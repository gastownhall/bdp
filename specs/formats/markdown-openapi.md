---
type: Specification
id: ""
status: draft
version: "0.4"
---

# Markdown API tables for OpenAPI

> **Imported draft format specification.** The BDP comparisons and test receipts below describe the original pinned Memory experiment. They do not describe current BDP main or qualify this imported copy. See [status and provenance](README.md).

This is a **Specification** work product. Its Bead title is the heading above and this Markdown is its body. No Bead or Link has been created from this file.

## Purpose and boundary

This sister format gives people a compact, editable view of ordinary HTTP operations while translating a deliberately small subset of [OpenAPI 3.1.2](https://spec.openapis.org/oas/v3.1.2.html) in both directions. It **uses the Type-expression and schema-table rules** in [Markdown schema tables for JSON Schema version 0.5](markdown-json-schema-v0.5.md); it does not redefine JSON Schema. OpenAPI 3.1's Schema Objects align with JSON Schema Draft 2020-12. A feature outside this subset is reported as unsupported, never omitted or guessed.

The first cut covers API title/version/description, static server URLs, operations, simple path/query/header/cookie parameters, JSON or other single-schema request and response media types, response headers, and reusable component schemas. It intentionally leaves authentication mechanisms, callbacks, webhooks, operation links, custom parameter serialization, examples, XML and multipart encoding, and behavioral rules such as HTTP decision precedence to their source specifications. This is a projection format; a rendered OpenAPI file does not become normative merely because it exists.

## Document shape

An API document starts with `# API: Name`, where `Name` is a nonempty, one-line title. Then, in this order:

```markdown
# API: Widgets

OpenAPI: 3.1.2  
API version: 1.0

One optional, single-line description of the API.
```

`OpenAPI` is exactly `3.1.2`. `API version` is a nonempty, author-chosen one-line string. The heading maps to `info.title`, the version line to `info.version`, and the optional paragraph to `info.description`. These are separate from the Specification Bead's own `Status` and `Version` labels. The generated OpenAPI object has `openapi`, `info`, and `paths`; it has no `jsonSchemaDialect`, so Schema Objects without an explicit `$schema` use the OAS 3.1 default dialect. Inline companion output retains its explicit Draft 2020-12 `$schema` and title; that explicit dialect governs the component schema. Sections appear in this order when present: `## Servers`, `## Schemas`, then one operation section per method and path. Blank lines separate headings, setting blocks and tables. Within a setting block, consecutive setting lines are adjacent; every nonfinal line ends with exactly two spaces for a Markdown hard break, as illustrated. Canonical reverse output uses that layout. Section and table syntax is exact; no hidden frontmatter is used. Ordinary table cells use the companion’s pipe/backslash escaping and one-line plain-text restrictions. Reverse projection refuses values that cannot be represented: schema values use `E_SCHEMA`, other OpenAPI fields use `E_OPENAPI`. An absent optional table-cell description renders as `—`; absent paragraph descriptions are omitted. Present empty/blank descriptions are refused, and a literal-sentinel table-cell description is refused rather than collapsed into absence.

`## Servers` has this table and at least one row:

| URL | Meaning |
| --- | --- |
| https://api.example.test/v1 | Production API. |

Each URL is a nonempty absolute URI without server variables. `Meaning` is plain one-line text or `—`. Rows map in order to `servers` entries with `url` and optional `description`. If the section is absent, omit `servers` (OpenAPI's default server is `/`).

`## Schemas` has this table and at least one row:

| Name | Source |
| --- | --- |
| Widget | Markdown: schemas/Widget.md |
| Problem | JSON: schemas/bdp-v0.schema.json#/$defs/readProblem |

`Name` follows the companion DSL's schema-name rule. `Markdown: path` names a relative `.md` file provided with the API document; it must be a valid companion-DSL document whose root heading is exactly `# Name`. Convert it by that Specification and put its resulting schema inline at `components.schemas.Name` only if the generated schema contains no local `$ref` in a schema position. Otherwise refuse with `E_SCHEMA`: this version has no reference relocation contract. The check follows schema positions, not literal data such as descriptions or enum values. Unreferenced `$defs` are allowed. Standalone companion `#/$defs/...` references resolve against the OpenAPI document root when embedded without a nested `$id`, not against the component object. Do not silently rewrite them or invent a nested `$id`. `JSON: uri-reference` creates a component Schema Object containing only `$ref` with that URI-reference; it does not dereference or weaken the target. A relative path or URI is resolved against the generated OpenAPI document's location. Component names are unique. No other component kind is supported. When reverse-projecting an inline supported component schema, write its canonical companion Markdown to `schemas/Name.md` and list `Markdown: schemas/Name.md`; for a `$ref`-only component, list `JSON: ref`. An inline component’s title must equal its component key; missing or unequal titles cause `E_SCHEMA`, rather than silently renaming it. If a component cannot be reverse-projected by the companion DSL, refuse it rather than serializing a partial Markdown schema. The reverse result is a **bundle**: API Markdown plus zero or more companion Markdown files.

## Operations

Each operation heading is `### METHOD /path`, where METHOD is `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, or `TRACE`; path begins `/` and uses OpenAPI `{name}` templates. No method/path pair repeats. Template-equivalent paths differing only in placeholder names are refused with `E_OPERATION`. Operation sections are sorted by path and then method in canonical output. An operation has these lines in order:

```markdown
### GET /widgets/{id}

Operation ID: readWidget  
Summary: Read one widget

Optional one-line operation description.
```

`Operation ID` is required, nonempty single-line text without Markdown formatting, and unique across the API; `Summary` and the plain description paragraph are optional. They map to `operationId`, `summary`, and `description`. The optional paragraph precedes any operation tables. Every operation has exactly one `#### Responses` table; the other tables are optional and appear in the order below. Empty tables are omitted.

### Parameters

```markdown
#### Parameters

| In | Name | Required | Type | Meaning |
| --- | --- | --- | --- | --- |
| path | id | yes | text | Widget ID. |
| query | include | no | boolean | Include details. |
```

`In` is `path`, `query`, `header`, or `cookie`; `Required` is `yes` or `no`; path parameters must say `yes`. `Type` follows the companion DSL's Type-expression grammar; a named Type must resolve to a row in `## Schemas`. `Meaning` is plain one-line text or `—`. Each row maps to one operation-level Parameter Object with `in`, `name`, `required` (always emitted), `schema`, and optional `description`. There are no path-item-level parameters, parameter `$ref`s, styles, explode settings, content-based parameters, examples or defaults in this subset. A placeholder `{name}` must have exactly one matching path parameter row, and a path parameter must have a placeholder. Duplicate `(in, name)` rows are rejected.

### Request body

```markdown
#### Request body

Required: yes

| Media type | Type | Meaning |
| --- | --- | --- |
| application/json | Widget | Widget to create. |
```

`Required` is `yes` or `no`. Every row has a nonempty media type and companion-DSL Type expression. All rows have the same `Meaning`; `—` means no description. Rows map to `requestBody.content[media].schema`. The shared Meaning maps to optional `requestBody.description`; `required` is always emitted. Duplicate media types are rejected. No encoding or media-type example fields are supported.

### Responses

```markdown
#### Responses

| Status | Meaning | Media type | Type |
| --- | --- | --- | --- |
| 200 | Found. | application/json | Widget |
| 404 | Not found. | application/problem+json | Problem |
| 204 | No content. | — | — |
```

`Status` is a three-digit HTTP status or `default`; at least one row is required. `Meaning` is nonempty one-line text and maps to the Response Object's required `description`. A bodyless response has `—` in both Media type and Type. A response with content has a nonempty media type and a companion-DSL Type expression. Rows with the same Status must have the same Meaning and distinct media types; they combine into one Response Object with one `content` map. A bodyless row cannot share a Status with a content row. The Type maps to each Media Type Object's `schema`. Status and media rows are sorted lexicographically in canonical output, with numeric statuses before `default`. No response examples or OpenAPI Link Objects are supported.

### Response headers

```markdown
#### Response headers

| Status | Name | Required | Type | Meaning |
| --- | --- | --- | --- | --- |
| 200 | ETag | no | text | Current entity tag. |
```

The Status must occur in Responses. Each row maps to that Response Object's `headers[Name]` Header Object with `required` (always emitted), `schema`, and optional `description`; HTTP header names are compared case-insensitively for uniqueness. In this subset, a header has no `content`, style, examples, default or `$ref`.

## Type expressions and references

Use the companion Specification's exact Type-expression syntax and JSON Schema mapping (`text`, `number`, `integer`, `boolean`, `null`, `Url`, `array of`, `OR`, parentheses, and named types). A named type inside an operation maps to `$ref: "#/components/schemas/Name"`, rather than the companion document's local `$defs` URI. Inline Markdown component schemas containing local `$ref` in a schema position are refused in both directions. A reverse inline component is subject to that check before extraction; local-reference relocation requires a later explicit design. Use an external `JSON:` component reference when the source schema needs to retain its own document resolution context. References to an undeclared component name fail. A component's external `JSON:` URI is not copied into every operation field; operation fields point to the named component.

Any OpenAPI Schema Object encountered in a Parameter, Request Body, Response or Header must be a companion-DSL Type expression shape or a local `$ref` to a declared component. All other shapes are unsupported here, even if valid OpenAPI. A direct external `$ref` in an operation must first be named in the Schemas table. A `Markdown:` component must pass the companion DSL's own translation or reverse-projection rules; this sister spec does not expand that DSL's coverage.

## Reverse projection and comparison

Reverse projection accepts only an OpenAPI object whose `openapi` is `3.1.2` and whose members match the subset above. The root may contain `openapi`, `info`, `servers`, `paths`, and `components` only. `info` contains `title`, `version`, and optional `description`. `components`, if present, contains `schemas` only. Each Path Item contains only supported HTTP methods; no path-level fields. Each Operation contains `operationId`, optional `summary`/`description`, optional `parameters`/`requestBody`, and required `responses`. Extra OpenAPI fields or Specification Extensions cause refusal. A Request Body must have a nonempty `content` map; an empty or absent map is refused with `E_OPENAPI`, preserving its required flag and description rather than losing them. Empty `servers`, `components.schemas`, `parameters`, `headers`, and Response `content` are normalized away in canonical output; do not use this format when the presence of an empty object itself matters.

The reverse projection prints the effective `Required: no` when a Request Body omits `required`; likewise a Parameter or Header missing `required` prints `no`, except path parameters, which must explicitly contain `required: true`; absent or false is refused with `E_OPENAPI`, never repaired. It prints `—` for absent optional descriptions in table cells. A Response must have a nonblank description; absent or blank descriptions are refused with `E_OPENAPI`. It sorts component names and operation rows but preserves Server and Parameter array order. Response rows follow the canonical status/media order given above. The reverse projection preserves Parameter array order. Response headers are object members, not an array: render their rows by the canonical response-status order, then by header name in Unicode code-point order using the authored spelling. Case-insensitive duplicate names remain an error; JSON object-key order carries no promise. It writes LF line endings and one final newline. When converting forward again, parsed JSON object-key order is immaterial; array order, member presence except the listed empty/default normalizations, text values, and referenced schema semantics are significant. The test harness compares the entire output bundle, including companion schema files.

The exact subset excludes `security`, `tags`, `externalDocs`, `deprecated`, `servers` with variables or operation overrides, callbacks, webhooks, links, examples, OAuth flows, multipart encoding, request/response media-type details beyond `schema`, parameter serialization controls, path-item `$ref`, and arbitrary OpenAPI vendor extensions. It also excludes OpenAPI documents at another version. For any such input, report an unsupported feature and its JSON Pointer or Markdown line; do not produce a lossy result. Do not infer an authentication scheme from a prose mention of authorization.

## Refusal and comparison rules

Use `E_TABLE` for malformed or contradictory Markdown headings, setting lines, tables or cells, including repeated response-status rows with conflicting Meaning; `E_OPERATION` for duplicate/invalid operation IDs, method/path pairs, or path-parameter mismatch; `E_REF` for an unknown component name or missing companion file; `E_SCHEMA` for an unsupported Type expression, an unsupported Schema Object found during reverse projection (including in a Parameter, Request Body, Response, or Header), or a component rejected by the companion JSON DSL; and `E_OPENAPI` for an unsupported or contradictory **OpenAPI input** structure other than a Schema Object. The category follows the offending construct: an unsupported `oneOf` inside a response schema is `E_SCHEMA`, even though it arrived inside an OpenAPI document. Return the first error in API document order with its Markdown line or JSON Pointer. A companion failure is wrapped as `E_SCHEMA` and includes the companion path and its local line or pointer; visit companions when their Schemas row is encountered, in table order. A test result is either a complete projection or one such error, never partial output.

Compare forward OpenAPI outputs as parsed JSON: object-key order does not matter, but array order does. Compare reverse Markdown bundles after normalizing line endings to LF and requiring one final newline for each file; other text and row order are significant. The reverse Markdown is canonical, so a Markdown→OpenAPI→Markdown pass may normalize whitespace, row order and companion file paths to `schemas/Name.md` without losing schema semantics. Relative `JSON:` reference strings retain their source-document resolution base; moving the generated API document requires explicit relocation outside this projection, not a silent URI rewrite. A JSON Schema validator can separately exercise sample instances but does not replace structural comparison of projections and annotations.

## Version 0.4 audit delta

This revision refuses inline component references until an embedding contract is selected, applies the companion version 0.5 lexical checks, fixes response-header ordering language, and refuses empty-content Request Bodies. The prior blinded stress receipts below belong to the earlier exact Specification pair; they have not been rerun or relabeled as qualification of this revision. Reference rewriting versus a stable schema-resource identity remains an explicit future choice.

The output API Markdown filename is not selected by this Specification; bundle packaging must supply it while retaining the source-document resolution base. No automatic relocation is claimed.

## BDP projection caveat

BDP Core and Write do not currently contain an OpenAPI document to reverse-project. They define normative prose and one normative JSON Schema bundle. A generated OpenAPI description is non-normative and can only cover the portion captured by OpenAPI operation/Schema Objects. Discovered URLs, arbitrary-depth Resource names, profile-conditional responses, query-combination rules, SSE replay, HTTP decision precedence, and an unspecified authentication mechanism must remain explicit gaps. The BDP schema bundle also exceeds the companion Markdown JSON DSL: use `JSON:` component references for it and report the companion-schema gap, rather than claiming that the Markdown tables round-trip its definitions.

## Round-trip findings and challenges

With historical version 0.3 of this Specification and companion JSON Schema version 0.4 supplied together, fresh Codex and Claude interpreters each matched 12 of 12 forward and 12 of 12 reverse stress cases exactly, including expected refusals. Two source-derived example slices from BDP Core and Write also passed both directions for both interpreters. Those slices demonstrate ordinary operation-table projection; they do not establish a complete BDP profile round trip. The BDP source pin for this exercise was `gastownhall/bdp` main `3ab9cdf5d45a2ea49a84ab191eac77c9aeaa19d0`.

| Area | Observed result or challenge | Current treatment |
| --- | --- | --- |
| Full-profile oracle | BDP main has no OpenAPI document. Core permits a generated OpenAPI description as non-normative tooling. | Refuse a full-profile PASS: there is no authoritative OpenAPI input to reverse-project or compare. |
| Passing BDP slices | A Core scope/discovery GET example and a Write operation-directory/sequence POST example each projected exactly in both directions for Codex and Claude. | Keep these as illustrative deployments, not replacements for Core or Write prose. |
| Discovery and resource identity | Scope, collection, operation, receipt, snapshot, feed, and continuation URLs are discovered. Resource IDs can have arbitrary depth. | Static path rows describe examples; they cannot encode the discovery contract or all Resource names. |
| Query and profile combinations | Repeated-key refusal, mutually exclusive selectors, revision/view/include combinations, and Read+Update versus Transactional envelopes depend on context. | Flat Parameter and Response tables cannot express those predicates; leave them in the source profile. |
| Streaming and HTTP state | SSE frames/replay, `Last-Event-ID`, conditional reads, HEAD/bodyless outcomes, 202 receipts, idempotency, error precedence, and mutation admission exceed a row's schema and status. | Do not infer state transitions or decision order from a generated operation table. |
| Authorization | BDP specifies authorization views but no universal bearer or API-key mechanism. | Do not invent an OpenAPI `security` scheme. |
| Shared schema bundle | Core and Write use the same normative 158-definition JSON Schema bundle. The companion Markdown DSL refuses the whole bundle and 143 of its isolated definitions. | Preserve a `JSON:` reference when appropriate; do not claim the companion schema is translated. |
| OpenAPI feature boundary | Callbacks, Link Objects, examples, alternate serialization, XML/multipart, and other OpenAPI structures fall outside the tested subset. | Refuse a source document using them instead of dropping members. |
| Interpretation and implementation | The final blind corpus passed only after both complete sister Specifications were supplied. Earlier attempts exposed an oracle error category, a Schema Object error-category ambiguity, and a test-instruction omission. | Keep the companion contract explicit. These are interpretation tests, not evidence of a general converter implementation. |
| OpenAPI description schema | The OAS-published JSON Schema **for** OpenAPI 3.1 descriptions contains dynamic references, patterned maps, conditionals, and evaluated closure. | The [meta-schema Markdown inventory](https://github.com/donnabox/memory-beads/blob/742e0025eb294a0d733c2ef0e945703f7325f965/experiments/meta-schemas/openapi-3.1.md) records a JSON-table DSL refusal. This OpenAPI operation DSL describes selected API documents, not their meta-schema. |

The [combined stress-test review](https://github.com/donnabox/memory-beads/blob/742e0025eb294a0d733c2ef0e945703f7325f965/experiments/meta-schemas/FINDINGS.md) compares these results with the JSON Schema meta-schema and BDP Core/Write tests.

## Depends on

| Title | Target | Status | Body |
| --- | --- | --- | --- |
| Schema table grammar | [Markdown schema tables for JSON Schema](markdown-json-schema-v0.5.md) | draft | Reuses the companion Type expressions and table grammar; this row is an authoring draft, not a live Link. |

## External sources

- [OpenAPI Specification 3.1.2](https://spec.openapis.org/oas/v3.1.2.html)

The external URL cites a published standard; it is not a `depends-on` Link target in this Bead scope.
