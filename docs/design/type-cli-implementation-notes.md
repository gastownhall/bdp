# Bead and Link Types: implementation notes

Companion to [Proposal: Bead and Link Types](type-cli-proposal.md), October 15,
2026. These notes are not part of the proposed issue body. They preserve the
implementation exercise, inspected code seams and acceptance cases for a possible
follow-up discussion on [beads#7590](https://github.com/gastownhall/beads/issues/7590).
The tagged-source foundation audit is active; runtime implementation has not begun.

## First implementation candidate: open definitions and their graph

Use an isolated experimental branch and fresh workspace to implement the smallest
end-to-end Type representation. This is proposed work, not a claim that implementation
has started or that an existing workspace can already be upgraded in place.

1. Establish trusted Type/BeadType/LinkType/ConformsTo seeds with exact pins through
   an explicit atomic bootstrap mechanism.
2. Create local Bead/Link definitions with open instance properties and no optional
   application-specific graph constraints. Creation makes them available for use.
3. Create/read/edit owned ConformsTo Links, enforcing exact available targets,
   category agreement and exact-revision cycle checks. Preserve historical owner
   snapshots; traverse those snapshots rather than mutable current adjacency.
4. Exercise generic show/versions/graph plus a small specialized create/list/validate
   path. Demonstrate ownership revision effects and optimistic concurrency.
5. Include a tiny Bead and Link using authored Types to prove exact affiliations
   and conformance matching. Otherwise label the result a definition-graph prototype,
   not completion of the usable-Type slice. This is a recommendation for coverage,
   not a requirement for full Issue/Dependency conversion in the first increment.

The foundation definitions still need structural integrity schemas; “open schema”
refers to application-instance properties. Unsupported rich schemas/constraints
must fail explicitly in the experiment rather than silently being ignored.
No full Types-profile qualification is claimed by a partial experimental surface.

### Implementation notes from Preview 2

Source inspected at
[`703bb13e91aa2cab2092443319139006d74242c8`](https://github.com/donnabox/beads/tree/703bb13e91aa2cab2092443319139006d74242c8).
BDP main checked at `67a2842e3f1918e70978f745587cf11eaf0df5a8`; this design does not
modify its current wire contract or assert draft-profile adoption.

| Current code | Consequence for the exercise |
| --- | --- |
| [Type reader](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/internal/storage/graphstore/types_read.go) reads installed descriptors through known types/ paths | Custom Type Beads need generic identity/discovery and revision reads, not just a command wrapper |
| [Catalog checks](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/internal/storage/graphstore/informational_types.go) require a fixed count and exact descriptor fingerprints | Dynamic definitions require a deliberately new storage/installation boundary; do not relax release integrity checks blindly |
| [Graph values](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/graphops/types.go) carry typeURL strings; TypeDescriptor carries conformsTo ID arrays and a schema URL | Exact affiliation pins and owned declaration records affect model, serialization, storage/history and validation |
| [Type CLI](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/cmd/bd/graph_preview_types.go) separates human selectors from descriptor output | Preserve recognizable listing behavior while removing assumptions that labels imply installed Type identities |

Before execution, settle three bounded contracts: seed identities/revision allocation;
compatibility boundary for old types/ descriptors versus new definition-Bead IDs;
and exact historical declaration traversal/closure indexing. A disposable workspace
can defer an in-place storage migration but cannot erase the distinction in its design.
The current graph model mints opaque revisions; transaction-local preallocation is
worth evaluating for bootstrap, not yet an adopted protocol mechanism.

### Acceptance cases for the exercise

| Case | Expected result |
| --- | --- |
| Create a Bead Type with omitted schema convenience input | Store the explicit chosen open object schema; valid definition usable immediately |
| Create a Link Type and its initial conformance declaration | Atomic definition/owned Link state; proper category and exact target pin |
| Cross-kind conformance or exact-revision cycle | Refuse atomically |
| Revise a declaration | Source Type gets a new revision; old definition snapshot retains old declaration |
| Change an ancestor's current definition | Existing child revision retains its exact ancestor contract |
| Use the Type on a tiny instance, then revise the definition | Instance keeps its original Type pin |
| Explicitly retype with stale revision precondition | Refuse without partial effects |
| Match Product@r1 versus Product | Exact affiliation/conformance versus any revision by identity/conformance, never latest lookup |
| Inspect definition graph | Generic graph operations show explicit hierarchy without synthesized affiliation edges |
| Supply unsupported rich constraints in the limited experiment | Report unsupported behavior; do not claim successful validation |


## Proposed design and implementation flow

Planning draft for discussion, October 15, 2026. Janet's release branch policy below
is an instruction; slice boundaries and product gates are proposed. This plan has
entered a Codex + Claude review council. The foundation audit is assigned below;
product decisions and later implementation assignments remain explicit.

### Release branch policy

Verified from the remote: `graph-preview2` is an annotated tag in `donnabox/beads`.
Its tag object is `d82299143954ec31964148d49509e24e84fc4abc`; its commit is
`703bb13e91aa2cab2092443319139006d74242c8`. This matches the inspected source above.
The same tag was not found in `gastownhall/beads` at this check. Use the verified
fork/tag, not a similarly named moving branch.

- Start each new Beads implementation workstream/change on its own branch and
  isolated worktree from that exact Preview 2 commit. Suggested branch prefix:
  `codex/trish-types-…`; names do not assign ownership.
- Keep `release/preview2-integration` frozen. There is no qualified Preview 3 base
  yet; Janet's local upstream catch-up merge is not a starting point.
- When Janet announces the qualified Preview 3 branch and exact head, merge that
  base into each workstream branch, resolve conflicts there, and rerun the affected
  checks before submitting to Preview 3. Preserve shared branch history.
- Dependent changes must name prerequisite PRs/commits. Do not copy shared changes
  independently into several branches. Start dependent implementation after its
  prerequisite is available through the qualified integration base, or explicitly
  coordinate a prerequisite merge and record that dependency in the PR.
- If newer upstream code becomes necessary, identify the concrete missing facility
  to Janet before choosing a different starting point.
- The existing BDP design branch/PR #60 continues in the BDP repository. A Beads
  release tag is not a base for that separate repository's specification work.

### How design stays ahead

Keep BDP #59 as the shared design record and Beads #7590 as the public product/CLI
proposal. For each implementation slice, freeze only the contract it needs: exact
spec revision/sections, examples, accepted outcomes, deferred behavior and errors.
Implementation can follow that snapshot while later sections continue evolving.
A changed accepted rule needs a visible spec/example update and an impact note to
active implementers; do not silently move their target or let implementation
convenience establish a new product decision.

Use Issue/Dependency and Memory as concrete design cases. Keep existing Issue and
Dependency behavior; no Memory document edit or new Memory product commitment is
implied by this plan. Build the smallest working graph before expanding schemas
and constraints. Promote discoveries back into the shared spec and its examples.

### Proposed implementation slices

| Slice | Scope and acceptance | Required decisions/dependencies |
| --- | --- | --- |
| 0. Baseline and contract audit | Read the tagged sources; map exact-reference, revision, ownership and catalog changes; identify overlap with Janet/Vickie and required checks. No product behavior changes. | Can begin now; initial source audit already matches the final tag. Confirm current ownership before assigning overlapping files. |
| 1. Exact Type affiliation and history | Carry the whole Type reference through model, persistence, BDP and CLI read/write paths. Omitted affiliation preserves its pin; explicit retyping plus properties is atomic and uses a revision precondition. Old revisions round-trip unchanged. | Select treatment of legacy unpinned/catalog records and wire compatibility. Reuse existing reference/Write mechanisms; do not invent another transaction layer. |
| 2. Definition Beads and bootstrap | Create the four foundation definitions and open-schema user Bead/Link Types; generic create/show/versions can use them. A tiny Bead and Link retain their original Type pins after definitions change. | Slice 1; settle seed identities, trusted initial installation and allocation of mutually dependent exact pins. Agree on fixed-catalog coexistence. |
| 3. Owned ConformsTo and matching | Create/edit declarations; preserve the exact historical owner state; reject cross-kind conformance and exact-revision cycles. Test transitivity, pinned versus identity-wide selectors and closure-index correctness. | Slice 2; settle source/owner revision operation and validate that underlying ownership supports it. Editing an ancestor cannot alter old descendant meaning. |
| 4. Type authoring conveniences | Small bd type create/list/show/update/validate surface over the same graph operations; preserve bd types compatibility. Confirm generic operations and specialized commands enforce identical rules. | Slices 2–3 for end-to-end behavior; flag/output design can proceed alongside them. Deletion waits for retention policy. No new Type store. |
| 5. Schema and graph enforcement | Separate changes for schema composition, endpoint pair matching, participation counts, ordered-pair uniqueness and per-Link acyclicity. Explain/check expose only checks that are actually implemented. | Freeze each corresponding contract and its acceptance matrix first. Final-state transactions, inherited constraints and mixed Type revisions must be covered. |
| 6. Domain adoption | Exercise the resulting system with Issue/Dependency and Memory contracts; bring established classifications forward and evaluate prospective retyping. | Corresponding enforcement is implemented; domain owners approve behavior. No automatic bulk migration. |

These are dependency-ordered slices, not six independent simultaneous coding jobs.
Descriptor examples, acceptance-case design and CLI interaction design can move
alongside the foundation without competing edits to shared storage/Write code.
We should split larger slices further once the tagged-source audit identifies the
actual modules and existing implementation owners.

### First working milestone

Create two open-schema Bead Types and two open-schema Link Types, declare one
same-kind conformance relationship in each category, and use them on actual records.
Then revise a definition and a declaration. Demonstrate old pins and old owned
snapshots still mean the same thing, transitive matching gives the expected results,
and stale explicit retyping fails atomically. Inspect the definition graph through
ordinary graph commands. This proves useful Type behavior, not just stored descriptors.

Reject unsupported constraints explicitly in the limited implementation. Do not
advertise the complete Types profile until all its required behavior is qualified.
A fresh disposable workspace is appropriate for initial evidence; existing-workspace
upgrade safety is a separate gate before general rollout.

### Per-change evidence and feedback

Each implementation PR names its baseline, frozen spec contract, dependencies,
changed public behavior, data/wire compatibility implications and acceptance cases.
Run the repository's prescribed checks at the branch head, including historical
round trips, failed-write atomicity and CLI/BDP parity where affected. Rerun relevant
checks after merging Preview 3 and validate the combined release candidate; passing
on Preview 2 alone does not qualify a Preview 3 submission.

Track each feature as designed, implemented, verified or release-accepted separately.
Keep design questions explicit instead of guessing. Review the plan before assigning
implementation and review each completed change before marking it ready. No deadline,
release acceptance, background schedule or implementation completion is asserted here.

### Next design decisions

1. Foundation bootstrap: stable production identities, trusted seed installation,
   and exact revision allocation for mutually referencing definitions.
2. Compatibility boundary: handling existing catalog identities and unpinned values
   without changing the meaning of old records.
3. Exact historical owned-declaration operations, including the source-reference
   behavior required to preserve immutable Type meanings.

Removal/retention, local floating-endpoint revalidation, richer constraint checks
and portable import/export continue as separate design work. They need not delay
an explicitly bounded experiment, but cannot be silently guessed for production.

### Active bounded work

Donna authorized beginning background work on October 15. Existing BDP #59 and
Beads #7590 remain the records while Janet determines Preview 3 tracking.

| Worker | Scope | State |
| --- | --- | --- |
| types_foundation_audit | Tagged-source audit and implementation contract packet | Active in isolated codex/trish-types-foundation-audit at exact graph-preview2 commit; no runtime edits authorized in this assignment |
| types_execution_plan_review | Independent Codex + Claude review of this plan | Active; findings pending, no review approval claimed |

Trish stays interactive for product decisions, integrates findings, and owns external
coordination. These are bounded background workers, not a recurring schedule or a
promise of unattended completion of the full Type implementation.
