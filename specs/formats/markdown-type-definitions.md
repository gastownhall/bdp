---
status: draft
version: "0.1"
---

# Markdown authoring for Bead and Link Type definitions

This proposed format describes **Type definitions**, rather than arbitrary Bead or Link instances. A Bead-Type definition and a Link-Type definition are both definition **Beads**. Their own exact metatype affiliation is separate from the Type identity they define, and direct Refines declarations are owned Link records rather than a descriptor `refines` field. The [descriptor specification](../types/type-system/type-system.md) and [Types profile](../profiles/types/types.md) retain their meanings; this format supplies an editable representation and explicit file bindings.

The examples use the current [intrinsic-2 publication](../profiles/types/intrinsic-publication-2.md). They are not an installation package, public Type CLI, registration/default selection, transaction syntax or provider qualification. [Types1](../profiles/types/types-binding.md) retains its own selection and admission rules. The [experimental instance bundle format](../../experimental/formats/markdown-bead-bundles.md) is separate and acquires no new authority through this document.

## Two modes: authoring intent and recorded state

A document starts with `# Bead type: DISPLAY NAME` or `# Link type: DISPLAY NAME`, followed by these exact settings:

```text
Format: bdp-type-markdown-0.1
Mode: authoring
```

`Mode` is either `authoring` or `recorded`. The heading declares the instance category of the Type being described; it is not a stored `describes` field, Type identity, descriptor title or metatype affiliation. The display name may be changed without changing any emitted value. File and directory names likewise establish no identity.

Authoring mode describes a new definition and its requested direct declarations. The author supplies an exact metatype and exact parent pins but need not invent a Resource revision, declaration Link ID or Link revision. An optional definition `id` is a literal intended identity, not evidence of an allocation or permission to use it. An omitted `id` remains unresolved; this format selects no allocation or publication mechanism. An authoring document is not a complete stored Resource and MUST NOT be mislabeled as a lossless stored-graph import.

Recorded mode describes one already recorded exact definition Bead and its complete recorded owned state. Its definition ID/revision and every captured Link ID/revision must be explicit. These values are observations supplied by the source, not values minted from a heading, SemVer label, file path, digest or row number. Editing a recorded document does not authorize writing those same revisions with changed content; a subsequent mutation needs the ordinary separately selected protocol and authority.

## Projection envelope and document structure

The comparison output for authoring mode is an **authoring-only** object:

```text
{format, mode:"authoring", instanceKind:"bead"|"link", definition:{id?,type,properties,metadata?}, refines?:[DECLARATION_INTENT]}
```

`definition.type` is the definition Bead's own exact metatype Reference. Each declaration intent contains exact `type`, exact `target`, `properties` and optional `metadata`. Its source is the containing definition intent; no wire `source`, allocated Link identity, revision or BDP operation is invented. This `refines` member belongs only to this authoring envelope; it MUST NOT be copied into descriptor `properties`.

Recorded comparison output is:

```text
{format, mode:"recorded", instanceKind:"bead"|"link", record:COMPLETE_DEFINITION_BEAD}
```

Both envelope formats use `format:"bdp-type-markdown-0.1"`. They are comparison values for this notation, not a new BDP wire carrier. `instanceKind` describes the Type's instances; the value under `record` is always a Bead. The serialized descriptor is exactly `definition.properties` or `record.properties`.

Sections occur in this order when present: Definition; Descriptor; Properties schema; Schema resources; Selectors; Property access; Incoming; Outgoing; Owns outgoing; Link constraints; Endpoint pairs; Metadata; Revision provenance; Refines; Other owned links. A section occurs at most once. Section headings and table headers below are exact; explanatory prose is not another source of emitted fields. Unknown structural sections refuse rather than disappear.

### Table cells and literal values

Tables use ordinary Markdown pipes. Within cells, `\|` denotes a literal pipe and `\\` a literal backslash; decode those Markdown escapes once before parsing a cell's value. Unescaped internal pipes, ambiguous escapes and multiline cells refuse. Literal newlines and significant surrounding spaces in a value are expressed through its JSON string spelling, not layout whitespace. Known names may be written bare; a JSON-quoted name permits an arbitrary exact member name, including an empty or whitespace-bearing extension name. Different spellings that decode to the same key are duplicates and refuse.

