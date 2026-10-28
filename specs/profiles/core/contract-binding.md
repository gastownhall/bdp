---
status: draft
intended-status: normative
version: "0.1"
---

# BDP v0.1: selected contract and JSON binding

Paired source under [#280](https://github.com/gastownhall/bdp/issues/280) and sole plan [#59](https://github.com/gastownhall/bdp/issues/59). This fixes the selected transport/artifact identity; the [current source map](../../../docs/design/bdp-v0.1-current-source-map.md) identifies the assembled contract and its proposal boundaries. The [CLI binding](../../../docs/cli-design/contract-binding.md) uses these same values. Existing runtime implementations and their BDP0 artifacts remain held at their actual pins.

The retained profile front door is [Core](retained-core.md) plus
[Write](../write/retained-write.md), native `retainedDiscovery`. Earlier
read/read-update/transactional helper shapes remain explicit staging inputs.
The selected Types and common-source counterparts are assembled as described in
the current source map. Implementation/runtime conformance and concrete consumer
qualification remain separate requirements; source publication does not establish
them. The selected [Event source](events.md) has its accepted payload/replay minimum.

## One selected identity

| Surface | Exact candidate value |
| --- | --- |
| Discovery `bdpVersion` | JSON string `"0.1"` |
| Specification/schema identity | `https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json` |
| Canonical schema artifact | [bdp-v0.1.schema.json](bdp-v0.1.schema.json) |
| Distribution copy | [bdp-v0.1.schema.json](../../../packages/protocol/schemas/bdp-v0.1.schema.json) |
| Successful BDP JSON media type | `application/vnd.bdp.v0.1+json` |
| CLI `bdp_spec` | The same complete specification/schema identity URI |

The identity names the selected protocol meaning, including normative prose and its schema, not just structural JSON compatibility. It does not name the executable version, CLI framing version, current git commit, profile, Type definition or a mutable feature list. The URI is an identifier; no dereference or new service endpoint is required. After adoption its meaning is immutable. Draft source bearing this candidate identity is not an adopted release or a promise that unresolved grammar will survive adoption.

`bdpVersion` is an exact identifier, not a number to order, a feature level or a compatibility range. A client MUST select a contract it implements and verify discovery and representation binding before interpreting data or issuing a mutation. An unsupported version or contradictory binding refuses; it MUST NOT be treated as the nearest supported version. Structurally similar JSON does not authorize a fallback. A service MUST NOT advertise changed v0.1 semantics as unchanged version `"0"`.

## JSON and HTTP admission

Once v0.1 is adopted, machine discovery and successful BDP JSON representations use `application/vnd.bdp.v0.1+json`. This includes full Resources, properties, inventories and JSON operation results. A Scope landing response may still be human-readable or bodyless; its registered `service-desc` relation identifies machine discovery with the version-specific JSON type. An ordinary absolute Resource URL remains directly readable with normal HTTP negotiation; a CLI supplies its supported binding automatically.

Clients request the selected JSON type in `Accept`; mutation bodies declare it in `Content-Type`. An old BDP0 endpoint accepting only `application/json` rejects the new body type with 415 before interpreting the payload, claiming a key or making effects. A v0.1 endpoint likewise rejects a generic-JSON mutation body as unsupported media rather than guessing which contract the caller intended. Missing mutation Content-Type is not a version selection. Existing request bounds, authentication, non-disclosure and endpoint admission ordering remain applicable.

`+json` permits JSON decoding; it does not make `application/json` and the version-specific subtype equivalent for negotiation. Media parameters do not select protocol meaning: `application/json; bdp=0.1` is especially unsafe because an old endpoint can ignore that parameter and execute under old semantics. The version is therefore in the subtype. Ordinary HTTP matching, quality weights and exclusions apply. An otherwise valid read accepting no successful offered representation receives the existing bodyless 406; an unsupported mutation body uses415 with the existing Problem diagnosis. A client MUST NOT retry either rejection under generic JSON as a way to force execution.

Problems retain `application/problem+json`; machine schema documents retain `application/schema+json`. HEAD and304 remain bodyless, preserve the selected read context and obey the existing metadata rules; any supplied representation Content-Type must agree with that context. These controls do not change Resource revisions, revision guards or HTTP validators into protocol-version tokens.

Non-JSON transports must explicitly bind the same selected contract before their payload is consumed. In particular, unversioned `text/event-stream` alone is not proof of v0.1 Event compatibility. The selected [Event source](events.md) requires finite v0.1 JSON and confirms representation/coverage in each page. CLI follow polls that source; no SSE binding is silently selected or qualified.

## Optional capabilities preserve the base contract

The candidate discovery definitions admit an optional `capabilities` object. Each key is a capability identity URI; its value maps exact nonempty version strings to feature-owned detail objects. A capability can advertise several versions together, so adding a newer version need not remove an older one. Names and versions compare exactly, with no implicit ordering, range or network lookup. This declaration conveys support, not authorization or automatic selection.

```json
{
  "capabilities": {
    "https://example.test/capabilities/future-feature": {
      "1": {"maximumItems": 20},
      "2": {"maximumItems": 40}
    }
  }
}
```

This is a discovery fragment with a fictional capability, not an assigned BDP feature or complete Scope description. Feature-specific navigation, bounds and other additions belong in that feature/version's detail object, interpreted only by clients implementing the selected version. An older client using the base contract MUST be able to ignore an unknown capability entry or an unsupported version of a known capability while continuing to use supported base behavior. Advertising version 2 does not silently replace version 1 or reinterpret a request selecting it. Unknown entries MUST NOT change base selection, representations, error/guard/retry meaning or required observations, and MUST NOT be treated as granted support for an operation.

Using an optional capability is explicit in its operation/subscription contract. A client requesting unsupported semantics refuses rather than silently omitting them; an authority refuses an unsupported new mutation before effects, including atomic preflight where required. Critical capability/version selection MUST use an admission discriminator that an implementation lacking it rejects; it MUST NOT rely only on an ignorable HTTP field/media parameter or reinterpret literal base data. Advertisement alone is not request selection. A richer service preserves the selected base behavior. If a feature cannot provide that behavior, advertising a flag is insufficient: it needs a separately selected contract or a truthful refusal. This is a bounded discovery extension point, not a template system, general executable extension mechanism or permission to add arbitrary base envelope fields.

The selected [exact Type-definition lookup](type-definition-read.md) uses this
capability map and a rejectable query selector. Its wrapper/ownership and narrow
missing-state permission are operation-specific, not new base or History behavior.

## Context and recovery

Execution identity includes the selected specification URI, explicitly selected capability versions and original semantic operation. Preparing an ordinary mutation freezes that binding with Scope, operands, input values and idempotency key. A retry MUST NOT rebind the frozen request to another contract, capability version, media type, current Type default or fresh key. A change in selected contract is a change in meaning, not an escape from the original key's disposition. An authority supporting another contract cannot erase prior durable no-reexecution obligations for the same logical Scope merely by changing its advertised version.

Continuations, conditional-read context and Event resume context remain bound to the selected contract and relevant representation/authorization/feature choices. They cannot be silently reinterpreted after a contract change. A refusal or unavailable retained result never proves the original mutation did not occur. Supporting a historical contract or recovery representation is a separate service choice; no parallel legacy endpoint/fleet is required here.

## Staging and adoption boundary

The separately named v0.1 schema began with the **original PR287 binding-slice
snapshot**: 159 inherited definitions, four amended definitions (`bdpVersion` and
the capability-map property on three discovery definitions), and two capability
helpers, for 161. Those statistics describe that source slice, not the composed
artifact forever. The subsequent [#279 common affiliation/ownership amendment](affiliations.md)
ports ten carrier amendments and two more helpers into the new slot; the PR289 carrier-port
snapshot contains **163 definitions**. Later paired amendments can extend that
artifact; this source-slice count is not a permanent definition count. See its [paired source record](../../../docs/design/bdp-v0.1-affiliation-port.md).

Unreplaced native payload, profile-token and advanced definitions remain inherited
**staging inputs**, not a decision to retain them. The selected retained Core/Write,
Types and required Event source compose as recorded in the current source map;
implementation and concrete consumer qualification remain separate. Copying
inherited grammar does not revive Experimental facilities or make an unselected
helper an advertised capability.
The old [v0 artifact](bdp-v0.schema.json), its distribution copy and existing parsers remain byte-bound to their old contract. This is artifact isolation, not an additional implementation or compatibility campaign. New source/schema work targets the v0.1 artifact; PR284 is preserved as the accepted carrier input for that port, without silently upgrading v0 validators. Inherited v0 HTTP examples in Core/Write remain explicitly inherited until their corresponding retained sections are retargeted. No old test/report/catalog digest becomes a v0.1 PASS from these source changes.
