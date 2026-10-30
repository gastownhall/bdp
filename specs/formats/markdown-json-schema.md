---
type: Specification
id: ""
status: draft
version: "0.6"
---

# Markdown schema tables for JSON Schema

This BDP-local draft extends the imported version0.5 design with lossless complete-bundle projection. The original is preserved separately as [markdown-json-schema-v0.5.md](markdown-json-schema-v0.5.md); its version0.4 stress receipts remain historical and qualify neither this grammar nor current BDP. The unchanged OpenAPI0.4 sister continues to use its pinned older companion, not an implicit0.6 upgrade. See [format provenance](README.md).

## Purpose, authority and boundary

The format is a human-readable authoring/projection language for parsed JSON Schema Draft2020-12 values. Tables expose ordinary fields and constraints; explicit residual schema blocks retain hard compositions without flattening validation or evaluated-property closure. It is not a Type-identity format, schema instance evaluator, provider, protocol runtime or permission to change a published schema. Prose in this specification explains the rules; prose in a rendered schema document is not executable and is refused by the codec.

Version0.6 must preserve the entire parsed JSON value on JSON→Markdown→JSON, including keyword omission versus presence, empty objects/arrays, boolean schemas, array order, arbitrary property/definition names, string annotation text, defaults, explicit true/false and negative zero. JSON object member order and source JSON whitespace/number spelling are not part of that comparison. There is no rebasing, dereferencing, implicit schema keyword, branch flattening, enum rewriting, annotation dropping or semantic normalization. A display title never replaces a schema title.

A complete bundle stays one schema resource with its original root $id, $schema, $defs and literal references. Named display sections reconstruct that original map; they do not publish independently rebased documents. Nested resource $id/$defs/anchors remain at their actual nested positions. A focused excerpt is not the complete original resource and must not be advertised under its identity. Read/Write profile selection belongs in separate entry indexes; rendering inherited definitions does not select or advertise them.

## Codec API and scope

The bounded implementation is [scripts/markdown-schema.mjs](../../scripts/markdown-schema.mjs), with no import side effects, filesystem IO, network access, dependencies or command-line execution:

- renderSchema(schema, {title?}) returns canonical0.6 Markdown. Input is an already parsed JSON schema object or boolean. The optional string title changes only the display heading. Unknown options refuse.
- parseSchema(markdown) returns the original parsed schema JSON. It does not resolve or fetch references, validate instances or interpret arbitrary annotations.
- definitionAnchor(name) returns the exact stable HTML anchor used for a root-$defs member, including arbitrary names. It is schema-def- followed by base64url of UTF-8 JSON.stringify(name). Quoting first preserves lone-surrogate distinctions. The root anchor is schema-root.
- SchemaMarkdownError carries code and location. formatVersion is0.6; dialect is the exact Draft2020-12 URI.

The implementation recognizes and shape-checks the keyword vocabulary listed below. This is not general JSON Schema meta-validation: regular-expression meaning, reference resolvability, custom vocabularies and format assertion remain the receiving validator's duties. Unknown assertion keywords refuse. x- prefixed members are preserved as annotation data, not executed. No0.5 parser or version migration is implemented: missing, wrong or malformed0.6 documents refuse rather than guess.

## Document and section grammar

A rendered document starts with one heading whose payload is a JSON string, then the exact marker Format: markdown-json-schema/0.6. The heading is display metadata only. There is exactly one Root schema section first, followed by zero or more named Schema sections. Blank lines separate structural elements. A CRLF input is accepted as LF; output is LF with one final newline. Other prose, headings, front matter, HTML or fences are refused.

The root header is exactly the two lines below. A named header uses the exact definitionAnchor(name) result followed by ## Schema: and the JSON-string name. Definition names may be empty, reserved Type words, Unicode, whitespace, pointers, punctuation or escaped newlines; duplicate decoded names refuse. The codec emits deterministic explicit anchors instead of relying on collision-prone Markdown heading slugs.