Cells labeled JSON contain exactly one JSON value; they are not Markdown code spans. `—` in a cell explicitly defined as optional means absent, whereas the JSON string `"—"` is a present string. JSON `null`, `false`, `{}`, `[]` and `""` are values, never omission. Comparison uses the sibling codec's accepted parsed-JSON value domain, not the byte spelling of a JSON number token. Arbitrary-precision numbers and recovery of their original lexical spelling are not claimed; a reader unable to preserve authored precision must refuse instead of silently rounding and claiming a lossless projection. Literal JSON blocks below require one fenced `json` value and preserve all allowed members, rather than selecting a few familiar fields.

### Definition

```text
## Definition

| Field | Value (JSON) |
| --- | --- |
| id | "https://types.example/work-item" |
| type | {"uri":"https://github.com/gastownhall/bdp/types/type-system/bead-type","revision":"bead-type-2"} |
```

The allowed rows are `id`, `revision` and `type`, each at most once. `type` is required in both modes and is a closed exact `{uri,revision}` Reference: absolute HTTP(S) URI and nonempty opaque string token. In recorded mode `id` and `revision` are required; `id` is an absolute canonical Resource URI and `revision` is a nonempty opaque string. In authoring mode `revision` is prohibited and `id` is optional. A URI-only metatype input is not silently resolved to a local default.

Category agreement is checked using the exact metatype and accepted conformance context, never URI spelling. A conforming specialization may be a metatype when the applicable profile admits it; these examples use the assigned intrinsic-2 pins. A format reader lacking required semantic context can retain a well-shaped authoring intent without claiming Type admission. It must not certify a recorded value's category or conformance merely from the heading.

### Descriptor

```text
## Descriptor

| Field | Value (JSON) |
| --- | --- |
| description | "A work item." |
| version | "1.0.0" |
| abstract | false |
| x-review | {"stage":"draft"} |
```

Rows map directly to descriptor properties. `description` is text, including the empty string; `version` is the existing SemVer author label; `abstract` is Boolean. Omission preserves omission and does not insert `abstract:false` or another default. A label may repeat across exact revisions and cannot be used as an exact revision selector.

The current common descriptor is **open**, so other permitted members are preserved as literal JSON values in this table. This is not permission for unsupported required enforcement semantics. Reserved/obsolete members `id`, `revision`, `type`, `ownedLinks`, `conformsTo`, `refines`, `revisionProvenance`, `describes`, `source`, `target` and `pairUnique` refuse as descriptor fields. Bead-Type descriptors prohibit `linkConstraints`; Link-Type descriptors prohibit `incoming`, `outgoing` and `ownsOutgoing`. The dedicated members `propertiesSchema`, `schemaResources`, `propertyAccess`, `incoming`, `outgoing`, `ownsOutgoing` and `linkConstraints` use their sections below and cannot also occur in the Descriptor table. Unknown descriptive content is preserved or explicitly refused; it is never silently dropped or renamed.

### Properties schema and sibling schema documents

```text
## Properties schema

Source: Markdown: work-item-properties.md
```

This delegates specifically to the sibling [Markdown JSON Schema v0.6 notation](markdown-json-schema.md), selected by that supplied document's `Format: markdown-json-schema/0.6` marker. The sibling API is `parseSchema(markdown)` for the schema value and `renderSchema(schema,{title?})` for display; `definitionAnchor(name)` supplies its definition links. This format defines no second property-type, composition or JSON Schema keyword grammar. The sibling projection yields one object-or-Boolean schema value, which becomes `propertiesSchema`; schema annotations, resource IDs, relative references, composition and closure retain the sibling grammar's meanings. Display-title options follow that API's contract and cannot become a Type identity or descriptor field. The preserved [v0.5 notation](markdown-json-schema-v0.5.md) is historical and is not accepted by the v0.6 parser merely because both formats use tables.

`Source: JSON: properties.schema.json` instead names a supplied local file containing the complete literal schema value. It is a preservation route for schemas outside the currently selected Markdown subset, not permission to omit unsupported keywords. `Schema value: true`, `Schema value: false` or `Schema value: {}` may replace the Source line for those three exact neutral/Boolean forms. A section must contain exactly one of Source or Schema value. `null` is not a schema.

