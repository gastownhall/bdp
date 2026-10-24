# Draft Types review artifacts

The working descriptor, profile, schemas and candidate graph use **Refines** for
Type-to-Type refinement. The October 20 amendment adds the selected `abstract`
marker and `propertyAccess` map, uses one common Type selector shape, and specifies
family-wide duplicate direct exact-target refusal. These are proposed-design
artifacts, not runtime adoption, a stored-identity migration or a compatibility alias.

Review artifacts for [Types](types.md) and [Issue/Dependency](../../types/issue/issue.md).
They are not the canonical BDP schema bundle, registered Type IDs, an installable
package, or implementation qualification. Schema IDs under
`https://example.org/bdp-draft/schemas/` identify schema documents, not Type Beads.

Donna's [four October 22 rulings](https://github.com/gastownhall/bdp/issues/59#issuecomment-6358504683)
select final atomic publication with at most one new revision per affected Resource;
unchanged complete final state with no other durable effects retains revisions and
emits no lifecycle Event, while preserving the successful retry outcome. They also
select truthful Scope-wide Types activation without grandfathered covered records,
and retain the smaller in-Scope Bead alias contract. See [§1](types.md#1-scope-and-responsibilities),
[§5.7](types.md#57-ownership-matches-through-conformance) and
[§7.4](types.md#74-local-aliases-for-canonical-references). Broader aliases are
[deferred in issue299](https://github.com/gastownhall/bdp/issues/299).
A shared transaction-wide revision token is not required. Sybil owns the paired
common CLI/Core/Write/result/Event propagation; these Types-local prose changes
do not adopt its wire format or qualify runtime behavior. Earlier artifact checks
remain bound to their recorded source. Unchanged descriptor/schema/fixture bytes
do not establish execution of the new written acceptance cases.

| Artifact | Applies to | Status |
| --- | --- | --- |
| [type-definition.properties.schema.json](type-definition.properties.schema.json) | Common properties of Type-definition Beads | The properties schema of Type **is** the common descriptor schema |
| [bead-type-definition.properties.schema.json](bead-type-definition.properties.schema.json) | BeadType instances (definitions of Bead Types) | Includes common schema, allows participation/ownership rules, prohibits Link constraints |
| [link-type-definition.properties.schema.json](link-type-definition.properties.schema.json) | LinkType instances (definitions of Link Types) | Includes common schema and requires endpoint-pair constraints |
| [refines.properties.schema.json](refines.properties.schema.json) | Refines Link properties | Open descriptive properties; general executable qualifiers are deferred |
| [schema-composition-cases.json](schema-composition-cases.json) | Product/ApprovedProduct conjunction and closure examples | Finite independent-schema cases; no property merge or closure rewriting |
| [issue.properties.schema.json](../../types/issue/issue.properties.schema.json) | Issue instance properties | Base review fragment; not full domain/write validation |
| [dependency.properties.schema.json](../../types/issue/dependency.properties.schema.json) | Dependency instance properties | Base review fragment; child-specific workflow fields remain open |
| [domain-property-cases.json](../../../fixtures/specs/issue/domain-property-cases.json) | Illustrative Issue/Dependency properties | Shape-test inputs, not a domain specification |
| [definitions.json](definitions.json) | Eight definition Beads and four owned declarations | Literal final graph, not creation/import syntax |
| [exact-definition-read.md](exact-definition-read.md) | Narrow exact definition lookup | Paired common binding; not general History or public Type lifecycle |
| [exact-definition-read.schema.json](exact-definition-read.schema.json) | Query/detail/wrapper/Problem grammar | Aliases fixed common exact-read helpers; no provider semantics |
| [exact-definition-read-cases.json](exact-definition-read-cases.json) | Exact query, task + four intrinsic wrappers, finite walks; six service cases | Finite offline artifact audits; service semantics unexecuted |

## Source and status

[Types §1.1](types.md#11-descriptor-specification-and-profile-rules) records the
ownership split: the descriptor owns abstract shapes, defaults, local restrictions
and concise normative field meanings; the profile owns detailed interpretation, enforcement,
conformance, composition and lifecycle. The working descriptor is deliberately
relocated into BDP at [type-system.md](../../types/type-system/type-system.md),
alongside this v0.1 candidate. Trish maintains both parts. The temporary external
placement has ended; the original source and history are preserved, not rewritten.

The immutable origin is [descriptor `01beba80`](https://github.com/donnabox/memory-beads/blob/01beba80b07fbed0564cabba1827f69b17d84369/specs/type-packages/type-system/type-system.md),
from [source PR3](https://github.com/donnabox/memory-beads/pull/3): full commit
`01beba80b07fbed0564cabba1827f69b17d84369`, 22,427 bytes, SHA256
`57eb7040aa2351edf9d86d9a9a8886959e692ca487a1ce8cd1c65e6033e986e1`.
That digest identifies the original source bytes, not the amended local file.
The original [placement Decision](https://github.com/donnabox/memory-beads/blob/cc32cba35758a8dbbd89d5cf953c7035203cd836/decisions/type-descriptor-profile-split.md)
is historical context. Local schemas and fixtures remain review companions,
not generated code or a lossless Markdown conversion. Review correspondence at
an exact new candidate commit; retaining origin provenance does not inherit an
old review's pass or adopt a released profile.

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

This v0.1 correspondence starts from integration commit
`365f337fd161e0c888b0ab6dc3a632bfbcb28581` on the sole shared
`codex/bdp-v0.1` branch. The selected Types artifacts originate at
`ce30e4a0854da5123a622a5be5e95190e36be413`; this is an explicit file port,
not a merge of that accumulated branch or its Memory domain catalog. The local
profile also incorporates later accepted registration, final-graph endpoint
eligibility, complete exact-definition reads and affiliation-carrier decisions.
Core/Write/distribution-schema propagation is a separate coordinated lane under
[issue279](https://github.com/gastownhall/bdp/issues/279); this file port does not
qualify a runtime. The Memory product
proposal is independent of this definition encoding; its fixed supplied catalog
need not expose definition Beads or ship the general Types profile. See
[Memory proposal #7661](https://github.com/gastownhall/beads/issues/7661) and its
[implementation/decision ledger](https://github.com/gastownhall/beads/issues/7656).

JSON Schema 2020-12 and its standard validation rules are the selected baseline.
Every schema resource in the retained closure uses the standard dialect; omission
uses/inherits that baseline. Other explicit dialect URIs refuse, including on embedded
resources. Literal/example data keys are not schema declarations. The root-only shape
check is not a closure walker. A general executable extension language is deferred;
support for an extension does not imply acceptance of its dialect URI. Unsupported
required vocabularies identified by the applicable meta-schema must refuse;
`$vocabulary` in an ordinary schema is not extension negotiation. Unknown annotations do not acquire assertion
semantics by being present. See [JSON Schema Core §8.1](https://json-schema.org/draft/2020-12/json-schema-core#section-8.1)
and Types §3.12. The common fields now include optional boolean `abstract` and a `propertyAccess`
map from object-member JSON Pointers to writable, init-only or service-managed.
Defaults and inherited restrictions are interpreted by the profile; shape checks
do not prove enforcement.

Referenced schema resources and resolution bindings must be retained immutably with
the Type revision, without fetching newer remote content during validation. Their
descriptor representation is a root `propertiesSchema` plus a proposed `schemaResources`
URI-to-resource map, immutable with its revision. The seed includes reachable descriptor
and standard 2020-12 meta-schema copies at their original IDs. Implementations supply the standard 2020-12 meta-schema resources for both
written and omitted dialects; a definition need not embed copies. The fixture
retains some standard copies for review, checked against adjacent artifacts and
`jsonschema-specifications`; see [third-party notices](THIRD_PARTY_NOTICES.md).
The finite checker preloads the standard baseline and each metatype's retained
application map with retrieval disabled. Relative external schema references
require an explicit applicable absolute schema base. No base is invented from
the Type identity or download location. Separate Schema Beads and mutable
sidecars are not required.

The profile also requires syntactic enforcement of standard formats and refusal of Types relying on unknown/unsupported formats, without network
or existence checks. This explicitly goes beyond annotation-only defaults; see
[JSON Schema Validation §7.2](https://json-schema.org/draft/2020-12/json-schema-validation#section-7.2).
The checker enables Python `FormatChecker` for its illustrative URI/date cases;
that setting alone proves neither coverage of every standard format nor admission
refusal for unknown formats. It does not implement general required-vocabulary
negotiation or prove arbitrary schema satisfiability.

The Types-local [exact lookup candidate](exact-definition-read.md) pairs with the
staged common Core read/discovery/error binding. Its local schema is an alias index
to existing common helpers, frozen at `6c3c421491adf8b7f6b3a0042c4d1196ce3c9115`;
the cases record the exact common-schema SHA256. Original PR292 qualification
remains historical, not inherited evidence for this candidate. The checker below
now audits the task plus four intrinsic complete wrappers, common grammar and
finite exact-dependency walks with retrieval disabled. Six service scenarios remain
unexecuted. These records use the existing illustrative IDs/revisions and explicit
example origin context, not a production bootstrap or registration claim.

## Changes from the current descriptor

The proposed design changes the recorded adopted descriptor snapshot above.
Core/Write alignment remains necessary for definition-Bead identity, category
specialization, owned Refines declarations, embedded schema closure, closed
instance-properties roots, Type lifecycle operations and inventory projections.
Explicit registration is distinct from storing a definition. Initial instance
use and import require existing exact registrations; automatic installation is
not selected initial behavior. Broader acquisition and lifecycle operations remain
deferred, without changing adopted Write's prohibition on mutation-triggered Type
installation. Aggregate constraints
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
The selected v0.1 direction preserves full exact definition records through
explicit operational byte/count admission bounds. These are not semantic family
maxima; accepted definitions must not become unreadable after limits tighten.
Core/Types read and admission correspondence remains necessary. Proposed actual-nominal-Type grouping and
empty owned set `{}` also require a coordinated Core amendment.

Endpoint, ownership and participation Type selectors share `{anyOf: [...]}` or
`{any: true}`. Correlated endpoint pairs retain their conjunction/union meanings;
the old endpoint arrays and `["*"]` are not aliases in these candidate artifacts.

The literal graph contains eight definition Beads and four owned declarations.
Its IDs and revision tokens are placeholders, not a production bootstrap publication.
Sources are floating in this fixture; exact owner snapshots remain authoritative.
Definition reference loops, including BeadType's self-affiliation, are distinct from
conformance cycles. Refines deliberately has neither generic identity acyclicity
nor an identity self-link prohibition: explicit T@2→T@1 remains permitted, while
exact-revision cycles reject. Shape checks do not prove declaration admission.

The graph records a final state. It supplies no creation/import syntax, revision
allocation, forward-reference, Scope binding or identity-conflict behavior.
The Issue/Dependency prose retains its inspected Preview 2 evidence and records
its selected bounded native adapter correspondence. The example Issue and Dependency
definitions declare `abstract: true`; their task/blocks refinements remain concrete.
This closes base instantiability, not general custom-definition provisioning or
runtime qualification. These artifacts do not select other unresolved domain fields. The fixed
Memory product proposal remains independent of this definition encoding.

## Validation limits and reproduction

JSON Schema validates shapes, not category membership/conformance, effective
schemas, reference availability, counts, cycles, authorization, or migration.
For example min3/max2 is syntax-valid but semantically inconsistent; a false
properties schema is valid JSON Schema but admits no instances. Unknown extension
properties do not imply supported semantics. SemVer syntax proves no compatibility
promise. The initial profile has no separate compatibility relation or SemVer migration
guarantee; informational version labels may repeat across exact definition revisions. Types §3.13 specifies a sound,
bounded mandatory contradiction floor and a separate warning for simple disjoint
optional-property types. Outside proved cases the static result is unknown;
full instance validation and authors' semantic responsibilities remain. This artifact
checker does not implement that general admission floor.

Before publishing or updating the working descriptor, review field-for-field
correspondence at the exact candidate commit between the local descriptor and
schema/fixture copies: shapes,
requiredness, defaults, local restrictions (including reserved-field prohibitions),
and concise meanings, explicitly including `linkConstraints.allowSelf`. Only
intra-repository schema-copy equality is mechanically checked; the artifact checker
does not parse the Markdown descriptor tables as executable schemas. Record the
immutable full candidate commit and each reviewed file digest. A change touching
profile-cited meanings requires renewed correspondence review.
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
string, number and null rejected), abstract/property-policy/selector shape cases,
finite direct-abstract-use and exact-target Refines family uniqueness cases, and
assertions that generic identity
acyclicity is absent from Refines and no local self-link prohibition is added, twelve
Product/ApprovedProduct composition cases, ten finite
endpoint-fact cases, two revision-closure cases and illustrative domain property cases.
Four finite dialect cases explicitly enumerate root/embedded/retained resource facts;
they distinguish literal data and do not implement general closure discovery.
The endpoint cases stipulate Scope and accepted exact-definition facts; they do not
implement registration or address classification; a negative case refuses an unpinned
foreign definition even when registered.
The revision cases check the target-edge walk, not complete declaration admission.
The exact-read audit additionally checks the fixed common-schema digest, 14 query
cases, capability/Problem helpers, task plus four intrinsic wrapper copies, five
altered-copy refusals, two visited-exact-pair walks and two missing-dependency
refusals despite newer copies. A newer task record does not affect the old walk.
These finite checks do not execute the six provider scenarios or confer registration,
default selection, ordinary list presence, public CRUD or publication authority.
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
