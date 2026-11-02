# BDP Markdown OpenAPI appendices

Edition 0.5 draft. This BDP-specific notation replaces the imported static-path
OpenAPI0.4 experiment. Its original text is retained in Git history, not as a
second current API specification. It is not a general lossless OpenAPI converter.

Each profile ends with its JSON Schema definitions, followed by an OpenAPI
appendix. The appendix declares operation families in readable Markdown tables.
The generator projects these tables plus Core's common native HTTP rules into an
[OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html) catalog. There is one
current catalog. Synthetic fixture paths are test inputs, not deployment routes.

## Operation boundaries

A family begins with a complete-line HTML comment `bdp-operation:start NAME` and
ends with the matching `bdp-operation:end NAME` comment. The comments only delimit
visible Markdown; they do not hide the contract. NAME is an ASCII letter followed
by ASCII letters or digits. Delimiters inside fenced examples are not operations.
Nested, duplicate, missing and malformed boundaries are errors.

Each block has `### Operation: NAME`, then a two-column `Field | JSON value`
table. JSON values appear in code spans and retain JSON types. Literal vertical
bars inside a JSON value use the JSON escape `\u007c`, not a Markdown separator.

Required fields are `id`, `methods`, `navigation`, `problem`, `codes` and
`continuation`. `id` matches NAME; `methods` is a nonempty unique array drawn from
`get`, `head`, `post`. `navigation` describes actual discovery or canonical-Resource
selection, with `role` required. `problem` names a shared schema definition, `codes`
lists applicable Problem codes, and `continuation` records the request family's
continuation rule. `request` and `response` name shared definitions; a response
array denotes explicitly selected alternative representations. A missing/null
response does not invent a JSON body.

Optional `optional` states the exact support condition; absence means required
Core. `kind` and `collection` carry point-subject/item metadata. Boolean fields
`history`, `versions`, `projection`, `aggregate`, `alias`, `landing`, and `event`
select the corresponding shared Core/Events HTTP rules. `forbiddenHeaders` is a unique array of header-name strings listing
response headers this operation cannot acquire. Unknown or duplicate fields fail.
Events families must live in Events and state optional advertisement explicitly.
These fields select documented rules; they cannot waive authorization or admission.

## Parameters

A six-column table follows: `Parameter | Location | Required | JSON Schema |
Meaning | Parsed schema`. Location is `query` or `header`; Required is `yes` or
`no`. JSON Schema is an inline JSON value, normally a primitive constraint or a
reference to a visible schema definition. Meaning is prose; an em dash means
empty. Parsed schema is an optional JSON reference for a JSON-encoded query value;
an em dash means none. Duplicate location/name pairs fail.

Operation-table `$ref` values resolve from the generated catalog base
`specs/openapi/`, not from the profile Markdown file. Schema fragments retain
their separate bundle reference context. Constraints remain on the serialized parameter unless explicitly identified as
its parsed representation.

## Projection and composition

BDP follows discovered URLs. The catalog therefore has empty `paths` and reusable
`components.pathItems` with `x-bdp-navigation`; it does not fabricate production
routes. Each emitted operation cites the actual source block and input digests.
Shared media, conditional reads, bodyless HEAD/304/412, native 405/406/500, Problem
media, kind/owning-Scope metadata and authorization-dependent caching come from
Core's HTTP binding. POST uses required Idempotency-Key and the selected Write
request/result. An implementation cannot claim conformance from generation alone.

Write's id-root1 composition uses the three existing create/batch signatures and
its separate schema resource, never a new endpoint. Types documents its existing
feature/media composition without inventing lifecycle routes. Proposed Transfer
has no selected native wire contract and emits no route. Optional capabilities
remain conditional; this notation creates no new base profile literal.

## Checks

`node scripts/generate-openapi.mjs --check` compares deterministic artifacts with
the visible source. `node --test scripts/openapi.node-test.mjs` checks references,
HTTP/media/HEAD rules, optional support, fixture bindings and negative cases.
Schema parity is checked separately by `scripts/spec-schema-fragments.mjs`.
Neither command is an external OpenAPI meta-schema evaluator or a live provider
qualification. The generated fixture lives under fixtures/openapi; only the
catalog under specs/openapi is a current API artifact.

## Feature composition tables

A complete-line `bdp-composition:start NAME` / `bdp-composition:end NAME` pair
owns a visible Field/JSON value table. As with operations, fenced examples and
review comments cannot supply a composition; hidden, duplicate, malformed or
unrecognized source fails closed. The closed fields are `id`, `media`,
`capability`, `version`, `operations`, `responseSchemas` and `selection`.
`operations` explicitly lists existing families; it cannot create one.
`responseSchemas` maps full ordinary output families to definitions in the
feature's schema resource. Other selected families retain their operation shape
and the feature's prose obligations; no evaluator/conformance claim follows.
The current selected composition is Types1; Transfer has no native composition.
