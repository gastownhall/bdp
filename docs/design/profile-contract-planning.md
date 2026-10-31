# Cumulative profile execution planning (source-private)

This groundwork prepares the current required contract set for an actual served runner. It does not execute a service, emit an evidence artifact, enable a profile, or change the public artifact/admission guard. The source-only API is in `packages/conformance/test-support/profile-contract-plan.ts`; it is not exported or emitted in installed packages.

## One requirement set

`loadProfileContractSelection(profile, history)` loads the current Read, Read+Update, Transactional, numeric and owned-wildcard catalog sources before calling the existing profile selection/retirement machinery. Exact companion copies of Read rows are deduplicated; conflicting copies, duplicate retirement owners, unknown targets and invalid retirement edges fail. Diagnostics remain in source catalogs but never enter the required set. Optional History is loaded only when explicitly selected. All exact source digests accompany the selection. The ordinary loader reads the repository catalog directory directly, exposes no source-injection argument and refuses unclassified or missing catalog files. `inspectProfileContractSourcesForTest` permits malformed-source counterfactuals, but its results are unbranded and cannot enter execution planning.

A factory selection is immutable and cannot be replaced by a caller's smaller structural lookalike. The planning function preserves every selected obligation even when the executable manifest contains only one or no rows. Missing inherited behavior cannot disappear behind a delta-only manifest. Retirement also remains active transitively: a TX row retiring an RU row does not restore the Read row that RU already replaced.

At this change's source, there are 44 normative Read obligations (the 49-row catalog also has five diagnostics), 130 cumulative Read+Update obligations, and 251 cumulative Transactional obligations. The numeric/owned companions add five distinct Update obligations; RU replaces one Read row; TX replaces 12 RU rows. Counts are explanatory snapshots, not hardcoded authority or coverage scores. History and configuration-triggered applicability remain separate.

## Discovery correction and inherited executable plans

`read-update.discovery.document` now retires `read.discovery.document`: `readDiscovery` is closed and fixes profile read, whereas the normative RU discovery requires operations/aliases and profile read-update. TX already replaces the RU closed document; its cumulative set now also excludes the Read-only predecessor. The normative conformance index declares this replacement and its inherited effect at TX, mirrored by a catalog test. This reconciles selection metadata with existing closed discovery shapes; it adds no new wire semantics and changes no Read artifact. Shared optional-contract and omitted-order citations remain bound at each replacement profile.

`read.discovery.optional-limits` is **not** retired. Its bound requirement says omission neither means infinity nor permits silent truncation/non-normative refusal, which remains true at every profile. The old Read executable realization additionally asserts `readDiscovery`; a future cumulative manifest must use the selected profile's schema while preserving the limits behavior. Keeping an obligation does not mean copying its old executable realization unmodified. The same applies to the code/status Problem laws: TX changes the envelope for some errors, not their embedded Problem status or meaning.

## Exact served configuration inputs

`bindServedProfileConfiguration` snapshots a closed, non-secret input record plus actual fixture source bytes, then returns a factory-bound configuration. Only factory-bound configurations can be compared or planned. `assertSameServedProfileConfiguration` refuses to combine records differing in any field. The derived capability list is sorted, but any change to exact fixture bytes still changes its digest. U1/U2/T2 launchers must capture these values from the **same installed service/fixture**, never from a second qualified Read listener.

| Field | Required source |
|---|---|
| `scope` | Actual canonical HTTP(S) Scope URL, including stable authority/path; no credentials, query or fragment. |
| `profile` | Actual selected/discovered profile. |
| `history` | Actual advertised optional History selection; not inferred from profile. |
| `sourceCommit` | Exact 40-character source commit used for this installed implementation. |
| `installedPayloadDigest` | SHA-256 of actual installed payload, following existing cohort binding conventions. |
| `installedContractsDigest` | SHA-256 of exact installed descriptors, pinned identities and complete schema closure. U2 must define a deterministic capture of its actual configuration. |
| `policyDigest` | SHA-256 of non-secret installed visibility/operation/aggregate policy configuration. |
| `authenticationDigest` | SHA-256 identity of trusted credential-to-principal configuration, without raw credentials or attribution fields. |
| `fixture` (input) | Exact `ConformanceArtifactSource` bytes from the installed fixture. The existing source copy, JSON complexity bounds and fixture parser derive the ID, capabilities and SHA-256. |
| `fixtureDigest`, `fixtureId`, `capabilities` (output only) | Derived from those bytes; independent caller claims are rejected. Every planned row must name the captured fixture. |

