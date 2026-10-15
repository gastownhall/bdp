# Draft Type-profile property schemas

These are review artifacts for [Types](../types.md) and
[Issue/Dependency](../types/issue.md). They are not the canonical BDP schema bundle,
registered Type IDs, an installable package or an implementation claim. Their
`https://example.org/bdp-draft/schemas/` IDs identify schema documents in these
examples; they are not Type-definition Bead identities.

| Artifact | Applies to | Status |
| --- | --- | --- |
| [type-definition.properties.schema.json](type-definition.properties.schema.json) | `properties` of a Type-definition Bead | Candidate descriptor syntax based on current BDP; product semantics are in Types |
| [conforms-to.properties.schema.json](conforms-to.properties.schema.json) | `properties` of a ConformsTo Link | Open base object with no required relationship-specific fields; semantic refinements require understanding/enforcement |
| [issue.properties.schema.json](issue.properties.schema.json) | Issue instance `properties` | Existing review fragment extracted from the Issue draft; not full domain/write validation |
| [dependency.properties.schema.json](dependency.properties.schema.json) | Dependency instance `properties` | Existing open base fragment; child-specific workflow fields remain to define |
| [examples/type-foundation.json](examples/type-foundation.json) | Illustrative final records for Type, ConformsTo, issue, task, dependency and blocks | Bootstrap proposal plus domain examples; not a mutation/import format |

## Source and dialect

