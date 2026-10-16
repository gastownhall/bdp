# Bead and Link Types: implementation notes

Companion to [Proposal: Bead and Link Types](type-cli-proposal.md), October 15,
2026. These notes are not part of the proposed issue body. They preserve the
implementation exercise, inspected code seams and acceptance cases for a possible
follow-up comment after the proposal is posted. No implementation has begun.

## First implementation candidate: open definitions and their graph

Use an isolated experimental branch and fresh workspace to implement the smallest
end-to-end Type representation. This is proposed work, not a claim that implementation
has started or that an existing workspace can already be upgraded in place.

1. Establish trusted Type/BeadType/LinkType/ConformsTo seeds with exact pins through
   an explicit atomic bootstrap mechanism.
2. Create local Bead/Link definitions with open instance properties and no optional
   application-specific graph constraints. Creation makes them available for use.
3. Create/read/edit owned ConformsTo Links, enforcing exact available targets,
   category agreement and exact-revision cycle checks. Preserve historical owner
   snapshots; traverse those snapshots rather than mutable current adjacency.
4. Exercise generic show/versions/graph plus a small specialized create/list/validate
   path. Demonstrate ownership revision effects and optimistic concurrency.
5. Include a tiny Bead and Link using authored Types to prove exact affiliations
   and conformance matching. Otherwise label the result a definition-graph prototype,
   not completion of the usable-Type slice. This is a recommendation for coverage,
   not a requirement for full Issue/Dependency conversion in the first increment.

The foundation definitions still need structural integrity schemas; “open schema”
refers to application-instance properties. Unsupported rich schemas/constraints
must fail explicitly in the experiment rather than silently being ignored.
No full Types-profile qualification is claimed by a partial experimental surface.

### Implementation notes from Preview 2

Source inspected at
[`703bb13e91aa2cab2092443319139006d74242c8`](https://github.com/donnabox/beads/tree/703bb13e91aa2cab2092443319139006d74242c8).
BDP main checked at `67a2842e3f1918e70978f745587cf11eaf0df5a8`; this design does not
modify its current wire contract or assert draft-profile adoption.

| Current code | Consequence for the exercise |
| --- | --- |
| [Type reader](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/internal/storage/graphstore/types_read.go) reads installed descriptors through known types/ paths | Custom Type Beads need generic identity/discovery and revision reads, not just a command wrapper |
| [Catalog checks](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/internal/storage/graphstore/informational_types.go) require a fixed count and exact descriptor fingerprints | Dynamic definitions require a deliberately new storage/installation boundary; do not relax release integrity checks blindly |
| [Graph values](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/graphops/types.go) carry typeURL strings; TypeDescriptor carries conformsTo ID arrays and a schema URL | Exact affiliation pins and owned declaration records affect model, serialization, storage/history and validation |
| [Type CLI](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/cmd/bd/graph_preview_types.go) separates human selectors from descriptor output | Preserve recognizable listing behavior while removing assumptions that labels imply installed Type identities |

Before execution, settle three bounded contracts: seed identities/revision allocation;
compatibility boundary for old types/ descriptors versus new definition-Bead IDs;
and exact historical declaration traversal/closure indexing. A disposable workspace
can defer an in-place storage migration but cannot erase the distinction in its design.
The current graph model mints opaque revisions; transaction-local preallocation is
worth evaluating for bootstrap, not yet an adopted protocol mechanism.

### Acceptance cases for the exercise

| Case | Expected result |
| --- | --- |
| Create a Bead Type with omitted schema convenience input | Store the explicit chosen open object schema; valid definition usable immediately |
| Create a Link Type and its initial conformance declaration | Atomic definition/owned Link state; proper category and exact target pin |
| Cross-kind conformance or exact-revision cycle | Refuse atomically |
| Revise a declaration | Source Type gets a new revision; old definition snapshot retains old declaration |
| Change an ancestor's current definition | Existing child revision retains its exact ancestor contract |
| Use the Type on a tiny instance, then revise the definition | Instance keeps its original Type pin |
| Explicitly retype with stale revision precondition | Refuse without partial effects |
| Match Product@r1 versus Product | Exact affiliation/conformance versus any revision by identity/conformance, never latest lookup |
| Inspect definition graph | Generic graph operations show explicit hierarchy without synthesized affiliation edges |
| Supply unsupported rich constraints in the limited experiment | Report unsupported behavior; do not claim successful validation |