The boundary rejects proxies, accessors, non-plain records and coercible non-string identities. It captures own data descriptors once, copies exact Uint8Array source bytes through the existing intrinsic boundary without caller iteration, applies bounded JSON and fixture validation, then freezes detached data. Caller records and source byte arrays remain unfrozen and later caller mutation cannot change a binding. The binding validates format/equality, not the truth of supplied values. The launcher still must establish payload/configuration capture and pair those observations with the run. This record is **not a new persisted evidence format**, public schema or credential container. A later evidence change requires separate review.

## Executable planning contract

`planProfileExecution(selection, configuration, execution?)` consumes exact executable manifest bytes using the existing intrinsic byte copy, bounded JSON and manifest parser, returns their SHA-256, and verifies the execution's same-configuration binding. No second request/action language exists. The result always has `claimEligible:false`; every requirement also appears in `unobservedIds`.

| Readiness | Meaning and next step |
|---|---|
| `unplanned` | No executable row exists. Author a real observation; do not drop the obligation. |
| `setup-unavailable` | Fixture lacks an executable setup capability. Supply an actual harness/service fixture; not a normative applicability waiver. |
| `applicability-unresolved` | Fixture lacks a manifest applicability capability. Review/justify the condition against actual supported configuration; this planner does not certify N/A. |
| `carrier-unsupported` | Current normative artifact/runner gates do not admit this manifest catalog/version/profile combination. Public gates stay unchanged; implement/review the carrier before running it. |
| `prerequisite-blocked` | A parsed prerequisite is retired, unplanned, lacks readiness, occurs too late in catalog order or forms a cycle. Repair the executable dependency chain. |
| `ready-unexecuted` | A parsed matching row has supported carrier, declared setup/applicability and ready prerequisites. This is structural readiness, conditional on a runner enforcing matching exact transport configuration before execution; no admission, behavior or coverage is established. |

Missing setup, missing applicability and blocked prerequisite lists remain available together. For a present row the display precedence is carrier unsupported, then prerequisite blocked, then applicability unresolved, then setup unavailable; absent rows stay unplanned. A carrier reason is also recorded at plan level, so unsupported carriers do not hide dependency failures. Retired rows, wrong-profile rows, diagnostics and unselected optional History cannot be counted as required execution. Invalid fixture/configuration pairing fails before planning. Current ordinary bundles retain their `read-v1` guard. Version-1 non-Read manifests remain rejected because that carrier does not bind the non-Read exact execution configuration. Version-2 Read+Update execution requires matching exact transport configuration; this planner does not itself receive or certify the runner's exact transport configuration. The source-private cumulative factory separately binds v2 `read-update-v1` to the canonical trusted selection. Transactional execution remains unsupported. Carrier support never implies qualification. Ready means ready to attempt, not adequate assertions or passing conformance. Fixture oracle pointers are checked against the captured parsed fixture. The actual runner must validate dynamic bindings and execute requests/negative controls on the actual target before producing observed results.

The first installed Read+Update executor captures its SQLite listener configuration, verifies the observed target binding before requests, and executes the partial cumulative manifest described in `read-update-executable-progress.md`. Further rows must use the same execution gate and actual after-mutation Read observations. Gaps remain explicit. U2 supplies installed contract/auth/policy fixture variants; each variant receives its own binding and applicability review. T2/T3 must do the same for the single Transactional owner and its receipt/replication surfaces. No sealed Read or development diagnostic bundle changes are needed for this planning layer.

## Next runner slice

After council closure, author the actual cumulative Read+Update v2 manifest and fixture against the installed P1 factory, including profile-specific discovery/limits and repaired inherited prerequisites. Add a separately reviewed profile-specific artifact path while preserving the existing Read guard; execute actual credentialed HTTP and after-state observations through the exact Read+Update configuration. Bind candidate evidence only after the installed U2 repair source is frozen. This is the next delivery slice; this planning layer does not pre-enable it.