Every Source is an explicit authoring file binding relative to this document, within a supplied bundle. It is not a wire Reference, network retrieval instruction, Type identity or implicit JSON Schema base. The reader does not fetch missing files. It requires the actual supplied file, preserves the complete projected value, and reports an unresolved binding if absent. File-location normalization must not rewrite embedded `$id`, `$ref`, anchors or schema values. A reader unable to preserve the selected sibling grammar refuses that schema projection while retaining a clear diagnostic; it does not substitute an empty schema.

Omitting Properties schema omits `propertiesSchema`, as allowed by intrinsic-2. Explicit `true`, `false`, `{}` and absence remain distinct authored values; every inherited constraint still applies. A `false` schema does not become omission because it has no valid instances. Earlier exact metatype editions retain their own requirements, including intrinsic-1's required schema field.

### Schema resources

```text
## Schema resources

| Retrieval URI | Source |
| --- | --- |
| https://schemas.example/shared-fields.json | JSON: shared-fields.schema.json |
```

Rows form `schemaResources`, keyed by the exact absolute fragment-free retrieval URI. Values are complete schemas projected from the same supplied-file mechanism above, using Markdown or literal JSON. Duplicate keys refuse. A present header-only table emits `{}`; an absent section omits the member. Retain resource values' own `$id`, base, anchors, dialect and exact references; the retrieval key is not substituted for their identifiers. A relative external reference requires the descriptor profile's explicit applicable absolute schema `$id` base. The definition ID and file download location supply no implicit base.

Standard 2020-12 resources remain the implementation-provided baseline; application closure and conflicting bindings retain Types §3.12 admission checks. This table neither embeds missing application schemas automatically nor promises a complete valid closure merely because files exist. Missing or conflicting required resources must not trigger live network fallback.

### Selectors

```text
## Selectors

| Name | Match | Type URI | Revision (JSON) |
| --- | --- | --- | --- |
| references | family | https://types.example/reference | — |
| exact-notes | family | https://types.example/note | "note-2" |
| all-links | any | — | — |
```

Names are document-local `[A-Za-z][A-Za-z0-9_-]*` bindings, not Type identities. `family` rows with the same name form one `{"anyOf":[REFERENCE,...]}` selector, in row order. A URI with absent revision yields that URI string; a present nonempty string revision yields the exact closed `{uri,revision}` object. References must be distinct; no latest/default lookup or URI rewriting occurs. URI-only selectors range across the identity's applicable revisions/conformance, unlike an unpinned instance affiliation resolved at write admission.

An `any` row emits exactly `{"any":true}` and must be the only row for that name; its Type URI and revision cells are absent. `any:false`, mixing any/family rows and empty anyOf selectors refuse. Every referenced selector must be declared. An unused named selector is harmless editorial material and emits no descriptor member. Its use in a property below substitutes the canonical selector value, never a document-local name in stored output.

### Property access

```text
## Property access

| Pointer | Access |
| --- | --- |
| /referenceCode | init-only |
| /computedScore | service-managed |
```

Rows form the exact `propertyAccess` map. Pointers and modes follow the current descriptor: exact object-member JSON Pointers, standard escaping, whole-array designation, and writable/init-only/service-managed only. Duplicate pointers refuse; a present header-only table emits `{}`, while absence omits the map. No wildcard or per-array-element policy is introduced. A writable declaration cannot weaken an inherited restriction; conflicting supplier requirements and complete mutation behavior remain profile admission/enforcement questions.

### Incoming, Outgoing and Owns outgoing

Bead-Type definitions alone admit the following sections:

```text
## Incoming

| Selector | Min | Max |
| --- | --- | --- |
| references | 0 | 5 |

## Outgoing

| Selector | Min | Max |
| --- | --- | --- |
| references | 1 | — |

## Owns outgoing

| Selector |
| --- |
| references |
```

Each Incoming/Outgoing row becomes `{linkTypes:SELECTOR,min?:N,max?:N}` in its array, preserving order and duplicates. At least one bound is present; bounds are nonnegative exact integers, with `min<=max`. `—` omits that bound: omitted min has the existing zero meaning, while omitted max is unbounded. These effective meanings do not insert members into output. Multiple constraints remain conjunctive; no deduplication erases authored declarations.

