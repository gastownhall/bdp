# Selected v0.1 exact Type-definition read binding

Shared correspondence for the Types-local
[exact source at PR283/8fc7ce9](https://github.com/gastownhall/bdp/blob/8fc7ce901f747587d352091d7110050059d3dc49/specs/profiles/types/exact-definition-read.md),
existing #282/#279/#280 and sole #59. [CLI interpretation](../../../docs/cli-design/exact-definition-read.md)
precedes this common propagation. The [selected binding](contract-binding.md) and
[shared schema](bdp-v0.1.schema.json) carry its request/detail/wrapper/Problem shapes.
This is staged source, not adoption, a new profile literal or runtime support.

## Capability and query dispatch

Capability `https://github.com/gastownhall/bdp/capabilities/type-definition-read`,
exact version `"1"`, has closed detail `{operation:ABSOLUTE_HTTP_URL}` served by the
advertising lookup Scope. No path prefix is prescribed. Base clients can ignore
this advertisement while retaining their actual supported base behavior. Advertising
it alone does not claim Types, grant authorization or imply application History.
Types' required complete-definition obligation remains the Types owner's source.

GET and corresponding HEAD take exactly once-only `capabilityVersion`, `uri` and
`revision`. Version 1 requires `capabilityVersion=1`, an absolute HTTP(S) canonical
Type identity and a nonempty opaque revision. The native query helper describes
decoded scalar members; the HTTP layer must separately reject repeated members.
Form-query decoding occurs once; literal plus is `%2B`, while encoded reserved
characters/Unicode remain token data. Literal `current`/`unpinned` have no special
wire instruction meaning. No alias resolution, local-name acquisition, creation
handle, inventory scan, default refresh, projection, incident view or paging.

Authenticate/apply ordinary non-disclosure and operational bounds, then read the
nonempty once-only selector before interpreting a future version's other members.
The permissive selection helper is a dispatch prefix, not request admission.
A supported version uses its complete closed query grammar. A valid unsupported
selector receives the feature-local request-family HTTP 422
`capability-not-supported`, `retry:"after-state-change"`, this `capability` URI,
requested `capabilityVersion` and `parameter:"capabilityVersion"`. No body JSON
pointer or atomic-batch capability is substituted. Missing/empty/repeated selection,
or invalid/extra version-1 members, uses existing `invalid-parameter`. No fallback
may silently change meaning. Lookup is read-only and creates no execution key,
registration/default effect or local graph membership.

## Complete wrapper, without ownership transfer

HTTP 200 uses selected v0.1 JSON and the closed result object:

```text
{ definition: COMPLETE_EXACT_DEFINITION_BEAD, originScope?: RECORDED_SCOPE_URL }
```

The definition's `id`/`revision` MUST equal the requested pair. Preserve its exact
metatype affiliation, all original properties/schema resources, metadata/provenance
presence and captured owned Links with their exact affiliations, identities,
revisions and endpoints. No incident aggregate, present-day recapture, synthetic
History provenance, current/nearest substitution or partial success. The definition
record helper requires the owned plane and pinned definition/Link affiliations;
shape validation alone cannot establish actual definition category/completeness.
Separate exact lookups follow recorded dependencies, not current adjacency. A child
read does not assert parent availability or complete closure interpretation.

`originScope` is returned whenever that original context is recorded. Never infer
it from a URI prefix or fill it with the receiver. Unknown intrinsic publication
context stays unresolved; a case requiring known original authority is not qualified
by dropping it. The received original context is not by itself a verified current
mutation binding. Authorized retained foreign definitions can be served while the
origin is offline, without fetching or renaming them.

This operation's wrapper is not a canonical Resource point response or a collection.
It MUST NOT carry `BDP-Resource-Kind` or `BDP-Collection-Kind`. If service-desc is
returned, it identifies the responding lookup service only, never the owner of
`definition.id`. The [point ownership rule](core.md#point-read-kind-and-owning-scope-navigation)
still applies to actual canonical Resource reads, not to every operation response
containing a record. Later mutation routing needs independently verified owning
context. Do not unwrap the result and treat its transport location as that proof.

HEAD retains selection/authorization/negotiation/status with no body. HTTP conditions
select this one native wrapper representation; auth/query/retained-state erasure
checks precede 304. GET 304 and precondition 412 are bodyless; negotiation 406 is
bodyless. Any validator is for the actual authorized lookup representation, not
an invented Resource revision, global closure or ownership witness. Applicable
private/no-store and CORS/ordinary HTTP rules remain binding.

## Narrow missing-state permission

Current whole-definition/owned-state disclosure authorization precedes existence or
reason-specific disclosure. Unknown exact pairs and nondisclosure use uniform
`resource-not-found`. This operation does not make an unfamiliar token evidence of
loss, pruning, reorganization or tampering. A temporary backend failure is ordinary
service failure, not proof that retained pieces are gone. Existing erasure and
ordinary discretionary removal disclosure take precedence; no removal lifecycle is
selected here.

For this selected lookup **only**, positive local knowledge of the exact retained
revision with missing reconstruction pieces MAY use existing `revision-unretained`
under current whole-definition/owned-state disclosure permission. This permission
MUST be decidable without reconstructing missing bytes; denial is never evidence
of loss. The required `missing` object retains [its precise bounded shape](core.md#historical-diagnoses-and-missing-state):
unique locations, at most 64, explicit `complete`, no content values or partial
Resource. It diagnoses missing reconstruction, not authorization or backend outage.
The cap bounds diagnostics, not the definition's semantic size or Link count.

This is the sole non-History exception to the History-only revision-diagnosis rule.
It neither imports the other four diagnoses nor requires subject-history permission,
versions pages, History provenance, participation tracking, retention floors or an
application History advertisement. The feature-local Problem union narrows existing
Read Problems plus this operation's capability refusal; global Read code tables
and History obligations stay unchanged. Ordinary `show URI@REV` cannot silently
fall back here solely because application History is absent.

## Existing limits and admission obligations

`limits.request.targetBytes` counts the complete encoded HTTP request target,
including the three query members. Exceeding the request bound uses existing
`request-too-large`; no successful partial/decoded/truncated query is allowed.
`limits.resource.representationBytes` applies to the inner complete definition
record including captured owned state, and `propertiesBytes` to its properties,
in UTF-8 JSON bytes under the existing definitions. They are not page limits,
family maxima or a claim that wrapper overhead fits in the inner record bound.

Version 1's detail adds no response-budget field. Actual whole-wrapper capacity
(including recorded origin context) and any operational count bounds must still
be honored at admission. Omission of a pre-advertised bound does not mean infinity.
Before accepting state/configuration that creates the promised exact-read obligation,
the authority MUST ensure it can serve the complete result within those operational
bounds, or refuse that admission using the applicable existing bound diagnosis
(`request-too-large` for request bytes; `limit-exceeded` for admitted operational
work/result capacity). This states no new Type registration or public CRUD API.

Tightening configuration MUST preserve promised complete retained reads or refuse
the configuration change. A newly smaller budget cannot justify truncation, paging
owned captures, an alternate current definition or false Unretained evidence.
Authorization changes remain authoritative. Existing promises do not turn temporary
I/O into permanent loss or demand invented data. Concrete implementation admission,
authorization/storage failures and retained-read service cases remain unqualified
by this source/schema port.
