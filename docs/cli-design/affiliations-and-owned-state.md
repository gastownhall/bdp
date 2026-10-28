# Canonical CLI: Type affiliations and owned state

Selected CLI-first #279 subset, paired with [common Core/Write rules](../../specs/profiles/core/affiliations.md)
and the [v0.1 binding](contract-binding.md). This is design source, not implemented
CLI support. It composes with [Scope/default resolution](scope-and-references.md).
Types lifecycle/definition-authoring commands remain deferred; the inventory is
`bdp type list`. No domain convenience commands are introduced.

## Author a Type, preserve an omission

Root CRUD edits Beads; `bdp link <verb>` edits Links. On create/update, `--type TYPE`
sets the affiliation. Relative names resolve against the established command Scope
(the configured default for an ordinary relative command); the emitted Type URI
is absolute. A Type URL does not choose the destination Scope. Creation requires
Type, while update can omit it to preserve the complete existing affiliation.

| CLI | Ordinary operation fields before execution |
| --- | --- |
| `bdp update item --set-property title=new` | `bead:"item"`, properties patch, no `type` |
| `bdp update item --type Task` | `bead:"item"`, `type:"https://work.example/acme/Task"` |
| `bdp update item --type Task@=r2` | `bead:"item"`, `type:{uri:"https://work.example/acme/Task",revision:"r2"}` |
| `bdp link update rel --type Blocks@=r2 --if-revision =link-r7` | `link:"rel"`, exact `type`, `expectedRevision:"link-r7"` |

Examples assume command Scope `https://work.example/acme/`. The singleton operation
URL supplies its discriminator; a batch member includes `operation:"updateBead"`
or `"updateLink"` using the same fields. `--dry-run-mode batch` compiles
without execution: no fetch, registration, default selection or claimed validation
success. No hand-authored whole-request JSON escape is needed for these inputs.
Actual key allocation, framing and emission/batch details belong to the complete
canonical CLI design and do not follow from this bounded source subset alone.

[Shared Reference parsing](scope-and-references.md#revision-selectors) uses
`TYPE@=TOKEN` for an exact Type pin; `TYPE@N` is usable only with an actual selected
store's Type-version ordinal mapping. It is not a definition inventory lookup or
permission to guess Type history. Absolute HTTP URLs remain literal, including
raw @; use a quoted bracketed selector such as
`--type '[https://work.example/acme/Task]@=r2'` for an exact pin.
Bare Type/endpoint input is unpinned; `@current` refuses as a durable pin.
Historical read selection and `--if-revision` guards are distinct from the Type
definition pin. Guards use `N` or `=TOKEN`; no standalone canonical `--revision`,
`--type-revision` or `json:` Reference escape is added. Offline emission refuses
unresolved local ordinals; it neither queries history nor invents a future/staged
revision.

Under Types, the service resolves explicit unpinned input once to its eligible
registered exact default. The CLI never resolves it during compilation. An omitted
Type stays at its old exact affiliation even after defaults change. Explicit input
replaces the whole Reference. The same resolved affiliation alone is a genuine
no-op; a different definition pin is an effect without a fake properties patch.
`--patch-properties '[]'` contributes no patch operations but does not cancel a
Type change. Guards/provenance alone do not form an update. Authorization,
optional guards, property-access policy, final validation and retry rules remain.

> **Cleo — Type and revision flags:** `--type` sets an affiliation on writes.
> Historical reads and exact Type pins use shared Reference selectors;
> `--if-revision` guards use `N` or `=TOKEN`. The wire has no separate
> `typeRevision`. This sidebar records the shared design;
> it is not a request to interrupt your work.

> **Cleo — Edits and rendering:** Keep singular `--set-property`/`--unset-property`
> and the unified replacement/patch/edit modes. Reuse your output formats and
> pagination; preserve native exact Reference objects in JSON output. This slice
> adds no alternate renderer, Type lifecycle verbs or property conversion.

## Select by nominal Type or family

`bdp list --exact-type Task` lowers to structural `type=<absolute URI>`: nominal
Type exactly, regardless of definition pin. `bdp list --type Task` lowers to
`conformsTo=<absolute URI>`: that Type and refinements under recorded exact
Types authority. The same flags apply under `bdp link list`. They may combine
with AND: exact nominal affiliation and recorded family membership are independent
predicates. This refines C1's earlier mutual exclusion to preserve wire coverage; see
[read selection](reads-and-paging.md). Filter operands accept identity only, so pin
suffixes/objects refuse. Bare
`--type any` means no restriction in the full CLI design; `--exact-type any`
refuses. Family support unavailable means refusal, never exact-only fallback.

`--selector` remains the selected protocol's bounded raw JSONPath and sees its
actual Reference shape; no string rewriting or virtual `.type` projection. For
nominal matching prefer `--exact-type`; `@.type == "URI"` does not match an exact
object while `@.type.uri` addresses that object's identity. The selected contract
binds this shape change rather than silently reinterpreting old client predicates.

> **Cleo — Filter vocabulary:** Human `--type` includes refinements;
> `--exact-type` means nominal identity, not exact definition pin. Keep the
> protocol's `conformsTo` spelling out of the ordinary flag vocabulary.

## Owned state needs no new command

Ordinary point reads and mutation postimages preserve recorded `ownedLinks`.
New captures union/deduplicate ownership matches, group by each Link's actual
nominal Type URI and keep its exact affiliation inside its full record. Two pins
share one nominal bucket; a refinement has its own bucket. A new empty owned set
is `{}` without empty selector/wildcard buckets. Earlier snapshots keep their
recorded shape. See the [candidate postimages](../../fixtures/affiliations/candidate.json).

Selected v0.1 Link mutation results preserve optional
`ownerRevisions:[{id,revision}]`: exactly the distinct initially or finally owning
source Beads, at most two, in ascending code-unit order of canonical URI.
Each reports its actual final
published revision. Omit the member when there are no owners; an empty array is
not admitted. Bead and allocation-only results omit the member. Ownership exit
reports the former owner's final revision, and an
owned no-op reports its unchanged revision. The inherited result-level
`source`/`sourceRevision` pair is not an alternative v0.1 spelling. The CLI never
infers owners from the final Type alone. See
[complete owner results](../../specs/profiles/write/link-updates.md#complete-owner-revision-context).

`link update --from REF` and `--to REF` replace whole endpoints while preserving
Link identity. Omission preserves the complete prior Reference and pin; an
explicit unpinned Reference removes its preceding pin. At least one Type,
endpoint or object input is required, without a new mandatory owner guard.
Retyping or correcting endpoints updates every affected initial/final source's
capture atomically. Retyping the source recomputes membership without inventing
Link edits. An owner revision never silently repins a Link. One atomic batch can
express coordinated repairs under the ordinary final-graph rules.

The paired [Event source](events.md) now covers Type-only facts with required
postimages and optional deltas under the [accepted D1/D2 minimum](event-decisions-20261022.md).
Selected [final batch publication](../../specs/profiles/core/publication.md) uses one
final Resource/owner outcome and at most one new revision. Batch `ownerRevisions`
entries report final published owner context, with membership compared
initially/finally. Omitted pins remain unchanged. Actual Types integration/qualification remain gates.
