---
status: editorial-draft
intended-status: optional-profile
version: "draft-1"
---

# Beads Protocol — Transfer

Review draft 1, November 1, 2026. Author: Iris, for Donna and Trish.

**Status: proposed profile in Donna's editorial corpus, not an adopted standard, capability advertisement or implementation claim.** Iris drafted against PR337 commit 72f92fe8293ee16a7cb7159507124592381e445a. The protocol source bytes are unchanged at the receiving commit 2aceaa942a14f8918d282e3736acb8cd7eacbbad. [Core](../core/core.md), [Write](../write/write.md) and [Types](../types/types.md) retain their respective authority. Requirements below describe this proposal; open items G1–G6 prevent freezing a complete interoperable version. Names and framing explicitly marked proposed are engineering selections for review, not historical human rulings.

## 1. Purpose, relationship and conformance

Transfer moves a coherent retained graph between implementations without turning saved Resources into ordinary create requests. Beads and Links keep their ordinary Core representation. Transfer adds source context, retained membership, prerequisites, integrity, completeness and admission rules outside those bodies.

Core owns Resource, Reference, identity, common authorization, exact JSON value and retained-address meanings. Write adds operation admission, atomic effects/publication and durable invocation recovery. Types, when selected, owns exact definition interpretation, registration, retained availability and constraints. Transfer neither redefines these contracts nor makes Types or Events mandatory for an otherwise Core-only Scope.

The first selected product delivery is same-logical-Scope, identity-preserving transfer of **all retained user data**, in JSON and JSONL, into an explicitly prepared fresh destination. A→fresh B→fresh C must preserve the same retained facts. Populated upsert, insert-only, no-op/conflict and whole-Resource force are also agreed behavior, delivered separately rather than silently removed from the contract.

Here profile means an optional specification/capability composition, not a third Core base-profile literal; Core base discovery remains core or write. A read-only provider may implement export. Import requires a distinct advertised admission capability and the applicable Write durability semantics; advertising ordinary Write or atomic-batch1 alone does not advertise Transfer. A profile implementation must state its supported export/import operations, encodings, completeness/adjunct profile, modes and bounds. It must not advertise all-retained import on the strength of a Resource-only codec or a few supported native sections.

This draft specifies a transport-neutral package and admission model. It does **not** assign an HTTP endpoint, media subtype, immutable profile URI, discovery schema field or public receipt-query route. Before adoption, the owner must bind the new profile/version and rejectable invocation selection under the normal contract publication rules (G6). No added meaning may be smuggled into the existing immutable Core v0.1 identity. File transfer can be specified without pretending an HTTP upload API already exists.

Uppercase MUST/SHOULD/MAY are intended normative requirements of this proposed profile. Each open G item is explicit; an implementation cannot fill it with a private assumption and claim portable version-1 conformance.

## 2. Coverage and authority

### 2.1 Complete means all retained facts, not all reconstructible bodies

An all-retained package must account for the entire declared logical Scope at one coherent capture boundary: live Resources, every retained version including replaced lineages and deleted subjects, recorded owned state, original provenance, required exact Type dependencies, actual associations, aliases, identity allocation/nonreuse, retained terminal/missing-state evidence and required recovery metadata. A package need not contain erased content; it must not resurrect it. An incomplete retained version remains explicitly incomplete, with its actual disposition and available retained pieces, rather than being omitted or fabricated as a full Resource.

Core's authorization-relative History window is not proof of a complete Scope backup. The exporter must establish authority to disclose the entire selected retained population, not just exhaust the caller's visible list. If authorization or acquisition prevents the complete profile, refuse that export; do not produce a completion declaring all-retained while quietly omitting hidden data. Diagnostics must still obey nondisclosure. An explicitly different limited profile is not this all-retained capability.

Every retained native fact must have a specified mapping or a required versioned adjunct. Unmapped required facts cause refusal. A count of emitted rows, digest of emitted bytes, successful query, or empty current workspace is insufficient proof of enumeration completeness. Capture procedures must be reviewable and supply a bounded way to establish their actual source inventory and retained boundary.

