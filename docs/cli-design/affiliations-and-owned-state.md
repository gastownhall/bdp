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
| `bdp update item --type Task@r2` | `bead:"item"`, `type:{uri:"https://work.example/acme/Task",revision:"r2"}` |
| `bdp update item --type Task --type-revision r2` | Same exact affiliation |
| `bdp link update rel --type Blocks@r2 --if-revision link-r7` | `link:"rel"`, exact `type`, `expectedRevision:"link-r7"` |

Examples assume command Scope `https://work.example/acme/`. The singleton operation
URL supplies its discriminator; a batch member includes `operation:"updateBead"`
or `"updateLink"` using the same fields. `--emit-operation`/`--emit-batch` compile
without execution: no fetch, registration, default selection or claimed validation
success. No hand-authored whole-request JSON escape is needed for these inputs.
Actual key allocation, framing and emission/batch details belong to the complete
canonical CLI design and do not follow from this bounded source subset alone.

For local spellings the first raw `@` begins the suffix. Unwrapped absolute URLs
containing `://` remain literal, including raw `@`; use `'[HTTP_URL]@REV'` or the
explicit pin option for an exact URL affiliation. Suffix plus `--type-revision`
is an error even if equal; an already pinned exact field-value escape also
conflicts with the explicit pin option. `--type-revision` requires `--type`. Type `@unpinned`
means unpinned input; `@current` refuses rather than a client read/write race.
`json:JSON`, `json:@FILE` and `json:@-` are exact field-value escapes for admitted
Reference/token forms and preserve opaque tokens/delimiters; they do not broaden
protocol Type URI grammar. Mutation targets remain unpinned. Resource
`--revision` / `ID@REV` select historical reads; `--if-revision` guards the current
write. Neither is the Type definition pin. An explicit token option carries the
literal token, including `current`/`unpinned` if those are actual opaque tokens.

Under Types, the service resolves explicit unpinned input once to its eligible
registered exact default. The CLI never resolves it during compilation. An omitted
Type stays at its old exact affiliation even after defaults change. Explicit input
replaces the whole Reference. The same resolved affiliation alone is a genuine
no-op; a different definition pin is an effect without a fake properties patch.
`--patch-properties '[]'` contributes no patch operations but does not cancel a
Type change. Guards/provenance alone do not form an update. Authorization,
optional guards, property-access policy, final validation and retry rules remain.

> **Cleo — Type and revision flags:** `--type` sets an affiliation on writes.
> Preserve `--revision` for historical reads and `--if-revision` for guards.
> Exact Type pins use the existing suffix convention or `--type-revision`; the
> wire has no separate `typeRevision`. This sidebar records the shared design;
> it is not a request to interrupt your work.

> **Cleo — Edits and rendering:** Keep singular `--set-property`/`--unset-property`
> and the unified replacement/patch/edit modes. Reuse your output formats and
> pagination; preserve native exact Reference objects in JSON output. This slice
> adds no alternate renderer, Type lifecycle verbs or property conversion.

## Select by nominal Type or family

`bdp list --exact-type Task` lowers to structural `type=<absolute URI>`: nominal
Type exactly, regardless of definition pin. `bdp list --type Task` lowers to
`conformsTo=<absolute URI>`: that Type and refinements under recorded exact
Types authority. The same flags apply under `bdp link list`. They conflict;
filter operands accept identity only, so pin suffixes/objects refuse. Bare
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

Mutation results preserve the native `source`/`sourceRevision` pair when the Link
is effectively owned before or after the operation. Leaving ownership still reports
the induced source revision despite an unowned postimage Type; unrelated unowned
operations omit the pair and owned-Link no-ops report the unchanged source revision.
The CLI does not infer these fields from the resulting Type.

Retyping a Link into/out of ownership changes its source atomically; retyping the
source recomputes membership without inventing Link edits. Endpoints stay literal,
including a source pin older than the new owning capture. These are provider rules,
not client patch expansion. One atomic batch can express coordinated repairs;
no per-Type pin policy, extra mandatory guard or new ownership command is added.
Required Type-only Event encoding and D1/D2 remain adoption gates; no rendering
choice here silently selects deltas versus postimages.
