# Draft Type-profile property schemas

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
| [issue.properties.schema.json](../../types/issue/issue.properties.schema.json) | Issue instance properties | Base review fragment; not full domain/write validation |
| [dependency.properties.schema.json](../../types/issue/dependency.properties.schema.json) | Dependency instance properties | Base review fragment; child-specific workflow fields remain open |
| [domain-property-cases.json](../../../fixtures/specs/issue/domain-property-cases.json) | Illustrative Issue/Dependency properties | Shape-test inputs, not a domain specification |
| [definitions.json](definitions.json) | Eight definition Beads and four owned declarations | Literal final graph, not creation/import syntax |

## Source and status

Starting descriptor inspected on October 14, 2026: BDP main
[`bd2178dd6f4b9f7c2d239624d7edaa3d961c3e26`](https://github.com/gastownhall/bdp/blob/bd2178dd6f4b9f7c2d239624d7edaa3d961c3e26/schemas/bdp-v0.schema.json).
This is a recorded source snapshot, not a claim that it remains the latest head.
Preview 2 evidence stays pinned to `b6f7115adfd6b3da0055b8576c152d8d9456518a`;
this schema work does not requalify the build or change canonical BDP/Write.

Fresh heads also checked during this consolidation: BDP main
`453b6dab386746bb03aac2c0a293572b8a71c969` retains the same descriptor and endpoint
schema; its intervening change concerns command minimum-field conformance rules.
Preview 2 integration is now `97446d1f0894417457f9e9b8f16569baf73d68f4`, with revision
guard/CLI feedback changes. The Issue field audit remains explicitly tied to the
older inspected build; it is not represented as a fresh qualification of this head.

These artifacts use [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-core).
Embedded schemas are checked against its meta-schema; an explicit root dialect
must match. Dialect choice, requiredness and exact property names remain review
proposals. URI/date formats need an enabled format checker. `$ref` composition
here uses preloaded resources, not arbitrary network fetching; immutable published
schema closure still needs lifecycle rules.

## Changes from the current descriptor

| Starting descriptor | Current draft |
| --- | --- |
| Descriptor id | Common Bead identity and revision |
| One descriptor with describes discriminator | Common Type plus BeadType/LinkType specializations; category follows affiliation/conformance; duplicate describes prohibited |
| conformsTo array | Owned ConformsTo Links in the exact owner snapshot |
| Optional propertiesSchema URL | Required embedded schema; no separate descriptor-schema layer |
| Independent source/target constraints | linkConstraints.typeConstraints is a union of correlated endpoint pairs |
| URL-keyed ownsOutgoing map with mandatory max | Bead ownership selector array, separate from arity |
| Endpoint multiplicity policy | Family-wide sourceMax/targetMax plus Bead participation bounds |
| No common author release label | Proposed optional version with SemVer syntax; no runtime selection or compatibility inference |

The current canonical owned-Link contract requires bounded owned sets. Separating
ownership and arity in this proposal does not adopt an unbounded canonical view.
Core/Types integration must reconcile view budgets explicitly; no arbitrary
universal maximum is invented here.

## Endpoint pairs and graph constraints

Each pair has explicit source and target endpoint objects. For local Beads, each
contains `resourceKind: bead`, `scope: same`, and a nonempty `types` array. Entries
are absolute HTTP(S) Type URLs or exact `{uri, revision}` references. `['*']` (shown
here in prose) is a wildcard array and must appear alone. Empty arrays, omitted
sides and wildcard mixed with specific Types are invalid. Unpinned selectors match any revision of the identity or conformance to any such
revision, never a repeatedly resolved latest definition. Pinned selectors require
exact nominal affiliation or conformance. This does not change exact stored
affiliation and ConformsTo target pins.

A Link must match both sides of one pair. Within either side, arrays mean OR.
Inherited pair lists remain separate conjunctions; concatenating them would widen
eligibility incorrectly. Local OR arrays are only a compact Cartesian expansion.

Endpoint `scope` and `resourceKind` spellings are candidate syntax. `cross` and
`either` Bead-address arms allow only wildcard Types: external resources are not
validated, and a URI's shape is not proof of its remote Type or existence. An
opaque external `resource` arm has no `types` or Scope requirement. Core address
classification must be specified before implementation; this does not enable
local Link endpoints. No network verification of remote content is promised.

`sourceMax` and `targetMax` are optional nonnegative integers on linkConstraints,
not on pair alternatives. Each counts the declaring conformance family per
endpoint identity across all arms and endpoint revision pins. No positive Link
minimum or generic endpoint pin-mode requirement is introduced. An absent maximum
adds no local bound. Bead incoming/outgoing rules still permit minima and maxima.

`unique: true` imposes ordered endpoint-identity pair uniqueness; `acyclic: true`
requires each adopting Link to stay outside directed identity cycles, including
self-links. Cycle traversal includes all current family Links across revisions and
endpoint alternatives; old cycles with no constrained Link may remain. A later
old-Type Link cannot close a cycle through a constrained Link. Uniqueness activates
at the adopting Link's ordered pair and counts the whole family there. Both checks
use this Scope's Link table, including external endpoint identities without fetching
those resources. See Types §5.8 for tradeoffs and potential CLI preflight/migration UX. False/omission never disables an
inherited rule. Arity, uniqueness and declared acyclicity validate the final atomic
transaction state; they do not waive authorization or revision preconditions.

Ownership/participation selectors retain the earlier candidate `{anyOf: [...]}`
or `{any: true}` spelling. Endpoint arrays are the selected new form; no unrequested
rewrite of the other selector surfaces is implied. Uniform shorthand can be reviewed
later. The example blocks descriptor inherits dependency's narrower local Issue
pair despite its own wildcard pair; a broad local constraint can warn, not widen.

## Metatypes and bootstrap

Type, BeadType and LinkType are all affiliated with BeadType in this candidate.
BeadType and LinkType declare conformance to Type. ConformsTo is affiliated with
LinkType. issue/task use BeadType; dependency/blocks use LinkType. All definitions
are Beads. Type owns ConformsTo, and both specializations inherit that ownership.

ConformsTo allows BeadType→BeadType or LinkType→LinkType. Its properties are an open
object. It requires exact target pins and a conformance DAG over exact definition
revisions, but the generic identity-based acyclic flag is deliberately absent.
That flag would also forbid T@2→T@1, an unresolved part of revision evolution.
Pair uniqueness on direct declarations/evidence is likewise not selected.

Eight definitions and four declarations form the finite example. These use trusted
seed placeholders, not client-assigned production revision tokens. Definition
reference loops (including BeadType's self-affiliation) are not conformance cycles.
Bootstrap authority, revision allocation, upgrades and installation remain open.
Sources are floating in the fixture; exact owner snapshots remain authoritative.
No implicit affiliation edges appear in the graph.

A graph file/CLI payload must distinguish creating records with newly allocated
revisions from preserving exported historical pins. Forward references within an
input, Scope binding and identity conflicts remain to design. See Types §7.1;
these literals are not a proposed package/import API.

## Validation limits and reproduction

JSON Schema validates shapes, not category membership/conformance, effective
schemas, reference availability, counts, cycles, authorization, or migration.
For example min3/max2 is syntax-valid but semantically inconsistent; a false
properties schema is valid JSON Schema but admits no instances. Unknown extension
properties do not imply supported semantics. SemVer syntax proves no compatibility
promise; publication-label uniqueness is still open.

Run from the repository root:

```sh
uv run --no-project --with 'jsonschema[format]' python scripts/check_type_examples.py
```

The check validates six schemas and positive/negative shape cases, exact example
references and owned-state consistency, category-preserving pair matches over
the finite foundation graph, schema-copy equality and illustrative domain property
cases. The Issue/Dependency prose is the existing WIP authoring draft, relocated with
its inspected Preview 2 evidence intact; it is not a fresh runtime qualification.
It preloads resources and forbids retrieval. It does not implement a generic Type
checker, import a graph, exercise a BDP server or qualify a release.

The common descriptor defines no Type-specific name or display-name field. Resource
ID supplies identity; generic resource aliases do not alter equality or conformance.
See the [independent CLI proposal](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/type-cli-proposal.md) for
authoring affordances and the separate [implementation notes](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/type-cli-implementation-notes.md)
for the proposed initial exercise.
