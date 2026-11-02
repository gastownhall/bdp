---
type: Specification
id: ""
status: draft
version: "0.5"
---

# Markdown schema tables for JSON Schema

> **Imported draft format specification.** The BDP comparisons and test receipts below describe the original pinned Memory experiment. They do not describe current BDP main or qualify this imported copy. See [status and provenance](README.md).

This is a **Specification** work product. Its Bead title is the heading above; this Markdown is its body. The editable front-matter `status` is the organization-defined lifecycle label and `version` is the author-chosen Work Product label. Neither is a JSON Schema keyword. No Bead or Link has been created from this file.

## Purpose and boundary

The format lets people review common JSON Schema contracts as Markdown tables and, within a deliberately small subset, translate in either direction without guessing. It uses JSON Schema Draft 2020-12. It is a projection format, not the source of Type identity or a replacement for JSON Schema. An unsupported construct is an error, never something the translator silently drops.

This version covers a root object, required/optional properties, five scalar schema types plus a `Url` string specialization, arrays with one item type, inclusive unions, named object shapes, named sets of allowed values, descriptions on objects, fields, sets and choices, field origin, and whether other fields or values are permitted. It does not cover array length, string patterns, numeric ranges, defaults, conditional schemas, schema-valued extra fields, remote references, recursion, or JSON Schema annotation keywords other than those listed below. A future revision can add those without treating prose as executable schema.

## Schema document shape

A schema document begins with `# Name`, where `Name` matches `[A-Za-z][A-Za-z0-9_-]*`. This becomes the root JSON Schema `title`. It then has exactly one `### Properties` section and zero or more `### Object: Name` and `### Allowed values: Name` sections. Each name is unique across the root and named sections. Sections may appear in any order after Properties, but every referenced name must resolve. References among named shapes must be acyclic. A blank line separates headings, description paragraphs, setting lines, and tables.

The root heading and each named Object or Allowed values heading may be followed by one optional, single-line plain-text paragraph describing that schema. This is the existing JSON Schema `description` at the root or corresponding `$defs` member. There is no new metadata field or extension for meaning. The paragraph must precede that section's setting or table, and the reverse projection emits it only when `description` is present. Property and choice descriptions stay in their Meaning table cells. Descriptions may be omitted; absent descriptions are not rendered as `—` paragraphs. Markdown formatting, embedded newlines, and an unescaped literal pipe are outside this subset for description paragraphs too.

`Other fields: allowed` or `Other fields: not allowed` may follow Properties or an Object heading and its optional description paragraph. If omitted, **allowed** is the default. `Other values: allowed` or `Other values: not allowed` may follow an Allowed values heading and its optional description paragraph. If omitted, **not allowed** is the default. The reverse projection writes the effective line even if the author omitted it, so readers need not remember either default. Settings affect only their own section.

The Properties and Object sections use this exact table header:

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| destination | text OR PostalAddress | yes | Notice | Where to send it. |

`Name` is a unique property name within its section and uses the same spelling rule as a schema name. `Required` is `yes` or `no`. `Defined by` is a name matching the schema-name spelling rule, without requiring a definition of that name, or `—` when origin is not recorded; it documents provenance and is not a validation condition. `Meaning` is one line of plain text or `—` when no description is recorded. Table rows may be empty, but the header remains. **Property and Object table data cells are plain text, without backticks; only the Value column of an Allowed values table uses code spans.** A table cell may contain `\|` for a literal pipe and `\\` for a literal backslash; raw pipes, unescaped backslashes, embedded newlines, and Markdown formatting inside cells are outside this subset. Surrounding cell spaces are layout, not content.

An Allowed values section has at least one row and uses this exact header:

| Value | Type | Meaning |
| --- | --- | --- |
| `automatic` | text | Let the sender choose. |
| `0` | number | Do not retry. |

