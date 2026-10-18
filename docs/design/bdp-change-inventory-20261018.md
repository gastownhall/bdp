# BDP change inventory — owner review

Non-normative review packet requested by Donna on October 17, 2026 Pacific.
This collects proposed changes; it does not adopt a protocol contract. Only the
adopted documents under `specs/` define BDP. The governing ledger is
[BDP #59](https://github.com/gastownhall/bdp/issues/59).

## Review entry point

All four owners have contributed. The most useful first review is the shared
mutation boundary: **retyping, re-pinning, source guards, deletion and recovery**.
The product has selected meaningful behavior here while current Core/Write still
contains incompatible immutability or live-target rules. Specify these effects as
atomic operations before inventing new CLI carriers.

Three additional decisions deserve their own sessions: the minimum historical
transfer carrier and admission evidence; durable Memory keys versus aliases; and
multi-principal provenance. Generic CLI conveniences can proceed as a design draft
against the current contract without deciding those questions. The companion CLI
is documentation only, with no domain commands or compatibility obligation.

Pinned owned-source timing remains parked. No section below overrides that hold.

## Evidence and collection status

Public BDP main was verified at
`3ab9cdf5d45a2ea49a84ab191eac77c9aeaa19d0` when collection began. A proposal's
source head and a qualified implementation head are separate evidence.

| Contributor | Requested contribution | Collection state |
| --- | --- | --- |
| Janet | Product/BDP boundary, pins and ownership, Type changes, transactions, discovery and CLI pressure | Twelve-topic release/contract inventory received; stale recovery naming and guard wording reconciled below |
| Iris | Import/export and interchange, atomic operation subsets, Events, identity and aliases | Nine-topic inventory received; exact proposal heads and stale-source caveats recorded below |
| Cleo | CLI-driven protocol needs and shared CLI-spec format | Eight-topic inventory and exact format handoff received |
| Polly | History, terminal deletion, recovery, provenance, ordering and signatures | Ten-topic inventory received; update-based recovery naming reconciled against Donna’s later ruling |

The shared index groups the changes; the owner sections below supply scenarios,
current-versus-desired behavior, status, dependencies and recommendations. Source
receipts identify the fixed evidence. The shared index consolidates Trish and all
four requested owners. Collection is complete; owner recommendations are not approvals.

## Shared change index

| ID | Scenario and current gap | Direction and status | Review boundary |
| --- | --- | --- | --- |
| BDP-01 | A Bead or Link deliberately changes its Type or exact Type revision. Current main treats affiliation as immutable. | Explicit replacement is accepted design; exact wire/schema propagation is outstanding. | Separate the primitive from the optional general Types system. Preserve historical meaning and validate the resulting graph, including ownership transitions. Additional mandatory retyping guards and Type-history presentation remain operation-contract questions. |
| BDP-02 | A citation changes its endpoint revision while retaining Link identity. Current main makes endpoints/pins immutable. | Same-ID re-pin is accepted product direction; detailed contract propagation remains. | Endpoint identity, endpoint pin, write guard and source aggregate revision are different values. |
| BDP-03 | Deletion preserves selected pinned citations and records history; selected old content can become a new current revision. | Product direction exists; main requires live update targets and reserves committed IDs permanently against re-creation. Terminal admission, recovery guards and operation details remain to reconcile. | Cleo's latest draft records update-from-revision as the candidate surface, superseding a separate revert verb. Never-allocated identities refuse recovery. Do not silently choose Type/endpoint rollback or Link resurrection. |
| BDP-04 | A Type definition is a versioned Bead with owned conformance declarations and retained schemas. | Isolated Types draft; not adopted by main. | Exact defaults, installation, retained dependencies and conformance are distinct from ordinary external graph traversal. |
| BDP-05 | Replacement handles service-managed and initialization-only properties; heartbeat-like observations change independently. | Shared property categories selected in the latest Types discussion; representations and Write propagation remain. | Replace writable data, preserve initialization-only values, service-complete stable fields, validate the result. Live observations are outside revision-covered properties. |
| BDP-06 | Multiple inherited ownership selectors choose one Link, including a specialized Link Type. | Nominal-Type grouping selected for the draft. | Each Link once; empty set is empty. Requires an explicit Core projection amendment. Pinned owned-source semantics are explicitly deferred. |
| BDP-07 | A server supports a useful atomic subset without pretending to implement every Transactional operation. | Existing Iris proposal, not adopted. | Preserve atomicity, support discovery, refusal precedence and retained retry outcomes. Never emulate atomic batch with a sequence. |
| BDP-08 | Link lifecycle facts, deletion/import context and feed ordering need consistent Event representation. | Existing Iris proposal plus History questions, not adopted. | Keep lifecycle Events separate from current owned snapshots, generic causality and a full activity feed. |
| BDP-09 | Portable graph transfer preserves identity, retained revisions and evidence. | Interchange proposal; legacy import/export implementation is a separate delivery. | Exact Resource contract, authority, erasure and closure checks must be explicit. File transfer does not require network federation. |
| BDP-10 | Compact discovery, coherent list/query behavior and property/metadata editing should work across domains. | Product design exercises; protocol versus client-only boundary remains to classify. | Client-side truncation cannot establish a server-side no-body guarantee. No domain-specific flags in the reference CLI. |
| BDP-11 | Revision/activity provenance and evidence distinguish who proposed, approved and committed a change. | Mixed accepted product choices and open shared proposals. | Polly’s harvested requirements distinguish carried claims, authenticated submission and optional evidence; participation does not grant permissions. Illustrative envelopes are not valid new wire. |
| BDP-12 | Users discover available Type revisions without changing installed/default versions. | Trish recommendation under discussion. | Prefer generic revision discovery and a CLI convenience; no automatic installation/promotion or compatibility inference from revision ordering. |
| BDP-13 | A durable Memory key survives title changes and transfer, independently of its canonical ID. Existing aliases are unversioned and repointable. | Open naming/lifecycle decision; no carrier selected. | Donna decides with shared identity/History and Memory owners. Determine uniqueness, reassignment, deletion/reclaim, export and whether key changes mint a Resource revision. |

## Polly contribution

Source: Polly’s October17 Pacific inventory, based on public main
`3ab9cdf5d45a2ea49a84ab191eac77c9aeaa19d0`, shared draft `b12665d6`,
[Provenance V2 #7510](https://github.com/gastownhall/beads/issues/7510)
(body observed at `2026-10-17T22:37:54Z`), and its
[Inception/lifecycle decision receipt](https://github.com/gastownhall/beads/issues/7510#issuecomment-6242419971).
The source inventory is retained locally with its issue snapshots. These are
owner-reported design positions, not an adoption vote.

| Topic | Desired behavior / status | Consolidation and next question |
| --- | --- | --- |
| Multiple principals | Represent submitter, initiator and contributors without treating all caller claims as authenticated facts. Donna-directed redesign; exact roles and shape open. | Expand BDP-11. A principal can have multiple roles; identity authentication does not prove each role claim, and participation labels grant no RBAC permissions. Current Core’s closed carried basis permits only `writer-supplied` or `unknown`; illustrative `authenticated` values are not current wire. Resolve meanings before schema edits. |
| Portable attestations | Optional approval of an exact request, separate service acceptance evidence, later endorsements and exportable verification. Proposal. | Separate amendment from unsigned provenance. Preserve signed bytes and bind evidence to its subject; DSSE demonstration is not a protocol decision. Trust, replay, generated fields and erasure remain questions. |
| Terminal deletion | Mint attributed terminal revisions for both Beads and Links; keep ordinary deleted GET behavior and historical evidence. Accepted product direction, unpropagated. | BDP-03. Specify terminal fields, final-live reference, deleted-state guard and Event/receipt mappings together. |
| Historical-base update | Create a new same-ID revision from retained properties/metadata under current authorization and constraints. Accepted semantic direction; operation details open. | BDP-03. Polly reconciled her inventory to Donna’s newer update-option preference; `--from-revision` remains a candidate spelling. No automatic Type/endpoint rollback or resurrection of other Links. |
| Inception | One open field for how the current period of presence in the Scope began; ordinary updates preserve it. Accepted direction. | BDP-11 plus BDP-03/09. Propagate the existing single-field decision; do not restore obsolete origin/entry facets or infer upsert implementation permission. |
| Revision sources | Preserve unknown versus known-empty sources and completeness; a real sources/completeness change is revision-worthy, attribution-only context is not. Accepted direction with concrete amendment pending. | BDP-11. Resolve equality, omission and reset semantics; citations neither fetch their targets automatically nor prove support for a claim. |
| Owned snapshots | Exact history uses recorded owned state, not current joins. Existing protocol law. Pinned owned-source timing expressly deferred. | BDP-06. Preserve competing examples without choosing A or a floating-only alternative overnight. |
| Ordered project history | Reuse existing Transactional positions/change groups rather than timestamp-sorting a supposedly complete feed. Primarily coverage/implementation work. | BDP-08. Time-to-position convenience, if wanted, is a separate question. Full feed expansion is not silently added to the product release cutline. |
| Erasure and evidence | Existing retention/erasure laws must also govern new signed-byte copies, indexes and bundles. Existing contract plus evidence-specific open work. | BDP-09/11. Do not equate missing rows or authorization tombstones with deletion/erasure, or imply Events carry every erasure record. |
| Activity and time | Activity is ordinary typed content unless a concrete generic gap appears. Full Activity expansion remains a proposal; additional timestamps explicitly deferred. | Domain modeling is not a reason for a domain command in the reference client or a special Activity protocol primitive. |

Polly recommends prioritizing multi-principal semantics and the bounded terminal/
historical-base operation contract, while keeping optional signing, Activity and
full feed expansion separately scoped. The recommended review order below incorporates Iris and Cleo; Janet’s release
constraints narrow the mandatory product path without adopting protocol changes.


## Source receipts

These fixed inputs make this collection reproducible. A local draft hash identifies
its actual content; its checkout HEAD is not a claim that the draft was committed.

| Input | Exact evidence | Use and limit |
| --- | --- | --- |
| Current Core/Write | Public main `3ab9cdf5d45a2ea49a84ab191eac77c9aeaa19d0`; Core blob `4061daefcbea3d49ff94ad669ca716e53c000179`, Write blob `ef9616df402b6f160381515619721f070100572d` | Adopted baseline for current-versus-desired comparisons. |
| Main Types draft | At main `3ab9cdf5`, Types blob `9c07daf3afc3e97d8d0b57a204269c2bb470628f` | Published WIP comparison input used by Cleo; the document itself is not an adopted Types profile. Adopted Type rules still reside in Core. |
| Latest Types candidate | [a575dc3d](https://github.com/gastownhall/bdp/tree/a575dc3d4f7369a3dbce5987f5a5f0fea426fef1/specs/profiles/types) | Accepted design rules and explicit open issues; not adopted Core/Write. Supersedes earlier candidate snapshots; does not replace the main comparison checkpoint or adopt new wire. |
| Cleo product CLI | Local `docs/reference/graph-cli-specification-draft.md`, SHA256 `d9af1f9b6b6c3509da3ef6f795ed64659e40225008d572a883d74221a7898dda`, uncommitted atop `c67855b4f7c1e4fb24409eb22d142a52d19ab92f` | Product decisions CLI-01–08 and shared documentation format. |
| Cleo handoff | Local `engdocs/design/preview3-cli-bdp-change-inventory.md`, SHA256 `a523894925397b0415288a4bee5e887f16824831f5dbfc973752686005b00317` | Eight bounded topics, format/table definitions and acceptance mapping. |
| Iris inventory | [Archived source](https://github.com/donnabox/agent-coordination/blob/675fc221cf9fdfe9620ef3b04e90272cd8a1e2ca/context/iris/bdp-change-inventory-20261018T043200Z.md), SHA256 `679166a2dd73bb69dea6b836dde6c0b249e446a2dda61fc673793f9c9a08dbb3` | Nine topics; later implementation receipts do not adopt these proposals. |
| Polly inventory | Local `bdp-design-inventory-20261017/INVENTORY.md`, SHA256 `087699b33a07de5f3bf670590a4acb3a30dac0d68611654ab3f1bcacf0fd89ec` | Ten topics, including corrected update-based recovery wording. |
| Janet inventory | Local `preview3-upstream-catchup-20261015/BDP-DESIGN-INVENTORY-JANET-20261017.md`, SHA256 `70bd90580d0614bbe99f578909f18e2d985adcfe88f2d1af6ac988c12dd7c8e8` | Twelve release/contract topics; detailed implementation receipts remain Janet-owned. |
| Batch subset | [PR163](https://github.com/gastownhall/bdp/pull/163), `7fa05f35fa014feacef71e8e9719e7911f151315` | Open draft for #152; not an implemented capability claim. |
| Lifecycle Events | [PR164](https://github.com/gastownhall/bdp/pull/164), `11175cb6d6d3d1991f5281f6dbe6d9c99c582434` | Open draft for #153. Its older body review pin does not cover this head. |
| Interchange | [PR165](https://github.com/gastownhall/bdp/pull/165), `006a998de0f54d63906e51e99d230d59225ac9db` | Open draft; older origin/entry and Memory planning text needs reconciliation. |

Cleo’s local files are under
`/Users/dbox/repos/wt/codex/preview3-cli-spec-20261017/`;
Polly’s inventory is under `/Users/dbox/.local/state/polly/`.
The hashes above were checked directly, not inferred from chat summaries.

## Iris and Cleo contributions — consolidated

| Topic / owners | Current versus desired and status | Dependency, recommendation and acceptance case |
| --- | --- | --- |
| Atomic subset / Iris, Trish | Main couples batch to the complete Transactional profile. Go’s six Bead/Link create/update/delete operations are selected product scope; subset discovery and unsupported-operation refusal are proposed in PR163. | Settle discovery, first unsupported member, retry/conflict precedence and zero-effect refusal. A mixed supported/unsupported new batch must change nothing; retained retries must preserve their original outcome. Do not rename a non-atomic sequence “batch.” |
| Lifecycle Events / Iris, Polly | Current incidence events differ from proposed symmetric Bead/Link create/update/delete/import facts; PR164 retains delta-based updates. Selected direction, proposed encoding. | PR164 must settle discriminators, terminal context, old-log handling and projection deduplication. A self-Link lifecycle fact must not be counted twice; importing history produces local import effects, not replayed source Events. |
| Shared query/export Resource / Iris, Cleo | Complete collection Resources already exist. Richer mixed queries, compact discovery and bounded correlation do not. Donna selected query-first/shared complete Resource output; existing list commands remain unchanged. | Freeze a common Resource corpus first. Query and transfer envelopes may differ. Compact results must be separately identified and cannot masquerade as complete import records. Rich query syntax, read-only POST, ranking and count endpoints remain proposals. |
| Identity-preserving transfer / Iris | PR165/#7662 propose JSONL framing, explicit heads, closure, limits and atomic fresh-destination publication. No adopted general transfer operation exists. | Preserve canonical IDs and opaque revisions in an authorized realization of the same logical Scope; collisions refuse. A pinned older endpoint and its historical owned closure must survive, or the entire import must refuse. No implicit remint/upsert, replication or arbitrary archive support. |
| Import head / Iris, Polly | Retain the imported exact version and original provenance unchanged, then create a new local head referencing that source version with `inception: import-insert`. Accepted direction; transition encoding remains pending. | Coordinate History/Event effects and attribution; ordinary edits preserve Inception. The destination must not rewrite the retained original as though it was locally authored. |
| Historical representation / Iris, Polly | Core can project missing old metadata as `{}` without changing the original revision; PR165’s scaffold requires explicit metadata. | Decide how original retained representations and version-specific contracts travel. A read projection must not be asserted to be original bytes. Do not “repair” history silently to satisfy the newest schema. |
| Retained-copy admission / Iris, Polly | Existing Core already requires origin/version identity and erasure-status evidence before visibility. Concrete transfer realization remains open. | Unknown erasure status must not admit a retained copy. A digest, authorized destination or retained revision token alone is insufficient. No automatic requirement for signatures or Activity follows. |
| Durable Memory keys / Trish, Polly, Iris; Melinda supplies Memory requirements, Janet acceptance | Core aliases are unversioned and repointable. A durable Memory key requirement is not yet mapped to a carrier or lifecycle. | Donna must settle namespace, collision, reassignment, release/reclaim, historical/export semantics and whether key changes mint a Resource revision. A title rename must not destroy lookup. Do not invent `properties.key`, `metadata.key` or an alias equivalence overnight. |
| Observations and exposure / Iris, Trish, Melinda | Stable service-generated fields and live observations differ; exact representation is open. Product policy excludes Memory from ordinary export without explicit inclusion, and automatic export emits no Memory. | Required transfer closure must obtain appropriate consent or refuse; saved configuration is not consent. Importing a historical heartbeat/lease must not activate execution. Generic reference commands do not acquire Memory-specific flags. |
| Property/metadata editing / Cleo | Write already supports atomic paired changes with JSON Patch/Pointer semantics. CLI flags are uneven. This is primarily CLI work. | Reuse current operations; specify values, escaping, null versus removal, arrays and ordering. A failed metadata patch must roll back a simultaneous properties change. No new wire set/unset verbs are needed merely for convenient syntax. |
| Independent source guard / Cleo, Trish, Polly | Product supports optional source-revision guards; current closed Write Link DTOs only carry the Link guard. Result `source` and `sourceRevision` already exist. | Add the missing input through a coordinated amendment, not properties/metadata or a racing pre-read. Either stale guard must fail the entire operation, including a would-be no-op. Omission follows the selected current-source behavior. |
| Safe deletion / Cleo, Polly, Trish | Main refuses a live incident Link. Shipping v1.3.1 already removes incident dependencies under `delete --force`, and dependent Issues under `--cascade --force`; Preview 2’s blanket refusal was a preview limitation. Selected direction needs compound effects and retained pinned citations. | Define terminal revisions, visibility, pinned survival, constraint checks and affected source revisions together. A force/override flag must not bypass supplied revision guards; stale guards refuse the whole compound deletion. Preserve the existing product dependent-Issue workflow under its compatibility obligations; this does not request a universal BDP cascade primitive. |
| Historical-base update / Cleo, Polly | Main updates require live targets and change arrays, have no retained-base input, and forbid creating a previously committed ID again, including after deletion. Same-ID recovery is accepted; new `revert` command is superseded by an update option. | Keep content base R1, current guard R7, actual predecessor and resulting revision distinct. Define terminal-ID admission; never-allocated identities refuse. Decide restored fields, required versus optional current guards, base-only invocation, no-op policy and key release/reclaim. Apply current authorization, Type/conformance and graph validation to the result, with atomic outcomes for concurrent recovery, erasure/pruning and key conflicts. Do not emulate atomic recovery by client read/replace or delete/recreate. |
| Capability exposure / Cleo, Vickie, Trish | SDK methods are broader than the executable, which currently exposes the domain readiness command. | Trish/Vickie must record a coherent adopted contract checkpoint, selected profiles/schemas and separate implementation heads before conformance claims; preserve Vickie’s existing completion target. Generic CLI implementation is a separate task. Refuse unavailable capabilities; preserve unknown mutation outcomes and receipts. Definition APIs, retyping and recovery need adopted wire before executable support claims. |

## Janet contribution — release boundaries and additional gaps

Janet’s inventory is at
`/Users/dbox/.local/state/janet/preview3-upstream-catchup-20261015/BDP-DESIGN-INVENTORY-JANET-20261017.md`.
Its main additional requirement is **semantic validity of local historical pins**:
current Core stores and echoes endpoint revision tokens without establishing that
the selected retained state is available, even in Scope. Existing structured pin
syntax is therefore not proof of exact-citation behavior. Main already defines
exact reads and typed missing-state diagnoses for its optional,
advertised History capability. The product needs endpoint-pin admission and
availability policy connected to that resolution through a selected capability or
profile rule, not silently strengthened obligations for every v0 Reference;
ordinary external pins remain unverified. Keep URI identity matching/incident
traversal separate from resolving the selected endpoint revision. Polly owns the
History meaning, Trish profile placement, and Janet the implementation evidence.
An acceptance case creates an in-Scope exact citation, removes or erases its
retained target state, and verifies the selected refusal/unavailability behavior
without silently floating the pin.

Janet also supplies three constraints on the plan:

- **Atomic primitives first:** re-pin, retype or deletion can affect multiple
  Resources even when submitted as one operation. Define their atomic extent and
  rollback/guard behavior. This does not make adoption of a general batch profile
  a product prerequisite; do not emulate a primitive with an interleavable sequence.
- **CLI syntax remains an adapter:** compact `ID@REV` or bracketed URI spelling
  must not become the stored/wire ID. Endpoint pins and write guards differ;
  ordinary external references remain opaque. Legacy product parsing obligations
  do not transfer to the new generic reference CLI.
- **Qualification remains separate:** a green source carrier, parser or F0 helper
  does not establish Memory functionality or advertised server capabilities.
  Product integration needs exact-source, installed and hosted proof under Janet’s
  ownership. Memory V1’s selected broad feature set is default-on, with named individual
  exceptions; Donna owns that release cutline and its exceptions. General Type
  installation, broad Activity, transfer and batch remain
  outside the mandatory Preview 3 path unless a selected scenario requires them.

Two owner-input discrepancies are reconciled by later human decisions, not a vote:

1. Janet J6 still says the selected command is `bd revert`. Donna’s later Cleo
   discussion and Polly’s corrected inventory supersede that spelling with an
   update option. Same-ID/new-revision recovery and Inception `revert` remain intact.
2. Janet J4 asks whether the source guard is mandatory. Cleo’s C07 records the
   existing selected **optional** behavior, including omitted-guard semantics and
   stale-guard refusal for no-ops. Preserve that product rule while designing the
   missing shared wire input. Any newly mandatory guard is a separate decision,
   not implied by this inventory. Additional mandatory retyping guards and the
   current-guard policy for historical-base updates are distinct, still-open questions.

Janet’s first recommended discussion, owned-source pin timing, remains expressly
**deferred by Donna**. It is a real admission blocker for that route, not an
invitation to settle it overnight. The local implementation’s refusal of
owned-source `@current` remains in place.

## Reconciliations and recommended discussion order

- **Keep accepted semantics:** explicit Type replacement, same-ID re-pinning,
  single-field Inception and query-first alignment are not reopened because an
  older main draft or reviewer uses stale wording. Their wire propagation is still
  work. The preview’s Memory-family retyping scope does not authorize cross-family
  conversion.
- **Use the later recovery surface:** update from a retained revision supersedes
  `bd revert` as a command proposal. The Inception value `revert` is a separate
  semantic value and has not been renamed. Shipping `bd restore` retains its Issue
  pre-compaction recovery meaning; it is not repurposed for this operation.
- **Separate real protocol gaps from CLI convenience:** paired properties/metadata
  patching, ordinary display formatting and batch-member authoring can reuse
  existing operations. Server-side compact acquisition, independent source guards,
  terminal revisions and historical recovery cannot be supplied by flag spelling.
- **Retain explicit holds:** question14 (pinned owned-source timing) waits for Donna;
  signing/provenance shapes wait for shared review; Type lifecycle and schema seams
  remain open. Neither a majority of owners nor a review council settles these.

Recommended review sequence, with Janet’s release constraints incorporated:

0. Record the coherent contract checkpoint and its selected profile/schema set,
   separately from implementation heads. Main `3ab9cdf5` is this packet’s adopted
   comparison baseline. Vickie completes against her existing target; any later
   successor and downstream contract pin require explicit reconciliation/adoption.
   This step neither adopts the evolving Types draft nor pulls it into her work.
1. Agree the amendment boundary for already-selected retyping, re-pinning and
   source guards. Keep historical pins, current guards and ownership effects separate.
2. Review deletion plus historical-base update as one lifecycle packet, including
   attribution, terminal state and the surviving graph.
3. Resolve the minimum transfer blockers: historical representation, erasure
   evidence, durable keys and import-head Inception. Do not couple this to a full
   new query language.
4. Review the small atomic-subset and lifecycle-Event proposals against the final
   Write checkpoint, preserving existing retry and ordering guarantees.
5. Review generic CLI choices and query acquisition needs; schedule multi-principal
   provenance and optional attestation as a shared design session.

This ordering is a recommendation, not a new Preview 3 commitment. Iris’s legacy
conversion, internal reader and detached export publication retain their own
qualification gates. F0 validators remain review-only. No owner contribution
qualifies downstream runtime or changes Vickie’s current implementation target.

## Reference CLI companion

The companion [reference CLI draft](../../apps/bdp/CLI.md) belongs beside the
implementation and is explicitly non-normative. Its target contains only generic
commands and flags. It is free to replace the current reference CLI surface
without a backward-compatibility obligation. Existing domain demonstrations are
evidence of current implementation, not commands to preserve in the target.

Cleo owns the product CLI specification. This companion uses Cleo’s supplied
document/table format and explicitly compares generic operations. Shared format
does not imply identical product and reference behavior or authorize changes to
either implementation. Its command mapping records BDP operation/read target,
required capability/profile, evidence head and unimplemented boundary. CLI wrappers
are explicitly separate from wire bodies; product `schemaVersion`/`preview`
wrappers are not imported as protocol fields. Its acceptance cases cover applied or
refused credentials, secret-free diagnostics, help/grammar consistency, cancellation
that preserves known outcomes, unknown delivery without unsafe retries, and no
atomic-batch downgrade. See the companion for the complete cases rather than
maintaining a second copy here.

## Decisions and implementation remain separate

The review packet will distinguish adopted contracts, accepted decisions awaiting
propagation, proposals, open questions and implementation-only gaps. No collected
proposal becomes an approval through inclusion. Main/shared merges, downstream
pins, Rust startup and runtime work retain their existing gates.
