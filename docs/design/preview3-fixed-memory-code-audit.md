# Preview 3 fixed Memory catalog: implementation audit and dispatch proposal

Read-only audit, October 17, 2026. This is input to Trish's reviewed plan, not an implementation authorization or a new normative specification. No code, shared Git references, PR, role launch, main branch, release branch or database was changed. No tests were run for this audit.

## Exact inputs and base policy

- Janet release tracker: donnabox/beads PR110, `codex/preview3-planning-execution`, head `ba8b3ab0ff58ca5504653df7b0184014e9aa8b04`; file `engdocs/drafts/preview3-integration-status.md`, refreshed directly from GitHub. Its top timestamp is stale compared with the appended October 17 milestones; use the newest entries and exact source heads.
- Authorized workstream starting point remains final `graph-preview2`, peeled commit `703bb13e91aa2cab2092443319139006d74242c8`. Janet's dedicated Preview 3 integration branch is still local-only pending Donna's approval. Do not start from an unqualified catch-up branch or write to frozen `release/preview2-integration`. When Janet names the published base, merge it into shared work branches and requalify.
- Latest catch-up PR113 is `b9eebc31f8e0f21b9a6154652476ed87027e9cad`, actual GitHub merge `9b39cae84d3d6f0e32fda033add5078e8751486b`. Janet records local installed 14-phase embedded/ordinary-server qualification, but hosted qualification remains pending in this tracker. Earlier PR111/112 green results do not transfer. These are context, not authorization to use that base.
- Seven critical files have identical Git blobs between graph-preview2 and PR113: graphstore `schema.go`, `types.go`, `records.go`, `informational_types.go`; CLI `graph_preview_types.go`, `graph_preview_issue.go`, `graph_preview_links.go`. This validates applicability of the observed foundation gaps despite upstream catch-up. It does not qualify either runtime here.
- Melinda Memory: gastownhall/bdp PR143 exact `38791e4cc6e16cf661fa839303d4ff315d49ab3d`, `specs/types/memory/memory.md`, eight schema/definition JSON artifacts and `fixtures/specs/memory/schema-cases.json`; 72 property-shape cases, not 72 runtime behaviors. Candidate contract still WIP. Refresh the exact landed commit before runtime catalog publication.
- New Donna ruling: retain legacy `related` Dependency identity/semantics. Coin a distinct Memory relation name; name is still TBD. Do not wire Memory to `--type related`.
- Existing work: `/Users/dbox/repos/wt/trish/trish-types-exact-closure` HEAD is Preview2 with **four untracked files**, `internal/typegraph/{graph.go,graph_test.go,CONTRACT.md,BUILD.bazel}`. Preserve/review them; do not rewrite the same evaluator. It has no callers and is not shipped. `/Users/dbox/repos/wt/trish/trish-types-foundation-audit` is same HEAD with untracked `engdocs/design/type-foundation-audit.md`. That older audit targets dynamic Types and must not become the V2 implementation scope.

Repo instructions read: root AGENTS, cmd/bd AGENTS, relevant testing guidance. Before coding, contributor preflight/open-PR overlap checks, issue linkage and layer-specific PR policy apply. Source and release qualification belong to Janet, not this worker.

## The decisive simplification

The proposed fixed Memory catalog contains six Bead Types (Memory, Observation, Decision, Procedure, Policy, Lesson) and six informational Link Types (new-name Related, Guidance, AppliesTo, Supports, Challenges, Supersedes). Each specialized Memory conforms to the exact Memory base contract. Supplied Links do not conform to Dependency or one another.

**None of these six Link Types declares a participation minimum, pair uniqueness, or acyclicity.** Parallel Links and cycles are intentionally allowed. The minimum needed validation is smaller than the general Types proposal:

1. Full inherited property validation and retention, including unknown open-root properties.
2. Nominal and conformance matching, with fixed immutable contract identities/revisions internally.
3. Union of source/target constraint pairs; both ends must satisfy the same pair arm.
4. Self-Link exclusion by identity, even when source and target revision pins differ.
5. Exact target pin required for Supports/Challenges/Supersedes; no silent auto-pin of bare input.
6. Local live floating versus retained exact endpoint checks.
7. Atomic source ownership/revision behavior; all outgoing Links of a Memory are owned.
8. Non-workflow semantics: Memory types and Links must not affect Issue readiness merely by existing.

General user-authored constraints, arbitrary conformance graph editing, Type Beads bootstrap, catalog installation/removal, aliases/registries and `bd type` CRUD need not ship. Generic arity/minimum/uniqueness/cycle machinery can be deferred unless a selected fixed Issue/Dependency contract adds such a requirement. Retain existing native Dependency checks. The positive-minimum deletion conflict can be outside this fixed catalog, explicitly, rather than pretending it is solved.