Export is not a field projection. Include/omit masks, query selection and display abbreviations must not silently alter a complete package. Properties and metadata retain all recorded admitted values. Comments and labels use the adopted Resource/Link model where one exists; otherwise the relevant required association adjunct preserves their actual native identities and associations. Do not synthesize historical associations from today's adjacency or flatten them irreversibly into current properties.

### 2.2 Same logical Scope and serving location

Every imported canonical ID denotes the same Resource of the same kind as at the source. Relative storage keys, native row addresses and human short IDs are not replacement public identities. No required beads/, links/ or types/ path segment is added or stripped. Transfer cannot infer kind, Scope or authority from a URL suffix.

The package declares its source identity context. It does not grant destination custody or prove exclusive authority. Import requires explicit authenticated authority to admit original state for that logical Scope, plus the current target's custody and freshness conditions. A host, DNS name or file location is not by itself that proof. Stable DNS-neutral Scope identity remains Donna's pending design discussion (G1); the package must use the actually selected Core identity contract and not invent a new one.

Cross-Scope copy/remapping and an ID prefix/root that changes canonical IDs are separate capabilities. The initial same-Scope import must refuse such requests; it cannot call them identity preservation. Opaque external References remain exact and are not fetched, reparented, validated as local Beads or activated as replicas. Core's native current-Link endpoint rules still apply to the admitted live graph; historical retained facts do not become live endpoints merely by appearing in the archive.

### 2.3 Trust, sensitive content and erasure

Package integrity is not authenticity. Supplied provenance remains carried data and must not become authenticated actor attribution, execution permission, trusted Type registration or evidence of origin merely because today's importer authenticated. Do not replace original context with the current importer or a fabricated import time. The public representation uses Core revisionProvenance, not old attribution, changeContext or an invented Inception field. Preserve exact recorded absence/unknown/present states and valid original actor basis; inability to represent them truthfully requires a declared mapping or refusal, not rewriting a bound version.

Before retained content becomes visible, establish original identity/version and erasure status using appropriate authoritative evidence and apply known erasures, as Core History requires. A saved package alone cannot establish that no erasure occurred after capture. Unestablishable required status causes rejection or discard, not indefinite unmanaged quarantine or laundering into a new identity. Controlled copies, indexes, inline owned content and staging must obey applicable erasure duties.

All retained operational facts must be classified. Old credentials, ciphertext, leases, sessions, retry tokens or authority claims must never activate an identity, reauthenticate a principal, reacquire a lease, execute a command or replay a source action. Sensitive recovery data may require an authorized protected adjunct; plaintext secret inclusion is not an implicit consequence of all-retained coverage. A profile cannot silently drop retained facts or expose secrets to avoid the classification problem. The security/custody mapping remains G4.

## 3. Proposed portable package grammar

The proposed grammar uses exactly one manifest, zero or more fact records, then one completion. JSON and JSONL carry the **same logical record sequence**, not distinct Resource vocabularies. Containers below are proposed Transfer fields, not new Core Resource members.

    JSON package = { manifest: Manifest, records: Fact[], complete: Completion }
    JSONL package = Manifest LF, Fact LF repeated, Completion LF, EOF

JSON top-level member order is immaterial. JSONL physical order is manifest first and completion last. Each JSONL line is one complete JSON object; there are no blank lines, BOM, comments, multiline records or trailing records. JSON admits only normal JSON whitespace after its final object. A producer writes UTF-8, LF JSONL terminators and a final LF. A receiver refuses truncation, a missing final JSONL terminator/completion, extra completion or any trailing nonpermitted data. Reaching EOF without completion is never a valid empty package.

All protocol-owned objects are closed. Fact kinds are versioned and unknown required kinds refuse; this version has no silently ignored optional fact family. Unknown Resource members are governed by the selected Core schema, not made legal by a Transfer wrapper. JSON duplicate member names after escape decoding, unpaired surrogates and inadmissible numeric values refuse. Apply Core's exact-decimal equality and its binary64 round-trip admission rule before digest canonicalization; do not round invalid data to fit. Native retained values that cannot be represented in Core need an explicitly specified protected adjunct and cannot masquerade as valid Resources (G3).

