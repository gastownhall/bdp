# Markdown authoring formats

These draft format specifications originate in the Memory experiment. BDP keeps editable copies here so its schema and HTTP documentation can use a consistent notation. Their presence does not change BDP wire contracts or make the full protocol expressible in either DSL. The current normative protocol remains in the [specification index](../README.md).

| Format | Edition | Boundary |
| --- | --- | --- |
| [Markdown schema tables for JSON Schema](markdown-json-schema.md) | 0.6 draft | Table-first notation with exact schema constraints, bundle/reference preservation and a bounded offline codec. |
| [Preserved JSON Schema notation](markdown-json-schema-v0.5.md) | 0.5 | Original import retained for the OpenAPI0.4 companion and historical comparisons. |
| [Markdown API tables for OpenAPI](markdown-openapi.md) | 0.4 | A restricted OpenAPI 3.1.2 projection using the companion schema notation. |
| [Bead and Link Type definitions](markdown-type-definitions.md) | 0.1 draft | Descriptor fields, sibling property schemas and owned exact Refines declarations; authoring intent and recorded state stay distinct. |
| [Markdown Bead/Link authoring bundles](../../experimental/formats/markdown-bead-bundles.md) | 0.1 | Nascent experiment; identity binding, revision pins and edit/delete mechanics remain open. |

## Maintenance and evidence

The proposed schema0.6 edition extends the imported notation against the actual BDP bundle: general named schemas, arbitrary names, constraints/maps, references, composition, conditionals and evaluated closure. Its bounded offline codec projects the complete unchanged schema resource; it neither fetches references nor implements BDP admission. The [Read](../profiles/core/read-contracts.md) and [Write](../profiles/write/write-contracts.md) contract indexes identify selected roots without promoting inherited helpers. The Type-definition notation composes that schema language with the existing descriptor and owned declarations, rather than defining another property-schema grammar.

Schema0.5 remains unchanged at its edition-specific path. OpenAPI0.4 continues to use that exact companion version; it does not silently acquire0.6 support. No Type-format parser, provider, public lifecycle command or instance-bundle converter is delivered by these drafts.

Historical comparisons and stress receipts in the imported documents remain bound to their original versions and source commits. In particular, their references to old BDP profiles, sequence operations, SSE or the absence of an OpenAPI catalog describe that experiment, not current BDP. Future grammar revisions need their own evidence; the original receipts cannot qualify them.

## Reproduction

The pure Node schema codec and profile projections are checked separately from provider behavior. The same checks run in CI. Use the repository-pinned Node24.22.1 and pnpm11.20.0 after the normal frozen dependency install.

```sh
# Check the complete schema companion and selected profile indexes.
pnpm markdown:check

# Exercise schema projection, malformed inputs and source correspondence.
pnpm test:markdown

```

## Provenance

The initial three imports came from [donnabox/memory-beads at 742e0025](https://github.com/donnabox/memory-beads/tree/742e0025eb294a0d733c2ef0e945703f7325f965/specs/formats). Their original editions preserve the source wording apart from import notes and pinned source-link relocation; schema0.5 now lives at its edition-specific path. Schema0.6 and the Type-definition0.1 document are subsequent BDP-side drafts, with separate source and check evidence. The hashes below identify the original source files before import edits, not the amended0.6 document or new Type format:

| Source file | SHA-256 |
| --- | --- |
| markdown-json-schema.md | `00c87b8f6c7164ab5963e6acf12d6135dee8709ce6bf6c0f3eba670b2056a985` |
| markdown-openapi.md | `1c360b449f38172c00f2b84d5722e59b1c85758386fd0a187a85224ef711344d` |
| markdown-bead-bundles.md | `3912b7b3968dc5950ae6228005506e78aafd7558cc55a175cc1186ac8d43195a` |
