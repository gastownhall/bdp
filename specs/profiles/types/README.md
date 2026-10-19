# Draft Types review artifacts

Review artifacts for [Types](types.md) and [Issue/Dependency](../../types/issue/issue.md).
They are not the canonical BDP schema bundle, registered Type IDs, an installable
package, or implementation qualification. Schema IDs under
`https://example.org/bdp-draft/schemas/` identify schema documents, not Type Beads.

| Artifact | Applies to | Status |
| --- | --- | --- |
| [type-definition.properties.schema.json](type-definition.properties.schema.json) | Common properties of Type-definition Beads | The properties schema of Type **is** the common descriptor schema |
| [bead-type-definition.properties.schema.json](bead-type-definition.properties.schema.json) | BeadType instances (definitions of Bead Types) | Includes common schema, allows participation/ownership rules, prohibits Link constraints |
| [link-type-definition.properties.schema.json](link-type-definition.properties.schema.json) | LinkType instances (definitions of Link Types) | Includes common schema and requires endpoint-pair constraints |
| [conforms-to.properties.schema.json](conforms-to.properties.schema.json) | ConformsTo Link properties | Open base object; semantic qualifiers still require understanding/enforcement |
| [schema-composition-cases.json](schema-composition-cases.json) | Product/ApprovedProduct conjunction and closure examples | Finite independent-schema cases; no property merge or closure rewriting |
| [issue.properties.schema.json](../../types/issue/issue.properties.schema.json) | Issue instance properties | Base review fragment; not full domain/write validation |
| [dependency.properties.schema.json](../../types/issue/dependency.properties.schema.json) | Dependency instance properties | Base review fragment; child-specific workflow fields remain open |
| [domain-property-cases.json](../../../fixtures/specs/issue/domain-property-cases.json) | Illustrative Issue/Dependency properties | Shape-test inputs, not a domain specification |
| [definitions.json](definitions.json) | Eight definition Beads and four owned declarations | Literal final graph, not creation/import syntax |

## Source and status

