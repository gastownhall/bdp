# Memory catalog publication — October 19, 2026

[Memory Bead and Link Types](memory.md) is the current v0.2 review draft. It describes **nine Bead Types and nine Link Types**, including **Evaluation as the selected Memory subtype** for the accepted evaluation-owner model, with required nonempty exact `{uri, revision}` subject references. The earlier eight-Bead catalog is preserved at [Memory010](https://github.com/gastownhall/bdp/blob/010be6463c54041dc9ec266c385788ec1a3fd88b/specs/types/memory/memory.md). Neither this source publication nor its Type count means installation, adoption or runtime support.

## Accepted behavior and carrier

[MEM-DEC-010](../../../docs/design/memory-evaluation-decision-20261019.md) selects one uniform model: every Addresses, Satisfies or Violates claim is owned by an evaluation, including self-authored/unattested claims. Each evaluation has one nonempty full subject group, and every claim concerns that group collectively. Any Bead can be assessed; group claims are not distributed to individual members. Different groups need separate evaluations, and independent evaluations can assess the same group.

Donna selected Evaluation refining Memory, with Conformance-family ownership and a required nonempty typed `subjects` array. Each member is an exact `{uri, revision}` Bead reference; floating subject references are refused. The ruling is recorded as a subsequent extension of MEM-DEC-010. The first accepted Evaluation state binds its subject group to the Bead identity across retyping away and back. Reordering that group is allowed; a different group needs a new Evaluation identity. Pre-Evaluation `subjects` extension data does not bind it. Special lifecycle automation, structured context/evidence and ephemeral graph framing remain open. Accepted design is distinct from installed Type identities and qualified schema/runtime projections. The current selected shared source supplies no concrete Activity typedef to adopt by reference.

All examples, claim endpoints/ownership, group-aware query behavior and satisfaction composition now use the evaluation-owner model. Satisfies composition follows evaluation subject bindings and compatible claims, not a literal chain of stored Satisfies Links. A collective intermediate group cannot be distributed to a singleton Constraint.

The earlier [MEM-DEC-009](../../../docs/design/memory-review-boundaries-decision-20261019.md) retains nontransitive Subject To, Requires/Defines closure, abstract Conformance with concrete peers, Issue/Dependency workflow boundaries, closure≠satisfaction and Type-constraint enforcement. Its unowned-claim baseline is superseded by MEM-DEC-010. [MEM-DEC-008](../../../docs/design/memory-conformance-decision-20261019.md) retains the peer hierarchy, shared evidence and Refines naming. Remaining deferrals are explicit in [publication scope](memory.md#publication-scope-and-deferred-specification-work).

## Source and projection

- Authoring source revision: `691d07b46169497c3fc7e917d368e1b5556f2856`; path `specs/type-packages/memory-references/memory-and-references.md` in the private authoring scope.
- Authoring source SHA256: `394636d4f9447d21c1a15387db479e1dd21fffeb63a3fe130c7fe78e3cd5870d`.
- Public `memory.md` SHA256: `1f97f8a80f725b2a44a0c715b4ccf09918f02af2abb9885797c3395255dc9e34`.
- Projection retains frontmatter, title, body, examples and definitions; omits the local-only Depends on locator; replaces the Chris-proposal locator with [its public source](https://github.com/gastownhall/beads/issues/5877).
- Private authoring paths are provenance, not external normative dependencies.

The separate [Types profile](../../profiles/types/types.md) and [reviewed immutable revision](https://github.com/gastownhall/bdp/blob/3f7ebc145513425c1362bf0ef88c756c41ed4315/specs/profiles/types/types.md) remain shared owner work. This pass edits no shared Type/metatype, Core/Write, authoring-format or runtime contract files.

## Historical schemas and fixtures

The schemas, `definitions.json`, `bdp-exploration.md`, [property fixtures](../../../fixtures/specs/memory/README.md), and `scripts/check_memory_examples.py` describe the earlier catalog at [3025dc7](https://github.com/gastownhall/bdp/tree/3025dc7a312d15cc715421ea1a281b5b0bd2b56d/specs/types/memory). Their passing checks do **not** validate this review catalog, Evaluation subjects/ownership, group semantics, graph rules or runtime support. Current schemas/fixtures must be deliberately regenerated against an accepted exact source before their results support implementation/qualification claims.

The [original issue body](../../../docs/design/history/memory-issue-7661-before-20261019.md), [pre-Conformance issue body](../../../docs/design/history/memory-issue-7661-before-conformance-20261019.md), and earlier exact catalogs retain their review identities. [Beads#7661](https://github.com/gastownhall/beads/issues/7661) mirrors the full current draft and links [PR143](https://github.com/gastownhall/bdp/pull/143).

## Validation and handoff

The [current lifetime-group receipt](../../../docs/design/memory-evaluation-lifetime-20261020.json) records source/projection digests and documentation/model-integrity checks for 18 Type definitions, accepted carrier/exact-subject-reference selection, evaluation ownership and four claim endpoint tables, collective/full-group scope, logical claim composition, Type refinement/evidence, and Markdown links/tables/whitespace. The [earlier carrier receipt](../../../docs/design/memory-evaluation-claims-20261019.json) retains its exact f200/bbd97 source subject. No regenerated schema or native runtime qualification is claimed.

Trish owns Memory-Type implementation and shared Type/metatype design; Melinda owns the Memory specification; Janet coordinates integration and qualification. A consumer frozen at Memory010 keeps that exact input until deliberate reconciliation selects a successor. Publication changes neither implementation holds nor merge, runner, runtime-pin or release authority.