## Source reality: adding names alone does not implement Memory

| Area | Existing seam and actual limitation | Needed work |
|---|---|---|
| Installed catalog | `internal/storage/graphstore/informational_types.go`: builder, installed count/bytes/fingerprint validation. `schema.go`: fixed definitions and ownership. `types_read.go`: hand-written ID switch. | One closed catalog can be extended; keep integrity checks and distinguish compiled support from installed/usable capabilities. No arbitrary type fallback. Coordinate generation marker and fresh-workspace policy with Janet. |
| Properties | `graphstore/types.go` has `Properties{Title, Body}`; `CreateRequest` cannot carry other properties. `records.go` always creates one fixed Memory Type. | A complete JSON object carrier must preserve additional root fields and specialized requirements; typed helpers can read title/body without dropping other fields. |
| Updates | `memory_update.go`, `memory_properties_patch.go`: complete final-state patch is restricted to exactly title/body. CLI `graph_preview_memory.go` rejects any other property. | Reuse atomic patch/guard/no-op implementation but validate whole post-state against selected contract. Replacement must fail if required specialized fields disappear. |
| History | `history_exact.go` accepts only current Memory Type and checks old snapshot affiliation against current catalog type. Issue history reconstructs the installed Issue type. | Historical reads must validate against the historical contract, not reinterpret through current affiliation. Even fixed catalog expansion needs all new subtypes admitted. Explicit retyping requires a deliberate further history change. |
| Type selection | `graph_preview_issue.go`, `graph_preview_types.go`, `graph_preview_links.go`: current task/bug map to one Issue; native relations map to one Dependency; Memory is a special case. | Add six true Memory nominal identities and selectors. Existing native discriminator projection is a separate change if included. Preserve legacy Dependency `related`; don't silently steal selectors. |
| List/recall/search | `bead_list.go`, `graph_preview_list.go`, `graph_preview_memories_projection.go`, `graph_preview_generic_projection.go`: equality with one Memory Type. | All-Memory queries must include conformers and apply filtering before pagination; summaries must not leak complete body/steps/choice payloads as summaries. |
| Conformance | `internal/httpapi/graphread/selection.go` captures ID-only closure, includes self, but visited-set cycle handling is not rejection. New untracked `internal/typegraph` supplies exact revision closure/matching. | A compiled static membership table or reviewed evaluator can serve fixed catalog. No runtime graph fetch needed. Do not claim exact BDP profile adoption from using the evaluator locally. |
| Endpoints | `LinkRecord.Source/Target` and SQL `source_path/target_path` are strings; `informational.go` checks only live local fixed Issue/Memory. | Pins and opaque external references require representation/lookup/retention work, separate from catalog registration. Existing graphops/bdpwire reference values are reuse candidates, not proof of runtime support. |
| Link properties | `informationalProperties` and `link_properties_patch.go` only allow optional note. | Apply accepted Memory Link schema; preserve metadata and complete history. |
| Ownership | `informational.go` atomically versions Memory source; Issue informational source remains unchanged. Historical `validateVersionOwned` recognizes only fixed owners/types. | Generalize Memory-family dispatch, maintain exact snapshots. Whether Issue Guidance becomes owned is a product decision; no incidental change in a Type catalog PR. |
| Deletion | `memory_delete.go` currently refuses a Memory with any incident Link. | Required floating cleanup and pinned survivors are new lifecycle work. Merely adding pinned reads is insufficient. |
| Existing transactions | `backend.go`/writer token fencing, patches, native batch already exist. | Reuse commit layer. Native `bd batch` does not automatically support arbitrary Memory/Link multi-operation transactions. No requirement here to build a general batch engine solely for minima absent from the selected catalog. |
| Provenance | Current `Attribution` actor/status/recordedAt and retained records are real, not Provenance V2. | Polly/Jim own revision/history evolution. Activity is separate and needs exact owner/acceptance, not a side effect of adding Memory subtypes. No signatures required. |

Current graph-preview storage and APIs are specialized internal surfaces. They already diverge from the public BDP schema. Local V2 changes do not authorize editing vendored BDP schema bytes or advertising pending Types/Write contracts. Preserve/refuse unsupported HTTP projections truthfully and coordinate any wire changes with Vickie.

## Ordered implementation slices

### P0 — independent compiled-contract foundation, dispatchable today

