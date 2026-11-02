> Historical source snapshot from commit `692d801231c78e12b456d8c5213bdf137a6b534d`. This is not the canonical review specification. See the [current specification](../../../../README.md). Original source and hash are recorded in the archive index.

# Selected v0.1 Resource projection

This amendment defines an optional, independently advertised capability under the
[selected v0.1 binding](contract-binding.md). The same mask applies to current
point GET, exact historical point GET, and each Resource returned by an ordinary
List. It amends [Core reads](core.md) and [ordinary read delivery](read-delivery.md)
only for an explicitly selected projection invocation. The unextended full-read
contract and held v0 schema bytes remain unchanged. This is specification source,
not an advertisement of client or provider implementation.

## Select content, then represent it

A point request first selects its authorized Resource edition. A List request
first selects its authorized current Resource population. Projection then changes
the represented fields, never identity, revision, authorization, membership,
ordering, count, or acquisition. Required filtering/sorting uses full selected
data even if a field is omitted from the response.

The same visible edition, read context, and projection mask yield the same
Resource content in GET and a corresponding List item. This equivalence does not
equate their envelopes, errors, validators, or continuation. A failed point lookup
and a successful empty List remain different outcomes. A revision predicate on a
current List does not acquire historical editions.

For an exact historical GET, project the selected saved edition. Do not substitute
current fields, a nearest revision, or present-day Type content. Full historical
authorization and retention rules are checked before projection. A mask is not
permission to read otherwise unavailable history.

## Mask composition

- No includes or omissions returns the full selected Resource representation.
- Includes union the selected original paths, plus protected context.
- Omissions subtract from that union; omit wins and argument order has no effect.
- Root include (`""`, the empty JSON Pointer) selects the whole Resource. Root
  omission refuses. Supplied mask arrays are nonempty; omit an array member to
  request no mask of that kind. Invalid RFC 6901 escapes refuse.
  Omit an empty projection container rather than serializing `{}`.
- Protect canonical identity, actual Type, selected revision, and whole source/
  target References on Links. A mask cannot misrepresent their meaning.
- Protected context cannot be sliced with nested include paths either. Protection
  is Resource-kind-aware: an absent `/source` on a Bead is an ordinary no-op,
  whereas a Link's `/source` Reference is protected whole.
- `title` is an ordinary optional property, not protected context.
- Properties/metadata admit nested paths. Revision provenance, recorded owned
  Links (`ownedLinks`) are whole-plane only initially. Each may be omitted by a mask; omission must be declared
  as projection, not misrepresented as a full record with no recorded state.
  Nested plane slicing is deferred. References stay whole.
- A valid absent optional include adds nothing, and an absent omission changes
  nothing. An include set matching no optional fields returns protected context
  only. Do not synthesize null or fall back to a full Resource.

Every path is evaluated against the original Resource. Retained array elements
are compacted once in original order; do not fabricate null padding or reevaluate
shifted indexes. Preserve ancestor containers. For `items:["red","blue","green"]`,
including `/properties/items/1` produces `["blue"]`; omitting that path from the
full array produces `["red","green"]`. Including indexes 1 and 2 and then omitting
index 1 produces `["green"]`.

Mask paths refer to the stable logical Resource shape. Schema evolution needs an
explicit compatibility story before this shape is locked. Path syntax,
unsupported/protected omissions, and unsupported capability remain errors.
Ordinary missing optional data is nonfatal.

Missing-path warnings are advisory and deduplicated per path when supported by
useful authorized evidence. They MUST NOT require an extra full scan, infer
absence from empty/incomplete pages, expose hidden fields, or alter selection or
success. Exact diagnostic framing belongs to the common response contract.

## Shared operations and existing views

`resources` results in the [Query draft](query.md) reuse this representation
contract. Count selects the same population before paging and does not depend on
masks. Graph mixed-component masking needs an explicit target convention; this
module does not invent it.

Properties-only, included-Link aggregates, Versions summaries, Events, and Type
inventories retain their own representations. A mask does not request a native
view or acquire related Resources. Versions is the separately accepted subject
History GET view; summary rows do not automatically accept Resource masks.

## Discovery and native invocation

The capability identity is
`https://github.com/gastownhall/bdp/capabilities/resource-projection`, version `"1"`.
Its closed detail contains required booleans `current`, `exact` and `list`; at least
one MUST be true. Each selects support for that operation independently. `exact:true`
also requires actual complete application History. Projection never advertises
History, structured List, Graph or Query on their own behalf.