Each Value is one Markdown code span with a single backtick on each side. For `text` and `Url`, its content is a nonblank literal with no backtick, pipe, or newline. For `number` and `integer`, its content is a JSON number literal; `integer` additionally requires an integral value and no decimal or exponent notation. For `boolean`, it is `true` or `false`. For `null`, it is `null`. `Meaning` follows the same rule as in the property table. Choice rows must not repeat a JSON value even under different Type words: text `0` and number `0` are distinct, while number `1` and integer `1`, or text and Url rows with identical content, are duplicate JSON values. A choice's Type must be one of the scalar or specialized string types below.

## Type expressions

| Markdown Type | JSON Schema |
| --- | --- |
| `text` | `{ "type": "string" }` |
| `number` | `{ "type": "number" }` |
| `integer` | `{ "type": "integer" }` |
| `Url` | `{ "type": "string", "format": "uri" }` |
| `boolean` | `{ "type": "boolean" }` |
| `null` | `{ "type": "null" }` |
| `Name` | `{ "$ref": "#/$defs/Name" }` |
| `array of T` | `{ "type": "array", "items": schema(T) }` |
| `A OR B` | `{ "anyOf": [schema(A), schema(B)] }` |

`Url` uses JSON Schema's `uri` format, meaning a non-relative URI with a scheme; it does not require `http` or `https`. [Draft 2020-12](https://json-schema.org/draft/2020-12/json-schema-validation) treats `format` as an annotation unless the validator enables format assertion. Thus this translation records the URL intent but does not, by itself, promise runtime rejection of malformed URLs. No other `format` is in this version. The words `text`, `number`, `integer`, `boolean`, `null`, and `Url` are reserved Type tokens and cannot name an Object or Allowed values section.

`OR` is inclusive, not exclusive. `array of` binds more tightly than `OR`; `array of text OR PostalAddress` means `(array of text) OR PostalAddress`. Parentheses change grouping, so `array of (text OR PostalAddress)` makes each array item a union. Nested OR is flattened to one `anyOf` array in left-to-right order. A translator preserves parentheses wherever needed to keep the same meaning on reverse projection. `oneOf` is supported only for the closed Allowed values shape below; arbitrary `oneOf`, `allOf`, `not`, tuple `items`, and `prefixItems` are outside this version.

## Markdown to JSON Schema

The root emits `$schema` with value `https://json-schema.org/draft/2020-12/schema`, `title`, `type: object`, `properties`, optional `required`, optional `additionalProperties: false`, and optional `$defs`. Property rows become entries in `properties`; `yes` rows appear in `required` in table order. Omit `required` when no row is required. Omit `additionalProperties` for **Other fields: allowed**; write `false` for **not allowed**. Named Objects become object schemas in `$defs` by the same rules, without a `title`. Named Allowed values also go in `$defs`. Omit `$defs` when there are no named sections.

`Meaning` becomes the property's JSON Schema `description`; `—` omits it. `Defined by` becomes the property's annotation `x-definedBy`; `—` omits it. Both annotations are placed on the property schema beside its type expression or `$ref`; they are not applied to a referenced definition. JSON Schema validators ignore `x-definedBy`, but it preserves the table's origin on a round trip.

For an Allowed values definition, gather the distinct row JSON types in first-appearance order, counting Url as `string`, and emit `type` as a string for one JSON type or an array for several. Each choice row becomes a subschema in table order with `const` set to its parsed JSON value and its full Type schema beside it; a Url choice therefore has both `type: string` and `format: uri`. Its Meaning becomes that subschema's standard `description`; `—` omits it. For **Other values: not allowed**, put the choice subschemas in `oneOf`. Distinct JSON values ensure exactly one branch can match. For **Other values: allowed**, put the choice subschemas in `anyOf` and append one final fallback. When no row Type is Url, the fallback's `type` repeats the enclosing `type`. When Url occurs, the fallback is the full Type schema of the sole distinct row Type, or `anyOf` of the full Type schemas for the distinct row Type words in first-appearance order. This retains the Url branch’s `format` annotation. When mixed with `text`, the plain-string fallback branch still admits arbitrary strings; the annotation does not impose a URI-only restriction on the complete fallback. The fallback is a validation branch, not another named choice. These are ordinary JSON Schema keywords; the canonical branch order and final fallback are projection conventions, not extensions.