Finish/review the existing pure exact conformance evaluator without dynamic loaders; then implement pure fixed-Memory property validation and local endpoint-pair predicates in a small internal package (suggested `internal/memorytypes`, final name implementation choice).

Inputs are a finite internal catalog key and complete properties; endpoint predicates consume already-resolved local category/conformance/revision context supplied by the caller. Output is acceptance or precise field/endpoint diagnostic. This is not a database, protocol schema, definition representation, registry, or Type management API. Fixed Go declarations are acceptable. No production Type IDs or aliases need be chosen for this step; contract fixtures can use draft symbols and exact source provenance.

Use pinned schemas/cases as executable requirements. The existing dependency graph already has `github.com/santhosh-tekuri/jsonschema/v6 v6.0.2` indirectly; using it is possible, but compare simple compiled/hand-coded validation against fixture fidelity rather than adding a general schema platform. Do not use loose structural checks that miss closed nested objects, nulls, number precision or format validation. Captured fixtures are test inputs, labelled nonnormative, with source commit/path/hash.

Acceptance: all 72 property cases (including inherited base validation), extra timestamp interval-order cases, preserve empty body and absent-vs-unknown inception, no `kind`, unknown root preservation, required specialized properties, whole-pair matching counterexample, no self-Link across different pins, required explicit citation target pin, and non-workflow classification. Endpoint validation should reject/return unsupported for unimplemented external resolution expectations rather than invent them. No I/O and no product capability advertisement.

This slice proceeds independently of retyping, persistence pins, History provider, Memory PR landing and registry decisions. It is candidate implementation until Melinda's landed version is reconciled. It is not Memory feature completion. Keep runtime integration separate and do not expand P0 into definition Beads/ConformsTo storage.

### P1 — full properties and subtype storage

After contract/identity selection: extend catalog initialization, generic Record/Create/patch/read paths, retained decode, owned validation and comparison to all six fixed Memory types and complete JSON property objects. Omitted type stays unchanged; no implicit subtype inference. Do not implement explicit retyping accidentally just because payloads now admit extra fields. Initially create each subtype directly in one transaction. One layer per PR, stacked where needed.

Meaningful acceptance: create each subtype; reject missing base/specialized field atomically; patch title preserves unknown root fields; replacing properties without required fields fails without revision; null distinct from empty; no-op no revision; reopen reads identical full current and historical properties; injected mutation failure leaves allocation/current/history unchanged. Exact history returns original affiliation/content after later updates. Test ownership of every Memory subtype, not only plain Memory.

### P2 — CLI and discovery through existing commands

Wire `--type`, `--properties` and existing patch/replace surfaces; `bd types --details`; show/recall/list/search/compare. All-Memory selection includes specialized types by conformance; nominal filtering remains distinguishable. No user-defined installation or new `bd type` subtree. New Memory relation name and selector collision check must be decided before exposure. CLI should not duplicate property validators.

Acceptance: a complete CLI Procedure creation with title/body/steps; ordinary Memory capture unchanged; exact selection vs family discovery; bounded result ordering/filter-before-page; updates preserving omitted/unknown properties; inventory exposes only usable catalog. Existing `--type related` still native Dependency behavior. Show/summary payload boundary is checked. Follow Janet's command/output decisions; don't settle human/JSON output policy in this PR.

### P3 — required endpoint references, Link catalog and ownership

Coordinate Trish Link/Reference lane with Polly/Jim History rather than privately reimplementing retained-state lookup. Add selected local floating/exact endpoint carrier, historical admission, fixed pair predicates, self-reference exclusion and citation pin checks. Then install/expose six informational links. Keep remote reference carriage decision explicit; no federation or network dereference is required for opaque external references.

Acceptance: Guidance Issue→Memory conformer succeeds, reverse/wrong local pairs reject; new Memory relation rejects Issue→Issue; Supports without exact target rejects; exact target resolves old subtype/content after current changes; source or target self identity rejects across pins; parallel Links allowed; unrelated cycles allowed; source-owned link add/update/delete versions source atomically and keeps old owned snapshots; Issue readiness unchanged by informational links. Include concurrency/stale guard/rollback tests. Exact-source pin mutations and owner-current-state behavior need a ruling or an explicit unsupported boundary.

### P4 — lifecycle/retyping/provenance integration

This is separate work, not hidden in catalog extension. Include only selected Preview3 requirements after owner agreement: note→Procedure atomic type/properties transition; retained original affiliation; revalidate affected floating links; delete cleanup for floating references and exact survivors; terminal revision and shared revisionProvenance; Activity authoring. Full V2 may need these even if a narrower Preview3 type slice lands first. No claim that fixed catalog alone satisfies Memory lifecycle.

