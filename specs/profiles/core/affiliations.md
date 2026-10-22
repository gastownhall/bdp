---
status: draft
intended-status: normative
version: "0.1"
---

# Common Type affiliations and recorded ownership

This is the selected #279 amendment for the [v0.1 contract binding](contract-binding.md),
paired with the [canonical CLI](../../../docs/cli-design/affiliations-and-owned-state.md).
It changes instance affiliations and new owned-state captures in Core/Write. The
[separate candidate schema](bdp-v0.1.schema.json) carries the common shape;
the held v0 schema/runtime are not upgraded. Types-profile interpretation composes
with [Trish's exact PR283 source](https://github.com/gastownhall/bdp/blob/a2aa88d9b5a0e0d78f48de2967d4ceaa38177876/specs/profiles/types/types.md).
Profile factoring and required Event representation remain adoption gates.

## One affiliation, independent identity

Every Bead and Link has one required `type` Reference: either an absolute HTTP(S)
Type identity URI, or an object containing exactly `uri` (that URI) and `revision`
(a nonempty opaque definition revision token). Relative paths, creation bindings,
URNs and a separate `typeRevision` member are not admitted Type carriers. Type
identity is the URI; an exact affiliation also records the definition revision.
Two affiliations with the same URI but different definition pins are different
versioned state, even though their nominal Type identity is equal.

```json
{"type":"https://work.example/acme/Task"}
```

```json
{"type":{"uri":"https://work.example/acme/Task","revision":"definition-r4"}}
```

Core-only providers MUST carry admitted references without requiring the Types
profile's definition language, registration or default-resolution semantics.
An affiliation is a distinguished Resource field, not an incident Link, access
grant or instruction to fetch/register a definition. Ordinary `properties.type`
remains authored JSON data. Type definition IDs, Type-ID arrays and ownership
map keys remain URI strings; they are not affiliations.

## Create, update and exact default resolution

Creation requires `type`. An ordinary Bead or Link update MAY supply `type`,
`propertiesChange`, `metadataChange`, or any combination, with at least one
present. An explicit `type` replaces the whole affiliation; it is not a partial
object merge. Omitting `type` MUST preserve the complete preceding affiliation,
including its definition pin, regardless of newly installed definitions/defaults.
Identity, Resource kind and Link endpoints/pins do not change in an update.
Properties and metadata remain unless explicitly edited, subject to applicable
service-completion and property-access rules; retyping is not implicit conversion.

Under Types, explicit unpinned input resolves once, before commit, to the Scope's
explicitly selected, registered eligible exact default. No eligible selected
default means refusal: never guess the sole/newest definition, fetch a remote
body or register one as a side effect. Stored and returned affiliations are exact.
Definition presence, registration, default selection and eligibility remain
separate. Omission continues existing use; an explicit replacement is checked
under the applicable Types lifecycle rules, including their treatment of an
unchanged exact affiliation. This amendment adds no blanket retirement rule.

```json
{
  "bead":"task-42",
  "type":{"uri":"https://work.example/acme/Task","revision":"definition-r4"},
  "expectedRevision":"resource-r7"
}
```

`expectedRevision` is an ordinary optional mutation guard on the Resource revision,
not a Type pin. Retyping adds no mandatory guard. Authorization, liveness, guards,
property-access admission and complete applicable validation still apply. Under
Types, destination properties and affected incident Links must satisfy the final
atomic graph. A batch may repair temporary endpoint-pair/arity invalidity when
its final graph is valid; syntax, authorization, guards, protected-property
admission and exact Reference resolution are not generally deferred. Existing
init-only values are preserved and validated under the destination policy;
explicit service-managed edits and protected-child bypasses refuse. No automatic
property deletion, endpoint repin or hidden repair makes an invalid retype valid.
Failure rolls back the whole atomic operation, including induced owner effects.

## Revisions, no-ops, history and retry identity

These rules apply at the primary Write [mutation revisions and guards](../write/write.md#mutation-revisions-and-guards) seam, not only in this amendment.

Revision-covered state includes the complete affiliation, properties, metadata
and, for an owner, its captured owned-Link state. A nominal Type or definition-pin
change is an effect even without object edits. The same resolved affiliation with
unchanged remaining state is a genuine no-op after all checks; no new Resource
revision, provenance or Event is created. Empty ordinary patch arrays contribute
zero patch operations, not proof that the whole update is a no-op. Guard/provenance
alone is not an update and no dummy patch is needed for a Type-only input.
Operation-local A→B→A transitions in a batch cannot be erased because final state
matches initial state. This does not choose exact induced-owner revision counts
for multi-operation batches or reopen their allocation mechanics.

Retained Resource versions, tombstones and recorded facts MUST keep the affiliation
and owned state of the revision they describe. They MUST NOT be resolved against
today's default, rebound to a newer definition or rebucketed using today's rules.
Current instance reads return the affiliation Reference, not an inlined definition.
Narrow exact-definition readability under Types does not imply general application
History; that transport seam remains in Types integration.

Retry identity preserves authored `type` presence and form: omitted, unpinned URI,
or exact `{uri,revision}`. These are distinct intents even if their first execution
would reach the same affiliation. Existing normalization of the URI/token still
applies; it MUST NOT erase this distinction. On first execution, a Types provider
retains the resolved exact affiliation as part of the resolution witness. Retained
replay uses that witness/outcome, never a fresh default resolution. Keys and
continuation/recovery context also retain their selected contract and capability
versions under the shared binding. Reusing a key with different Type intent follows
the existing mismatch rules, rather than being treated as equivalent by postimage.

## New owned-state captures

Select the effective owned set under the owning Bead's accepted exact Type authority
and the applicable recorded Link conformance. Inherited selectors contribute a
union; deduplicate Links across selectors/paths. Group the selected full Link
records by each Link's **actual nominal Type URI**: the string itself for unpinned
Core carrying, `.uri` for exact affiliations. Preserve every Link's complete exact
affiliation and independent Resource revision. Different definition pins of one
nominal Link Type share a bucket. A specialization appears once in its own nominal
bucket, never again under an ancestor or every matching selector.

Every newly captured bucket MUST be nonempty, with each Link exactly once in
ascending code-unit order of canonical `id`. No wildcard or empty selector bucket
is emitted. An owning Bead with no selected Links carries `ownedLinks:{}`; a
non-owner omits the member. This replaces the inherited empty-explicit-bucket rule
for new captures. Retained old snapshots keep their recorded shape, including
old empty buckets; returning an unchanged retained revision does not rewrite it.

Retyping a Link can add it to or remove it from its source's owned set. Compare
membership before and after the operation: leaving ownership is an effect too.
The Link and affected source revision effects commit atomically. A definition-pin
change can change conformance/membership even when nominal identity is unchanged;
if the Link remains owned, its changed full record is still changed captured state.
Retyping a source Bead recomputes its owned set from existing outgoing Links under
the destination rules, with no invented Link revisions for unedited Links. An
ordinary incoming citation does not version its target. Independent Source/Link
revision tokens are not made equal by ownership.

An otherwise admissible Link whose source is literally pinned to S@r1 keeps that
pin while a resulting S@r2 capture can contain L@l1. S@r1 does not retroactively gain
L. The citation is not a guard or a claim of earlier membership. There is no automatic
repin, shared token or foreign fetch. Specific Types traversal/admission/creation-token
mechanics and new per-Type pin policies are outside this bounded clarification.

The common JSON schema validates the carrier, not grouping key/record equality,
deduplication, default resolution or state transitions. In particular it MUST NOT
be read as proving these semantics merely because a record validates. Shared
record definitions intentionally do not globally forbid empty historical buckets;
new-capture semantics require contextual validation.

## Selection

The structural `type` filter compares actual nominal Type URI, extracting `.uri`
from an exact affiliation; it ignores definition pin. `conformsTo` uses the
applicable accepted exact recorded closure under Types, not a live/latest publisher
graph. Unavailable family semantics refuse rather than degrading to exact matching.
Filter operands are unpinned identities. Exact nominal selection does not select
an exact definition revision. Ordinary structural predicates need no object-shape
branch in the caller.

A bounded raw JSONPath `selector` sees the actual wire record, including the
Reference union. Its strings are not rewritten and `type` is not a virtual string
projection. A comparison of `@.type` to a URI string does not match an object
Reference; `@.type.uri` addresses its URI when present. Use the structural predicate
for nominal matching across both shapes, or an explicit supported raw expression.
This is a deliberate v0.1 shape change, not string-only compatibility under v0.

## Required Events: explicit remaining gap

A Type-only effect requires an observable committed update; it MUST NOT be omitted
or represented by a fake property patch. Event `type` remains the fact discriminator;
`subjectType` carries the subject's recorded affiliation. The new schema widens that
carrier but inherited `updatedData`/`ownedLinkDelta` still require another delta
member and cannot yet express an affiliation-only effect. Existing delta application
also assumes stable nominal buckets. These are adoption gaps, not passing behavior.
Donna's D1/D2 representation/coverage choices and the coordinated Event payload/
ownership transition amendment remain pending. No example here chooses required
postimages versus deltas or general read-only observation guarantees.
