# Same-ID endpoint pin update amendment

This review packet accompanies the focused Core/Write draft changes. It adds
explicit pin edits to the existing UpdateLink operation while retaining fixed
Link identity, Type and endpoint URI identities. A floating Reference explicitly
unpins; omission preserves; complete endpoint equality determines no-op after
ordinary admission and current-resource guards. No new operation, public
source-revision guard or protocol `current` keyword is introduced.

## Proposed carrier and Event crosswalk

| Surface | Proposed representation | Evidence boundary |
| --- | --- | --- |
| UpdateLink input | Optional `source` and `target`, each the existing complete input Reference form | Closed-schema and SDK carrier/Scope/sequence checks; URI equality with the held current Link is member semantics. |
| Link `updated` Event | Optional `source` and `target`, each the complete resulting Reference for a changed endpoint | Closed schema accepts endpoint-only effect, preserves nonempty property/metadata deltas and excludes direct effects beside `ownedLink`. |
| Owning Bead `updated` Event | Same complete endpoint delta inside `ownedLink.link` | Owner's revision remains separate; no direct endpoint field on a Bead. Preimage identity/kind checks require semantic validation beyond the structural schema. |
| Consumer apply | Replace supplied complete endpoint Reference after verifying unchanged URI; leave omitted endpoints intact | Described in Write; no Event replay implementation qualification is claimed. |
| Feeds | Normal Link `updated` fact in eligible incident Bead feeds; no linked/unlinked fact from pin-only changes | No new public Beads feed or HTTP Write capability is inferred. |
| Erasure | Match the complete source/target Reference pair, including pin presence/tokens | A surviving revision with another pin pair does not retain the older pair's erased content. Existing lineage/cursor/ordinal rules remain unchanged. |

Core continues treating stored pins as opaque provenance. This amendment does
not add automatic historical resolution, Type revision selection or a special
meaning for the literal protocol token `current`. The Beads CLI resolves its own
`current` selector in its existing writer transaction; that adapter spelling is
not a new wire token.

## Implementation qualification

Beads storage/read [PR133](https://github.com/donnabox/beads/pull/133) and [CLI PR136](https://github.com/donnabox/beads/pull/136) exercise local unowned source/target pins, owned target pins, same-ID
re-pin, explicit unpin, guards and retained snapshots. Exact commits and actual
runtime qualification are recorded on those PRs; this document does not relabel
their evidence or claim full BDP conformance. Donna explicitly kept **owned-source
pins deferred for the first product slice**; no pre-write or post-write owner
observation point was selected. The product refuses that mode atomically.
External endpoint admission and export historical closure remain separately
qualified consumer work.

The generic TypeScript reference evaluator has **NYI endpoint pin edits**.
Without an explicit guard, the newly parsed endpoint members would be silently
ignored by its existing properties/metadata writer. This amendment therefore
adds a deliberate `validation-failed` refusal before revision allocation or
writes, plus no-partial-effect tests. That is a partial-implementation boundary,
not a claim that the proposed valid operation has been implemented there. Its
existing property/metadata updates are unchanged. Full endpoint mutation,
matching Event construction/application and erasure execution need separate
reference-runtime qualification before advertising this amended contract as
implemented.

## Adjacent amendment preservation

This branch starts from the published Preview 3 integration successor including
Memory PR143 and normally incorporates merged PR172. Ordinary empty update-array
admission from PR172 is preserved, including sequence/batch no-op behavior.
Endpoint-only updates and endpoint intent beside empty arrays are admitted by
the combined carrier; emitted-delta guards and nested presence alternatives
remain intact. Historical-base update/recovery appendices in PR174 remain their
own contract; this amendment adds no Link historical-base update, recovery,
source-pin observation point or provenance rename.

## Private schema policy review

The packaged schema changes only `updateLinkMembers`, `ownedLinkDelta` and
`updatedData`. Independent source review checked the complete transitive Type
descriptor schema closure and all other private schema-graph source pins: their
interpretation bytes are unchanged. The installed schema indexer does not
interpret these Write/Event envelopes. The private `schema-resource-index-2`
policy is therefore retained, with an explicit rationale and refreshed packaged
schema provenance hash. This is not a product release pin, a claim of unchanged
public wire semantics, or a conformance reseal. Existing catalog quotations are
updated only where these draft clauses changed; catalog identities, evidence
paths, observed results and sealed evidence remain untouched.
