# Memory V2 interchange — WIP proposal

WIP/proposed specification material for Donna, Trish and implementation owners. October 17, 2026.

Prepared from PR159 d7197e97a29bff8f075028419afad05388e2e655. Not adopted wire/schema, runtime behavior or release qualification. Existing [Core](../../profiles/core/core.md) and [Write](../../profiles/write/write.md) remain unchanged. Donna’s semantic/landing holds remain in force; preparation/publication of this draft does not release them.

Review companion: [bounded implementation plan aligned with Trish’s scoped Memory Types work](../../../docs/design/iris-memory-interchange-plan.md). Go implementation remains paused pending Donna’s review. Pure contract/fixture draft preparation is authorized.

Define one portable, versioned JSONL contract for moving a selected Memory-containing graph between V2 implementations. Deliver legacy import and Go interchange through bounded adapters to the current storage APIs. The future Rust implementation reads and writes the same contract. Neither Go delivery nor this format depends on a new query engine, URI layout, HTTP streaming protocol or full BDP deployment.

## Goals and release boundary

The immediate goals are to import supported legacy data without silent loss and interchange canonical V2 Resources between independent implementations. V2 means the selected Memory specification is complete except for an explicit, curated exception ledger. Federation is the first expected exception; unsupported functionality is never silently counted as implemented.