```text
<a id="schema-root"></a>
## Root schema

Value: object
```

Value is object, true or false. object means the schema value is a JSON object; it does NOT insert type:object. A boolean schema cannot carry object tables/settings/definitions. Empty object schema and true are kept structurally distinct.

Definitions: present may occur once on the object root. It records that the root $defs member exists, even when empty. Every following named section becomes one member of that map. Named sections without the marker refuse. An absent marker and no named sections leave $defs absent. Nested $defs is an Advanced clause within its actual containing schema, never hoisted.

Object sections may contain, at most once each: Other fields setting, Required order setting, Keywords table, Properties table and Advanced block. Settings/tables apply only to their own section; duplicate ownership refuses. Canonical output orders Value, Definitions, Other fields, Required order, Keywords, Properties, Advanced. The parser accepts those recognized elements in any order but does not infer data from unrecognized text.

## Field tables and arbitrary names

The version0.5 five-column header remains:

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "destination" | ref "#/$defs/PostalAddress" | yes | "Notice" | "Where to send it." |

A Properties table is introduced by ### Properties. Presence of that table creates the properties keyword, including an empty map for a header-only table. Absence leaves properties absent; no root object/type/properties default is synthesized.

In0.6, Name is always a JSON-string literal, so every JSON property name is representable. Required is exactly yes or no. Meaning is either the absence sentinel — or a JSON string for the property's description. Defined by is — or a JSON value for its x-definedBy annotation; the familiar string origin is the common case, and other JSON annotation values remain literal. Empty string and the literal string — are quoted and are distinct from absence. title and all other field annotations remain in the field's explicit schema clause rather than being confused with the display heading.

All cells are plain text. Encode a cell by doubling every backslash, then escaping each pipe as backslash-pipe. Decode only those two Markdown escapes before parsing JSON/Type syntax. This retains JSON escapes and arbitrary backticks, pipes, newlines and whitespace inside quoted data. Raw newlines in cells and any other Markdown backslash escape refuse; no trimming occurs inside a JSON-string value. Structural surrounding cell spaces are layout. A literal row-ending pipe is required. Duplicate decoded field names or wrong headers/column counts refuse.

### Required presence and order

When present, Required order: followed by a JSON array records the exact required keyword, including [] and its original order. A listed property row must say yes exactly when its name is in that array. Names not locally declared in properties are permitted: ordinary composition can require a field defined by another branch. Do not fabricate extra rows for them.

Without Required order, yes rows lower to a required array in row order; no yes rows leave required absent. Canonical rendering writes the explicit setting whenever a schema with properties has required, so reverse output never loses empty presence or reorders the array. A required keyword without a properties table stays an ordinary Keywords row. A Keywords required row together with a Properties table is refused to avoid two authorities.

### Other fields setting

Other fields: allowed lowers to explicit additionalProperties:true; Other fields: not allowed lowers to false. Omission leaves that keyword absent. This deliberate0.6 presence rule preserves a distinction that0.5 normalized away. A schema-valued additionalProperties stays in Advanced. The setting and an Advanced additionalProperties clause cannot both occur. Unevaluated-property closure is never substituted for additionalProperties, or vice versa.

## Inline Type expressions

Simple field schemas use the existing readable Type vocabulary, with explicit lossless additions:

| Type expression | Exact schema JSON |
| --- | --- |
| text | {"type":"string"} |
| number, integer, boolean, null, object, array | Object with that exact type string. |
| Url | {"type":"string","format":"uri"} |
| any | {} |
| true or false | The corresponding boolean schema value. |
| ref followed by a JSON string | Object with only $ref set to that exact string. |
| Name | Local shorthand {"$ref":"#/$defs/Name"} for the old identifier spelling. |
| array of T | {"type":"array","items":schema(T)} |
| A OR B | {"anyOf":[schema(A),schema(B)]} |
| schema | A placeholder for the matching hard field clause in Advanced properties. |