For example, the closed mixed set below becomes the following definition:

```markdown
### Allowed values: RetryPolicy

Other values: not allowed

| Value | Type | Meaning |
| --- | --- | --- |
| `automatic` | text | Let the sender choose. |
| `0` | number | Do not retry. |
```

```json
{
  "type": ["string", "number"],
  "oneOf": [
    {"const": "automatic", "type": "string", "description": "Let the sender choose."},
    {"const": 0, "type": "number", "description": "Do not retry."}
  ]
}
```

Changing only the setting to **Other values: allowed** replaces `oneOf` with `anyOf` containing the same two choice branches followed by `{ "type": ["string", "number"] }`. Thus another text or number would validate; a boolean would not. The optional paragraph under `### Allowed values: RetryPolicy`, if present, becomes `description` on this definition itself, separate from each choice's `description`.

## JSON Schema to Markdown

The reverse translator accepts only the listed subset. `$schema` may be absent or exactly the Draft 2020-12 URI; a different dialect is rejected. The root must be `type: object` with a nonblank `title` that is a valid schema name. Each `$defs` member must be either a supported object or a supported Allowed values definition. Local `$ref` may point only to a `$defs` member in this document. Every keyword or extension not explicitly permitted here is rejected, including `$id`, `format` values other than `uri` paired with `type: string`, `default`, `pattern`, `minItems`, and unknown `x-` members. A schema-valued `additionalProperties` is rejected.

An object’s absent or empty `properties` renders as a header-only Properties/Object table and canonical forward output uses `properties: {}`.

For an object, absent or `true` `additionalProperties` displays **Other fields: allowed**; `false` displays **not allowed**. The reverse projection always prints the setting. Every `required` name must exist in `properties`; absent or empty `required` means all rows say `no`. A property's optional `description` fills Meaning and optional `x-definedBy` fills Defined by; absence displays `—`. A present `x-definedBy` must be a string satisfying that name rule; other values cause `E_SCHEMA`. Present descriptions must be representable in their destination context: an empty or whitespace-only description, or a table-cell description equal to the absent-value sentinel `—`, causes `E_SCHEMA`, rather than being lost as absence.

A root or named Object's own optional `description` becomes its plain paragraph, distinct from property-row meanings. An object definition may not carry an independent `title` in this subset.

An Allowed values definition may use the canonical `oneOf` or `anyOf` form above. Every choice branch must contain exactly `const`, its matching scalar `type`, optional `format: uri` only for a Url string branch, and optional `description`. Branch values must be distinct as JSON values. The enclosing `type` must list exactly the distinct branch JSON types in first-appearance order. `oneOf` has only choice branches and prints **Other values: not allowed**. `anyOf` has those branches plus exactly one final fallback of the canonical shape specified above and prints **Other values: allowed**. Its optional own `description` becomes the paragraph under the Allowed values heading, while branch descriptions fill the Meaning cells. A choice branch's `description` never stands for the whole set.

The reverse translator also accepts a nonempty plain JSON Schema `enum` of distinct supported scalar values without per-choice descriptions. Values must agree with any stated `type` constraint or the input is refused with `E_SCHEMA`. It derives row Types from the value and `type` constraint when present, prints `—` for each Meaning, and prints **Other values: not allowed**. Without `type`, a numeric enum value is rendered as `number`; with only `integer`, it is `integer`. A plain string-only enum with `type: string` and `format: uri` renders its rows as Url; other uses of `format` on a plain enum are outside this subset. A plain `type` schema without an enum or canonical choice branches is a Type expression, not a named Allowed values definition. An arbitrary `oneOf` or `anyOf` is not a choice set unless it has the exact shape above; ordinary `anyOf` remains the Type-expression union defined earlier.

