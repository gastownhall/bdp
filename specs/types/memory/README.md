# Memory catalog publication — October 19, 2026

[Memory Bead and Link Types](memory.md) is the current published design draft: eight Bead Types and nine Link Types. Its [publication-scope table](memory.md#publication-scope-and-deferred-specification-work) lists deliberate deferrals. This publication is not BDP adoption, installed support, release qualification, or permission to lift an integration hold.

The catalog now defines common Constraint behavior, any-Bead subjects, transitive Subject To applicability, Requires/Defines necessity and tree structure, independent contribution/satisfaction/breach claims, conditional N/A satisfaction, and retirement. No separate Implementation or Proposal Bead Type is selected.

## Source and projection

- Authoring source revision: `fc38e4403f256b49182f7e8ec8175e0f3286ec7d`; path `specs/type-packages/memory-references/memory-and-references.md` in the private authoring scope.
- Authoring source SHA256: `2d02bcfb69be8813ef415ee34f25d0a5e1b8dfeccd15379c0eee23c46c254562`.
- Public `memory.md` SHA256: `b4f9231f32eeebde210c2848668aed43de10fc096072ead92b0c74a852e3dd34`.
- Projection: retain frontmatter, title, body, examples, and Type definitions; omit the local-only Depends on locator section; replace the working Chris-proposal locator with its public [source issue](https://github.com/gastownhall/beads/issues/5877).
- Public readers use this file and its repository revision. The private authoring scope is provenance, not a required or normative external dependency.

The [reviewed Types profile](../../profiles/types/types.md) and its [immutable reference revision](https://github.com/gastownhall/bdp/blob/3f7ebc145513425c1362bf0ef88c756c41ed4315/specs/profiles/types/types.md) remain separate shared work. This publication changes neither that profile nor shared descriptor or authoring-format definitions.

## Historical artifacts

The schemas, `definitions.json`, `bdp-exploration.md`, property fixtures, and `scripts/check_memory_examples.py` retained in this branch describe the earlier catalog at [3025dc7](https://github.com/gastownhall/bdp/tree/3025dc7a312d15cc715421ea1a281b5b0bd2b56d/specs/types/memory). They are historical review artifacts. Their successful property checks do **not** validate this catalog's current Types, constraints, graph rules, mutation behavior, or runtime support. No new installable schema projection is selected by this prose publication.

The [previous beads#7661 body](../../../docs/design/history/memory-issue-7661-before-20261019.md) is preserved for review history; its requirements, CLI text, examples and evidence retain their original source identities. It is not a second current catalog. PR143 preserves that ancestry and remains a draft targeting the shared specification branch.

## Validation and next handoff

The [publication validation receipt](../../../docs/design/memory-editorial-completion-20261019.json) records exact source/projection digests and checks. Documentation/model-integrity checks cover eight Bead/nine Link definitions, actual refinement families, wildcard-source endpoint compatibility with References, ownership inheritance, seven inherited applicability declarations, Markdown tables/anchors, and whitespace. The executable applicability representation is explicitly deferred, not claimed as a supported schema or evaluator. No runtime tests or release qualification are claimed for this publication.

The selected core endpoint, family, ownership, tree, multiplicity and claim rules remain in force in the proposal. Any implementation omission needs an explicit scope decision. Trish owns shared Type reconciliation; Janet owns implementation scope, compatibility evidence and runtime qualification.

## Conformance and Refines decision

The [accepted Decision](../../../docs/design/memory-conformance-decision-20261019.md) introduces Conformance under References, with Addresses, Satisfies, and Violates as peers. Evidence is declared on Conformance and source ownership selects that common family. Satisfies no longer refines Addresses. Family queries and the informative CLI sketch reflect this distinction.

Refines replaces the Type-to-Type name ConformsTo while retaining its universal structural/semantic promise. This owned catalog uses the new label; shared profile/metatype/authoring-format propagation and any stored identifier, wire or compatibility changes remain separate owner work. The linked immutable Types profile still uses its historical terminology. No Requires subtype relationship or synthetic type-field claim Link is introduced.

The [preceding review-issue body](../../../docs/design/history/memory-issue-7661-before-conformance-20261019.md) and [preceding selected catalog](https://github.com/gastownhall/bdp/blob/b4b2249423e777a8241819c37ed2a77267159514/specs/types/memory/memory.md) retain their original identities. This revision supersedes that catalog's claim inheritance/evidence/ownership model and Type-relationship naming. Direct authoring of unspecialized Conformance Links remains open.

## Editorial completion

Donna's final editorial comment is incorporated in [Determining Conformance](memory.md#determining-conformance): begin with the subject and applicable constraints, inspect necessary obligations, then assess claims and evidence. The satisfaction-chain example follows that explanation. All text from the CLI section onward, including all Type definitions, is unchanged from [4f280f4](https://github.com/gastownhall/bdp/blob/4f280f45c2e05f02788e64a314765521ae78186d/specs/types/memory/memory.md). This pass changes explanatory prose only.