[Types §1.1](types.md#11-descriptor-specification-and-profile-rules) records the
ownership split: the descriptor owns abstract shapes, defaults, local restrictions
and concise normative field meanings; the profile owns detailed interpretation, enforcement,
conformance, composition and lifecycle. Janet temporarily maintains the working
descriptor in `donnabox/memory-beads` through October 21 at the latest under Donna's
October 19 arrangement. The profile pins the
[descriptor candidate at `742e002`](https://github.com/donnabox/memory-beads/blob/742e0025eb294a0d733c2ef0e945703f7325f965/specs/type-packages/type-system/type-system.md)
and its [accepted placement Decision](https://github.com/donnabox/memory-beads/blob/742e0025eb294a0d733c2ef0e945703f7325f965/decisions/type-descriptor-profile-split.md).
The descriptor's full commit is `742e0025eb294a0d733c2ef0e945703f7325f965`;
its verified 17,535 bytes have SHA256
`524935216f0498addab12e729cb848bd5e5592dba13d31debe5a28ee16a40dee`.
Both remote files were verified; the descriptor remains a proposed-design draft.
Split review findings are dispositioned with native final correspondence closure;
one council reviewer timed out without findings. Local schemas and fixtures remain review companions; no generated-code
or lossless Markdown conversion claim is made.

Starting descriptor inspected on October 14, 2026: BDP main
[`bd2178dd6f4b9f7c2d239624d7edaa3d961c3e26`](https://github.com/gastownhall/bdp/blob/bd2178dd6f4b9f7c2d239624d7edaa3d961c3e26/schemas/bdp-v0.schema.json).
This is a recorded source snapshot, not a claim that it remains the latest head.
Preview 2 evidence stays pinned to `b6f7115adfd6b3da0055b8576c152d8d9456518a`;
this schema work does not requalify the build or change canonical BDP/Write.

Additional historical snapshots checked during the original consolidation: BDP main
`453b6dab386746bb03aac2c0a293572b8a71c969` retains the same descriptor and endpoint
schema; its intervening change concerns command minimum-field conformance rules.
The subsequently inspected Preview 2 integration snapshot is
`97446d1f0894417457f9e9b8f16569baf73d68f4`, with revision guard/CLI feedback changes. The Issue field audit remains explicitly tied to the
older inspected build; it is not represented as a fresh qualification of this head.

The current design-source baseline for this reconciliation is shared branch
`codex/trish-spec-integration` at `b12665d64c2aaf6172bd1cdab409cef31ef28f44`.
This is a source observation, not a new runtime qualification. The Memory product
proposal is independent of this definition encoding; its fixed supplied catalog
need not expose definition Beads or ship the general Types profile. See
[Memory proposal #7661](https://github.com/gastownhall/beads/issues/7661) and its
[implementation/decision ledger](https://github.com/gastownhall/beads/issues/7656).

JSON Schema 2020-12 and its standard validation rules are the selected baseline.
Every schema resource in the retained closure uses the standard dialect; omission
uses/inherits that baseline. Other explicit dialect URIs refuse, including on embedded
resources. Literal/example data keys are not schema declarations. The root-only shape
check is not a closure walker. Custom/derived meta-schema presentation remains open;
support for an extension does not imply acceptance of its dialect URI. Unsupported
required vocabularies identified by the applicable meta-schema must refuse;
`$vocabulary` in an ordinary schema is not extension negotiation. Unknown annotations do not acquire assertion
semantics by being present. See [JSON Schema Core §8.1](https://json-schema.org/draft/2020-12/json-schema-core#section-8.1)
and Types §3.12. Descriptor field requiredness and exact names remain review syntax.

Referenced schema resources and resolution bindings must be retained immutably with
the Type revision, without fetching newer remote content during validation. Their
descriptor representation is a root `propertiesSchema` plus a proposed `schemaResources`
URI-to-resource map, immutable with its revision. The seed includes reachable descriptor
and standard 2020-12 meta-schema copies at their original IDs. Baseline meta-schema
provisioning remains unresolved: implementation-supplied or descriptor-carried, uniformly
for written and omitted `$schema`. The current fixture carries copies for explicit-
dialect roots but not its two omitted-dialect roots; it is not complete admission
evidence for that unresolved obligation. Copies are checked against the adjacent
artifacts and `jsonschema-specifications`;
see [third-party notices](THIRD_PARTY_NOTICES.md). The finite checker uses each metatype's
retained map with retrieval disabled for the exercised cases. Map serialization and anonymous relative-base
handling still need review; separate Schema Beads or mutable sidecars are not required.
The profile also requires syntactic enforcement of standard formats and refusal of Types relying on unknown/unsupported formats, without network
or existence checks. This explicitly goes beyond annotation-only defaults; see
[JSON Schema Validation §7.2](https://json-schema.org/draft/2020-12/json-schema-validation#section-7.2).
The checker enables Python `FormatChecker` for its illustrative URI/date cases;
that setting alone proves neither coverage of every standard format nor admission
refusal for unknown formats. It does not implement general required-vocabulary
negotiation or prove arbitrary schema satisfiability.

## Changes from the current descriptor

The proposed design changes the recorded adopted descriptor snapshot above.
Core/Write alignment remains necessary for definition-Bead identity, category
specialization, owned ConformsTo declarations, embedded schema closure, closed
instance-properties roots, Type lifecycle operations and inventory projections.
Adopted Write prohibits mutation-triggered Type installation; the proposed explicit
automatic-installation mode requires coordinated Write adoption. Aggregate constraints
currently supplied as Scope policy move into the proposed Type contract; current
policy/wire behavior is not silently replaced. The adopted descriptor object is
closed; proposed descriptor roots permit extensions without granting unknown fields
implemented semantics.
See [definition and schema rules](types.md#2-definitions-identity-and-affiliation),
[graph constraints](types.md#5-endpoint-constraints-and-arity),
[remaining decisions](types.md#7-decisions-still-needed) and
[readiness](types.md#8-readiness-and-landing) for detailed status.

The current canonical owned-Link contract requires bounded owned sets. Separating
ownership and arity in this proposal does not adopt an unbounded canonical view.
Core/Types integration must reconcile view budgets explicitly; no arbitrary
universal maximum is invented here. Proposed actual-nominal-Type grouping and
empty owned set `{}` also require a coordinated Core amendment.

Ownership/participation selectors deliberately retain `{anyOf: [...]}` or
`{any: true}` while endpoint selectors use arrays. Uniform shorthand is deferred;
this spelling asymmetry is not an authorization to rewrite other selector surfaces.

The literal graph contains eight definition Beads and four owned declarations.
Its IDs and revision tokens are placeholders, not a production bootstrap publication.
Sources are floating in this fixture; exact owner snapshots remain authoritative.
Definition reference loops, including BeadType's self-affiliation, are distinct from
conformance cycles. ConformsTo deliberately has neither generic identity acyclicity
nor an identity self-link prohibition: explicit T@2→T@1 remains permitted, while
exact-revision cycles reject. Shape checks do not prove declaration admission.

The graph records a final state. It supplies no creation/import syntax, revision
allocation, forward-reference, Scope binding or identity-conflict behavior.
The Issue/Dependency prose retains its inspected Preview 2 evidence; these artifacts
do not freshly qualify a runtime or select unresolved domain fields. The fixed
Memory product proposal remains independent of this definition encoding.

## Validation limits and reproduction

JSON Schema validates shapes, not category membership/conformance, effective
schemas, reference availability, counts, cycles, authorization, or migration.
For example min3/max2 is syntax-valid but semantically inconsistent; a false
properties schema is valid JSON Schema but admits no instances. Unknown extension
properties do not imply supported semantics. SemVer syntax proves no compatibility
promise. The initial profile has no separate compatibility relation or SemVer migration
guarantee; publication-label uniqueness is still open. Types §3.13 specifies a sound,
bounded mandatory contradiction floor and a separate warning for simple disjoint
optional-property types. Outside proved cases the static result is unknown;
full instance validation and authors' semantic responsibilities remain. This artifact
checker does not implement that general admission floor.

Before publishing or moving the descriptor pin, review field-for-field correspondence
between that exact descriptor and the local schema/fixture copies: shapes,
requiredness, defaults, local restrictions (including reserved-field prohibitions),
and concise meanings, explicitly including `linkConstraints.allowSelf`. Only
intra-repository schema-copy equality is mechanically checked; the artifact checker
does not parse or verify the external Markdown descriptor. Record the immutable full
commit SHA and descriptor-byte SHA256 with the reviewed source. A change touching
profile-cited meanings requires renewed correspondence review before moving the pin.
Retain the reviewed source and digest with the review evidence; loss of access blocks
verification/publication until that exact source can be recovered. It does not promote
a companion schema to descriptor authority.

Run from the repository root:

```sh
uv run --no-project --with 'jsonschema[format]' python scripts/check_type_examples.py
```

The check validates six schemas and positive/negative shape cases, exact example
references, owned-state consistency and inherited ownership-selector matches, category-preserving pair matches over
the finite foundation graph, twelve invalid ownership/projection/endpoint/schema-map fixture mutations,
schema-copy equality, five self-link shape cases (boolean false/true accepted;
string, number and null rejected), intrinsic-ConformsTo assertions that generic
acyclicity is absent and no local self-link prohibition is added, twelve
Product/ApprovedProduct composition cases, ten finite
endpoint-fact cases, two revision-closure cases and illustrative domain property cases.
Four finite dialect cases explicitly enumerate root/embedded/retained resource facts;
they distinguish literal data and do not implement general closure discovery.
The endpoint cases stipulate Scope and accepted exact-definition facts; they do not
implement registration or address classification; a negative case refuses an unpinned
foreign definition even when registered.
The revision cases check the target-edge walk, not complete declaration admission.
The composition check validates each contract unchanged and
compares its conjunction with separate `allOf` branches, removing only each branch
root dialect declaration after independent validation so it is not misplaced in a
non-resource-root position; no assertion is rewritten. It checks the inline examples
against their fixture schemas. This does not decide arbitrary schema satisfiability or
select cross-schema `unevaluatedProperties` rewriting. Its category helper
recognizes the fixture's direct intrinsic BeadType/LinkType affiliations only; it is
not a general resolver for custom metatypes that conform to those categories. That
fixture shortcut neither prohibits conforming metatypes nor proves their admission.
The exact metatype selectors in the fixture remain intentional; intrinsic upgrades
must publish a coherent shared exact graph and retain prior versions, not silently
switch selectors to identity-wide matching. The Issue/Dependency prose is the existing WIP authoring draft, relocated with
its inspected Preview 2 evidence intact; it is not a fresh runtime qualification.
The checker preloads resources and forbids retrieval. It does not implement a generic Type
checker, import a graph, exercise a BDP server or qualify a release.

The common descriptor defines no Type-specific name or display-name field. Resource
ID supplies identity; generic resource aliases do not alter equality or conformance.
See the [independent CLI proposal](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/type-cli-proposal.md) for
authoring affordances and the separate [implementation notes](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/type-cli-implementation-notes.md)
for the proposed initial exercise.
