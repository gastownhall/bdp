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
| [schema-composition-cases.json](schema-composition-cases.json) | Product/ApprovedProduct conjunction and closure examples | Finite independent-schema cases; no property merge or closure rewriting |
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

Additional historical snapshots checked during the original consolidation: BDP main
`453b6dab386746bb03aac2c0a293572b8a71c969` retains the same descriptor and endpoint
schema; its intervening change concerns command minimum-field conformance rules.
Preview 2 integration is now `97446d1f0894417457f9e9b8f16569baf73d68f4`, with revision
guard/CLI feedback changes. The Issue field audit remains explicitly tied to the
older inspected build; it is not represented as a fresh qualification of this head.

The current design-source baseline for this reconciliation is shared branch
`codex/trish-spec-integration` at `b12665d64c2aaf6172bd1cdab409cef31ef28f44`.
This is a source observation, not a new runtime qualification. The Memory product
proposal is independent of this definition encoding; its fixed supplied catalog
need not expose definition Beads or ship the general Types profile. See
[Memory proposal #7661](https://github.com/gastownhall/beads/issues/7661) and its
[implementation/decision ledger](https://github.com/gastownhall/beads/issues/7656).

JSON Schema 2020-12 and its standard validation rules are the selected baseline.
Embedded schemas are checked against its meta-schema; an omitted root dialect uses
2020-12 and a conflicting explicit dialect refuses. Unsupported required vocabularies
identified by the applicable meta-schema must refuse; `$vocabulary` in an ordinary
schema is not extension negotiation. Unknown annotations do not acquire assertion
semantics by being present. See [JSON Schema Core §8.1](https://json-schema.org/draft/2020-12/json-schema-core#section-8.1)
and Types §3.12. Descriptor field requiredness and exact names remain review syntax.

Referenced schema resources and resolution bindings must be retained immutably with
the Type revision, without fetching newer remote content during validation. Their
closure encoding and installation remain open. The checker uses preloaded resources
and forbids retrieval. The profile also requires syntactic enforcement of standard
formats and refusal of Types relying on unknown/unsupported formats, without network
or existence checks. This explicitly goes beyond annotation-only defaults; see
[JSON Schema Validation §7.2](https://json-schema.org/draft/2020-12/json-schema-validation#section-7.2).
The checker enables Python `FormatChecker` for its illustrative URI/date cases;
that setting alone proves neither coverage of every standard format nor admission
refusal for unknown formats. It does not implement general required-vocabulary
negotiation or prove arbitrary schema satisfiability.

## Changes from the current descriptor

| Starting descriptor | Current draft |
| --- | --- |
| Descriptor id | Common Bead identity and revision |
| Descriptor name and adopted `{id, name, describes}` inventory projection | No separate Type name identity; resource ID and aliases supply naming. Changing the adopted inventory projection requires a separate Core amendment. |
| Closed descriptor object | Candidate descriptor roots permit extensions; unknown data does not imply implemented semantics. |
| Core's always-open instance properties | Draft schema authors may choose closure, subject to inherited compatibility; adopting that change requires Core alignment. |
| One descriptor with describes discriminator | Common Type plus BeadType/LinkType specializations; category follows affiliation/conformance; duplicate describes prohibited |
| conformsTo array | Owned ConformsTo Links in the exact owner snapshot |
| Optional propertiesSchema URL | Required embedded schema; no separate descriptor-schema layer |
| Independent source/target constraints | linkConstraints.typeConstraints is a union of correlated endpoint pairs |
| URL-keyed ownsOutgoing map with mandatory max | Bead ownership selector array, separate from arity |
| Endpoint multiplicity policy | Family-wide sourceMax/targetMax plus Bead participation bounds |
| Aggregate constraints supplied as Scope policy | Selected draft direction places declared arity/uniqueness/acyclicity in the Type contract; current policy/wire behavior is not silently replaced. |
| Write prohibits mutation-triggered Type installation | Explicit automatic-installation mode is selected for the future lifecycle (§7.2), subject to validation/admission; coordinated Write adoption remains required. |
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

For explicitly unpinned Type write input, the Scope instead uses its explicitly
chosen installed exact default for the canonical Type identity. Installing a later
revision alone does not change that default; an explicit default change affects
future unpinned selections, not existing pins or updates omitting Type. Pinned input
keeps its requested revision. Alias resolution does not promote a default, and
identity-wide query/constraint matching never consults this write default. Unpinned
input without a selected local exact default refuses, even with only one installed
revision; an explicit admitted pin or explicit default selection is needed. Initial
selection and its operation/permission contract remain open; no automatic first-install
selection or fallback is introduced. See Types §7.2. These are semantic rules, not
new descriptor fields or executable behavior in the literal fixture.

A Link must match both sides of one pair. Within either side, arrays mean OR.
Inherited pair lists remain separate conjunctions; concatenating them would widen
eligibility incorrectly. Local OR arrays are only a compact Cartesian expansion.

Endpoint `scope` and `resourceKind` spellings are candidate syntax. `cross` and
`either` Bead-address arms allow only wildcard Types for ordinary external graph
endpoints: a URI's shape is not proof of its remote Type or existence. An
opaque external `resource` arm has no `types` or Scope requirement. Core address
classification must be specified before implementation; this does not enable
local Link endpoints. No network verification of arbitrary remote content is promised.

Registered exact Type definitions are different: their retained pinned conformance
closure supplies trusted local dependencies for semantic validation, even with
canonical IDs in another Scope. No online fetch, identity rewrite or origin-write
permission follows. Mere cache presence is insufficient. ConformsTo's intrinsic
semantic checks use that definition resolver. The candidate generic endpoint syntax
does not yet encode this special resolution; the seed demonstrates same-Scope
pairs, not an installable cross-Scope definition graph. Registration does not bypass
its explicit same-Scope endpoint restriction; cross-origin ConformsTo admission needs
the remaining descriptor/semantic encoding. See Types §§2.2 and 7.2.

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
A declaration's exact Link Type must already be accepted before the declaration is
used to admit a candidate. An unaccepted specialization cannot establish its own
ConformsTo membership through a self-typed declaration or mutually dependent
unaccepted relationship Types. It can declare through built-in ConformsTo and then
serve later declarations once accepted. This is a logical admission dependency;
transaction/batch/import ordering syntax remains open. Trusted intrinsic bootstrap
and permitted schema recursion are separate, not a blanket ban on reference loops.

Eight definitions and four declarations form the finite example. These use trusted
seed placeholders, not client-assigned production revision tokens. Definition
reference loops (including BeadType's self-affiliation) are not conformance cycles.
Bootstrap authority, revision allocation, upgrades and installation remain open.
Sources are floating in the fixture; exact owner snapshots remain authoritative.
No implicit affiliation edges appear in the graph. Bead and Link Type-only changes
create Resource revisions even when properties are unchanged; this is a selected
mutation rule, not behavior executed by these final-state fixtures. A Link Type change
entering or leaving its source's owned set also creates a new source revision atomically
with the Link revision, preserving prior snapshots. Source-Bead retyping recomputes
its owned set from existing outgoing Links under the new effective Type in the new
Bead revision; Link revisions change only for explicit Link edits. Invalid final graphs
refuse atomically. Endpoint movement, pinned-source pre-/post-mutation semantics and
exact revision production across batch members remain separate open work. Current
Core/Write mutation contracts still need coordinated propagation.

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
the finite foundation graph, seven invalid ownership/endpoint fixture mutations,
schema-copy equality, twelve Product/ApprovedProduct composition cases and illustrative
domain property cases. The composition check validates each contract unchanged and
compares its conjunction with separate `allOf` branches; it checks the inline examples
against their fixture schemas. This does not decide arbitrary schema satisfiability or
select cross-schema `unevaluatedProperties` rewriting. Its category helper
recognizes the fixture's direct intrinsic BeadType/LinkType affiliations only; it is
not a general resolver for custom metatypes that conform to those categories. That
fixture shortcut neither prohibits conforming metatypes nor proves their admission.
The exact metatype selectors in the fixture remain intentional; a future intrinsic
upgrade needs a coherent bootstrap decision, not an unreviewed switch to identity-wide
selectors. The Issue/Dependency prose is the existing WIP authoring draft, relocated with
its inspected Preview 2 evidence intact; it is not a fresh runtime qualification.
It preloads resources and forbids retrieval. It does not implement a generic Type
checker, import a graph, exercise a BDP server or qualify a release.

The common descriptor defines no Type-specific name or display-name field. Resource
ID supplies identity; generic resource aliases do not alter equality or conformance.
See the [independent CLI proposal](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/type-cli-proposal.md) for
authoring affordances and the separate [implementation notes](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/type-cli-implementation-notes.md)
for the proposed initial exercise.