array of binds more tightly than OR. Parentheses preserve grouping. OR is inclusive; it never means oneOf. Nested anyOf arrays are NOT flattened. Canonical output uses explicit ref strings and parentheses where needed; a one-branch anyOf, array-valued type or any other structurally different schema uses the hard-clause representation rather than normalizing into a similar expression. Reserved words can still be definition names via explicit ref strings. Local shorthand lowers literally; neither it nor explicit refs are a schema-resolution or fetch operation.

Field description and x-definedBy live only in their cells and are reattached alongside the lowered schema. Boolean field schemas cannot carry object annotations. If other constraints/annotations prevent exact inline expression, Type is schema and the corresponding Advanced properties entry holds its remaining schema. A simple Type plus a residual for the same field refuses. Thus a constrained string remains constrained rather than becoming an unconstrained text row.

Url records a format annotation. It does not imply HTTP(S), trigger a fetch or claim a format-asserting validator was run.

## Keyword tables

### Keywords uses this exact header:

| Keyword | JSON value |
| --- | --- |
| $schema | "https://json-schema.org/draft/2020-12/schema" |
| $id | "https://schemas.invalid/bundle.json" |
| type | ["object","boolean"] |
| minLength | 1 |
| dependentRequired | {"start":["end"]} |
| description | "Arbitrary text\\nincluding pipes and blanks." |

The usual keyword token is plain text. A keyword name outside the token spelling [A-Za-z$][A-Za-z0-9_$-]* is a JSON string; this allows arbitrary x-annotation names without breaking rows. Duplicate names are checked after decoding. JSON value is one complete JSON value, with the cell escaping above. Strict JSON parsing rejects duplicate decoded object keys, invalid literals, trailing input and nonfinite numbers. Every authored numeric literal, including numbers nested in data values or Advanced blocks, must retain its decimal value when converted to the codec’s finite JavaScript Number and emitted again. The codec compares normalized decimal coefficients/exponents without expanding powers of ten; differing values, overflow and underflow refuse with E_PRECISION. Equivalent spellings such as 1.0 and 1e0, ordinary 0.1 and negative zero are admitted. For example, 9007199254740993 and 1e-400 refuse rather than silently becoming 9007199254740992 and0. Empty/default values are preserved, not omitted.

Keywords owns all non-schema-valued keywords and annotations. Supported groups are:

| Group | Keywords |
| --- | --- |
| Identity, references and descriptive strings | $schema, $id, $ref, $anchor, $dynamicRef, $dynamicAnchor, $comment, title, description, format, pattern, contentEncoding, contentMediaType. |
| Type and exact values | type as a valid string or nonempty unique type array; const as arbitrary JSON; nonempty enum with distinct JSON values. |
| Numeric constraints | minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf. Values are finite numbers; multipleOf is positive. |
| Nonnegative integer constraints | minLength, maxLength, minItems, maxItems, minContains, maxContains, minProperties, maxProperties. |
| Boolean constraints/annotations | uniqueItems, readOnly, writeOnly, deprecated. |
| Dependency/data annotations | required when no property table, dependentRequired string-array map, default, examples array, $vocabulary boolean map, arbitrary x- annotation values. |

$schema may be absent or exactly the selected Draft2020-12 URI; no dialect is inserted if omitted. Other dialects refuse. $id and reference strings are retained exactly, including relative nested resource IDs and external fragments. A $ref with siblings is not replaced with its target and its siblings are not dropped. Formats, patterns, anchors and vocabulary semantics are not guessed from strings.

This keyword-shape boundary is explicit: it is not a second meta-schema implementation or proof that all keyword interactions are satisfiable. For example a valid but impossible allOf remains impossible; the codec must not repair it. Assertion/admission belongs to the receiving JSON Schema evaluator.

## Advanced schema clauses

### Advanced contains exactly one fenced json-schema JSON object. It owns only structural schema-valued keywords:

- Single schemas: items, contains, additionalProperties, unevaluatedProperties, unevaluatedItems, propertyNames, not, if, then, else, contentSchema.
- Nonempty ordered schema arrays: allOf, anyOf, oneOf, prefixItems.
- Schema maps: patternProperties, dependentSchemas, nested $defs, and the residual complex properties map described below.

Each object/boolean subtree retains its complete literal schema at its original position, including nested resource identity and references. Keyword-shape checks recurse through these trees. Cross-field conditions are not converted into unconditional Required cells. Branch order, paired if/then/else presence, contains bounds and closure operators stay exactly where authored. Neither allOf of closed schemas nor unevaluatedProperties may be flattened into an apparently equivalent fixed table.

```json-schema
{
  "allOf": [
    {"$ref":"#/$defs/OpenMembers"}
  ],
  "if": {"required":["kind"],"properties":{"kind":{"const":"link"}}},
  "then": {"required":["source"]},
  "unevaluatedProperties": false
}
```

The Advanced block is a residual, not a raw-schema escape hatch for a whole document. It cannot contain root $defs, $id, $schema, type, title, description, required, constraints or other keyword-table fields. Root definitions must be named sections; ordinary fields must be tables. An Advanced properties map may contain exactly the fields whose Type is schema, and each such row must have one matching residual. Its child schema excludes description and x-definedBy because those are already owned by cells. Missing/orphan clauses, duplicate annotations or an ordinary Type plus residual all refuse. A nested subtree inside an actually hard operator remains literal; it is not recursively transformed into a competing table authority.

The renderer consistently emits table-first forms whenever they are exactly representable. It uses Advanced for hard operators and constrained/annotated field schemas that cannot fit the inline Type form, not as a complete root JSON wrapper. Arbitrary named scalar, array, map, boolean and composed definitions are therefore expressible without requiring every definition to be an Object or Allowed-values set.

## Exact reconstruction and canonical display

The parser reconstructs each schema section from disjoint authorities: keyword table, explicit closure setting, property rows plus exact required order, and advanced residuals. It rejects any overlap. It then places named schemas back into the original root $defs map. No identities or references are rewritten. Forward table authoring can use yes/no Required inference, but canonical reverse rendering always records the explicit presence/order needed for an exact parsed-value round trip.

For canonical output, property and definition names and keyword rows sort deterministically by JavaScript UTF-16 code-unit order. Schema arrays and all data arrays remain in input order. Object map order is not part of parsed JSON equality. This differs from a byte-identical source JSON/Markdown reproduction promise: whitespace, JSON escape spelling, number spelling and source object-key order may change. Annotation/value strings and number values themselves must not change. Negative zero is emitted as -0, not silently changed to0.

The codec admits at most16MiB Markdown output/input and128 levels of JSON/schema nesting. An inline Type expression is additionally limited to65536 UTF-16 code units,128 parenthesis levels,128 recursive parse levels (the initial expression is level0), and4096 parse nodes including the initial expression. These bounds are checked before recursive parsing; excess complexity refuses with E_LIMIT. Rendering uses the existing schema placeholder and Advanced property form when a supported schema would exceed an inline bound, preserving its data rather than emitting unparseable shorthand. Parsed-JSON-only input excludes functions, undefined, symbols, nonfinite numbers and custom JavaScript objects. renderSchema starts from parsed values; it cannot recover or detect precision already lost by a caller’s earlier JSON parser. parseSchema checks the authored numeric lexemes before parsing, as specified above. It does not invoke a schema fetch or an evaluator as a side effect of rendering/parsing. Limits are this authoring tool's bounds, not new BDP wire limits.

## Refusal rules and diagnostics