Owns outgoing emits an array of **positive** selectors. Duplicate expanded selector values refuse under the current descriptor's uniqueness rule; no negative selection or ownership exclusion is introduced. Empty sections emit `[]`; missing sections omit their members. Effective ownership is the inherited/local positive union, independent of participation maxima. These rules govern instances of the described Bead Type; they are separate from the definition Bead's own owned Refines declarations below. Link-Type definitions do not gain these Bead-only fields.

### Link constraints and correlated endpoint pairs

Link-Type definitions require a nonempty Endpoint pairs table. Link constraints is optional and supplies only the listed local settings:

```text
## Link constraints

| Field | Value (JSON) |
| --- | --- |
| sourceMax | 4 |
| targetMax | 8 |
| unique | false |
| acyclic | true |
| allowSelf | false |

## Endpoint pairs

| Source kind | Source scope | Source selector | Target kind | Target scope | Target selector |
| --- | --- | --- | --- | --- | --- |
| bead | same | work-items | bead | either | notes |
| bead | same | notes | resource | — | — |
```

Each row emits one `{source:ENDPOINT,target:ENDPOINT}` alternative, in table order, under `linkConstraints.typeConstraints`. A bead endpoint emits `{resourceKind:"bead",scope:S,types:SELECTOR}` with explicit same/cross/either scope. A resource endpoint emits exactly `{resourceKind:"resource"}`; both scope/selector cells are absent. It represents the profile's opaque external-resource arm, not permission for a local Link endpoint. Unknown selector bindings and duplicate complete pair values refuse. Source/target values in one row are correlated; do not form a Cartesian product from separate columns or rows.

The remaining Link constraints rows map exactly to sourceMax/targetMax nonnegative integers and unique/acyclic/allowSelf Booleans, at most once. Other names, minima and `pairUnique` refuse; absent settings stay absent. Family-wide maxima and ordered-pair uniqueness use the profile's populations across alternatives, revisions and conformers. Acyclicity retains its **per-Link promise** with family-wide traversal; this format does not replace it with blanket whole-family DAG activation. Vertices and self-link comparisons use endpoint identity independently of pins. False unique/acyclic adds no local restriction; false allowSelf prohibits self-links, while true/omission adds no local prohibition. No local value removes an inherited rule. Refines' intrinsic exact-revision DAG/target-uniqueness rules remain distinct from generic acyclic/unique settings.

### Metadata and revision provenance

Metadata, when present, contains one literal JSON object and maps to the definition Bead's common `metadata`, not descriptor properties. A present `{}` remains distinct from an absent section. The corresponding exact/common record contract still determines whether absence is legal for a recorded source; this authoring syntax does not make a required record member optional or invent `{}` to repair missing state. An optional Revision provenance section is available only in recorded mode and contains the complete applicable JSON object under the ordinary `revisionProvenance` member. No author, commit time, provenance state or origin Scope is invented from the file. This format selects no creation-time provenance input or Activity workflow.

### Refines declarations

An optional `## Refines` section contains zero or more `### Declaration: LABEL` blocks. Labels are unique editorial names and emit no IDs. A declaration block has this table, followed by mandatory `#### Properties` with one literal JSON object and optional `#### Metadata` with one literal JSON object. Recorded blocks may additionally have `#### Revision provenance` with its exact ordinary object.

```text
### Declaration: base-work-item

| Field | Value (JSON) |
| --- | --- |
| type | {"uri":"https://github.com/gastownhall/bdp/types/type-system/refines","revision":"refines-2"} |
| target | {"uri":"https://types.example/base-work-item","revision":"base-1"} |
```

Both modes require exact type/target References. The Link Type must be Refines or an already accepted specialization; the target is an exact parent definition of the same described category. URI-only parents, numeric revisions, id/revision objects, aliases/default substitution and local file names in those persisted Reference positions refuse. Shape projection does not prove the Link Type's grounded acceptance, semantic conformance or exact closure availability.

In authoring mode the table permits only type and target. No source, id or revision is fabricated; the containing definition establishes the source intent. A present empty Refines section emits `refines:[]`; absence omits the authoring envelope's intent member. This does not claim that any live declaration already exists or decide how to create one.