### 3.1 Manifest

Proposed closed members:

| Field | Meaning |
| --- | --- |
| record | Literal manifest. |
| format / formatVersion | Proposed bdp-transfer / 1; not yet an assigned immutable contract identity. |
| resourceContract | Exact adopted Core prose/schema identity, never a producer build or mutable branch. |
| sourceScope | Scope identity context under the selected Core contract; no transport-host-derived authority. G1 may require this binding to change before adoption. |
| capture | Opaque source-defined capture identifier and exact capture-profile identity. It identifies one coherent retained boundary, not a globally comparable sequence or a credential. |
| coverage | Literal all-retained for this profile. |
| requirements | Ordered unique exact profile/version identities for required fact families and Type interpretation; unsupported requirements refuse before publication. |
| inventory | One declared count for each supported fact family, including required empty families. The source profile defines and validates completeness. |

The manifest does not contain an installer, executable query, SQL, shell command, storage-table selector or code download instruction. Producer build information can be recorded only by a later declared diagnostic extension; it cannot substitute for resourceContract or capture-profile identity. No unassigned URI is treated as an adopted standard.

### 3.2 Resource-version record

    { record: "version", resourceKind: "bead" | "link",
      head: BOOLEAN, resource: complete ordinary historical Resource }

The wrapper's resourceKind selects the actual Core historicalBeadRecord or historicalLinkRecord schema and must agree with immutable kind. Historical Beads contain no current incident links aggregate. Every Resource carries exact canonical id, whole type Reference, exact revision, properties, metadata, version-specific endpoints and recorded revisionProvenance/ownedLinks when applicable. A legacy pre-metadata public projection follows Core; any original-byte recovery fact is separately mapped rather than conflated with the public projection.

The version address is the tuple (canonical ID, revision). It occurs once in the version family. Conflicting or duplicate occurrences refuse, even if a parser could choose the first/last. A retained address must never be rebound to different covered state or immutable context. Revision equality is equality only; no order, timestamp or source engine commit can be inferred from the token.

head marks the source's actual live head at the capture boundary. A live identity has exactly one; an absent/deleted identity has none. A separate required identity-state record distinguishes deletion, retention and uncertainty; head:false alone is not a deletion or lineage description. Current and retained memberships are explicit, never inferred from stream order.

Captured owned Links are the same first-class versioned Links, not a second writable edge plane. Their full records must agree with the corresponding retained Link address/state. Preserve recorded bucket shape, affiliations and endpoint pins, including valid older captures. Do not recapture historical owners from the current graph or repin their endpoints. For different Link revisions, whole endpoint References may legitimately differ: current Write permits endpoint correction. Identity and kind, not all endpoints across time, are immutable.

### 3.3 Required retained fact families

The following proposed families make missing protocol work visible. Their semantic requirements are specified here; their complete portable payload schemas and source mappings are **not yet frozen** (G2–G4). A completion may not claim them implemented using arbitrary native blobs.

| Family | Required facts and association |
| --- | --- |
| identity-state | Canonical identity/kind, current live/deleted disposition, allocated-but-no-body identities, lifetime nonreuse and known terminal/erasure/pruning/reorganization evidence. Unknown is distinct from positively known absence/deletion. |
| history-state | Per-identity participation, authority order, current/replaced lineage and truthful known direct predecessor/successor relations, incomplete-body/missing-piece state and original context not expressible in a full version. No invented gap-bridging edges or new engine commits. |
| type-prerequisite | Exact required definition/schema/declaration closure and interpretation evidence, including valid historical and intrinsic correspondence. Retained dependency bytes, identity and fingerprints do not themselves grant registration. |
| alias-state | Exact live alias→canonical in-Scope Bead binding and collision obligations, where the source has aliases; alias history only where actually retained. Aliases are locators, not Resources or new revisions. |
| association-state | Original non-Resource comments/labels and associations not already represented losslessly by adopted Resources/Links, keyed to exact identities/revisions or specified native original addresses. No guessed historical linkage. |
| recovery-state | Retained original admission/result and nonreuse/continuity facts required to preserve the logical Scope. Credentials and operational leases are inert; required anti-reexecution guarantees must still be enforced. G4 defines the safe principal/custody/secret mapping, not this table alone. |

