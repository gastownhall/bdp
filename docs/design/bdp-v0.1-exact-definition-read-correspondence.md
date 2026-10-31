# Exact definition lookup: shared source correspondence

Candidate under existing #282/#279/#280 and sole #59. Shared base is read-delivery
PR293 `36a8374fd9feef113d8b6fd8ade15c21ad46f4be`, still a draft undergoing bounded
parent review. The Types input is the five-file exact-read increment at
[PR283 `8fc7ce901f747587d352091d7110050059d3dc49`](https://github.com/gastownhall/bdp/pull/283),
over `a2aa88d`. Neither source is adopted or runtime support. This pairs the
[CLI interpretation seam](../cli-design/exact-definition-read.md) with the
[Core binding](../../specs/profiles/core/type-definition-read.md), two shared schema
copies and [literal paper cases](../../fixtures/type-definition-read/candidate.json).

## Closed propagation

The feature is a direct exact-pair lookup in an explicit interpreting Scope,
including authorized retained foreign definitions when their origin is offline.
It uses required rejectable query version selection, complete recorded definition
values/owned Refines state and an explicit result wrapper/origin context. It does
not retarget ordinary canonical point reads, infer ownership from the receiver,
fetch/register on a miss or require application History. Unknown versions refuse
before version-1-specific interpretation.

| Types-local definition | Shared native definition |
| --- | --- |
| selection | typeDefinitionReadSelection |
| queryV1 | typeDefinitionReadQueryV1 |
| capabilityV1 | typeDefinitionReadCapabilityV1 |
| definitionRecord | exactTypeDefinitionRecord |
| success | typeDefinitionReadResult |
| capabilityProblem | typeDefinitionReadCapabilityProblem |
| problem | typeDefinitionReadProblem |

These seven helpers are a literal structural port with only reference/name
rewriting into the shared bundle. Exactly one prior definition changes:
capabilityAdvertisements validates known version 1 detail while preserving
unknown version objects and the atomic-batch advertisement. Other prior definitions,
root metadata and the old v0 slot remain unchanged. The candidate now contains
178 definitions; that is this source snapshot, not a permanent size invariant.
The separate CLI framing schema/registry/runtime exports are untouched.

The frozen Types-local schema/cases retain their actual original common dependency,
PR292 ad6ddd4/hash d9c9822c8abdaae907a966ef076f945043116adb52b94c9c1c71dbaa8c8adf09.
The new fixture identifies that original dependency separately from this shared
port; it does not relabel old evidence or claim the Types checker ran against a
new input. Source checks compare the seven ported definitions, original cases
and complete Task/Refines record values against exact 8fc7ce9 Git inputs.

## Narrow common permission and ownership

The Core History-only rule now explicitly permits only revision-unretained on this
selected operation, with positive local knowledge, missing reconstruction and
current whole-definition/owned-state disclosure permission decidable without the
missing bytes. It imports neither the other four diagnoses nor general History,
versions pages, mandatory provenance, participation tracking or a retention floor.
Unknown/nondisclosed exact pairs retain uniform resource-not-found. Temporary I/O
is service failure, never invented loss evidence. The reused 64-item missing-state
ceiling bounds diagnostics, not the definition or its owned Link family.

The wrapper has no Resource/Collection kind header. Optional service-desc names
the responding lookup service; recorded originScope is not a current verified
mutation destination. These ordinary owning-Scope rules apply to actual canonical
point reads. Original authority/bootstrap context cannot be fabricated or erased to
claim an otherwise unqualified intrinsic case.

Encoded request bounds keep their existing meaning. Inner Resource/property byte
limits count their actual native JSON, while whole-wrapper capacity is protected
at state/configuration admission. Version 1's closed detail gains no speculative
budget field. No implicit family maximum, owned-state page, new registration API
or configuration shrink may silently discard a promised complete read.

## CLI boundary and qualification

The adapter has explicit exact-definition intent and interpreting context; generic
show does not silently fall back from missing History. A future Type command must
provide a usable signature/descriptor preserving this wrapper. Public Type CLI is
still the user's deferred surface; only type list remains the placeholder. This
candidate therefore does not claim complete public CLI/wire isomorphism for Types,
add a hidden command or relabel the wrapper as an ordinary Resource result.

Actual bounded validation is **481/481 across thirteen files**, zero failures/skips:
eleven new shared artifact tests plus the prior 470. Strict Ajv/full formats compiles
all 178 definitions; grammar controls cover dispatch versus admission, known/unknown
capability versions, query shape/token encoding, exact affiliation/owned state,
wrapper/origin separation, feature-local Problems and the narrowed diagnostic union.
The first 10-pass/one-failure log is preserved: its control used the wrong existing
revision-reorganized family/status, corrected to the unchanged gone/410 mapping.
No schema or old assertion was weakened to resolve it.

One current History catalog quotation is updated to include the explicit narrow
exception; IDs/profiles/anchors/order/selection and the other quotes remain unchanged.
All 569 current quotations resolve. The ordinary read-framing test loses its incidental
171-definition count because that source-snapshot number is not a framing invariant;
all real framing/protected-context/native/error assertions remain. Exact source checks
bind this port's seven additions/one amendment rather than make future unrelated
capabilities break that CLI test.

Fourteen query shapes, six encoding examples and copied complete response/Problem
values are grammar/correspondence checks. Six service cases remain unexecuted; no
lookup provider, dispatch/auth/storage, origin proof, operational admission, complete
closure, HTTP, installed-client, compiler/renderer or public Type command is qualified.
No full-suite/hosted green is claimed. Actual Types/profile composition, intrinsic
publication and semantic integration remain gates, alongside required Event decisions
and exact multi-operation owner allocation. Runtime/main/product/serve/Vickie/
Experimental holds stay in place. Trish owns Types, shared propagation is Sybil's
source lane, and Molly curates at useful milestones; no extra tracker/worker/review
campaign or publication-permission queue follows.

Final source checks resolve thirteen JSON fences and 69 local file/anchor targets;
six touched TS/JSON files pass Biome/whitespace. Canonical/distribution candidate
bytes match at SHA256
`489df73fe36a96348e5c87a614c5973625a930a2559f755b2d77bca47a8c2e7c`.
Held v0 remains
`15104f001d41290c130b22999ceafe3bb9e83e8aa36db3f7aee2de06c268a327`.
Own temporary dependency links/caches are removed before publication. This evidence
paragraph and byte-format-only restoration of an unchanged Unicode quotation follow
the passing run; no new semantic/test/schema change follows it.
