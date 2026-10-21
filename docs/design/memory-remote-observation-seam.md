# Memory remote target: expected role and observed state

**Status: open shared integration case.** This non-normative note retains the
bounded example requested in [Melinda's handoff](https://github.com/donnabox/agent-coordination/issues/1#issuecomment-6208340861)
and its [durable scope and dependencies](https://github.com/gastownhall/bdp/issues/59#issuecomment-6208337811).
It selects no field, envelope, observation vocabulary or revision policy.

The inspected BDP main snapshot is
[`37d6622f95e71cac022478cfbcb3e8f2d6bdf444`](https://github.com/gastownhall/bdp/tree/37d6622f95e71cac022478cfbcb3e8f2d6bdf444).
No accepted shared representation for the complete expected-versus-observed
contract was found in the sources below. The existing Reference and Link Type
contracts supply parts of it, but do not settle its read representation.

## Retained example

A local **Observation Memory Supports an exact remote Decision Memory revision**.
Observation and Decision are distinct Bead Types conforming to Memory under the
Donna ruling recorded in the durable scope comment; Supports is a distinct Link
Type. There is no Memory kind discriminator. Decision identifies the example's
intended target; it does not make Supports a Decision-only relationship. Supports
expresses the expected Memory role, rather than proving the remote target has it.

Conceptually, with illustrative names rather than wire syntax:

```text
Scope A stores:
  Observation O --Supports--> {uri: Scope B / Decision D, revision: d1}

Stored assertion: support for the content at D@d1; expected target role Memory.
Remote observation: Type/conformance, lifecycle and availability, if established.
```

The endpoint pin selects D@d1. It must not silently select D's current revision
when d1 cannot be read. Its presence proves neither remote existence nor
immutability. The local Link remains a recorded assertion even when its target
cannot be observed.

## Existing source boundaries

| Source | What it supplies | What it leaves open here |
| --- | --- | --- |
| [Types §5.1](../../specs/profiles/types/types.md#51-endpoint-eligibility-is-a-union-of-pairs) | Cross/either Bead-address arms require wildcard Types; an opaque resource arm has no Type requirement. The storing Scope does not fetch to establish remote Type, existence, content or immutability. | How reads expose a domain's expected role separately from observations. The wildcard cannot be replaced with a remote Memory/Decision Type constraint. |
| [Types §5.4](../../specs/profiles/types/types.md#54-scope-boundaries-identities-and-pins) | A pin selects the referenced revision; external resources remain opaque under §5.1. | Local availability and floating-endpoint revalidation rules are still explicit shared work. |
| [Core References](../../specs/profiles/core/core.md#references) | A Reference carries a URI and optional opaque revision. It carries no endpoint Type; external pins are not validated or dereferenced by the storing authority. | Neither an expected-role field nor an observed-role field is defined on a Reference. |
| [Core Resource records](../../specs/profiles/core/core.md#resource-records) | A Link has its own Type and ordinary source/target References. | No common expected-versus-observed target projection is selected. A properties schema cannot extend the common envelope. |
| [Issue §3.3](../../specs/types/issue/issue.md#33-attribution-lifecycle-and-operational-fields) and [§4.3](../../specs/types/issue/issue.md#43-endpoint-admission-and-pins) | Observation placement/revision policy is explicitly open; remote dependencies also need a shared mapping for Type expectations and availability. | A Memory-specific observation envelope would not resolve this shared boundary. |
| [Memory proposal R9, R19 and R20](https://github.com/gastownhall/beads/issues/5877) | Structured Links expose expected target kind separately from observed kind; unresolved remote targets are unavailable, never inferred gone. Resolved targets expose their kind-specific lifecycle separately from stored Links. | Shared graph vocabulary and representation belong to the shared contract. Product “kind” terminology does not select a Memory discriminator. |

These citations are inspected at the snapshot above; the Memory product proposal
was read with `updated_at: 2026-10-16T19:14:03Z`. The earlier
[Memory draft §4](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/specs/types/memory.md#4-informational-link-types)
also separated remote expectation from observed availability/Type. Its older
Memory-plus-kind catalog is historical and superseded by the ruling in the
handoff; it supplies no accepted shared observation representation.

## Acceptance conditions for the future shared contract

These are review scenarios retained from the requirements, not executable
conformance cases or a selected response shape.

| Situation | Required distinction |
| --- | --- |
| O creates Supports to remote D@d1 without a remote lookup | Preserve the exact Reference and expected Memory role. Do not claim verified remote Type membership. |
| An authorized observation establishes D@d1's Type/conformance and lifecycle | Keep those observed facts distinguishable from the Link's expectation and from current D. Do not expand target bodies in a Link summary. |
| Observation establishes an incompatible target Type | Preserve the expectation/observation discrepancy; do not report successful Memory validation or silently change the assertion. |
| Scope B is unreachable or the exact target cannot be resolved | Report unavailable rather than inferring gone, deletion, erasure or Type mismatch. |
| Authorization withholds target information | Preserve the applicable non-disclosure rules; denial is not positive evidence of removal or Type mismatch. |
| Authorized exact History returns a substantiated removal diagnosis | Preserve that diagnosis under [Core's evidence and authorization rules](../../specs/profiles/core/core.md#historical-diagnoses-and-missing-state); failure alone is not positive removal evidence. |
| D advances to d2, changes Type, or loses current visibility | Do not substitute d2 for d1 or rewrite the stored Link. Any new observation must remain separate from the recorded exact assertion. |
| Two reads observe different remote availability | Settle observation placement, freshness, authority and revision/cache behavior explicitly; do not infer that a read mutates O, its owned history or the Link revision. |

The shared design still needs to specify how consumers obtain the expected role
from the exact Link Type's semantics, how generic readers handle an unavailable
or unfamiliar Type definition, and where observations and their evidence belong.
This note supplies no extra Memory or Link member to bridge that gap.

Citation-pin admission, floating revalidation, R20 graph cleanup, stable-Link-ID
re-pinning, old/new ownership effects and Provenance V2 source admission remain
separate shared dependencies. Passing properties-schema checks does not establish
any of them or implement these observation outcomes. This handoff requests no
PR142 amendment, runtime/CLI work, protocol adoption or release qualification.
