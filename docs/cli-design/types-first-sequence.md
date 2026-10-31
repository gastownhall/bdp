# First Types acceptance sequence

Donna's October 29–30 five-increment sequence supersedes the earlier October 28
sequence and its temporary custom-instance placeholder. Each increment must work
as ordinary product functionality before the next is pulled forward. This is an
acceptance contract, not evidence that a particular executable has passed it.
The [general canonical CLI](bdp-cli.md) owns shared parsing and operations; the
[Types companion](types-cli.md) owns the Type workflow and presentation. The
[Types profile](../../specs/profiles/types/types.md) owns interpretation and
availability semantics.

## Establish one explicit baseline

Use one identified Scope and one pinned build. Record the actual installed Type
identities, exact editions and supported native operations. Fresh local intrinsic
definition IDs are `type`, `bead-type`, `link-type` and `refines`; the earlier
`TYPE-ID-FOR-*` and `type-for-*` spellings were explanatory placeholders, not
product names. Display a definition Bead's ordinary affiliation as **Type**.
Keep friendly names, local Resource IDs, shared protocol identities and exact
revision tokens distinct.

Initialization prepopulates real, locally owned definition Beads for **all installed
Types**, including the existing Issue classifications such as task and the Memory
family, as well as the four intrinsic definitions. These records participate in
the ordinary graph. The [intrinsic local-record correspondence](../../specs/profiles/types/types.md#24-ordinary-local-records-for-shared-intrinsic-definitions)
preserves the shared intrinsic definitions' common protocol meaning and genuine
local ownership. Applying this direction to the other installed definitions must
preserve their actual identities, exact affiliations and native validation rules;
it does not rename every installed Type or invent new aliases.

Real installed records are runtime authority. Descriptor and compiler indexes
must be checked against those same exact records and the same transaction; they
are not a second independently mutable registry. Neither a generated display row
nor a retained foreign cache entry substitutes for an ordinary local Bead. This
acceptance sequence does not redesign packs, namespaces, public lifecycle APIs or
the profile's availability and exact-default requirements.

## Increment 1: ordinary Type Beads and existing functionality

Generic graph services must include a Type-definition Bead because it is an
ordinary Bead, without checking for `bead-type` or `link-type` to grant graph
membership. The same Resource acquisition, selection, projection, traversal and
Count paths apply to definition Beads and other records. Generic Type/family
predicates may interpret each record's exact affiliation and captured ancestry
uniformly; descriptor compilation and admission remain separate responsibilities.
A specialized Type query engine or definition-only service enrollment path does
not satisfy this increment.

This increment is independently useful. Complete it before authoring new Types,
new refinement chains or custom instances.

| Path | Required observable outcome |
| --- | --- |
| `bd show type`, `bd show bead-type`, `bd show link-type`, `bd show refines` | Return each complete ordinary local definition Bead, with real identity/revision, ordinary Type field, descriptor and owned state. Exact shared correspondence remains checked. |
| Existing installed definitions | Show the actual installed task, memory and other Type definitions through their recorded local IDs. Do not fabricate a local shorthand or global identity to satisfy the example. |
| Ordinary List, Count and Graph | All installed definition Beads appear through the same read paths as other Beads. Count agrees with the matching complete List, and Graph retains genuine refinement Links, endpoint identities and pins. No separate definition-only collection stands in for the graph. |
| `bd list --type type`, `bd list --type bead-type`, `bd list --type link-type` | Family and nominal filtering follow recorded exact affiliations/conformance. The all-Type family includes both BeadType and LinkType definitions; the filtered views remain ordinary graph views. |
| `bd link list --type refines` | Return genuine local Refines records through ordinary paging/visibility, with real owners and exact endpoint pins. |
| Generic AST Query | Query the same records and exact captured Type facts through the selected AST contract. A separate legacy Issue/Dependency expression query need not acquire new Resource semantics. |
| Existing native operations | Existing supported creation and readback continue working for their admitted families, not just one task example. Preserve native validation, assessment gates, ownership, history and refusal behavior. |

For the current Issue product, retain its existing prefixed-ID rule: `bd-333` is
valid; bare `333` must produce a clear validation refusal without changing state.
That compatibility choice does not introduce a separate public/native ID mapping.
Reopen the store and check the same committed results through ordinary reads.
An unsupported command must refuse honestly; its refusal is not proof that an
existing supported operation was preserved.

## Increment 2: real Type authoring

The required local authoring forms are:

```text
bd type create --id Foo --type bead-type ...
bd type create --id Relates --type link-type ...
```

The ellipses mark descriptor inputs still requiring complete examples and shared
CLI lowering; these lines are not copy-and-run recipes. Both operations must
persist real locally owned definition Beads that immediately appear through
Increment 1's ordinary read paths. The Type field describes the definition Bead's
own affiliation; a LinkType definition is itself a Bead, not a Link instance.

Under an admitted metatype edition allowing omission, absent `propertiesSchema`
adds no local constraints and remains absent on readback. All inherited and other
constraints remain. A supplied schema adds requirements; malformed or null input
must refuse under the selected contract. Preserve retained editions' exact meaning.
Do not count an unsaved descriptor or a successful Show as proof that instance
availability/default conditions have been established.

## Increment 3: author real refinement Links

Donna's requested convenience order is:

```text
bd link create --type refines BASE DERIVED
```

The intended declaration is **DERIVED refines BASE**. The normative stored Link
therefore has the derived definition as source and an exact base definition
revision as target, with the source's owned state revised atomically. Preserve
same-category endpoint requirements and inherited constraints.

The [shared Link CLI](bdp-cli.md#bd-link-create) currently defines its ordinary
positionals as `SOURCE TARGET`. Its explicit endpoint form for this declaration
is consequently `--from DERIVED --to BASE`. The requested `BASE DERIVED`
convenience needs an explicit, paired CLI-lowering reconciliation before it can
be published as executable syntax. Do not silently reverse the stored relation
or silently reinterpret all general Link positionals. Read the new declaration
back and verify family matching and its exact captured target revision.

## Increment 4: persisted custom instances and updates

```text
bd create --id X --type Foo ...
bd update X --type Foo ...
```

These are real writes. There is no temporary unsaved-instance completion path.
The complete authoring-to-use sequence must explicitly establish the selected
profile's required Type availability and exact-default conditions; this document
does not choose a new lifecycle API or infer authority from cache presence.

Read X back through ordinary Show/List/Count/Graph and generic AST Query, including
`bd list --type Foo`. Check its complete properties, exact affiliation, identity
and history after reopening. Supply an invalid candidate and require atomic
refusal with no allocated Resource, induced owner revision or success Event.
Updates preserve omitted fields and affiliations; explicit retyping validates
the whole resulting state, including every inherited constraint.

## Increment 5: the complete sequence in batch

Exercise Type authoring, Refines creation and custom-instance create/update through
the selected atomic batch contract, with ordinary readback of committed results.
Include refusal and rollback cases. A native-only batch test or schema shape check
alone does not establish this complete Types sequence. Preserve the same exact
identity, revision, ownership, validation and Event obligations as individual writes.

## Completion evidence and spec coherence

For each increment, keep the descriptor prose, applicable schemas, CLI contract,
examples and affected executable validation coherent. Record the exact build and
selected source, complete actual outputs, persistence/reopen results and known
unsupported behavior. Distinguish source-only checks, tested candidates, installed
builds and actual main qualification. A shortcut, cached result or successful
unrelated workflow cannot close an unexecuted acceptance step.

The canonical CLI corpus must exercise one mixed population through shared
assertions, rather than testing Type definitions only through a separate command:

| Corpus dimension | Required coverage |
| --- | --- |
| Population | Existing Task and Memory records, all installed definition Beads, ordinary Links and Refines. Add an ordinary Bead with descriptor-shaped application properties, so shape alone cannot confer Type status. |
| Operations | Ordinary Show/List/Count/Graph and generic AST Query, with unfiltered reads, exact/family selectors, nested property projections, ordering and supported paging or honest completeness refusal. |
| Record fidelity | Complete properties, metadata, exact affiliation, identity/revision, endpoint pins and captured owned Links; retain their meaning after reopen. Count agrees with the complete matching List. |
| Uniform behavior | Use the same canonical result/projection checks across Resource categories. Traversing Refines must use ordinary Link handling. Do not add a test-only whitelist, alternate inventory or weakened descriptor to make the corpus pass. |
| Later increments | Extend that same corpus with authored definitions and persisted custom instances when their increments are implemented, including atomic refusal and batch rollback. |

These are required future observations, not a claim that this document's examples
or any current build have executed the complete corpus.

The four intrinsic definitions' category facts remain unchanged: Type, BeadType
and LinkType definition records affiliate with BeadType; Refines affiliates with
LinkType. Ordinary local graph reads do not re-author the shared intrinsic graph,
replace retained exact-definition lookup or adopt an unselected Types1 transport.
