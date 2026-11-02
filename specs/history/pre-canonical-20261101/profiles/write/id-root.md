> Historical source snapshot from commit `692d801231c78e12b456d8c5213bdf137a6b534d`. This is not the canonical review specification. See the [current specification](../../../../README.md). Original source and hash are recorded in the archive index.

---
status: draft
intended-status: normative
version: "1"
---

# ID-root allocation: fixed version 1 Write supplement

This draft supplements [retained Write](retained-write.md), [creation/allocation](write.md#creation-and-identity-allocation) and optional [atomic-batch1](atomic-batch.md). It defines server allocation beneath an authored local identity prefix for both Bead and Link creation. It does not change the common v0/v0.1 schema or mirror, prescribe deployment routes, or claim an implemented provider. Trish's receiving review and integration remain pending.

## Advertisement and selection

Capability identity is https://github.com/gastownhall/bdp/capabilities/id-root. Exact version "1" has a closed empty detail object:

```json
{"capabilities":{"https://github.com/gastownhall/bdp/capabilities/id-root":{"1":{}}}}
```

Only a Write provider may advertise it. Advertisement promises both ordinary createBead and createLink forms; support is not inferred from one form. Unknown advertised versions are ignorable and do not authorize version1. Capability support conveys no authorization or Types support.

The presence of idRoot at an ordinary create target permanently selects this fixed id-root1 string form. Use the SAME discovered createBead/createLink URL, POST media and Idempotency-Key as ordinary Write. There is no new endpoint, media parameter or version flag. The selected request requires idRoot and forbids id. Without idRoot, use the unchanged ordinary create request and its allocation semantics. A base closed receiver rejects the new member; no client-side fallback, fabricated explicit ID or automatic new key is permitted.

Detection is confined to grammar-owned create positions. A properties/metadata member or string named idRoot does not select this feature. A top-level idRoot on update, delete, alias, read or an unknown operation is malformed, never an ignored hint. Wrapper or per-member idRootVersion is not admitted. A future feature version must have a new rejectable selector; it cannot reinterpret this fixed string form.

After ordinary syntax/media/authentication/carrier/key admission and the existing known-key comparison, a fresh selected invocation without id-root1 support receives the feature-local capability-not-supported Problem: status422, retry after-state-change, capability URI above, capabilityVersion:"1", pointer /idRoot for a singleton or /operations/N/idRoot for its selecting batch create. Do not interpret the unsupported extension's remaining values as another grammar. On a supported fresh invocation, invalid root/type/endpoint/other ordinary input receives its applicable ordinary refusal. This selection does not override atomic-batch's own carrier/support admission. Missing support does not erase previously issued recovery rights.

## Human-readable carrier tables

These tables follow the Name, Type, Required, Defined by, Meaning convention of the original Markdown JSON Schema format v0.5 and the operation-table layout of its OpenAPI sister v0.4. They are explanatory tables, not a claim of strict DSL translation or round trip: external BDP references, allOf, conditional admission and canonical-path constraints remain authoritative in the separate JSON Schema and prose. The root integration records the original format source pin.

### Object: idRootCreateBeadRequest

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| idRoot | idRoot | yes | IdRoot1 | Canonical local prefix for one service-allocated opaque suffix segment. |
| type | typeReference | yes | RetainedWrite | Whole canonical Type affiliation, with optional exact string revision pin. |
| properties | properties | no | RetainedWrite | Ordinary initial properties; omission means the ordinary empty object. |
| metadata | metadata | no | RetainedWrite | Ordinary initial metadata; omission means the ordinary empty object. |
| revisionProvenance | revisionProvenanceInput | no | RetainedWrite | Ordinary caller-supplied provenance subject to normal admission. |

This is the full selected Bead body. id is absent and forbidden: id and idRoot cannot coexist. Without idRoot the ordinary base create carrier applies, including its optional id.

### Object: idRootCreateLinkRequest

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| idRoot | idRoot | yes | IdRoot1 | Canonical local prefix for one service-allocated opaque suffix segment. |
| type | typeReference | yes | RetainedWrite | Whole canonical Type affiliation, with optional exact string revision pin. |
| source | durableInputReference | yes | RetainedWrite | Complete ordinary source Reference; singleton creation has no name handles. |
| target | durableInputReference | yes | RetainedWrite | Complete ordinary target Reference; explicit pins remain literal string tokens. |
| properties | properties | no | RetainedWrite | Ordinary initial Link properties. |
| metadata | metadata | no | RetainedWrite | Ordinary initial Link metadata. |
| revisionProvenance | revisionProvenanceInput | no | RetainedWrite | Ordinary caller-supplied provenance subject to normal admission. |

This is the full selected Link body and also forbids id. The canonical Reference is a URI string or closed uri/revision object in the applicable input domain; an integer revision or id/revision object is not that Reference. These named types refer to existing canonical definitions, not guessed Markdown primitive formats.

### Object: idRootBatchRequest

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| capabilityVersion | text | yes | AtomicBatch1 | Exactly the string 1 selecting the existing atomic-batch1 carrier. |
| operations | array of idRootBatchOperation | yes | IdRoot1 | Nonempty six-CRUD array with at least one rooted create; no extra wrapper selector. |

Feature create members add the ordinary operation and optional name fields to their open member form; unlike selected singletons, an individual create in a feature batch may be unrooted. Link members retain existing inputReference name support. The complete closed member variants and exclusive id/root rule are defined by the feature JSON Schema.

## HTTP operation tables

Targets below are the existing discovered Write create URLs or the independently advertised atomic-batch1 URL. No fixed path or new operation is defined. The singleton URL selects Bead versus Link grammar before body validation.

### POST ordinary discovered createBead or createLink URL

#### Parameters

| In | Name | Required | Type | Meaning |
| --- | --- | --- | --- | --- |
| header | Idempotency-Key | yes | idempotencyKey | Existing byte-exact principal and Scope key namespace. |

#### Request body

Required: yes

| Media type | Type | Meaning |
| --- | --- | --- |
| application/vnd.bdp.v0.1+json | idRootCreateBeadRequest OR idRootCreateLinkRequest | Use the corresponding body for the already selected ordinary create URL. |

#### Responses

| Status | Meaning | Media type | Type |
| --- | --- | --- | --- |
| 200 | Original complete ordinary created outcome. | application/vnd.bdp.v0.1+json | mutationResult |
| 405 | Ordinary method rejection with no body. | — | — |
| 406 | Ordinary unacceptable response media with no body. | — | — |
| 422 | Applicable feature refusal or ordinary admission Problem. | application/problem+json | idRootCreateProblem |
| 500 | Unexpected internal fault with no Problem body. | — | — |
| default | Other applicable ordinary Write Problem. | application/problem+json | readUpdateProblem |

#### Response headers

| Status | Name | Required | Type | Meaning |
| --- | --- | --- | --- | --- |
| 200 | Cache-Control | yes | text | Existing private, no-store response policy. |
| 405 | Allow | yes | text | Ordinary allowed methods and applicable OPTIONS policy. |

Existing command-result rules forbid operation-target ETag and Location. This supplement adds no Resource-kind header or other result metadata.

### POST existing advertised atomic-batch1 URL with rooted create composition

#### Parameters

| In | Name | Required | Type | Meaning |
| --- | --- | --- | --- | --- |
| header | Idempotency-Key | yes | idempotencyKey | Existing batch invocation key; not one key per member. |

#### Request body

Required: yes

| Media type | Type | Meaning |
| --- | --- | --- |
| application/vnd.bdp.v0.1+json | idRootBatchRequest | Explicit feature-owned composition requiring both advertised capabilities. |

#### Responses

| Status | Meaning | Media type | Type |
| --- | --- | --- | --- |
| 200 | Complete ordinary atomic result with actual allocated IDs. | application/vnd.bdp.v0.1+json | atomicBatchResult |
| 405 | Ordinary method rejection with no body. | — | — |
| 406 | Ordinary unacceptable response media with no body. | — | — |
| 422 | Applicable feature, batch or ordinary admission Problem. | application/problem+json | idRootBatchProblem |
| 500 | Unexpected internal fault with no Problem body. | — | — |
| default | Other applicable ordinary atomic-batch Problem. | application/problem+json | atomicBatchProblem |

#### Response headers

| Status | Name | Required | Type | Meaning |
| --- | --- | --- | --- | --- |
| 200 | Cache-Control | yes | text | Existing private, no-store response policy. |
| 405 | Allow | yes | text | Ordinary allowed methods and applicable OPTIONS policy. |

The same command-result ETag/Location prohibition and ordinary HTTP boundaries apply. These tables do not replace the cited native conditional-response or error-precedence clauses.

## Canonical prefix and one opaque suffix

idRoot is a nonempty canonical local path prefix, without a leading or trailing slash. For example, projects/alpha requests an identity of the form projects/alpha/<opaque-segment>. The service chooses exactly one nonempty safe suffix segment and emits the complete absolute canonical Resource URL. It does not return an ID template or leave interpolation to the client. The prefix itself need not identify an existing Resource and allocating beneath it creates no Resource at the prefix. Hierarchy implies neither containment nor a nested Scope.

Apply Core's [local path rules](../core/core.md#scope-discovery-and-human-documentation): nonempty safe segments; no dot segments, controls, backslashes, query/fragment, scheme-relative or absolute URI; no encoded separator; exactly one percent decode with valid UTF-8; unreserved characters literal and required escapes uppercase; no Unicode normalization. Root spellings are literal prefixes, never creation handles, result paths, Type locators, alias resolution requests or absolute URIs. URI@2 remains one literal Type URI; no new token/pin parser is introduced.

The separate schema performs lexical canonical-spelling checks, including encoded unreserved/control/separator refusals. It cannot establish all UTF-8, canonical identity, namespace ownership or allocation policy. For example a%FF passes its lexical shape but MUST fail service UTF-8 admission. All resulting full-path constraints and ordinary configured bounds still apply. Root plus suffix must remain in the owning canonical Scope and must not conflict with Resource identities, aliases or protocol navigation.

Allocation preserves ordinary lifetime non-reuse across both Resource kinds and deleted identities. Concurrent distinct keys cannot commit the same identity. The service reserves the chosen identity, all Resource/owner effects, required facts and terminal key state atomically, or none. No client collision scan, counter/entropy guarantee, inferred kind prefix, pre-created directory or permission bypass is added. The service may refuse roots it cannot safely support under its existing native policies/bounds; it must not silently allocate elsewhere.

## Type admission, outcomes and durable retry

Type remains the ordinary whole typeReference. With Types semantics, the service resolves/adopts the exact accepted definition at admission once; a client does not prefetch a definition to manufacture that result. An explicit pin is checked as an exact opaque string token. An unpinned default resolved for the original decision is captured as ordinary accepted affiliation. Root selection changes no authorization, protected-input, provenance, endpoint, ownership or final-publication rule.

Return the unchanged complete ordinary mutationResult. Its created Resource contains the actual allocated canonical id and original accepted Type/postimage; no root or suffix field is added to a Resource or result. Required facts and any owner effects use that same identity. A name capture in a batch captures only this identity, not a future/staged revision.

The authored root and selected capability participate in the existing complete semantic invocation identity; the allocated result and resolution witnesses are retained with the decision. A known same-meaning key returns the original disposition and ID/Type/postimage, even after a default changes, the Resource is later deleted, or fresh feature support is withdrawn, subject to existing disclosure/retention rules. It neither reallocates beneath the root nor re-resolves current defaults. Changed meaning conflicts; retained in-progress behavior and expired-success anti-reexecution remain ordinary Write. No new namespace/key generation, collision retry, weakened output authorization or recovery mechanism is introduced.

## Explicit composition with atomic-batch1

If a service advertises both capabilities, id-root1 also composes at the SAME advertised atomic-batch1 operation URL. Both advertisements are required. The wrapper remains capabilityVersion:"1" plus operations; there is no wrapper/member id-root selector. Presence at a createBead/createLink member selects the feature-owned idRootBatchRequest grammar. At least one rooted create is required for this selected composition. Other creates may omit both selectors or use ordinary id; no create may carry both id and idRoot. Six CRUD discriminators, operation/name fields, prior creation bindings and all other members retain their ordinary meaning.

The [feature schema](id-root-v1.schema.json) composes open base createMembers and closes its extended singleton/member carriers. Its batch union substitutes the two extended create variants and directly reuses the four already closed base update/delete variants. It explicitly owns this composition; it does NOT modify, validate as, or silently broaden the old closed batchRequest. A no-root batch uses the original schema. It does not select richer batch2, queries, sets, aliases or sequence execution.

Prior names remain unique and refer only to prior created identities of the required kind. Root is never interpolated with @name. Atomic lifetime allocation, one complete bounded outcome, final-state publication and existing create-delete allocation effects remain unchanged. Ordinary unsupported-operation, guard, Type, endpoint and result-budget failures still roll back the whole batch. No separate singleton calls, partial prefix commit or chunking substitutes for this composition.

## Artifact and proof boundary

The [paired fixture](../../../fixtures/id-root/candidate.json) and [artifact unit](../../../packages/protocol/src/id-root-artifact.test.ts) cover the closed schema carriers, old-base preservation, reference/token syntax and authored Type/retry/allocation examples. Strict Ajv with full formats checks schema shape; it does not execute an allocator, Type evaluator, provider, CLI, HTTP transaction or concurrency/recovery scenario. Service refusal/allocation/default/replay examples are written obligations and correspondence controls, not provider PASS evidence. Implementation, integration, OpenAPI/CLI mappings and consumer qualification remain separate.
