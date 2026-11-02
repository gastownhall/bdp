> Historical source snapshot from commit `692d801231c78e12b456d8c5213bdf137a6b534d`. This is not the canonical review specification. See the [current specification](../../../../README.md). Original source and hash are recorded in the archive index.

# Intrinsic Types publication 2

This selected draft source succeeds [publication1](intrinsic-publication.md) under
[Types §2.3](types.md#23-shared-intrinsic-publication-and-illustrative-graph).
The artifact is [intrinsic-2.json](intrinsic-2.json); its
[publication record](intrinsic-2.publication.json) records the SHA256 of all UTF-8
bytes, including the final newline. A digest identifies bytes, not publisher
identity or ordinary Resource authority. This is not an install protocol or proof
of provider support.

## Exact graph

Definition identities remain under
`https://github.com/gastownhall/bdp/types/type-system/`:

| Definition | Exact revision | Own exact affiliation |
| --- | --- | --- |
| type | type-2 | bead-type at bead-type-2 |
| bead-type | bead-type-2 | bead-type at bead-type-2 |
| link-type | link-type-2 | bead-type at bead-type-2 |
| refines | refines-2 | link-type at link-type-2 |

The two declaration identities remain `bead-type-refines-type` and
`link-type-refines-type`, each at `declaration-2`. Each pins Refines at refines-2
and targets Type at type-2. Their literal floating sources name their owning
definitions, and their records equal the copies in those owners' `ownedLinks`.
There are no Issue, Dependency, Memory or other application definitions.

Type remains abstract. BeadType and LinkType refine its exact type-2 edition.
Metatype self-affiliation is separate from the acyclic Refines graph. All exact
metatype, declaration, target and schema dependencies belong to this coherent
publication; mixing an edition1 reference into this assigned graph is invalid.
This does not forbid ordinary user definitions from recording their own valid
exact dependencies under the profile.

## Optional local properties schema

Donna's October29 ruling makes `propertiesSchema` optional in the new common
Type descriptor schema. Its absence adds no local schema constraints. Every
inherited constraint and every other applicable local descriptor constraint
still applies. An explicit schema adds constraints; it never overrides an
ancestor. `null` is not omission. Validation does not insert a schema value or
copy a parent into the saved descriptor.

The application schemas have versioned identities under
`https://github.com/gastownhall/bdp/schemas/types/intrinsic-2/`.
The [four companion files](intrinsic-2/) equal the four roots embedded in the
artifact. BeadType2 and LinkType2 reference the new Type2 schema; they do not
weaken the old Type1 schema. LinkType2 still requires `linkConstraints`, and all
category, endpoint, property-policy and reserved-field restrictions remain.
The four bootstrap definitions retain explicit own schemas and their complete
retained application environments. The eight retained standard 2020-12 resources
keep their original identities and values. No live schema retrieval is permitted.

[Finite omission cases](schema-omission-cases.json) distinguish descriptor shape
from validation of the complete unchanged instance object. They exercise inherited
requirements, local additions, multiple parents, explicit neutral/false schemas,
null/malformed refusal and no value insertion. They do not implement provider
admission, registration, writes or Type lifecycle operations.

## Retention and inspection

Publication1 bytes, receipt, exact revisions and schema identities remain unchanged.
Its metatype editions still require their original `propertiesSchema` field.
Publication2 does not reinterpret a record pinned to BeadType1 or LinkType1,
rewrite a stored descriptor, or silently select a new installed default. Trusted
provisioning and any implementation's support for retained editions require their
own explicit selection and qualification. Ordinary clients cannot update or remove
these intrinsic definitions.

As in publication1, no original authoring Scope is recorded. Exact-definition lookup
must omit `originScope`; the repository namespace is not a fabricated origin.
Ordinary local inspection Beads have their own actual local identities, revisions,
ownership and checked correspondence under
[Types §2.4](types.md#24-ordinary-local-records-for-shared-intrinsic-definitions).
They do not replace or re-author the shared exact identities above. No namespace
migration, alias, generic package/registry API or runtime adoption follows.
