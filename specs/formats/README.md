# Markdown authoring formats

These draft format specifications originate in the Memory experiment. BDP keeps editable copies here so its schema and HTTP documentation can use a consistent notation. Their presence does not change BDP wire contracts or make the full protocol expressible in either DSL. The current normative protocol remains in the [specification index](../README.md).

| Format | Imported version | Boundary |
| --- | --- | --- |
| [Markdown schema tables for JSON Schema](markdown-json-schema.md) | 0.5 | A deliberately restricted Draft 2020-12 subset; unsupported constructs must be refused. |
| [Markdown API tables for OpenAPI](markdown-openapi.md) | 0.4 | A restricted OpenAPI 3.1.2 projection using the companion schema notation. |
| [Markdown Bead/Link authoring bundles](../../experimental/formats/markdown-bead-bundles.md) | 0.1 | Nascent experiment; identity binding, revision pins and edit/delete mechanics remain open. |

## Maintenance and evidence

These files are the starting point for BDP-side format development. No DSL extension or converter is introduced by this import. The schema DSL needs explicit design for bundles/references, constraints, maps, composition, conditional rules and evaluated-property closure before it can preserve the broader BDP schema surface. Readable tables alone do not establish a lossless translation.

Historical comparisons and stress receipts in the imported documents remain bound to their original versions and source commits. In particular, their references to old BDP profiles, sequence operations, SSE or the absence of an OpenAPI catalog describe that experiment, not current BDP. Future grammar revisions need their own evidence; the original receipts cannot qualify them.

## Provenance

All three source files were imported from [donnabox/memory-beads at 742e0025](https://github.com/donnabox/memory-beads/tree/742e0025eb294a0d733c2ef0e945703f7325f965/specs/formats). Their original wording is preserved apart from a labeled import note and relocation of links to source-only material. References between the two companion format specs remain local. Source-file SHA-256 values before those documented edits are:

| Source file | SHA-256 |
| --- | --- |
| markdown-json-schema.md | `00c87b8f6c7164ab5963e6acf12d6135dee8709ce6bf6c0f3eba670b2056a985` |
| markdown-openapi.md | `1c360b449f38172c00f2b84d5722e59b1c85758386fd0a187a85224ef711344d` |
| markdown-bead-bundles.md | `3912b7b3968dc5950ae6228005506e78aafd7558cc55a175cc1186ac8d43195a` |