Before rendering, every reverse-projected name, origin, description and choice value must meet the corresponding Markdown lexical restrictions above. A supported JSON scalar type alone is insufficient: blank string choices and string choices containing a backtick, pipe or newline cannot be rendered and cause `E_SCHEMA`. For code-span choices apply the literal restrictions; for property/choice Meaning cells use the specified pipe/backslash escaping rather than the code-span restrictions. Canonical choice branches and plain enums receive the same choice-value checks. Names and origins follow their own stated lexical rules. Never trim or drop an unrepresentable value.

For display, sort Properties rows and named `$defs` sections by name in Unicode code-point order. Preserve the order of choice branches or plain `enum` rows. Use one blank line between headings, description paragraphs, setting lines, and tables. Write both effective **Other fields** and **Other values** settings. Use `—` for absent table-cell Meaning or Defined by. This is a canonical Markdown rendering, not a promise to reproduce the author's whitespace or table-row order.

## Refusal and comparison rules

Reject malformed tables, duplicate names or choices, unresolved or cyclic named references, contradictory choice branches, invalid literals, and unsupported JSON Schema keywords. Report an error code and the case location; do not invent a best-effort schema. The test harness uses `E_TABLE` for table/shape errors, `E_TYPE` for type-expression errors, `E_REF` for unresolved names, `E_CYCLE` for recursive references, and `E_VALUE` for invalid Markdown choice literals or duplicate Markdown choice values. Use `E_SCHEMA` for unsupported or contradictory JSON Schema input, including a choice branch whose `const` or `type` disagrees with the enclosing choice definition.

JSON→Markdown→JSON may normalize absent `$schema` to an explicit dialect, `additionalProperties: true` to omission, empty `required` to omission, absent `properties` to an empty object, and plain `enum` to canonical choice branches. The reverse projection sorts property rows, so a round trip may reorder `required`; these semantic normalizations are distinct from exact forward-fixture comparison. No byte-for-byte JSON round trip is promised.

Compare Markdown→JSON outputs as parsed JSON objects (object member order is immaterial; array order is retained). Compare JSON→Markdown outputs after normalizing line endings to LF and ensuring one final newline; all other text, including row order and setting lines, is significant. A JSON Schema validation engine can separately check sample instance acceptance, but that does not replace structural comparison because annotations and named-choice order matter here.

## Version 0.5 audit delta

This revision makes reverse-output representability checks explicit. The version 0.4 blinded receipts below remain historical evidence for that exact version; they were not rerun or relabeled as version 0.5 qualification. No converter implementation is claimed.

## Open work

The supported subset deliberately omits more of JSON Schema than it accepts. Extension metadata is a provisional projection contract, not yet a BDP Type descriptor rule. We still need to decide whether Markdown-authored Type contracts warrant a compiler, and how to represent descriptor identity and conformance without pretending the tables are complete Type definitions. The Memory Type catalog and Melinda's public proposal are unchanged by this Specification draft.

## Round-trip findings and challenges

The historical version 0.4 stress corpus was interpreted independently by Codex and Claude: each matched 21 of 21 Markdown-to-JSON cases and 15 of 15 JSON-to-Markdown cases, including deliberate refusals. This tests the stated subset, not arbitrary Draft 2020-12 schemas or an implemented converter. An exercise against BDP Core and Write at `gastownhall/bdp` main `3ab9cdf5d45a2ea49a84ab191eac77c9aeaa19d0` found the following limits. Core and Write share one normative 158-definition JSON Schema bundle; Write's separate 21-definition batch sketch is non-normative.