The primary requirements are [Memory R24, R27 and R27a](https://github.com/gastownhall/beads/issues/5877): truthful legacy conversion, atomic connected-unit interchange, canonical identity and Link meaning, and explicit consent to export Memory bodies. Pin the accepted Memory, graph, Types and provenance contracts and their subsequent product rulings before freezing format version 1. In particular, the new Memory association has a distinct identity/name to be selected; existing `related` behavior must not be rebound.

The initial transfer profile is deliberately bounded:

| Include | Defer or refuse explicitly |
| --- | --- |
| Required Task and Memory state and Memory-related Links | Directory packages and full database backups |
| Exact IDs, properties, metadata, endpoint References and pins | General URI namespace redesign and relocation |
| Current heads plus retained versions required by pins and owned state | Arbitrary historical archive, synchronization and Event-log replay |
| Original per-version provenance and new import heads | Broad provenance redesign or fabricated original attribution |
| Existing required Memory/Link contracts | Arbitrary Type installation or unsupported contracts |
| One complete package published atomically into a fresh destination | Merge/upsert into a populated destination and resumable partial commits |

Donna selects identity-preserving handoff as the bootstrap contract. Absolute-ID
encoding is the proposed first implementation. Local-ID encoding and copy into a different Scope remain future contract capabilities, not prerequisites. Any required Memory behavior omitted by this profile must be implemented elsewhere or named in the V2 exception ledger; a narrow interchange pass alone does not establish complete Memory conformance.

## Relationship to BDP and the CLI

Resource payloads use one pinned, shared V2 Resource contract, with the corresponding BDP shapes wherever adopted. Transfer framing carries context, history membership and completion separately. There is no Go-specific Resource schema or backend table dump.

BDP continues to use cursored JSON over HTTP. An exporter may consume those pages or read the same logical Resources directly from its storage API. Both paths obey the same snapshot and value contract. Go need not implement a BDP server/client merely to support the file contract; the future Rust CLI can use its BDP implementation beneath the same reader/writer interface.

The intended CLI relation remains `export = selected coherent Resources + transfer framing`. General list/query unification can follow. Initial selection can be explicit seed IDs or the admitted graph, with the minimum endpoint/owned-Link/pin closure needed for a valid unit. It need not expose the proposed richer predicate language.

Use an explicit new-format selection during transition; existing legacy JSONL and dependent consumers keep their established format. Working spellings might be `bd export --format bdp-transfer-v1 --include-memories` and `bd import --format bdp-transfer-v1 --mode identity-preserving`. Exact flags are a separate CLI decision. Do not prepend a manifest to existing legacy output and silently call it compatible.

## Settled Bead Type-update behavior

Donna confirmed on October 17: BDP permits changing a Bead’s Type through the normal update operation. Validate the resulting properties and affected Links against the new Type’s applicable constraints. If that validation fails, the update fails atomically. This applies to Beads generally; it is not an import-only or Memory-only operation. A dedicated retype operation is unnecessary.

This is settled semantic direction. Propagating it into Core/Write, singleton/batch request schemas and implementations remains owner work; the existing frozen schema is not evidence that the selected behavior is implemented. Omitted property edits retain their ordinary update meaning, and existing transaction validation timing remains governed by the shared Types contract. This ruling does not broaden the selected Go V2 implementation cutline or release the implementation hold.

## JSONL record contract

One package is UTF-8 JSONL: a manifest, zero or more complete version records, then one completion record. Each physical line contains one JSON object. Values obey the selected Resource contract; invalid Unicode, duplicate members and unsupported numeric values refuse rather than being replaced or rounded. Writers use LF terminators. The final completion record must be followed only by its line ending and EOF.

| Record | Required meaning |
| --- | --- |
| `manifest` | Transfer format/version, immutable Resource-contract identity, canonical source Scope, ID encoding, selection/history policy and Memory exposure posture |
| `version` | Resource kind, explicit source-head membership and one complete Resource version, including its identity, revision and recorded provenance |
| `complete` | Distinct Resource/version counts and SHA-256 commitment to all preceding package bytes |

These are proposed field names. The Resource-contract identifier identifies immutable schemas and semantics; it is separate from producer version/build. Additional required capabilities must be declared before version records. Unknown required capabilities, record kinds or unsupported contract versions fail explicitly. Only extensions expressly permitted by the selected format may be ignored; closed BDP Resource bodies do not become open by being placed in a transfer.

`head` identifies the source current version. It is not inferred from record order, timestamps or opaque revision spellings. The initial profile carries one source head for each included live Resource and any additional retained versions required by its included pins and their owned state. It does not claim a complete ancestry archive. The initial profile refuses deleted endpoints/terminal-state combinations it cannot represent faithfully; they are separate declared capabilities rather than silently revived Resources.

`resourceKind` belongs to transfer framing while the selected Resource contract lacks a kind discriminator. If the adopted Resource contract contains one, it must agree with the wrapper. Bead and Link records retain the same envelopes and Reference forms as canonical reads. Preserve inline owned-Link state and its first-class Link records consistently; neither copy is an independent authority.

The completion digest covers the exact original UTF-8 bytes of every preceding line, including line terminators, and excludes the completion line. It establishes package integrity, not authenticity or permission to claim a Scope. Different encodings may have different digests without implying different logical Resource values. Empty exports still have a manifest and valid completion record.

The following framing example has a computed valid byte digest. Its illustrative Types/Resource contract are not the pending V2 catalog. It demonstrates a current Memory plus an earlier version needed by a pinned Task-to-Memory Link; no revision ordering is inferred.

```jsonl
{"record":"manifest","format":"bdp-transfer","formatVersion":1,"resourceContract":"urn:bdp:wip:core-carrier:d7197e97a29bff8f075028419afad05388e2e655","sourceScope":"https://example.invalid/project/","idEncoding":"absolute","selection":{"state":"current","history":"required-pins","memoryBodies":true}}
{"record":"version","resourceKind":"bead","head":true,"resource":{"id":"https://example.invalid/project/beads/task","type":"https://example.invalid/types/task","revision":"task-r1","properties":{"title":"Use the procedure"},"metadata":{"source":"synthetic"},"ownedLinks":{"https://example.invalid/types/association":[{"id":"https://example.invalid/project/links/citation","type":"https://example.invalid/types/association","revision":"link-r1","source":"https://example.invalid/project/beads/task","target":{"uri":"https://example.invalid/project/beads/procedure","revision":"memory-r1"},"properties":{"note":"Pinned source"},"metadata":{}}]},"revisionProvenance":{"actor":{"id":"user:source-author","basis":"writer-supplied"}}}}
{"record":"version","resourceKind":"bead","head":true,"resource":{"id":"https://example.invalid/project/beads/procedure","type":"https://example.invalid/types/procedure","revision":"memory-r2","properties":{"title":"Procedure","body":"Current café procedure.","steps":["Check the state"],"x-source":{"tag":"retained open field"}},"metadata":{},"revisionProvenance":{"actor":{"id":"user:source-author","basis":"writer-supplied"}}}}
{"record":"version","resourceKind":"bead","head":false,"resource":{"id":"https://example.invalid/project/beads/procedure","type":"https://example.invalid/types/procedure","revision":"memory-r1","properties":{"title":"Procedure","body":"","steps":["Check the older state"]},"metadata":{}}}
{"record":"version","resourceKind":"link","head":true,"resource":{"id":"https://example.invalid/project/links/citation","type":"https://example.invalid/types/association","revision":"link-r1","source":"https://example.invalid/project/beads/task","target":{"uri":"https://example.invalid/project/beads/procedure","revision":"memory-r1"},"properties":{"note":"Pinned source"},"metadata":{}}}
{"record":"complete","resources":3,"versions":4,"sha256":"5b76ec80e0fd3a48b57668179d0f5acb80e6976bb194f22f4844f2dfeef3a586"}
```

If required Memory key/name state is not part of the selected Resource representation, its shared transfer representation must be settled before freezing v1. Add an explicitly specified record family if necessary; never invent a Go-only field or silently lose key semantics. Likewise, classify Task labels/comments and other auxiliary state against the selected contract before claiming preservation. A generic Resource export is not automatically a complete legacy Issue export.

## Selection completeness and Memory exposure

A normal query may return a Link without its endpoints. An import-ready package must satisfy its declared closure instead. Export includes required local endpoint Resources, required pinned versions, owned-Link content and applicable Type-contract dependencies, or refuses the connected unit. External References remain opaque and are never fetched automatically. Carrying such a Reference alone does not claim federation.

All membership, live records, required historical reads and dependency checks come from one coherent source boundary. Independent transactional reads per Resource do not establish that guarantee. Export refuses an unavailable boundary or exceeded bound; it never substitutes a newer page, omits an endpoint, truncates history required by a pin or emits a successful completion for a partial unit.

Memory bodies require explicit caller consent. Ordinary export excludes Memories by default; automatic export generates no Memory records. A request selecting a Task with a required Memory endpoint must obtain explicit body-carrying consent for that package or refuse the requested connected transfer. It cannot substitute a summary for an importable complete version or quietly drop the Link. The manifest declares the resolved exposure/selection policy.

## Import admission and identity

The first path is an identity-preserving handoff into an empty, explicitly initialized destination for the same logical Scope. Preserve canonical IDs and source versions under the selected history-admission rules; authorize the destination authority explicitly. A package naming a source Scope does not by itself permit an unrelated store to impersonate that authority. This is a handoff/restore contract, not a live federation or concurrent multi-authority synchronization protocol.

Copying into a different logical Scope is deferred. That path requires a complete
identity/version/reference mapping and cannot silently retain old identity claims
while rewriting state. It is not interchangeable with local-ID spelling. The
bootstrap implements identity-preserving handoff only.

Import proceeds through five stages:

1. Validate manifest support, source context, destination mode and bounds. Reject unsupported formats, contracts or features before publication.
2. Stage the whole package and verify EOF/completion, digest/counts, duplicate identities/versions, source-head membership, References/pins, Types and owned-Link agreement. Exact retained addresses must never be rebound to incompatible content/provenance.
3. Resolve the admission plan and destination constraints. Existing required Type contracts must match exactly; no automatic arbitrary installation. Refuse data that cannot be represented truthfully.
4. Recheck state and atomically publish the package as one acceptance unit: admitted original versions, coherent destination heads, required import transitions and a durable disposition. No per-line commits or supported-prefix execution. A bounded package that exceeds transaction limits fails completely.
5. Return a structured receipt with invocation identity, package identity/digest, per-Resource original-version disposition and resulting head revisions. Once committed, a response/cleanup fault must not be reported as proof of rollback; resolve the outcome using the retained invocation identity.

A new import head records the local import and references its source version; the original version’s state/provenance remains unchanged. Original pins stay pins to original retained versions, not to the new heads. Imported content/recorded claims do not acquire authenticated historical attribution because the importer authenticated today. An operation that versions owning sources and Links must publish mutually consistent heads and account for each transition once.

Candidate provenance mapping: Polly’s origin/entry recommendation separates original identity creation from admission to the current recording context and the operation minting a revision. See [Iris’s format review](../../../docs/design/iris-inception-format-review.md). A stable admission correlation may link import heads to receipts, but must remain meaningful after operational receipt expiry, avoid exposing caller retry keys and avoid circular receipt/head hashes. Original historical entry accounts stay unchanged; older-package origin absence versus explicit unknown remains a shared decision. This recommendation is not adopted wire format.

The import-head transition must create the agreed imported lifecycle fact. Go can implement that narrow native history/event meaning without waiting for wholesale BDP Event-wire refactoring, but it cannot fake a property change or claim that ordinary create/update already preserves source history. Pin the minimum approved import provenance/event semantics before qualifying this capability. [BDP #153](https://github.com/gastownhall/bdp/issues/153) tracks the broader shared amendment; it is not permission to change the frozen main contract.

Same retained import invocation and same package/policy returns the same disposition, with no duplicate heads or Events. Reusing the invocation identity for a different package/policy conflicts. A deliberate second import is distinct; the initial fresh-destination importer refuses an occupied destination instead of performing a merge. Receipt retention/expiry and retry behavior after expiry must be explicit; do not claim unbounded exactly-once delivery.

## Existing behavior and opt in compatibility

New-format support does not replace dependency-mode import/export. Workspace
format and input/output format are independent dispatch decisions:

| Workspace | Interchange selection | Behavior |
| --- | --- | --- |
| dependency | Existing/default legacy format | Existing legacy import upsert/export behavior |
| link | Legacy input | Explicit legacy-to-graph conversion adapter into a fresh graph workspace |
| link | New versioned transfer | Identity-preserving graph handoff into a fresh destination |
| dependency | New versioned transfer | Clear unsupported-format/mode refusal; no mutation or automatic migration |

`--graph-mode` asserts a persisted workspace format for normal commands; it does
not convert a dependency workspace to link format or temporarily bypass the
binding. Flipping new-format selection must not silently route an old store
through new mutation semantics. Keep legacy options, output records, defaults
and existing partial-failure/retry behavior unchanged by this feature. Cover
classic/direct and proxied routes with feature-off regression/differential checks
against the selected integration base, plus mismatch/no-mutation controls. Do not
promise unchanged behavior from dispatch inspection alone.

Shipping v1.3.1 legacy semantics differ from the new contract: Issue IDs are
preserved but rows upsert; canonical graph revision/provenance history is not
in that format. Parsing precedes normal import writes. Classic/direct import
writes Memory config rows separately and large Issue imports in committed
chunks; later failure can leave durable earlier work. Proxied import applies
rows/Memories/prefix in one unit of work. Dependency validation may skip/report
an invalid edge rather than fail the import. File export stages to an atomic
replacement; stdout export may leave partial bytes after an error. A post-commit
reporting/cleanup failure is not proof that no change occurred.

The new format deliberately promises stronger package atomicity in both engines:
invalid or incomplete packages publish nothing, retained retry outcomes prevent
duplicate heads, and uncertain post-admission outcomes are resolved through the
invocation receipt. This promise does not retroactively change legacy semantics.

## Legacy import adapter

Keep the legacy path independently deliverable. Decode the existing Issue/Memory JSONL into one internal admission plan, using an explicit field-preservation/remapping/refusal table. Preserve empty Memory bodies and valid keys, exact content, dependencies, metadata and admitted comments. Missing historical authorship remains absent/unknown; no fabricated native history.

The adapter does not convert a legacy human key into canonical Memory identity. Resolve collisions, unavailable history and unrepresentable data before mutation. The source stays untouched and a failed conversion publishes no partially converted graph. R24 also covers legacy access/storage paths beyond a single export file; file-import qualification alone does not discharge that wider compatibility requirement.

The two readers, legacy and transfer-v1, may share validation/admission mechanics where meanings agree. They do not need to share their external record format, independent PR ancestry or release gates. Do not route the legacy importer through the future exporter or delay legacy fixes for the new format.

## Compatibility and independent consumers

Publish the versioned envelope schema, pinned Resource schemas, example files, expected normalized results and refusal vectors together. Clients choose a supported writer version. Readers explicitly declare supported versions and fail clearly on unsupported ones; future default changes have their own compatibility policy. No parser guesses a new format by attempting legacy fallback after invalid new-format data.

Conformance compares semantic state and references, retained originals/provenance and declared new heads. It does not compare backend tables, clock-specific destination revisions or identical complete histories. Readers must support arbitrary legal record ordering and forward references by staging; deterministic writer ordering may aid review without becoming version ancestry.

Use the same corpus for Go and Rust. A self-round-trip is useful but cannot certify interchange between independent implementations. Once both exist, require Go export → Rust import/export → fresh Go import, and the reverse, plus each implementation consuming the other’s independently authored fixtures. Before Rust exists, Go can qualify against the frozen contract and corpus; independent runtime interoperability remains pending.

## Tactical delivery plan

| Milestone | Deliverable | Completion evidence |
| --- | --- | --- |
| Freeze the minimum contract | Exact Memory/graph/provenance pins, Type catalog, identity mode, required history closure, envelope schema and refusal matrix | Schema/example checks and owner-dispositioned decisions; curated exceptions listed by requirement |
| Finish legacy import | Current Go adapter, mappings/refusals and actual producer corpus | Exact-source installed embedded/shared-server validation, interruption/rollback/retry proof, zero required skips |
| Add Go writer | Consistent bounded acquisition, serializer and explicit new-format CLI entry | Source unchanged, correct snapshot, consent policy, deterministic semantic output, failure/truncation and file-publication proof |
| Add Go transfer reader | Fresh-destination staged admission and receipts | Exact originals/pins/heads, every required refusal and injected-failure atomicity, restart/retry checks in both installed modes |
| Add the second consumer when authorized | Rust reader/writer against the same contract | Actual two-direction cross-implementation results on fresh disposable stores |

Reuse Iris’s existing legacy importer, snapshot-acquisition and detached-publication work where compatible with the selected V2 base. Earlier source checks do not qualify changed code or new Resource contracts. Keep PRs bounded and reviewable; Janet selects the integration base and coordinates engine qualification. Donna decides release scope and curated exceptions.

Initial positive fixtures must cover Unicode/empty-body Memory state; metadata; a Task-to-Memory association; required historical pins; and owned-Link consistency. Negative fixtures must cover Memory-body selection without consent, identity collision, key-lookalike retargeting, unknown/unsupported Type or contract, missing pin version, missing endpoint, inconsistent owned copies, invalid JSON values, truncated/tampered package, output failure and an injected import failure after staged work. Preserve current `related` behavior and use the separately chosen Memory association identity. Include retry after lost response and crash/reopen checks; success requires exact state and cleanup evidence, not merely a process exit code.

Exclude from this tactical path: `updateWhere`/`deleteWhere`, new query predicates or traversal engine, identity-root changes, native HTTP JSONL, directory packages, parameterized batches, stored procedures and Rust project startup. Go V2 remains at the six individual Resource operations. A BDP Resource-compatible file bridge does not imply full BDP profile conformance.

## Fit against the Memory requirements

Checked [Chris Sells’s Memory proposal #5877](https://github.com/gastownhall/beads/issues/5877),
body updated October 16, 2026, with his relevant clarifications. S13/R27 requires
selected Task/Memory/Link interchange preserving identity and meaning, with
whole-connected-unit publication or refusal. It does not require upsert into an
occupied destination or cross-Scope copying. The agreed fresh-destination,
identity-preserving profile and collision refusal are compatible with that
requirement; acceptance also requires a useful successful transfer, not refusal
of every nontrivial graph.

| Requirement | Profile obligation |
| --- | --- |
| S13 / R27 | Successfully transfer an admitted connected unit; preserve exact identities and Link meanings; reject unsupported units atomically; never match by key/lookalike ID |
| R3 / R7 / R22 | Preserve exact Memory state, metadata, derivation absence/empty/populated distinctions, recorded origin/provenance and whole owned/outgoing Link state under the selected V2 mapping |
| R18 / R19 | Preserve exact pins; admit required local retained states or refuse; opaque external References do not require acquiring their targets |
| R27a | Exclude Memories from ordinary export by default; require explicit body-carrying inclusion; automatic export generates no Memory records |
| R24 / TC7 | Legacy conversion preserves valid empty bodies and keys, invents no historical author and fails on ambiguity/collision/loss; account for supported legacy surfaces beyond files |
| R26 / R28 / R29 | Same canonical Resource meaning across providers/engines and structured records; file support alone does not prove all required history/viewer/API outcomes |

R14’s ordinary write rules do not mandate import upsert: the proposal assigns
interchange admission/mapping/publication to the shared interchange contract.
R13’s restoration of a deleted Memory is a separate shared History capability;
fresh-store import is not a substitute for it. The broader Memory V2 claim still
needs all non-excepted requirements fulfilled, including deleted/pinned lifecycle
behavior outside the supported transfer profile.

Before freezing the schema, settle key/name, derivation/Inception and the selected
Provenance V2 representation; preserving only the illustrative title/body example
is insufficient. Add named positive and refusal tests for the table above. The
new format is not yet qualified: existing graph import/export artifacts and this
schema discussion do not establish actual Go/Rust interchange.

## Decisions needed before implementation

1. Pin the exact V2 Memory/graph/Types/provenance contract and curated exception list, including key/name and auxiliary-state representations.
2. Specify authority admission for the agreed identity-preserving handoff into a
   fresh destination of the same logical Scope. Cross-Scope copy is deferred.
3. Approve the minimum import-head provenance/version/Event semantic and authority-admission rules without waiting for unrelated shared amendments.
4. Fix package/transaction limits, Type catalog support and receipt retention/recovery semantics.

No broader query or naming decision is a prerequisite. This PR publishes a review draft; Go implementation and normative/runtime promotion remain separately gated. Rust setup/startup and spec-main amendments remain governed by the existing owner gates in [BDP #59](https://github.com/gastownhall/bdp/issues/59).

## Shared Inception design update — October 17, 2026

Donna delegates shared Inception design to Polly, replacing the candidate’s editable Memory-only property. Preserve original identity-creation claims separately from destination import/revision facts; exact fields and unknown handling remain undecided. Coordinate the minimum preservation/import-head contract before schema freeze. Full provenance expansion may follow Preview 3; that does not waive truthful history or permit a competing envelope. See the [batch/retyping and provenance dependency note](../../../docs/design/iris-batch-memory-retyping-note.md). Source implementation remains paused.

## Colocated review artifacts and limits

`transfer.schema.json` is a WIP **framing scaffold**. Its `resourceContract` names
only an illustrative current-Core carrier anchored to the starting commit; it is
not the pending V2 Memory/Types/Provenance contract. It reuses Core beadRecord/linkRecord with complete metadata required and the
derived incident-Link aggregate excluded, rather than inventing alternate members. Closed Core shapes
still refuse proposed Inception fields and exact Type affiliations they do not
admit. Before format freeze, select the actual accepted contract (including how
original versions under earlier contracts remain interpretable) and revise this
scaffold deliberately. A single current schema cannot silently reinterpret every
retained historical contract. Required unsupported histories must refuse.

`examples/connected.jsonl` is synthetic and uses illustrative Type URLs. It carries
complete properties, recorded source provenance, an owning source with matching
inline/first-class Link state and an older target version required by an exact pin.
It proves neither actual Type installation nor the complete Memory catalog. Do
not copy its IDs/revisions into production fixtures as accepted domain identities.

`../../../fixtures/specs/interchange/refusal-cases.json` describes finite mutations of that package. Run
`uv run --no-project --with 'jsonschema[format]' python scripts/check_transfer_examples.py`.
The offline checker validates framing/current carrier, strict JSON/UTF-8,
digest/counts, heads, required local endpoint/pin closure and owned-copy agreement
for these vectors. Current owned-state agreement and Memory-family consent checks use explicit
synthetic `../../../fixtures/specs/interchange/resource-facts.json`; it does not infer or install a domain
Type catalog. It is a review-artifact checker, NOT a shipping importer,
canonical URI normalizer, domain validator, signer, History implementation or
proof of bounded runtime admission/atomicity. It opens no stores or servers.
Resource contract, authority, imported-head provenance, retention, transaction
bounds and actual failure publication remain runtime/owner gates.

Pending literal CLI flags, discovery, future resource-contract IDs, cause values
and receipt wire members remain proposals. No changes to the distribution schema,
current parsers, conformance catalogs, shipped profiles or client pins are made.

The scaffold checker currently requires LF on every physical line, including the
completion record. Reader acceptance of other line endings is not selected by
this artifact; pin that policy explicitly before freeze.

Polly’s subsequent reviewed recommendation incorporates the format feedback:
new heads preserve unrecorded origin as unrecorded; explicit unknown stays
explicit; identity continuity/copy is separate from legacy-conversion as a
transformation. Admission correlation is portable beyond retry-page expiry and
avoids a receipt/head hash cycle. These remain recommendations pending Donna,
not adopted fields or an origin-account-correction implementation dependency.

[Review and check status](REVIEW.md) records the per-draft council disposition.

Required closure includes the retained first-class owned-Link versions embedded
in each selected retained owning version, recursively with their required local
endpoint/pin state. `examples/historical-owned.jsonl` demonstrates this case;
missing the historical owned version refuses. If a required Resource is now
terminal/deleted and the initial live-head profile cannot represent it, refuse
the unit rather than revive it or drop its owned state. This is required history
closure, not a promise to export every historical version.

The fixture facts in `fixtures/specs/interchange/resource-facts.json` classify the
illustrative Procedure as Memory-family and Association as source-owned; they are
not a production catalog. A no-consent Memory vector now refuses. Current-Core
numeric admission compares exact decimal values with ECMAScript's finite binary64
shortest form using the repository's Node runtime; large admissible values and
negative zero have a positive package, while excess-precision integer/decimal
vectors refuse. Scope/path-boundary and fixed Resource-root checks cover the
current-Core scaffold; they are not a complete canonical-URI normalizer or an
authority-admission implementation. Initial head/history records require explicit
metadata and exclude derived/cursored incident views.

This scaffold refuses original historical records lacking complete metadata; it
never invents `{}` to make them pass. The accepted historical contract must
settle any supported unrecorded metadata representation before freeze.

## Explicit pre-freeze gaps in the scaffold

The review checker is not a complete current-Core validator. Noncanonical local
endpoint spellings (host case/default ports) can currently be classified external
and skip closure; local-ID segment grammar (empty/dot/backslash/encoded separator)
is not fully checked. Those gaps must be fixed before format freeze or any real
admission use. They are recorded review limitations, not permitted transfer or
federation semantics. The Node runtime is required in addition to the documented
uv/Python dependencies for numeric checks. Event fixture carriers similarly do
not execute ownership, rollback/no-op or endpoint-source projection behavior.
The completed draft-publication council does not qualify those runtime behaviors.