A native recovery adjunct must name its exact versioned profile, family, stable address, interpretation, required prerequisites and integrity coverage. It must distinguish original bytes from public projections. It must not expose packet-chosen SQL tables as the portable Resource authority. Necessary binary data may use a specified byte encoding; base64 is neither a data model nor permission to serialize everything as table cells. Required native data that cannot be faithfully mapped causes refusal. Optional Core Events support does not require manufacturing a seventh family. Existing retained Event facts must nevertheless be explicitly classified in the actual source recovery inventory and preserved by an applicable required adjunct when needed; they cannot disappear behind an all-retained claim (section 8).

### 3.4 Retained-fact wrapper and family agreement

Proposed closed outer wrapper for all non-version facts:

    { record: "retained", family: FAMILY_NAME,
      profile: EXACT_FAMILY_PROFILE_IDENTITY,
      address: NONEMPTY_STRING_ARRAY, value: FAMILY_DEFINED_VALUE }

family must be one declared family, profile must match its manifest requirement, and address has the exact arity/meaning fixed by that family profile. Its full tuple is opaque to other families and unique within the family; delimiter-joined strings are not a collision-safe address encoding. The inventory uses family names, while requirements bind immutable family meanings. A receiver supports the complete declared profile or refuses it; it cannot store unknown required values as unvalidated blobs and report import success.

Each family profile must define a closed value schema, stable address, capture/enumeration completeness proof, authority/erasure rules, cross-family invariants, applicable bounds and exact native admission mapping. The built-in manifest and version/completion wrappers do not make those family contracts exist. Required empty inventory entries are checked against source enumeration and destination obligations; an omitted family is not an assertion that it is empty. G2 is the finite work of specifying these named payloads against the actual retained source/receiving contracts, not an open-ended extension framework or authorization for arbitrary packet schemas.

### 3.5 Order and integrity

Proposed deterministic order: version records first in ascending canonical ID, then opaque revision, comparing unsigned UTF-16 code units lexicographically, with a shorter exact prefix sorting first. Do not normalize Unicode or reinterpret that serialization order as History order. Other families follow a fixed profile-declared family order and stable, uniquely encoded family-address order. An adjunct must define its address comparator before interoperability can be claimed. Arrays inside Resource values and recorded owned captures keep their semantic order. History authority order is carried explicitly, not replaced by serialization order.

