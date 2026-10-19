# Memory catalog publication — October 19, 2026

[Memory Bead and Link Types](memory.md) is the current v0.2 design draft: eight Bead Types and nine Link Types, including abstract Conformance and its three concrete peer refinements. [Publication scope](memory.md#publication-scope-and-deferred-specification-work) distinguishes the selected model from deferred mechanics and runtime qualification.

## Current decisions

[MEM-DEC-009](../../../docs/design/memory-review-boundaries-decision-20261019.md) records the review follow-through:

- Subject To is nontransitive. Start with the subject's applicable roots and follow Requires, including Defines, to discover necessary obligations.
- Conformance is abstract; concrete refinements remain usable and discoverable through the family. Under the current subject → Constraint representation, claims are unowned and do not revise the assessed subject. Assessment-Bead ownership is a separate design discussion.
- Only Issue and Issue refinements are eligible for dispatch; only Dependency and its refinements carry Issue-blocking semantics. Closing an Issue establishes no satisfaction or verification.
- Type graph constraints need affected-state validation on create/update/delete and at the shared commit/admission boundary.

[MEM-DEC-008](../../../docs/design/memory-conformance-decision-20261019.md) retains its historical identity. Its peer hierarchy, common evidence, and Refines naming remain accepted; its source-owned assessment rule and undecided direct authoring are superseded. No Assessment Bead Type, third-party owner field, cascade, or new kind enum is selected.

## Source and projection

- Authoring source revision: `f2dc4e2ac0a9300b0a8c146ffe7660c3f727a50f`; path `specs/type-packages/memory-references/memory-and-references.md` in the private authoring scope.
- Authoring source SHA256: `3e5ee974c69ee0eca4f30402a081e5dff2c7f0077bcdff331f44179d8a021aef`.
- Public `memory.md` SHA256: `c1997a66c985638da3fc564b7c9a62d32ebf28ec6f839adc79daa1f4160235ae`.
- Projection retains frontmatter, title, body, examples and Type definitions; omits the local-only Depends on locator section; replaces the Chris-proposal locator with [its public source](https://github.com/gastownhall/beads/issues/5877).
- The private authoring scope is provenance, not a required external contract dependency.

The separate [Types profile](../../profiles/types/types.md) and [immutable reviewed revision](https://github.com/gastownhall/bdp/blob/3f7ebc145513425c1362bf0ef88c756c41ed4315/specs/profiles/types/types.md) remain shared owner work. This publication does not edit the shared Type/metatype, Core/Write or authoring-format contracts.

## Historical schemas and fixtures — not v0.2 validation

The schemas, `definitions.json`, `bdp-exploration.md`, [property fixtures](../../../fixtures/specs/memory/README.md), and `scripts/check_memory_examples.py` describe the earlier catalog at [3025dc7](https://github.com/gastownhall/bdp/tree/3025dc7a312d15cc715421ea1a281b5b0bd2b56d/specs/types/memory). They are historical review artifacts. Their passing checks do **not** validate v0.2 Types, graph constraints, ownership, mutation behavior, or runtime support. The checker explicitly labels its results historical. Deliberately regenerated current schemas/fixtures and exact-revision implementation evidence remain required work before claiming such coverage.

The [earlier issue body](../../../docs/design/history/memory-issue-7661-before-20261019.md), [pre-Conformance body](../../../docs/design/history/memory-issue-7661-before-conformance-20261019.md), and [preceding source](https://github.com/gastownhall/bdp/blob/83f7d2bb01109cfd27b053547f04afba55e5339b/specs/types/memory/memory.md) retain their original review identities. The full current draft is mirrored in [beads#7661](https://github.com/gastownhall/beads/issues/7661) with a link to [PR143](https://github.com/gastownhall/bdp/pull/143).

## Validation and handoff

The [current validation receipt](../../../docs/design/memory-review-boundaries-20261019.json) records source/projection digests and documentation/model-integrity checks: 17 definitions, concrete peer refinement and evidence, abstract-base behavior, assessment independence, nontransitive applicability with Requires closure, workflow/enforcement boundaries, Markdown links/tables, and whitespace. Historical checker syntax is checked without treating historical fixtures as current qualification.

This remains a design publication, not installed support, a release allocation, a merge authorization, or a change to implementation holds. Trish owns Memory-Type implementation and the shared Type/metatype design; Melinda owns the Memory specification; Janet coordinates integration and qualification.
