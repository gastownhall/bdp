# Memory catalog publication — October 19, 2026

[Memory Bead and Link Types](memory.md) is the current published design draft: eight Bead Types and eight Link Types. Its [publication-scope table](memory.md#publication-scope-and-deferred-specification-work) lists deliberate deferrals. This publication is not BDP adoption, installed support, release qualification, or permission to lift an integration hold.

The catalog now defines common Constraint behavior, any-Bead subjects, transitive Subject To applicability, Requires/Defines necessity and tree structure, independent contribution/satisfaction/breach claims, conditional N/A satisfaction, and retirement. No separate Implementation or Proposal Bead Type is selected.

## Source and projection

- Authoring source revision: `2d3c766e01ba9bb4019ee3a4ccca4bfb3cc460a7`; path `specs/type-packages/memory-references/memory-and-references.md` in the private authoring scope.
- Authoring source SHA256: `6cff5d268ab6284ee672ab36b4f9d3ec938f7fe0eb37ccfdd0eaa20b3bcdb420`.
- Public `memory.md` SHA256: `0a0ce8473459648569ef626f19d33af9314b75d773a6c29c4f0f7f58f2dcab81`.
- Projection: retain frontmatter, title, body, examples, and Type definitions; omit the local-only Depends on locator section; replace the working Chris-proposal locator with its public [source issue](https://github.com/gastownhall/beads/issues/5877).
- Public readers use this file and its repository revision. The private authoring scope is provenance, not a required or normative external dependency.

The [reviewed Types profile](../../profiles/types/types.md) and its [immutable reference revision](https://github.com/gastownhall/bdp/blob/3f7ebc145513425c1362bf0ef88c756c41ed4315/specs/profiles/types/types.md) remain separate shared work. This publication changes neither that profile nor shared descriptor or authoring-format definitions.

## Historical artifacts

The schemas, `definitions.json`, `bdp-exploration.md`, property fixtures, and `scripts/check_memory_examples.py` retained in this branch describe the earlier catalog at [3025dc7](https://github.com/gastownhall/bdp/tree/3025dc7a312d15cc715421ea1a281b5b0bd2b56d/specs/types/memory). They are historical review artifacts. Their successful property checks do **not** validate this catalog's current Types, constraints, graph rules, mutation behavior, or runtime support. No new installable schema projection is selected by this prose publication.

The [previous beads#7661 body](../../../docs/design/history/memory-issue-7661-before-20261019.md) is preserved for review history; its requirements, CLI text, examples and evidence retain their original source identities. It is not a second current catalog. PR143 preserves that ancestry and remains a draft targeting the shared specification branch.

## Validation and next handoff

The [publication validation receipt](../../../docs/design/memory-catalog-publication-20261019.json) records exact source/projection digests and checks. Documentation/model-integrity checks cover eight Bead/eight Link definitions, actual conformance families, wildcard-source endpoint compatibility with References, ownership inheritance, seven inherited applicability declarations, Markdown tables/anchors, and whitespace. The executable applicability representation is explicitly deferred, not claimed as a supported schema or evaluator. No runtime tests or release qualification are claimed for this publication.

The selected core endpoint, family, ownership, tree, multiplicity and claim rules remain in force in the proposal. Any implementation omission needs an explicit scope decision. Trish owns shared Type reconciliation; Janet owns implementation scope, compatibility evidence and runtime qualification.