| Code | Boundary |
| --- | --- |
| E_VERSION | Explicit0.6 marker is missing/wrong; no inferred0.5 migration. |
| E_DOCUMENT | Bad document/section/value marker, extra prose/HTML, unclosed or wrong fence. |
| E_TABLE | Wrong header/columns/separator/cell escape or Required spelling. |
| E_NAME | Definition/property name or exact generated anchor mismatch. |
| E_TYPE | Malformed/unbalanced Type expression or non-string ref operand. |
| E_JSON | Invalid JSON value, duplicate-free scanner syntax failure, nonfinite/non-JSON JavaScript data. |
| E_PRECISION | Authored numeric literal would round, overflow or underflow in the finite Number representation. |
| E_DUPLICATE | Repeated decoded JSON key, table name, section or authority. |
| E_OWNERSHIP | Whole-schema/raw-definition bypass, orphan/missing residual or conflicting structural surface. |
| E_REQUIRED | Explicit required array disagrees with property Required cells. |
| E_SCHEMA | Wrong keyword value shape or invalid object/boolean carrier. |
| E_KEYWORD | Unsupported keyword; unknown semantics are never silently discarded. |
| E_DIALECT | Unsupported schema dialect. |
| E_OPTIONS | Unknown renderer options or non-string display title. |
| E_LIMIT | Source nesting or Markdown size exceeds the stated tool bound. |

Location identifies the section/keyword or local parsed source position; no exact original JSON line-offset fidelity is promised. Only decoded schema data enters the output. An error never produces a partial “replacement” schema. Ref strings are preserved as data rather than pre-resolved, so unresolved external schema meaning is not a successful validation claim.

## Original0.5 gaps and current BDP source coverage

The original audit concerned a historical158-definition bundle. Current selected common v0.1 has212 definitions and2,427 schema nodes. Its vocabulary was inventoried before this implementation; source bytes remain unchanged. These are source counts, not a provider/Type conformance statement.

| Original gap |0.6 representation and boundary |
| --- | --- |
| Whole bundle had $id/$defs without a root Object | Value:object plus exact identity Keywords and root named sections; no injected type/object or split publication. |
| Only named Objects/Allowed-values sets | Any named schema object or boolean, including scalar, array, map, ref or composition. |
| General allOf/oneOf/anyOf and closure | Literal hard clauses; exact branch arrays and unevaluatedProperties, with no closure flattening. |
| if/then/else/not and dependentRequired | Literal schema operators and explicit dependency-map keyword value. |
| Inline const/enum and nested annotations | Exact keyword data or literal hard subtree; no named-choice normalization. |
| Patterns, bounds, uniqueness and counts | Explicit constraint rows; applicability remains native JSON Schema semantics. |
| Dynamic names and typed extra values | JSON-string field names, propertyNames/patternProperties and schema-valued additionalProperties. |
| Type arrays, independent titles, formats, comments/defaults | Literal keyword values and arbitrary annotation text with absent/empty distinctions. |
| Recursion and external references | Original $id/ref/anchor graph remains literal; no fetch/rebase/resolution claim. |
| Source/proof comparison | Whole-bundle and intrinsic2 parsed-value comparisons, not a relabeled set of old fragment or provider receipts. |

The [pure Node unit](../../scripts/markdown-schema.node-test.mjs) and [fixtures](../../fixtures/markdown-schema/) exercise complete common-bundle projection, four intrinsic2 property schemas, handwritten lowering, nested identities and hard clauses, arbitrary names/annotations, omission/order/boolean preservation, and deliberate malformed/ownership/refusal controls. This is an implemented finite source codec and test corpus, not a production converter service, general meta-validator, Type DSL compiler, provider/runtime or whole-standard interoperability claim. Original0.4/0.5 evidence remains pinned to its own source. Profile-specific entry selection and generated companion/index integration belong to their receiving owner.

## Remaining work

Source/projection changes need paired grammar, codec and refusal/positive fixtures. Root's integration will publish the one faithful common companion and selected Read/Write entry indexes. The Type DSL can delegate schema clauses through the exported API while retaining its own Type identity/admission rules. No whole-spec format migration, OpenAPI0.4 upgrade, schema instance evaluator or production service is authorized by this draft.