For this draft, integrity uses the named [RFC 8785 JCS model](https://www.rfc-editor.org/rfc/rfc8785.html) over already Core-admissible values. Form a virtual UTF-8 JSONL sequence consisting of JCS(manifest)+LF followed by JCS(each fact in package order)+LF. The digest is SHA-256 over the ASCII domain separator "BDP-TRANSFER-DRAFT1" plus LF followed by that sequence. This domain/name/algorithm is a proposed engineering selection, not the earlier example-only digest or an adopted revision scheme. It does not compute or replace Resource revisions.

    Completion = { record: "complete", facts: NONNEGATIVE_INTEGER,
                   resources: NONNEGATIVE_INTEGER,
                   versions: NONNEGATIVE_INTEGER,
                   sha256: LOWERCASE_64_HEX }

facts counts every fact record, excluding manifest/completion. resources counts distinct version-record Resource IDs, not all allocated identities; versions counts version records. inventory accounts for every family and must match actual counts. Completion counts and digest must match. JSON and JSONL encodings of identical logical packages therefore share the digest despite JSON indentation/member order. Do not rely on host-language lossy decoding before admission/JCS. Decoded line/value/record/total bounds apply independently of byte commitment.

The digest verifies received package integrity only. It proves neither source authentication nor completeness of the actual captured Scope. Both require their separate authority/inventory evidence. A legal re-export may have a different capture identifier or order/provenance envelope at package level, so roundtrip comparisons must compare preserved facts, not demand an identical file digest.

## 4. Producer obligations

1. Authenticate/authorize the selected complete export, including sensitive and owned-state closure, and select the exact supported contracts and bounds.
2. Acquire one coherent retained boundary across Resources, history, allocations, associations, Types and recovery adjuncts. A sequence of independent current reads is insufficient. Do not silently restart expired captures, use current state for an unavailable old page, or label an authorization-filtered page set complete.
3. Build/verify the complete source inventory and every fact's mapping. Preserve positively known incomplete/terminal state; refuse unknown required mapping. External references remain opaque and do not trigger network fetches.
4. Validate package structure, uniqueness, Reference/pin correspondence, ownership, Type prerequisites and family consistency. Present missing state honestly; never synthesize an empty body or original attribution.
5. Emit manifest/facts and completion only after all required completeness/integrity conditions can be met. A streamed failure may leave a prefix; it must not append a successful completion. A file writer should publish through a fresh temporary artifact and atomic rename only after complete validation where the filesystem supports that guarantee. Do not claim cross-filesystem atomic publication or crash durability without proof.

Resource limits bound capture time, raw/decoded bytes, records, per-value/property/owned state, depth, dependency closure and staged/atomic publication work. A producer/receiver must publish meaningful bounds for the selected capability. Exceeding a bound fails the whole unit, never truncates or spills secret content into diagnostics. Bounded staging need not retain the entire package in memory or keep a database transaction open during upload/parse. It may use protected disposable staging, then revalidate target conditions at one atomic publication boundary.

## 5. Import admission

### 5.1 Frozen invocation and target prerequisites

Import is a distinct operation, not repeated ordinary create calls or a batch of revision-stripped Resources. Freeze the destination logical Scope, selected contract/profile versions, package identity and bytes/semantic content, requested mode, force intent, guards and authenticated principal under one durable invocation key. Do not reread a changed input file on automatic retry.

Fresh means no prior user-data/allocation/key history that would conflict with admitting the complete source state. Trusted initialization and separately registered exact Type prerequisites are explicit exceptions, not permission to overwrite an arbitrary initialized workspace. Native required defaults/indexes/constraints/views and target custody must be established by trusted setup before import. The package is not executable schema setup or automatic migration.

When Types interpretation applies, all required exact definitions and complete schema/declaration/conformance closure must already be registered for this Scope. Mere cached or package-carried bytes are insufficient. No fetch, acquisition, registration, default selection, retirement reversal or validation bypass occurs implicitly. Retained historical interpretation must not be resolved through today's default. Types1 activation still covers all live and retained covered versions, not a new-import epoch. Retired exact definitions must remain available for retained meaning, but the current Types text does not select restoring live affiliations to a fresh store under a retired revision: G3 must reconcile that case explicitly, never grandfather it privately.

### 5.2 Validation and planning

Validate the complete syntax, declared contracts/families, limits, completion/EOF/digest, exact addresses, counts and all prerequisites before publication. Establish original-version identity and authoritative erasure status before visibility. Validate the final graph and historical constraints appropriate to each recorded edition; do not apply today's Type default or current graph adjacency to historical versions.

Whole incoming Resource selection includes its complete stored affiliation, properties, metadata, endpoints and owned state. Unknown optional-looking fields do not authorize partial application. Every duplicate/conflicting address, inconsistent inline Link, missing required history/prerequisite, unsupported adjunct, invalid kind or forbidden destination authority refuses the package.

At publication revalidate destination custody, relevant current state/guards, authorization and preregistration. Mutable destination state must not change between the plan's guarded baseline and its atomic commit without detection. A successful observational dry run reserves nothing and cannot substitute for these checks.

### 5.3 Modes and conflicts

| Mode/case | Proposed admission rule |
| --- | --- |
| insert-only | Admit only identities absent from destination lifetime allocation/nonreuse state; any allocated collision refuses the package. Exact replay of an already decided invocation is handled by durable retry before mode checks, not treated as a new insert. |
| upsert (default) | Admit new identities and retained versions; for existing identities prove equality or a safe one-sided head transition as below. No field-by-field merge. |
| proved no-op | The full addressed state/context and relevant original facts match; retain original Resource revision/envelope and create no synthetic import head. Required newly admitted history/allocation facts must still be accounted for, so a current-body match alone does not prove a whole-package no-op. Admission of missing retained facts is changed:true even when no current Resource gets a new revision; retry bookkeeping alone is not such an effect. |
| guarded one-sided update | A verified common retained baseline plus the guarded current head establishes that only the incoming side changed; advance to that whole incoming state atomically. Revision spelling, timestamp, equal titles or missing ancestry do not prove this. |
| local-only edit | If incoming is demonstrably unchanged from the verified baseline, retain the local current version; admit any compatible missing retained facts without erasing the edit. |
| divergence/unknown proof | If both sides changed or a required baseline/proof is unavailable, report a conflict and commit nothing. Do not guess last-writer-wins. |
| explicit force | Select the complete incoming Resource head for each conflicting incoming identity while retaining the displaced local version and lineage in History. Never use force to bind one exact (ID,revision) to different content, override kind, skip authorization/Types/erasure/nonreuse/graph rules, or silently delete destination-only identities. |

Mode and force are invocation intent, not members of saved Resource bodies. The package's absence of an identity is not a deletion instruction during populated upsert. Explicit incoming terminal/deletion facts have their own authoritative guarded admission and cannot be inferred from an omitted record. A fresh restore must reproduce source terminal membership without reviving deleted Resources.

The precise portable baseline/lineage witnesses, live-head admission law and safe Type-retirement interaction remain G3. This table fixes user-visible behavior without pretending Core ordinary CRUD currently admits chosen historical revisions. If those prerequisites are unsupported, refuse the capability/mode, not silently use ordinary Write allocation. Force that cannot durably preserve the displaced version must refuse before effects.

### 5.4 One atomic publication

All admitted original versions, final heads/owned state, history/terminal/alias/allocation facts, required recovery state and the terminal import outcome commit together or none. A last-record validation failure commits no prefix, no hidden allocation and no successful key tombstone for lost work. Internal staging or temporary acquisition does not authorize graph visibility, Type registration or secret leakage.

Original versions keep their addresses/context. Admission metadata must be associated without altering the Resource under its original revision. This profile does not require a new import-head version for an unchanged return. A store needing an engine-local commit may record one internally, but must not call it the original source commit or alter BDP historical values. Real effectful current transitions and induced owner changes must be mutually consistent; no intermediate Link/owner versions are published. Exact original-state admission requires its own mapping under G3, not automatic inheritance of all ordinary Write revision-minting rules.

The first implementation may refuse oversized packages; a future resumable/chunked mode must have a separately selected capability with explicit partial-commit/recovery semantics. There is no automatic fallback from atomic to per-line/best-effort operation, including after a timeout or resource limit.

## 6. Results and durable recovery

Use Write's authoritative logical-Scope/authenticated-principal idempotency namespace, key syntax and at-most-once outcome semantics. Transfer does not create a key namespace partition by package format, endpoint, profile, media, serving host or epoch. After carrier/key admission, known-key resolution precedes fresh feature support, target liveness, current guards/defaults and limits. Retained compatible replay returns the original terminal disposition without effects; different intent conflicts; in-flight work does not execute again. Expired success preserves permanent compact anti-reexecution state and returns the truthful expired disposition, never fabricates discarded detail.

Proposed successful transfer result fields: package digest and selected profile identity; destination Scope; explicit terminal committed decision; changed; per-family admitted/unchanged counts; bounded complete per-Resource dispositions, including incoming original head and chosen resulting head or terminal identity; and known displaced-version references for force. Large results must fit an admitted bound or use a separately specified complete result contract, not silently truncate. A result transaction/correlation appears only when the selected Write contract requires it for an effectful decision. No success receipt is allowed to claim source authentication or a lifetime body-retention promise.

These are a proposed Transfer result shape, not the ordinary CRUD mutationResult or a new public receipt service (G6). The invocation identity/key remains private client recovery state; a package digest is not a retry key or authentication token. Successful no-op still retains anti-reexecution state even without a new Resource revision/Event.

A connection break, interruption, renderer error or cleanup failure after possible commit does not prove rollback. Distinguish known committed success with failed delivery, known atomic refusal and unresolved outcome. Recover with the same frozen invocation/key and original selected contracts. Never retry with a new key, relaxed mode, dropped Types or another encoding to force a fresh execution. Current authorization controls result disclosure without rewriting the original outcome or enabling reexecution.

Source recovery facts require care: preserving nonreuse and successful-key continuity is an enforcement obligation, whereas copied credentials/leases remain inert. A detached snapshot cannot preserve work acknowledged after capture. Claiming the same writable logical Scope after disaster requires surviving continuity/cutover and principal/key-namespace evidence (G4); controlled A→B→C roundtrip alone is not writable disaster recovery or generic replication.

## 7. Refusals and diagnostics

Use applicable existing Core/Write Problem meanings unchanged where they apply. A Transfer-specific binding must assign its new unsupported-format/family, package-integrity/completeness and original-state-conflict diagnostics before publication (G6); no new name is silently added to the closed v0.1 Problem enum by this draft.

Malformed JSON/duplicates/Unicode, unsupported required contract/family, bound exhaustion, absent completion/digest mismatch, invalid references/owned state, unregistered exact prerequisite, conflicting retained address, divergent head, failed target guard, unknown erasure status and forbidden custody must all refuse before graph publication. Authentication/nondisclosure precedence remains; diagnostics cannot enumerate hidden identities, expose secret bytes or claim omitted unknown state was verified absent.

Every refused new package has no committed Resource/history/allocation effects. Durable admitted failure/retry bookkeeping follows Write and is not a successfully imported prefix. Once an original outcome is unknown or committed, reporting a new validation error on a changed retry must not erase that uncertainty/success. Staging cleanup is owned, bounded and protected; incomplete cleanup is reported honestly rather than relabeled rollback.

## 8. Composition with Events

[Events](../events/events.md) is a separate optional observation profile. Transfer
does not require Events support, and importing retained records is not Event replay.
An eventual native Transfer binding must state its conditional Event production
rules before adoption; this proposed profile does not invent those rules.

## 9. Review decisions and unresolved mappings

> The [informative appendix](#appendix-open-design-questions) records explicit
> Transfer revisit triggers alongside these existing open questions.

| ID | Outstanding work; proposed direction |
| --- | --- |
| G1 | Stable DNS-neutral logical Scope identity/serving-location relationship. Donna's next design decision; use selected Core until changed, do not adopt a new identifier here. |
| G2 | Complete portable family payloads, stable fact addresses/order and native recovery adjunct mappings, including aliases and positively known incomplete/terminal states. Owner engineering/spec correspondence; no table dump declared portable. |
| G3 | Original-version/head admission, common-baseline/no-op/conflict proof, exact retained Type eligibility including retired fresh restoration, and full History lineage/context mapping. Reconcile with Core immutable addresses and Write/Types before claiming these operations. |
| G4 | Origin/erasure evidence, disclosure/security classification, inert operational data versus enforced allocation/key continuity, current-principal/custody mapping and disaster-recovery cutover. Raise only actual changed product choices; routine binding mechanisms remain engineering. |
| G5 | Events conditional import effects and baseline policy under the selected optional Events contract. Recommend separate optional profile, no old-log replay or mandatory import head. |
| G6 | Final profile identity/discovery/rejectable transport selection, formal closed schemas, new diagnostics and complete Transfer result/recovery binding. The framing/digest above is a concrete proposal to review, not an assigned public standard. |

No new vote is requested on both encodings, Resource-first bodies, all-retained coverage, same-Scope preservation, bounded atomicity, preregistered Types or accepted populated modes. Cross-Scope remapping, resumable bulk and replication remain separate later capabilities. A and legacy conversion are separate compatibility paths, not implementations of this native profile.

## 10. Required conformance cases (specified, not executed)

| Case | Required result |
| --- | --- |
| JSON and JSONL of identical logical contents | Same admitted facts and integrity commitment; no second Resource vocabulary. |
| Empty user graph with retained allocations/deletion facts | Preserve those facts; not an empty package merely because no live Resource exists. |
| A→fresh B→fresh C | Exact all-retained identities, values, revisions, pins, provenance, captures, lineage, associations and nonreuse; target-local storage IDs/commit tokens are not mistaken for source facts. |
| Incomplete retained version / erased content | Honest missing-state/disposition preservation; no invented full body, resurrection or omission from claimed coverage. |
| Duplicate or conflicting address, changed pinned body, invalid inline Link | Atomic refusal including force; no first/last winner or recapture repair. |
| Missing/retired exact Type dependency | No auto-install/default/activation; refuse unsupported admission or apply the explicitly reconciled retained-use rule, never guess. |
| Unchanged reimport / local-only edit / incoming-only edit / divergence | Proved no-op / retain local / guarded whole-state advance / conflict, respectively; ambiguity conflicts. |
| Whole-Resource force | Preserve displaced History and all invariants, never field merge or authorization bypass. |
| Late malformed fact, exceeded bound, missing completion or changed target | No committed prefix/allocation; truthful failure and owned staging cleanup. |
| Lost success, same-key retry with changed intent, detail expiry | Original outcome once; changed meaning conflicts; expired success never reexecutes; no automatic fresh key. |
| Events absent / baseline initialization / populated force | No Event dependency / no fabricated past creates / exact conditional local transition with atomic outcome. |
| Untrusted actor, source lease or operational credential | Remains carried/inert data; no attestation, activation, fetching or execution. |
| Snapshot followed by newly acknowledged allocation/erasure | Cannot claim safe same-Scope writable disaster recovery without the actual surviving continuity mechanism. |

## 11. Correspondence sources

The companion [Transfer review notes](../../../docs/spec-review/transfer-review.md) pins the selected source paths and relevant clause ranges, records stale proposal mismatches and separates settled outcomes from new draft choices. CLI mapping is in [the canonical CLI's proposed Transfer section](../../../docs/cli-design/bdp-cli.md#proposed-transfer-commands). Examples in the older Resource comparison demonstrate shape only; they lack the required retained families and are not complete packages under this draft. Nothing here claims an implementation, review council, executed acceptance test, adoption or promotion.

## Schemas

This profile remains proposed. Its retained family schemas and native wire binding
are unresolved; examples above are not a complete import/export validation schema.

## OpenAPI

No native Transfer HTTP capability, operation, media binding, admission error set
or result schema is selected by this proposal. No Transfer routes are emitted in
the current OpenAPI catalog. Final selection remains an explicit design decision.

## Appendix: open design questions

This informative index preserves the proposal's existing G1–G6 questions in [§9](#9-review-decisions-and-unresolved-mappings); it resolves none of their proposed carriers. The [registry](../../deferred.md) tracks deliberate deferrals without treating this editorial draft as an adopted capability.

Transfer design must explicitly revisit replication/changefeeds and cross-feature ordering (review decisions39/43), Snapshot retained-minimum/continuity work (57), and erasure/publication races (76). See [XFER-OBS](../../deferred.md#xfer-obs--replication-streaming-and-cross-feature-order) and [XFER-RETAIN](../../deferred.md#xfer-retain--snapshot-minima-continuity-and-erasurepublication-races). Current Core erasure and Write publication fences continue to apply; stronger mechanisms require demonstrated requirements. G1 retains generic identity/custody questions; G4/G5 retain source authority, safe recovery and import/Event correspondence. Historical Inception and source-correlation residuals remain [unadopted](../../deferred.md#import-context--historical-import-lifecycle-and-source-correlation), not new common Resource members.
