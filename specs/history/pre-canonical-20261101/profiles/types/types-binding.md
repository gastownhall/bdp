> Historical source snapshot from commit `692d801231c78e12b456d8c5213bdf137a6b534d`. This is not the canonical review specification. See the [current specification](../../../../README.md). Original source and hash are recorded in the archive index.

# Types version 1 binding

Selected draft source under [Types](types.md), paired with the [common contract binding](../core/contract-binding.md). This is source selection, not release adoption, advertisable runtime evidence or an implementation claim. The [feature-owned schema](types-v1.schema.json) supplements the unchanged v0.1 common bundle; it is not another common schema authority.

## Exact capability and Scope obligation

| Item | Selected value |
| --- | --- |
| Capability identity | `https://github.com/gastownhall/bdp/capabilities/types` |
| Exact supported version | JSON member name `"1"` |
| Version-1 detail | Closed empty object `{}` |
| Base contract | BDP `"0.1"`, existing complete specification identity |
| Types-required JSON representation | `application/vnd.bdp.v0.1.types.v1+json` |
| Additional shape source | `https://github.com/gastownhall/bdp/schemas/types-v1.schema.json` |

The capability is independent of the base `core`/`write` profile literal. There is no `types` profile literal or new required root discovery member. Version strings compare exactly; future versions are not ranges or replacements. Base clients may ignore unfamiliar entries/versions and continue using promised base behavior. Types-aware clients validate the known closed detail in addition to common discovery; unsupported versions alone do not establish version-1 support.

Advertising Types1 promises its full selected interpretation for **all live and retained Bead/Link revisions of the logical Scope**, including captured owned Link records. Output affiliations pin exact definitions, and the complete required exact definition/schema/declaration closure is retained. No per-Resource or prospective epoch qualification is introduced. A Scope with older URI-only affiliations or unavailable required meaning MUST refuse activation; it MUST NOT guess pins, grandfather old covered records, rewrite history or change the coverage boundary to make the flag pass. Remaining Core-only or starting a distinct qualifying Scope are alternatives, not migration instructions.

Types1 additionally requires actual version-1 [exact definition lookup](../core/type-definition-read.md), including its authorization, whole-record and bound obligations. Narrow lookup support alone is not Types1. Trusted intrinsic provisioning and activation are admission events under that lookup contract: establish complete servability within actual resource/property/response bounds before accepting the obligation. Failure uses the existing applicable limit/validation diagnosis; no truncation, paging of an owned capture or later substitution is permitted. Tightened configuration cannot strand promised accepted exact records.

Read-only Core can support Types1. Write support makes the profile's admission, validation, final-graph, ownership, revision and refusal obligations conditional on the actual advertised operations. Types1 does not require atomic-batch support; when atomic batch1 is independently advertised/selected, its existing final-publication obligations also apply. No public registration, installation, inventory or lifecycle operation is added by this capability.

## Rejectable selection on ordinary operations

Passive advertisement is not request selection. For ordinary Resource reads, local graph collection/family reads and ordinary singleton mutations that require Types1, the client selects the exact Types-required subtype above. Reads send `Accept` selecting only that successful representation: no base alternative or wildcard fallback. Mutations send that subtype in `Content-Type` and select it in `Accept`. The JSON bodies, References, operation routes, revision guards and ordinary result shapes remain those of the selected v0.1 operation; the feature schema additionally requires exact affiliations in full record outputs, including captured owned Links. This is an additional binding, not a media parameter or ignorable header.

An unaware receiver rejects the unsupported mutation subtype with 415 before effects or key claim. A read that offers no acceptable successful representation receives the existing bodyless 406. A Types-aware receiver must not serve a successful Types-required response while Types1 is unsupported for that invocation. Common authentication, request bounds, syntax and nondisclosure ordering remain applicable; unsupported media does not authorize disclosure of hidden state. A client MUST NOT retry with base/generic JSON, drop Types, change versions or allocate a fresh key to force execution. Stale discovery therefore cannot silently downgrade a Types-required request.

The server preserves all promised base representations and operations. Base clients can keep using them; a Scope advertising Types1 enforces its Scope-wide invariants on **all** accepted writes, not only requests using the richer subtype. The distinct subtype lets a client require that promise even if support/context changes between discovery and admission. A Scope cannot disable validation while continuing to advertise Types1.

Optional atomic batch uses the same Types-required HTTP subtype when its mutations require Types1. The existing body independently selects atomic-batch version1; neither discriminator substitutes for the other. The complete group is preflighted and processed under both selected contracts. Types does not expand batch members or waive a disabled member. This rule is confined to ordinary Resource/collection operations and their mutation results. It does not relabel discovery, Events, schema documents or the exact-definition lookup wrapper as ordinary Resources. The lookup keeps its independent query selector and common response binding.

Successful negotiated Types JSON uses the Types subtype; Problems remain `application/problem+json` and schema documents `application/schema+json`. JSON decoding support alone is not feature support. Negotiate the actual representation before conditional success, including 304. Existing HEAD/304 bodylessness, authorization, variant-sensitive validators, conditional context and `Vary` obligations apply; a base representation's validator is not proof of a Types-required representation. No new error code, HTTP validator meaning or Resource revision is introduced.

## Frozen intent and retained recovery

The selected v0.1 identity, Types capability/version and subtype are part of semantic execution context. CLI compilation, native invocation, dry-run context, the mutation journal and HTTP-to-executable predispatch validation MUST preserve them. A body alone is not a self-describing feature selection. `bdp_spec` continues identifying the actual base contract; it does not by itself assert Types1 execution. No user-facing version flag is required or selected here.

There is one existing logical-Scope/authenticated-principal key namespace across routes, media and features. Identical JSON with Types-required versus base-only intent is not the same selected invocation, and changing carrier cannot create another namespace. Compare the frozen intent under the existing retained-key rules; a retained incompatible invocation conflicts instead of executing again. Preserve the original exact/default-resolution witnesses and result; never resolve a new default during replay.

After the receiver admits the carrier/key, known-key comparison/replay precedes fresh support, liveness, guards, defaults and admission bounds. Withdrawal of fresh Types execution does not erase the original disposition or promised recovery. Preserve the recognized recovery binding and required comparison/result state or refuse the incompatible configuration change. If a receiver genuinely cannot admit the frozen carrier or supply retained recovery, return the truthful applicable refusal/service failure; this never proves the earlier write did not happen and never permits reexecution under base semantics. Current authorization still governs disclosure of retained results.

## Structural and provider evidence

The feature schema checks known detail, Types1→lookup1 presence, base discovery compatibility and exact-affiliation record shapes. Unknown versions remain opaque. Structural validation cannot prove activation, registration, bound servability, permissions, graph semantics, negotiation, atomic refusal or durable recovery.

Provider acceptance must separately demonstrate unsupported subtype/refusal without effects or key claim; valid typed read/write results; exact-definition lookup preserving its complete wrapper and recorded origin context while omitting fabricated origin context; stale-discovery refusal; no base fallback; independent Types/batch selection; cross-carrier same-key conflict; retained replay after fresh-support withdrawal without default re-resolution; no-op validation; conditional HEAD/304/406 correspondence; and executable predispatch context. Written cases or artifact shape tests are not execution of these obligations.