The command-minimum catalog mapping adds one omitted inherited obligation to the explanatory snapshot above: historical 129 RU/250 TX and 81 audited RU rows become 130 RU/251 TX and 82 audited RU rows. The prior runtime evidence remains attributed to its original source; this metadata change adds no executable observation.

## RU→TX inheritance audit

Audited every 82 current RU catalog rows against the existing Transactional forms. The 12 existing direct-form retirements remain sufficient for this reviewed set; no additional TX retirement is introduced. The key text is [Mutation Transactions](../../specs/profiles/write/write.md#mutation-transactions): TX sequence keeps its envelope, declaration order, separate commitment and lack of isolation, projecting each receipt into the shared entry without adding a receipt member. [Batch operation target](../../specs/profiles/write/write.md#batch-operation-target) explicitly requires sequence 200 while singleton/batch returns receipt 200/202. [Transactional problem details](../../specs/profiles/write/write.md#transactional-problem-details) preserves code meaning but distinguishes direct, receipt and sequence contexts.

One misleading citation was removed from `read-update.singleton.owned-link-no-op`: “Read+Update has no durable Mutation Receipts and no BDP Events.” It described the lower profile, not the row's inherited no-op law. The row still binds revision/source/provenance retention; TX separately binds absence of no-op Events. No normative semantics changed.

| RU row | TX treatment | Basis / required executable context |
|---|---|---|
| `read-update.discovery.document` | Retired | Replaced by `transactional.discovery.document`; do not run the contradictory RU direct-form assertion. |
| `read-update.discovery.aliases` | Inherited | Required aliases remain required at TX; only the closed discovery document changes. |
| `read-update.discovery.limits` | Retired | Replaced by `transactional.discovery.limits`; do not run the contradictory RU direct-form assertion. |
| `read-update.discovery.operation-directory` | Retired | Replaced by `transactional.discovery.operation-directory`; do not run the contradictory RU direct-form assertion. |
| `read-update.singleton.create-bead` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.update-bead` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.document-patch-merge-replace` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.document-patch-atomicity` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.document-patch-validation` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.delete-bead` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.incident-links-nondisclosure` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.create-link` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.update-link` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.delete-link` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.owned-link-source-revision` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.owned-link-no-op` | Inherited | No-op retains Link/source revisions and provenance. Removed the unrelated RU-only no-receipts/no-Events citation; TX no-op Events law is independently bound by transactional.event.no-op-owned-update. |
| `read-update.singleton.attribution` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.expected-revision` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.expected-revision-race` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.hidden-subject` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.idempotency-key-required` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.unauthenticated` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.idempotent-retry` | Retired | Replaced by `transactional.idempotency.cross-carrier`; do not run the contradictory RU direct-form assertion. |
| `read-update.singleton.idempotency-conflict` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.unsupported-media-type` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.method-405` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.no-local-bindings` | Inherited | Operation/input/result-content law survives; observe result or failure through the TX receipt or shared sequence projection, with TX admission precedence. |
| `read-update.singleton.result-headers` | Retired | Replaced by `transactional.singleton.receipt`; do not run the contradictory RU direct-form assertion. |
| `read-update.alias.put-creates` | Inherited | Alias operation/identity/authorization law survives; TX uses locator-only singleton receipts and sequence projections, never atomic batch aliases. |
| `read-update.alias.put-repoints` | Inherited | Alias operation/identity/authorization law survives; TX uses locator-only singleton receipts and sequence projections, never atomic batch aliases. |
| `read-update.alias.delete-releases` | Inherited | Alias operation/identity/authorization law survives; TX uses locator-only singleton receipts and sequence projections, never atomic batch aliases. |
| `read-update.alias.uniqueness-invariant` | Inherited | Alias operation/identity/authorization law survives; TX uses locator-only singleton receipts and sequence projections, never atomic batch aliases. |
| `read-update.alias.link-coexistence` | Inherited | Alias operation/identity/authorization law survives; TX uses locator-only singleton receipts and sequence projections, never atomic batch aliases. |
| `read-update.alias.allocation-avoids-aliases` | Inherited | Alias operation/identity/authorization law survives; TX uses locator-only singleton receipts and sequence projections, never atomic batch aliases. |
| `read-update.alias.non-canonical-target` | Inherited | Alias operation/identity/authorization law survives; TX uses locator-only singleton receipts and sequence projections, never atomic batch aliases. |
| `read-update.alias.unknown-subject` | Inherited | Alias operation/identity/authorization law survives; TX uses locator-only singleton receipts and sequence projections, never atomic batch aliases. |
| `read-update.alias.carrier-syntax` | Inherited | Alias operation/identity/authorization law survives; TX uses locator-only singleton receipts and sequence projections, never atomic batch aliases. |
| `read-update.alias.authorization` | Inherited | Alias operation/identity/authorization law survives; TX uses locator-only singleton receipts and sequence projections, never atomic batch aliases. |
| `read-update.alias.forbidden` | Inherited | Alias operation/identity/authorization law survives; TX uses locator-only singleton receipts and sequence projections, never atomic batch aliases. |
| `read-update.alias.no-version-minted` | Inherited | Alias operation/identity/authorization law survives; TX uses locator-only singleton receipts and sequence projections, never atomic batch aliases. |
| `read-update.alias.sequence-binding` | Inherited | Alias operation/identity/authorization law survives; TX uses locator-only singleton receipts and sequence projections, never atomic batch aliases. |
| `read-update.alias.retained-without-reauthorization` | Inherited | Alias results disclose no Resource record; TX non-record receipt entry rules retain this. Receipt ownership/non-disclosure remains independent. |
| `read-update.alias.reference-resolution` | Inherited | Alias operation/identity/authorization law survives; TX uses locator-only singleton receipts and sequence projections, never atomic batch aliases. |
| `read-update.alias.reference-idempotency` | Inherited | Alias operation/identity/authorization law survives; TX uses locator-only singleton receipts and sequence projections, never atomic batch aliases. |
| `read-update.sequence.order-and-partial-commit` | Inherited | TX explicitly keeps declaration order, separate commitment and no sequence isolation. It is not an atomic batch. |
| `read-update.sequence.local-bindings` | Inherited | TX binds only committed identity; failed creator projects binding-unavailable. Pending/withheld extensions add independent TX rows. |
| `read-update.sequence.transient-predecessor` | Inherited | TX pending/transient creator projects idempotency-in-progress without executing the dependent; projection is nonwaiting, not a direct singleton refusal. |
| `read-update.sequence.expired-creator-binding` | Inherited | Expired completed creation preserves binding identity; TX adds explicit withheld/allocation forms. Test visible and withheld contexts separately. |
| `read-update.sequence.retained-failure` | Inherited | Terminal failed receipts project retained member problems for as long as retained. Expiry rules replaced separately. |
| `read-update.sequence.member-problem-shape` | Inherited | TX status matrix expressly keeps sequence 200 and shared member problem operationIndex/operationName. Receipt problem status is would-be status, not carrier status. |
| `read-update.sequence.retry-after-hint` | Inherited | Sequence retains shared member problem shape and may carry retryAfter on after-delay problems. Absence is valid; do not require emission. |
| `read-update.sequence.carrier-rejection` | Inherited | TX sequence keeps the RU request envelope and contextual preflight. Invalid whole carrier executes nothing. |
| `read-update.sequence.contextual-validation` | Inherited | TX inherits reference/ownership correspondence validation; interpret results in receipt or projected sequence entry. |
| `read-update.sequence.idempotent-retry` | Inherited | TX retained receipt projects at current sequence position/name without executing again; no receipt field added to sequence envelope. |
| `read-update.sequence.disconnect` | Inherited | TX admitted sequence retains independent per-member outcomes; disconnect decides no outcome. Recovery/internal fault has dedicated TX rules. |
| `read-update.sequence.internal-fault` | Retired | Replaced by `transactional.idempotency.durable-admission`; do not run the contradictory RU direct-form assertion. |
| `read-update.sequence.interleaving` | Inherited | TX sequence explicitly remains unisolated; unrelated requests may commit between separately atomic members. |
| `read-update.idempotency.in-progress` | Retired | Replaced by `transactional.idempotency.concurrent-join`; do not run the contradictory RU direct-form assertion. |
| `read-update.idempotency.key-reservation` | Inherited | All unknown member keys admitted together; TX records durable pending receipts/ownership in that step. |
| `read-update.idempotency.claim-atomicity` | Inherited | Same all-or-none admission step, not a sequence-wide execution lock. TX unresolved dependency reservations add obligations. |
| `read-update.idempotency.concurrent-dependent-retry` | Inherited | TX nonwaiting sequence projection preserves original attempt ownership; no second execution or poisoned dependency. |
| `read-update.idempotency.transient-not-retained` | Inherited | Transient post-admission TX abort retracts pending receipt/key; no terminal transient disposition is retained. Sequence pending projection is also not a new retained disposition. |
| `read-update.idempotency.semantic-identity` | Inherited | Record identity is inherited. TX batch operation order remains semantic; sequence labels/positions are carrier metadata, not operation identity. |
| `read-update.idempotency.principal-isolation` | Inherited | Authenticated principal remains a namespace component; TX additionally qualifies namespace by epoch, never attribution. |
| `read-update.idempotency.cross-carrier` | Inherited | Sequence and singleton still share key namespace; TX adds batch cross-carrier singleton equivalence in a separate row. |
| `read-update.idempotency.authorization-view` | Retired | Replaced by `transactional.receipt.reauthorization`; do not run the contradictory RU direct-form assertion. |
| `read-update.idempotency.forbidden-retained` | Inherited | Post-admission permanent forbidden remains a retained failed receipt/member projection; Scope-level pre-admission forbidden creates no receipt. |
| `read-update.idempotency.retention-minimum` | Retired | Replaced by `transactional.discovery.no-idempotency-retention`; do not run the contradictory RU direct-form assertion. |
| `read-update.idempotency.expired` | Retired | Replaced by `transactional.idempotency.expired-detail`; do not run the contradictory RU direct-form assertion. |
| `read-update.idempotency.expired-failure` | Retired | Replaced by `transactional.idempotency.failed-retained`; do not run the contradictory RU direct-form assertion. |
| `read-update.idempotency.durable-boundary` | Inherited | Mutation and final disposition remain atomic. TX additionally durably admits pending receipt; abandoned pending state is retracted within bounded recovery, never resumed. |
| `read-update.idempotency.crash-mid-sequence` | Inherited | Retained terminal members survive, pending/unstarted work is retracted, and explicit resubmission continues. No recovery-driven tail execution. |
| `read-update.idempotency.restore` | Retired | Replaced by `transactional.restore.key-namespace`; do not run the contradictory RU direct-form assertion. |
| `read-update.problem.table` | Inherited | Code family/status/retry remain inherited; TX direct/receipt/sequence context determines carrier envelope. Never demand HTTP 409 for a failed receipt containing status 409. |
| `read-update.validation.type-contract` | Inherited | Validation law survives; after-admission failures use failed receipts or projected sequence problems; no direct RU singleton error assumption. |
| `read-update.validation.diagnostics` | Inherited | Validation law survives; after-admission failures use failed receipts or projected sequence problems; no direct RU singleton error assumption. |
| `read-update.validation.identity-taken` | Inherited | Validation law survives; after-admission failures use failed receipts or projected sequence problems; no direct RU singleton error assumption. |
| `read-update.validation.aggregate-constraint` | Inherited | Validation law survives; after-admission failures use failed receipts or projected sequence problems; no direct RU singleton error assumption. |
| `read-update.http.command-minimum-fields` | Inherited | The shared command-preconditions rule covers RU singleton/sequence and TX singleton/batch/sequence POSTs, independent of field presence or values. Existing private observations are not cumulative evidence; read and receipt minima remain unchanged. |
| `read-update.http.request-too-large` | Inherited | Body octet limit rejection remains pre-admission 413 in TX, before body parsing; no receipt/key capture. |
| `read-update.http.cache-no-store` | Inherited | TX receipt and sequence representations retain private,no-store. Additional streaming no-transform rule is independent. |
| `read-update.http.cors-idempotency-key` | Inherited | Optional CORS, if enabled, still accepts Idempotency-Key and exposes applicable fields; TX adds its fields. |

This is a metadata/inheritance audit, not executed parity. The existing 12 TX retirement declarations remain tested against their maintained spec/packet list. The new RU→Read edge is mirrored against its normative declaration and separately tested, and its inherited exclusion is checked at TX. Optional-limit and preserved sequence assertions have explicit regression controls. The audit table is locked to current catalog ID order, inherited/retired treatment and each replacement ID; surviving discovery clauses have removal counterfactuals. No administrative erasure/restore capability, optional History or public write-profile admission is added.