In recorded mode the table additionally requires id, revision and source, each preserved literally. Source must have the containing definition's identity, with either the recorded floating URI or recorded exact pin; do not automatically replace its revision with the containing owner's revision. The containing definition edition's captured owned state remains authoritative. Group captured Link records in `ownedLinks` under their **actual nominal Link Type URI**, ignoring its revision only for the map key. Preserve each record's exact type/revision/endpoints/properties and optional metadata/provenance, and preserve row order within each bucket. The same exact record cannot appear twice. A base and specialized declaration to the same exact parent are semantic duplicates under the Refines family rule; different parent revisions remain distinct promises.

Recorded mode requires the Refines section even if it has no blocks. With no other owned Links, it emits `ownedLinks:{}`. `## Other owned links`, if present, contains one complete literal JSON object of the remaining captured nominal buckets, preserving exact records and order. It supplies a preservation route for other ownership imposed by an admitted metatype specialization; it does not declare new ownership. Buckets must be nonempty arrays of complete exact Link records whose actual nominal Type agrees with the bucket key; no wildcard or empty selector bucket is invented. No bucket may be split between this object and the declaration blocks; a known Refines-family declaration cannot be hidden here to bypass its rules. A reader lacking semantic family context cannot claim a complete certified Refines interpretation. The source must actually provide complete recorded owned state; missing source state cannot be repaired with an empty object or today's incident Links. Other owned links is prohibited in authoring mode, which describes new declaration intent rather than a captured graph.

## Errors and comparison

Projection either produces the complete comparison value or a diagnostic with document path, section/row (or literal JSON pointer), stable code and explanation. No partial output is a successful projection. Use the following codes; semantic verification unavailable from the supplied bundle remains explicitly unqualified rather than fabricated:

| Code | Condition |
| --- | --- |
| E_TYPE_DOCUMENT | Wrong/missing mode, duplicate/unknown structural section, or malformed table/block. |
| E_TYPE_FIELD | Duplicate decoded field, wrong value kind, reserved/obsolete descriptor field or category-invalid section/member. |
| E_TYPE_REFERENCE | Missing/invalid exact metatype, declaration type/parent pin, recorded envelope field or source identity mismatch. |
| E_TYPE_SCHEMA | Invalid schema value, unresolved file binding, unsupported sibling grammar or loss of schema resource identity/reference context. |
| E_TYPE_SELECTOR | Missing/duplicate selector binding, duplicate reference, invalid any/family mixture or duplicate positive ownership value. |
| E_TYPE_CONSTRAINT | Invalid participation bound, min>max, missing/duplicate endpoint pair or unknown Link setting. |
| E_TYPE_OWNED | Missing claimed recorded owned state, duplicate captured Link or known duplicate exact-parent declaration. |

When several errors exist, report the first in document order; validate a referenced supplied schema when its Source row is encountered. A sibling failure is wrapped as E_TYPE_SCHEMA while retaining its original code, file and location. A malformed exact record is not silently downgraded to authoring intent. Definition metadata and permitted open descriptor extensions survive in full; unsupported content refuses rather than disappears.

Comparison uses the accepted parsed-JSON values, ignoring object-key order and preserving array order and member presence. This is neither arbitrary-precision numeric interchange nor recovery of source numeric-token bytes; unsupported source precision must refuse rather than silently weaken the value. Do not insert defaults, flatten inheritance, rewrite pins, normalize URI spelling, turn omissions into empty collections, convert labels to tokens or infer schema resources from files. No byte-for-byte recovery of Markdown whitespace, table row layout or JSON whitespace is promised. Reverse rendering must choose one representable spelling for every value or refuse; that rendering algorithm and any Type-format converter implementation require separate design/evidence. There is no claim of a whole-spec or arbitrary graph round trip.

## Examples and authority

The [paired fixtures](../../fixtures/markdown-types/README.md) include new Bead/Link Type authoring examples and a recorded definition with an exact owned declaration. Literal expected descriptors, declaration intents and recorded values make the proposed mapping reviewable. Negative snippets distinguish syntax/shape diagnostics from separate provider admission obligations. They have not been executed by a converter or provider.

This notation does not register, install, choose a default, publish, revise, retire or mutate a Type. Exact schema/definition closure, authorization, category agreement, conformance, effective constraints, ownership, publication and lifetime behavior remain the [Types profile](../profiles/types/types.md) and ordinary Core/Write obligations. Type declarations and Type usage remain separate. Trish retains descriptor/profile meanings and eventual adoption; the proposed authoring representation supplies no new enforcement or lifecycle authority.
