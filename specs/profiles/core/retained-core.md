---
status: draft
intended-status: normative
version: "0.1"
---

# Retained Core candidate

This is the positive Core entry for the selected [v0.1 binding](contract-binding.md),
paired with the [canonical CLI](../../../docs/cli-design/bdp-cli.md). It replaces the
inherited cumulative Read/Read+Update/Transactional **selection model** for this
candidate, not the old v0 contract. The required [Event source](events.md) uses
Donna's accepted postimage/replay minimum. The [publication amendment](publication.md)
defines final batch/owner states. Actual Types/profile integration and normal
qualification remain adoption gates.

## Closed responsibility boundary

Core carries Resource identity/kind, URI-or-exact Type affiliation, properties,
metadata, optional recorded provenance, References and opaque revisions. It defines
Scope/navigation, ordinary point/collection reads, authorization, bounded selection,
pagination, HTTP/JSON/errors and required Event observation. It neither requires
writes nor interprets Type definitions merely because a Resource carries `type`.

The selected common source is imported by clause family, with the paired modules
below taking precedence over inherited v0 examples/profile vocabulary:

| Retained family | Source |
| --- | --- |
| Scope/Resource non-reuse, URI normalization, aliases and References | [Scopes and identity](core.md#scopes-and-identity), [Beads and Links](core.md#beads-and-links) |
| Value equality, opaque revisions, attribution and ordinary native constraints | [Revisions](core.md#revisions), [Carried attribution](core.md#carried-attribution) and the shared JSON/numeric rules |
| Complete Type carrier and recorded owned state | [Affiliations](affiliations.md); Types interpretation remains conditional, not Core's descriptor-installation rule |
| Read authorization and selection | [Authorization views](core.md#authorization-views), [Selection](core.md#selection) |
| Full/properties/optional aggregate/incident/collection reads and kind metadata | [Resource records](core.md#resource-records) through collection retrieval, amended by [ordinary read delivery](read-delivery.md) |
| Alias resolution, unknown/deleted Resource disclosure and HTTP failures | [Alias resolution](core.md#alias-resolution), [Reads after deletion](core.md#reads-after-deletion), [Problem details](core.md#problem-details) and HTTP/CORS/conditional/HEAD rules |
| Optional complete application History | [Historical resolution](core.md#historical-resolution), only when historicalResolution is advertised; no weakening into a partial capability |
| Optional exact definition operation | [Type-definition read](type-definition-read.md), only in its explicitly selected interpreting context; not general History or a complete Types advertisement |
| Required observation | [Events](events.md), required postimages and truthful bounded replay; optional delta uses the six mutation names |
| Atomic publication when Write/batch is selected | [Final publication](publication.md), at most one final new version per Resource; no mandatory batch/replication on Core |

Inherited embedded Type descriptors, mandatory `types` inventory, sequence,
Transactional discovery, public epochs/positions/views, receipts, replica snapshots,
changes and strict checkpoint reads are not imported by this entry. A clause's
legacy mention of those facilities cannot create a retained requirement. Shared
native invariants, non-disclosure, erasure of controlled content and immutable
retained-address meaning are not waived by this extraction. Delete is not erase.
Ordinary pagination is not replica bootstrap or a general retention promise.

## Discovery usable by Core clients at either profile

The selected native entry is `retainedDiscovery`, whose arms are `coreDiscovery`
and `writeDiscovery`. Every Core client MUST understand both discovery shapes,
including `profile:"write"`, even if it implements no mutation commands. A service
adding Write therefore keeps its Core reads usable by that client. There is no
implicit ordering or nearest-profile fallback. The only base profile literals are
`core` and `write`; later independent features use the existing versioned capability
map instead of inventing a higher cumulative literal under this contract.

Core discovery requires `bdpVersion:"0.1"`, `profile:"core"`, canonical `scope`,
absolute Bead/Link inventory URLs and absolute `events` navigation. Optional fields
are aliases navigation, order, Core limits, maximumEndpointMultiplicity under its
existing policy, historicalResolution and capabilities. No `types` inventory is
required or guessed. `events` is required navigation for a required obligation,
not independent proof of Event conformance. The selected source uses finite v0.1
JSON replay; optional SSE is not selected by this navigation member.

Write uses the same Core shapes/meaning and adds required operations/aliases
navigation; see [retained Write](../write/retained-write.md). Unknown capability
entries/versions can be ignored for base use. Unknown required meaning MUST be
refused, never ignored. Known capability detail is feature-owned. Atomic-batch
version 1 requires Write
and cannot be advertised on the Core-service arm. Unknown capability versions
remain opaque base metadata until their owning semantics are selected.
A future Types capability must qualify earlier URI-only/uninterpreted records
explicitly; a flag cannot retrofit pins or rewrite retained addresses.
Advertising the narrow definition operation alone does not advertise all Types semantics. The final
Types advertisement/inventory remains coordinated with the Types owner and cannot
add required root members that break already published base clients.

Core limits contain only page, request, resource, selector and pagination lifetime.
They expose no replica retention/checkpoint obligation. Omitted bounds have their
existing meaning, not infinite capacity. Optional application History keeps its own
complete native contract and fixed-limit continuation rules. A History versions
response supplies BDP-Resource-Kind when that metadata is known and disclosable,
including HEAD/304. Unknown/nondisclosable kind may be omitted rather than invented;
this creates no extra permanent kind marker or stronger retention guarantee.
Full Resource/properties reads keep their actual-kind requirement. Summary rows
never acquire BDP-Collection-Kind.

## Required observations and compatibility gates

Core MUST provide [required Events](events.md); Write additionally owes durable
facts for its committed effects. Postimage is the required common representation;
delta is optional. Sources declare observation coverage, bounded replay and gaps
without fabricating external original history. Native retainedEventPage is the
selected entry. Event navigation in shape-valid discovery is not conformance.

Adding a feature MUST preserve selected base Resource/read/result meanings, issued
revision addresses, authorization and cursor context. Added validation may refuse
new inadmissible state; it cannot reinterpret old committed values, keys or retained
addresses. A richer service preserves the selected Event representation or refuses
an unsupported subscription before delivery under the selected Event source.
Core does not promise global latest state, cross-replica
read-your-writes, stable portable identity across canonical-URL changes, automatic
acquisition or implicit capability downgrade. A hot-tier miss alone proves neither
absence nor erasure; temporary backend unavailability stays a service failure.

The old readDiscovery/readUpdateDiscovery/transactionalDiscovery definitions remain
staging/evidence inputs in the bundle. They are not this candidate's entry and do
not authorize serving v0.1 with those old profile literals. No old runtime/schema
slot, installed client or past acceptance report is silently upgraded.