## Decisions that block different steps

| Decision | Blocks | Does not block |
|---|---|---|
| New Memory relation name/selector | Runtime Link exposure/catalog final identity | Property validation, Bead subtypes, pair evaluator with internal symbolic IDs |
| Production catalog identity and historical meaning scheme | Persisted nominal affiliation/catalog release | Pure algorithms/validators |
| Preview3 retyping scope: allow Memory-family only, all fixed types, or defer with refusal | Retype writer, affected-link validation, old/current affiliation handling | Direct subtype create and ordinary property updates |
| Pin support cutline including source pins | Citation Links/complete lifecycle acceptance | Pure property validation and catalog metadata |
| External opaque reference carriage selected or explicitly deferred | External Link cases, not local relationship predicates | Local-only implementation; no federation implied by later carriage |
| Issue Guidance ownership and compact structured exposure | Issue revision effects/owned view | Memory-owned outgoing behavior, separate Link discovery |
| Deletion/minimum conflict | General minimum-accepting fixed catalog only | Catalog currently declares no such minimum; preserve native Dependency behavior |
| Polly/Jim shared provenance/history details | Terminal deletion, revision envelope, Activity workflow as applicable | Property validation and local type conformance computation |
| User-defined Type representation, bootstrap/registration | None of fixed-catalog V2 | All listed fixed-catalog work |

A finite operational resource/owned-set budget is still required and must refuse rather than truncate. Existing `PreviewOwnedLinkLimit=1000` is a disposable bound, not a newly accepted Memory domain maximum; preserve/report until consciously changed.

## Ownership/overlap and tests

- Janet: base publication, generation markers, Issue/Dependency shim/projection behavior, CLI compatibility, build/installed qualification. Recheck source owner before touching common catalog/init files. No wait on her entire catch-up is necessary for P0.
- Melinda: exact accepted schemas, six Bead/six Link domain rules, final naming and spec landing. Refresh source pin before claims.
- Trish: conformance evaluator, pair/Reference semantics, integration plan. Existing untracked evaluator must be preserved and reviewed, not assumed already qualified.
- Polly/Jim: history, terminal revisions, provenance envelope and mint/participation seams. Reuse existing history provider.
- Vickie: public BDP DTO/schema/capability boundaries; avoid unrelated reference implementation edits.
- Iris: PR87 `b5973def8e395e5acee6707ac02bb3bd654c03f1` adds `graphstore/export_current.go` with fixed current-Type/endpoint/owned closure assumptions; catalog/payload changes require her review of export acceptance. PR88 `649350ba8534315d55ee1fddaed87c699dabf8a8` publication sink is independent. PR86 legacy import may likewise need new payload/schema mapping; import/export is not a prerequisite for P0 or direct Memory creation.

Use `scripts/test.sh` for focused pure/package suites, then appropriate repository gates; do not conflate default Dolt skips with persistence qualification. Existing regression anchors include `TestReadInstalledTypes`, `TestExampleInformationalTypeLifecycle`, generation guards, `TestMemoryUpdateLifecycle`, `TestMemoryPropertiesPatchLifecycle`, refusal/rollback/concurrent-owned-writer/lost-commit-response tests, `TestReadVersionRetainedLifecycle`, `TestReadVersionOwnedMembershipByOwnerKind`, `TestVersionComparisonMemoryDirectionAndContext`, informational lifecycle/concurrency tests, collection/selection tests and graph CLI fixtures. After wiring, installed embedded and ordinary shared-server scenarios on exact candidate are mandatory for shipped claims. Refresh BUILD manifests when adding files. No full runtime test was executed by this read-only audit.

## Suggested first worker prompt

Implement only P0's pure fixed-Memory contract foundation, starting a separate workstream branch from graph-preview2 (703bb13e) unless Janet explicitly supplies a newer approved integration base. Read and preserve existing untracked internal/typegraph work; do not edit its owner's checkout. Run required contributor preflight and coordinate package ownership before implementation. Use BDP Memory PR143 exact38791e4 as candidate input, keep test fixture provenance, and label implementation unexposed until the accepted landed contract is reconciled. Supply complete-property validation for all six fixed Memory forms and pure local pair/pin/self-link checks; reuse existing exact conformance computation where useful. Keep all type IDs/names configurable in internal test/catalog inputs until product naming is settled. No storage, CLI, schema migration, Type Beads, dynamic registration, public wire change, provenance redesign, federation, Rust, or main/release mutation. Deliver a reviewed small PR or patch according to the parent-authorized publication scope, with focused tests and exact evidence; enumerate remaining integration gates. Parent owns outward coordination and release admission.