Starting point verified on October 14, 2026: BDP main
[`bd2178dd6f4b9f7c2d239624d7edaa3d961c3e26`](https://github.com/gastownhall/bdp/blob/bd2178dd6f4b9f7c2d239624d7edaa3d961c3e26/schemas/bdp-v0.schema.json),
`$defs.typeDescriptor`, `endpointConstraint`, `ownedLinkDeclaration` and
`ownedWildcardDeclaration`. The local design branch's older canonical copy is not
represented as the current source head. Preview 2 integration still resolves to
`b6f7115adfd6b3da0055b8576c152d8d9456518a`; this check does not requalify its build.

These artifacts use [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-core).
The descriptor's embedded `propertiesSchema` is checked against that meta-schema;
an explicitly declared root dialect must match. This is a concrete review choice,
not a settled cross-dialect or vocabulary-support policy. URI/date formats require
an enabled format checker. Cross-resource constraints are not JSON Schema assertions.

## Changes from the current descriptor

| Current descriptor | Candidate Type-Bead representation |
| --- | --- |
| Descriptor `id` | Common Bead `id`; its `revision` selects immutable descriptor content and owned declarations |
| `name`, `description`, `describes` | Retained in properties; one Type metatype describes definitions of either bead or link instances |
| Required `conformsTo` array | Removed and prohibited in properties; authoritative declarations are owned Links |
| Optional `propertiesSchema` URL | Required embedded schema for this candidate; use an explicit permissive schema when appropriate, not an implicit network fetch |
| `source.conformsTo` / `target.conformsTo` lists | `source.types` / `target.types` selectors with explicit OR, avoiding reuse of the declaration name |
| URL-keyed `ownsOutgoing` map with mandatory positive `max` | Selector array; ownership and bounds are separate, so pins and shared conformance counts can be expressed without arbitrary budgets |
| Scope-only positive endpoint multiplicity policy | Candidate Link `source.max` / `target.max` and Bead `incoming` / `outgoing` rules; expresses the selected Type constraints, not a rewrite of the current Scope policy |
| Closed descriptor root | Open root for reusable Type definitions, with known fields validated and common-envelope/old conformance duplicates prohibited |

Names and exact shapes above are **proposed syntax for review**, not additional
operator rulings. The already-selected semantic rules govern their interpretation.
The current canonical owned-Link contract requires bounded owned sets; the
candidate separation of ownership from arity is not an adopted relaxation of that
contract. Core/Types integration must reconcile required bounds and resource
budgets before implementation, rather than invent a universal maximum here.
The example `blocks` definition uses unrestricted local endpoint selectors and
inherits dependency's narrower rules; local breadth never overrides inherited
restrictions and may produce the agreed warning.

## Candidate selector and bound vocabulary

- A Type reference is an absolute HTTP(S) URL string or `{uri, revision}`. This
  preserves existing URL conventions while admitting pins. Production identity
  rules, exact/floating matching and canonicalization remain open. Schema admission
  of an unpinned selector does not decide its matching policy.
- `{anyOf: [references...]}` is an OR selector; `{any: true}` adds no Type restriction.
  These are descriptor data, not JSON Schema applicators. AND/NOT/exact-only syntax
  is not introduced. All inherited declarations still apply conjunctively.
- On a Link definition, `source` and `target` require a selector; `max` is optional,
  nonnegative and counts the declaring family at the named endpoint. No `min`
  member is accepted. Omitted `max` adds no local maximum.
- On a Bead definition, `incoming` and `outgoing` contain `linkTypes` selectors
  with `min`, `max`, or both. Omitted minimum means zero; omitted maximum is
  unbounded. Arrays can be empty. Counts combine according to the shared Types
  rules. JSON Schema cannot compare `min` with `max`; semantic admission must.
- `ownsOutgoing` is a Bead-only array of Link-Type selectors. It does not itself
  create count limits. `{any: true}` is the candidate spelling for wildcard
  ownership; overlaps must not create duplicate owned Links or count slots.
- `pairUnique: true` adds the shared ordered-pair uniqueness constraint for a Link
  family. False/omission adds no local declaration and cannot remove an inherited
  constraint. It does not enable uniqueness by default on ConformsTo.
- The existing `external` values `none`, `opaque`, `bead` are retained as candidate
  vocabulary only. Default behavior, unresolved targets and the interaction of
  opaque external references with Type requirements still require design.

## What shape validation cannot establish

The schema checks descriptor structure, known field types, category-appropriate
fields, nonnegative limits, and syntactic validity of the embedded schema. It does
not prove semantic conformance, detect every impossible schema, resolve references,
compute effective Types, validate graph counts/cycles or authorize a write.

Admission must additionally handle endpoint Type kinds, exact definition closure,
qualifier execution, same-kind ConformsTo endpoints, cycles, contradictory bounds,
immutable schema resources, inherited constraints, transaction timing and retention.
For example, `min: 3, max: 2` passes the syntax schema but is not a valid effective
contract. A boolean false properties schema is valid JSON Schema syntax but admits
no instances; syntactic acceptance does not make it a usable Type definition.
Unknown extension properties are not instructions a validator may silently treat
as implemented semantics. Cross-revision constraint evolution is still deferred.

## Examples and bootstrap boundary

The example proposes a self-typed foundational `Type` Bead and a `ConformsTo`
Link-Type definition, both installed as an understood seed set. Type owns
ConformsTo; ConformsTo accepts Type-definition Beads at both ends. This reference
dependency loop is not a conformance cycle: the seed definitions have no outgoing
conformance declarations. Normal subsequent definitions use the Type metatype.

This is a **bootstrap candidate**, not an adopted seed installation, authorization,
revision-allocation or generic create protocol. Opaque example revision tokens
are labels, not client-assigned production revisions. The self-reference cannot
be implemented by assuming an ordinary create operation already knows its own
future revision. Bootstrap and upgrades require a separate explicit mechanism.

The example declares conformance only for task→issue and blocks→dependency; it is
not a complete built-in catalog. Both declaration endpoints are in the example
Scope. Definition availability across Scopes remains open. Declaration sources
are floating in this illustration; the containing owner's recorded snapshot is
authoritative. Source-pin syntax/operations still need finalization. No Type-
affiliation edge is synthesized on domain instances.

Issue and Dependency schemas here are authoritative review fragments linked from
the domain prose. Their copies inside the example are checked for exact equality.
Updating a schema artifact is repository authoring, not automatic migration of any
published Type or instance. Published definitions embed the selected schema content;
the package file's URL does not make it a floating runtime dependency.

## Reproduce document validation

From the repository root:

```sh
uv run --no-project --with 'jsonschema[format]' python specs/schemas/check_examples.py
```

The check validates the four schemas, positive/negative property examples, the
example definition records and their recorded declaration consistency. It also
checks the domain fragments against the prose. It does not exercise a BDP server,
implement the proposed type checker or qualify runtime graph behavior.