A supported Resource GET/HEAD or ordinary Bead/Link inventory GET/HEAD accepts
once-only `projectionVersion=1` and optional `fields=ENCODED_JSON_MASK`.
`fields` is a JSON object with nonempty `include` and/or `omit` arrays of RFC 6901
pointers. Apply ordinary form-query decoding once, then JSON decoding; duplicate
JSON keys refuse and a literal plus must be encoded `%2B`. `fields` requires the
version selector. A selected version without fields requests the full native
representation and has no projection header. A supplied empty mask refuses.

Current requests require `current:true`; exact `revision=TOKEN` requests require
`exact:true`; ordinary inventories require `list:true`. Inventory selectors,
`limit` and `cursor` compose under their existing meanings. Structural endpoint
filters retain canonical local Bead ID or absolute URI inputs; normalize local
references before comparison, preserving external URI equality. The parsed-query
schema carries raw filter strings; existing local-ID/URI validation still applies. Exact requests admit
only `revision`, `projectionVersion` and `fields`; no historical inventory is
introduced. Properties view, incident view, included-Link aggregate, Versions,
Events and Type inventories do not admit these parameters in version 1.

Base clients may ignore the capability and continue full reads. A client selecting
it MUST refuse locally if the necessary advertisement is absent. A receiving
service MUST refuse unsupported capability/version or operation support, never
ignore a mask, silently return full content or substitute local rendering.
Malformed, repeated or extra parameters use `invalid-parameter`. A well-formed
unsupported selection uses the feature-local 422 `capability-not-supported`
Problem with `capability` equal to this URI and `capabilityVersion` equal to the
requested version. Ordinary authentication and nondisclosure precedence applies.

## Representation and continuation

Every successful explicitly masked point or inventory response MUST carry the
outer HTTP field `BDP-Projection`, containing the compact ASCII JSON mask actually
applied. Escape non-ASCII characters as JSON Unicode escapes. Include the field on
corresponding successful HEAD and 304 responses. Full responses have no such field.
This is representation metadata, never a Resource property or a claim that omitted
content was absent in storage. Expose it under ordinary CORS rules. Refuse before
output if required request-target or response-header bounds cannot carry it intact;
never truncate the mask. Existing actual-kind and owning-Scope headers still apply.

Projected responses use `projectedBeadRecord` or `projectedLinkRecord`, and inventory
wrappers use `projectedBeadCollection` or `projectedLinkCollection`. These arms are
selected only by an explicitly masked invocation; no-mask responses use ordinary
full/current/historical arms. The projected arms retain identity, actual Type,
revision and whole Link endpoints, while allowing masked properties, metadata,
provenance and owned state to be absent. Stored/full-record requirements are not
loosened. Schema acceptance does not replace semantic protection of mask paths.

Authorization of the complete selected edition precedes masking. Exact saved data
that is unavailable remains unavailable; no current read may fill the gaps.
Validators cover the actual authorized representation, not a manufactured ETag
from a Resource revision. Conditional and HEAD decisions retain their native order
and bodyless meaning. A full representation's validator does not automatically
qualify a projected representation.

An inventory continuation freezes the mask with its selection, ordering, snapshot
and authorization context. Follow the issued `next` unchanged except for the
existing permitted `limit` replacement. Changing its native mask refuses; a
client cannot silently substitute a new selection or snapshot. Count and member
order are determined before projection. A separate client display mask cannot
recover fields the native representation omitted or alter that continuation.

The canonical schema's projection capability, parsed-query, projected-record and
feature-local Problem definitions are mirrored in the distribution schema.
[Artifact cases](../../../fixtures/resource-projection/candidate.json) pair the
native shapes with current/exact/List content obligations. They are authored
static cases, not evidence that a provider executed authorization or masking.

## Required positive/refusal coverage

Pair current GET and same-edition List under no mask, include, omit, both, missing
paths, empty optional projection, whole provenance, and Link Reference protection.
Repeat content projection on an exact saved edition while current content differs.
Check authorization before masking, protected omission refusal, unsupported
capability, native view separation, representation validators, and unchanged
count/selection/ordering. Those are authored obligations until a provider suite
actually executes them.
