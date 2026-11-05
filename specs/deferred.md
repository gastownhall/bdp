# Deferred specification work

Non-normative editorial registry, November 2, 2026. This records deliberate deferrals and scheduled follow-ups; it neither selects a proposed wire contract nor qualifies an implementation. The owning specifications retain their complete current requirements. An implementation cannot defer a mandatory rule here or advertise an optional capability on the strength of partial delivery.

**Design deferred** means meaning remains unselected. **Delivery deferred** means an already specified optional capability is not scheduled for a named implementation. **Scheduled design** records an accepted sequence, not indefinite deferral. Active open questions are not automatically deferred. The spec-local appendices own question context and alternatives; this registry owns disposition, owner and revisit conditions. Execution belongs in the repository stabilization plan rather than a second task tracker.

A change that introduces, resolves or changes a recorded deferral should update its entry and owning appendix together. Retain a short resolution link when an entry closes. An old issue or PR is not safe to archive until its actual residuals have a durable home; a registry link alone is not a complete historical-stack coverage map.

## Core identity and References

### CORE-ID — Scope relocation and generic identity

**Design deferred.** [Core's identity appendix](profiles/core/core.md#appendix-open-design-questions) owns the context. Canonical Resource URLs remain immutable, with nonreuse across serving-authority replacement. Generic DNS-neutral Scope identity, relocation authority, replica/fork distinction and serving-location mapping remain unselected. Alternatives include retaining URL-based identity with an explicit custody/relocation mechanism or introducing separately specified logical identity; neither may be inferred from a host name or Package mapping.

**Owner / revisit:** Core identity owner and Donna, when an explicit relocation/Transfer identity design is taken up. Transfer G1 already exposes the dependency; it does not decide it. Preserve [issue62](https://github.com/gastownhall/bdp/issues/62) and the [naming follow-up](https://github.com/gastownhall/bdp/issues/2#issuecomment-6001154558).

### CORE-REF — Foreign expectations, witnesses and broader aliases

**Design deferred.** Core retains URI-or-exact-object References and opaque foreign endpoints; reference-looking JSON creates no graph edge. A reader-computed witness, an unenforced foreign expected-Type assertion, and aliases to foreign Resources, Links or exact revisions are distinct proposals. None establishes remote validation, retention, acquisition or authority. Current in-Scope Bead aliases retain their complete contract.

**Owner / revisit:** Core/Types owners with Donna, during explicit external-reference/federation or broader-alias design; Package needs alone do not expand generic aliases. Sources: [issue11](https://github.com/gastownhall/bdp/issues/11), [witness proposal](https://github.com/gastownhall/bdp/issues/6#issuecomment-5463594132), [issue299](https://github.com/gastownhall/bdp/issues/299), and [selected alias cutline](https://github.com/gastownhall/bdp/issues/59#issuecomment-6358504683). See the [Core appendix](profiles/core/core.md#appendix-open-design-questions) and [Types appendix](profiles/types/types.md#appendix-open-design-questions).

## History, ownership and retained data

### HIST-DELIVERY — Optional reference History adoption

**Delivery deferred.** [Core Historical resolution](profiles/core/core.md#historical-resolution) already owns the optional History contract. Complete exact reads, truthful missing-state diagnoses, historical authorization, immutable addresses and erasure duties are requirements when selected. Reference implementation timing is separate; internal retained-source lookup or narrow terminal reads do not advertise full History. No new competing History specification or restart of a historical Beads runtime campaign follows from this entry.

**Owner / revisit:** Core/History and reference implementation owners, when optional History delivery is deliberately scheduled with current portable capability evidence. Current priority is Core/Write/Types stabilization followed by Callable and Package, before deeper Memory/Issues design. Preserve residuals from [issue1](https://github.com/gastownhall/bdp/issues/1) and its [complete-or-refuse/citation corrections](https://github.com/gastownhall/bdp/issues/1#issuecomment-5586084982); evidence remains bound to its original source and scope.

### OWN-REVIEW — Owned Links reexamination

**Design reexamination requested; current rules retained.** [Core Owned Links](profiles/core/core.md#owned-links) and Write still require complete recorded captures, current authorization closure and atomic actual owner effects. Ownership does not select a cascade. Donna has put this existing design on the shortlist for reexamination; this is not approval to remove or weaken it.

**Owner / revisit:** Core/Write/Types owners and Donna, when ownership design is explicitly reviewed. Historical correction/recovery should preserve existing admitted invariants with minimal work, avoid a broader ownership redesign or unnecessary duplicate historical graph captures, and surface unavoidable costs before expanding scope. Historical sources: [ownership declaration ruling](https://github.com/gastownhall/bdp/issues/59#issuecomment-6184442693), [transitive ownership ruling](https://github.com/gastownhall/bdp/issues/59#issuecomment-6184038569), [endpoint correction ruling](https://github.com/gastownhall/bdp/issues/59#issuecomment-6457645585). See [Write's appendix](profiles/write/write.md#appendix-open-design-questions).

### WRITE-RECEIPTS — Public outcome services

**Design deferred.** [Public mutation receipts](../experimental/mutation-receipts.md) remains non-normative exploration. Independent receipt Resources, polling/pending states, paging, URLs and public lifetime/ownership rules are not selected. Current Write still requires durable internal outcomes, original-key recovery, successful non-reexecution and truthful uncertain disposition; experimental navigation cannot replace these obligations.

**Owner / revisit:** Write/observation owners with Donna, if a concrete need for independently readable long-running or large outcomes is scheduled. Preserve useful ownership/reopen observations from [PR184](https://github.com/gastownhall/bdp/pull/184) as evidence for applicable current durability, without adopting receipt-specific API. See [Write's appendix](profiles/write/write.md#appendix-open-design-questions).

## Events and Transfer

### XFER-OBS — Replication, streaming and cross-feature order

**Design deferred; explicit Transfer revisit.** [Events](profiles/events/events.md) specifies finite observation, required postimages and truthful coverage/gaps. It grants no replica application, streaming or universal cross-source ordering. Replication/changefeeds and streaming requirements remain separate. Feature-specific ordering is retained unless equivalence is demonstrated; historical ordering must first be reconciled with current contracts.

**Owner / revisit:** Events/Transfer and shared Write owners, **when designing Transfer** (November 2 review decisions39 and43). Reconcile source correlation, acquisition/replay boundaries and ordering rather than silently carrying old mechanisms forward. Historical material: [PR161](https://github.com/gastownhall/bdp/pull/161), [PR162](https://github.com/gastownhall/bdp/pull/162), [PR168](https://github.com/gastownhall/bdp/pull/168), and the [Events appendix](profiles/events/events.md#appendix-open-design-questions).

### XFER-RETAIN — Snapshot minima, continuity and erasure/publication races

**Design deferred; current fences mandatory.** Immutable Snapshot eligibility and a live serving head are distinct. Retained-minimum promises, continuity/disaster-recovery guarantees, and stronger snapshot/erasure publication-race mechanisms need an explicit supported Transfer contract. Existing applicable erasure, controlled-copy cleanup, truthful retention and atomic publication duties continue unchanged. A saved package alone cannot prove no later erasure or allocation occurred.

**Owner / revisit:** Transfer/History/Write owners, **during Transfer design** (decisions57 and76, together with39/43). Preserve actual crash witnesses and source-bound historical evidence; clean reopen is not a crash substitute. Stronger erasure mechanisms require demonstrated product needs, not speculative expansion. Sources: [Snapshot/serving-head ruling](https://github.com/gastownhall/bdp/issues/59#issuecomment-6270333421), [PR186](https://github.com/gastownhall/bdp/pull/186), [PR201](https://github.com/gastownhall/bdp/pull/201), [PR276](https://github.com/gastownhall/bdp/pull/276). [Core assurance](profiles/core/core.md#history-recovery-imports-and-assurance) remains binding; [Transfer's appendix](profiles/transfer/transfer.md#appendix-open-design-questions) points to its existing G1–G6 questions without adopting their proposed carriers.

### IMPORT-CONTEXT — Historical import lifecycle and source correlation

**Design deferred.** Historical lifecycle purpose does not adopt all of PR164/165. Import Events, entry/presence cause, source correlation, propagation, authority and interoperable carriers remain separate residuals. The historical single-field Inception/open-enum direction does not add that field to current Core. Old origin/entry alternatives and native/private wrappers cannot silently replace current `revisionProvenance`.

**Owner / revisit:** Transfer/Events/Provenance owners with Donna, during the corresponding import binding and after stabilization priorities. Sources: [PR164](https://github.com/gastownhall/bdp/pull/164), captured head `11175cb6d6d3d1991f5281f6dbe6d9c99c582434`; [PR165](https://github.com/gastownhall/bdp/pull/165), captured head `006a998de0f54d63906e51e99d230d59225ac9db`; [bounded draft-publication receipt](https://github.com/gastownhall/bdp/pull/165#issuecomment-6242004714). Publication review is not import implementation approval. See [Events](profiles/events/events.md#appendix-open-design-questions) and [Transfer](profiles/transfer/transfer.md#appendix-open-design-questions) appendices.

## Attribution and Types

### PROV-NEXT — Broader Provenance direction

**Scheduled design:** immediately after stabilization and Donna's spec edit pass (November 2 decision28). Core's existing carried context remains data rather than attestation; authenticated authorization identity is not automatically a public actor assertion. [PR183](https://github.com/gastownhall/bdp/pull/183), captured head `35770747c9ea08c04d5d76887c667ccfab4f14bc`, supplies direction for that next review, not an adopted carrier.

**Owner / revisit:** Provenance/Core/Write owners with Donna at that scheduled point. Review writer-supplied actor/submitter, authority beside service-derived claims, independent reported/channel submitters, and source/withdrawal/completeness effects. Claim encoding/merging, normalization, lifecycle/interchange and CLI transition still need their own binding and qualification. The [Core appendix](profiles/core/core.md#appendix-open-design-questions) retains the distinction.

### TYPE-PACKAGING — Public authoring and global/local meaning

**Design deferred where explicitly unselected.** Types retains exact definition/registration/Scope-wide interpretation requirements. Its [existing unselected-mechanism boundary](profiles/types/types.md#8-conformance-and-unselected-mechanisms) is authoritative. Experimental Package global/local Type correspondence, portable graph packaging, public lifecycle/acquisition commands and publisher/version/closure binding must be deliberately specified; provenance or available bytes alone do not establish nominal equality, registration or installation.

**Owner / revisit:** Types plus Callable/Package owners with Donna, in the selected next Callable AND Package design work. [Callables](profiles/callables/callables.md) and [Packages](../experimental/packs.md) retain their selected direction and explicitly open questions. Publication on main does not make them adopted runtime capabilities or decide generic Scope identity. See the [Types appendix](profiles/types/types.md#appendix-open-design-questions).

## Memory

### MEM-MECHANICS — Composition, applicability and lifecycle

**Design deferred**, exactly within [Memory's publication-scope boundary](types/memory/memory.md#publication-scope-and-deferred-specification-work). Selected Evaluation ownership, exact nonempty subject references, collective claims, family graph rules and declared ownership stay selected. Deferred work includes revision/context compatibility and provisional Requires cross-revision restrictions; executable applicability and its authority/bounds; conditional dependency qualification; structured sufficient conditions; evidence/reconciliation; generic abstract-Type representation; concrete query/CLI design; and detailed edit/retype/recovery/retention integration.

**Owner / revisit:** Memory and shared Core/Types/Write owners with Donna, after Callable AND Package and before implementing the affected mechanism. No automatic repinning, cascade, per-subject distribution of collective claims, or executable predicate language is inferred. [Memory's appendix](types/memory/memory.md#appendix-open-design-questions) preserves the concrete questions; [issue6](https://github.com/gastownhall/bdp/issues/6) is historical reference-carrier context, not a competing Memory implementation specification.

### MEM-INTERCHANGE — Old Memory import and identity proposals

**Design deferred.** Historical Memory V2 proposals are harvest sources for their owning current contracts, not a second Memory authority. Interchange/import authority and provenance belong with [IMPORT-CONTEXT](#import-context--historical-import-lifecycle-and-source-correlation); generic identity belongs with [CORE-ID](#core-id--scope-relocation-and-generic-identity). Current Memory retains its selected Reference carrier, exact Evaluation subjects and explicit publication boundary. No implicit registration, historical remapping or old origin/entry carrier is adopted.

**Owner / revisit:** Memory and Transfer/Core owners, after Callable AND Package and during an explicitly selected interchange design. Preserve [PR165](https://github.com/gastownhall/bdp/pull/165) residuals with [Memory's appendix](types/memory/memory.md#appendix-open-design-questions); the historical draft-publication review did not qualify import or runtime behavior.

## Active reviews and engineering follow-up

### URI-REVIEW — Schema identity and fast-uri314

**Active bounded review, not a routine dependency deferral.** [PR314](https://github.com/gastownhall/bdp/pull/314), captured head `f660094e2350340194c1ffc85ce729c668d80208`, changes query percent-escape admission and proposed schema-resource index/digest identity. The schema maintainer must review URI/security behavior and persisted consumer transition before selection. Contributor advisory claims remain unverified; old green CI is not a migration proof.

### STARTUP-MAP — Focused startup successor

**Active residual mapping.** [PR272's explicit hold](https://github.com/gastownhall/bdp/pull/272#issuecomment-6537200254) states its 392-file stack is not incorporated or superseded. Preserve deployment-file startup, sanitized refusal categories, missing-file/exit2/no-readiness/lifecycle regressions and conditional source alias. Reference owners should map these to a small typed startup boundary with real readiness/shutdown/secret checks, not automatically merge the old framework or claim a new public API. Closure requires a focused successor and actual applicable evidence.

### HIST-UPDATE — Required historical-update delivery

**Active delivery, not deferred.** Donna requires `--from-revision` in specifications and BDP product before closing the spec review. [PR174](https://github.com/gastownhall/bdp/pull/174) is a historical source; [Beads7719](https://github.com/gastownhall/beads/issues/7719) records the integrated native direction, not proof of public BDP completion. Current receiving selects optional discoverable historical Update, same-ID undelete, genuine body-free terminal versions, a narrow authorized terminal read, explicitly selected source/predecessor output and permitted initial batch-composition refusal. Source admission consumes exact complete authorized editable content plus an independently authorized current protected baseline; unused old owned/protected structure is not required. This entry is a receiving-status record, not a substitute normative carrier, landed-source receipt or implementation claim. Spec/runtime owners retain integration and full applicable qualification; History/Events joint bindings require explicit review before support is claimed.

### TEST-MAP — Current obligations and historical witnesses

**Active engineering, not deferred semantics.** Feature owners retain mandatory supported-feature safety, real crash witnesses where crash behavior is claimed, scoped actual installed observations and portable current obligations. Historical configurations/results remain historical; clean reopen cannot stand in for a crash, and private controls do not become public API. Decisions73–75 select focused fixtures/shared proven mechanics, not a broad new framework. See the repository stabilization plan for execution and per-stack coverage accounting.


These are **not newly deferred protocol design**: the bounded URI/security/consumer review for [PR314](https://github.com/gastownhall/bdp/pull/314); the focused startup successor/coverage map for [PR272](https://github.com/gastownhall/bdp/pull/272#issuecomment-6537200254); item-by-item editorial reconciliation from [issue5](https://github.com/gastownhall/bdp/issues/5); and historical-stack obligation maps before archival. In particular PR334 requires comparison of its eight files with landed PR339 and a preserved gap map, not a second batch landing or relabeling an originally failed receipt. Decisions73–75 retain focused allocation/diagnostic, child-listener/source-binding and portable pre-admission media cases; these belong in current feature-owned engineering coverage, not deferred semantics. Historical qualification limits and current mandatory rules survive cleanup.

## Preview-1 Callables and Issue package

### CALL-PREVIEW — Callables after preview-1

**Design deferred.** [Callables §12](profiles/callables/callables.md#12-deferred) lists what preview-1 leaves unselected: readable bodies and parameter binding, how an endpoint advertises what it supports (including atomic execution and result validation), registration details settled together with packages, how much of `cliMapping` survives, and paged or streamed results. CALL-O1, CALL-O2 and CALL-O3 of the experimental draft close at preview depth only as that document states, once its rulings are marked.

**Owner / revisit:** Callables owner with Donna, after the preview; the advertising exercise follows the specification work, and registration is settled with packages. The archived draft is [callables-draft-20261030](history/callables-draft-20261030/callables.md).

### CALL-COMMANDS — Commands without raw generic writes

**Design anticipated.** Preview-1 requires Write for a CallableBatch. Donna expects many services will want to expose commands without raw generic writes, and that is a common pattern, so the design should anticipate it when that requirement is revisited.

**Owner / revisit:** Callables and Write owners with Donna, when a service asks for it or at the next Callables edition.

### ISSUE-PREVIEW — Issue and Dependency Types after preview-1

**Design deferred.** [Issue §11](types/issue/issue.md#11-carried-open-items) indexes the carried items: policy-dependent status meaning, operational observations, codified metadata, ownership, pinned endpoints, Link recovery, properties replacement, comments as Beads and custom classification lifecycle.

**Owner / revisit:** Types and Issue package owners with Donna, after the preview. The October draft is [issue-draft-20261014](history/issue-draft-20261014/issue.md).

### LINK-RECOVERY — Historical update and recovery for Links

**Design open.** Donna ruled on 2026-11-05 that `--from-revision` should work on both `bd update` and `bd link update`, and that the current Bead-only text is a specification bug. [Issue 363](https://github.com/gastownhall/bdp/issues/363) lists what the extension has to settle. It is not a preview dependency.

**Owner / revisit:** Write owner with Donna, after the preview.