| Area | Observed result or challenge | Current treatment |
| --- | --- | --- |
| Whole BDP bundle | The `$defs` container has an `$id` and no root Object. Splitting it would change its identity and relative-reference topology. | Refuse a whole-bundle round trip; this DSL requires one root Object and does not accept `$id`. |
| Individual BDP definitions | 15 of 158 isolated normative definitions round-tripped under stated semantic normalization; 143 had direct or transitive blockers. The Write sketch yielded 2 of 21 isolated passes and 19 refusals. | Keep fragment passes distinct from a bundle pass. Do not emit a partial replacement for either complete source. |
| Named shape | Scalar and array `$defs` such as `dateTime`, `revision`, and `typeIdArray` cannot be declared as named sections. An otherwise simple Object can fail through a reference to one. | Only named Objects and Allowed-values sets are supported; refuse unresolved shape aliases. |
| Composition and closure | `allOf`, general `oneOf`/`anyOf`, and `unevaluatedProperties` cannot be flattened into fixed field tables without changing validation. | Refuse compositions outside the exact Type-expression and Allowed-values forms. |
| Conditional validation | `if`/`then`/`else`, `not`, and `dependentRequired` express cross-field conditions beyond each row's yes/no Required cell. | Refuse rather than turn conditional obligations into unconditional rows. |
| Constants and enums | BDP places `const` and `enum` inline and inside branches, not only in standalone named Allowed-values sets. | Accept only the canonical named-choice forms and supported plain enum form; refuse other placements. |
| Value and collection restrictions | Patterns, string lengths, numeric bounds, array lengths, uniqueness, and minimum property counts have no columns. `Url` records `format: uri`, which is neither an HTTP(S) restriction nor guaranteed format assertion. | Refuse unsupported keywords. The URI-format assertion was not exercised in the local validator because its format plugin was unavailable. |
| Dynamic property names and values | `propertyNames`, schema-valued `additionalProperties`, and boolean subschemas cannot be expressed by Other fields allowed/not allowed. | Refuse typed maps and boolean-schema branches; do not silently substitute an open Object. |
| Type and annotation fidelity | Array-valued `type`, independent titles on named definitions, formats such as `date-time`, and other annotations exceed the canonical reverse form. | Refuse rather than drop validation or annotations. The 15 fragment passes are semantic normalizations, not byte-for-byte JSON copies. |
| Validation boundary | A mechanical comparison of the 15 passing fragments and 204 representative Ajv instance-acceptance comparisons agreed; the two Write-sketch passes had 10 representative comparisons. | Treat finite comparisons as corroboration, not proof for all instances or for the refused definitions. Installed, authority-defined Type property schemas were outside the checked-in BDP bundle and were not tested. |
| JSON Schema's own meta-schema | The published Draft 2020-12 meta-schema has an object-or-boolean root, `$id`, `$vocabulary`, seven `allOf` references to vocabulary meta-schemas, and dynamic recursion. | Whole-document refusal. The [Markdown inventory and blocker table](https://github.com/donnabox/memory-beads/blob/742e0025eb294a0d733c2ef0e945703f7325f965/experiments/meta-schemas/json-schema-2020-12.md) is intentionally not DSL-conforming output. |
| Published OpenAPI 3.1 schema | The current dated OAS schema uses 39 named definitions, dynamic references, patterned component maps, conditionals, and evaluated-property closure. | Whole-document refusal, also for its dialect-aware `schema-base` variant. See the [Markdown inventory](https://github.com/donnabox/memory-beads/blob/742e0025eb294a0d733c2ef0e945703f7325f965/experiments/meta-schemas/openapi-3.1.md). |

The [combined stress-test review](https://github.com/donnabox/memory-beads/blob/742e0025eb294a0d733c2ef0e945703f7325f965/experiments/meta-schemas/FINDINGS.md) keeps complete-source refusals separate from the passing small-subset and isolated-fragment cases.

## External sources

- [JSON Schema Draft 2020-12 Core](https://json-schema.org/draft/2020-12/json-schema-core)
- [JSON Schema Draft 2020-12 Validation](https://json-schema.org/draft/2020-12/json-schema-validation)

These URLs cite published standards. They are not `depends-on` Link targets in this Bead scope.
