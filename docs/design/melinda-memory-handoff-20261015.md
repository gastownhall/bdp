# Prompt for Melinda: Memory Bead and Link Type specification

You are Melinda. Own the Memory domain specification while Trish and Donna continue
the shared Type system. Produce a reviewable specification in `specs/types/memory.md`
that satisfies Chris Sells's Memory requirements and uses the current BDP Type model.
This is specification work; do not implement Memory runtime or CLI behavior yet.

## Start with the current sources

1. Fetch `gastownhall/bdp` main and read `specs/types.md` in full, including its open
   decisions and readiness section. Trish is landing this as a work-in-progress
   design specification. Main's Type draft is the shared design authority after
   that landing; `docs/specs/bdp.md` remains the existing protocol contract. Do not
   mistake the design's presence on main for wire adoption or implementation.
2. Read Chris's current proposal and relevant comments:
   https://github.com/gastownhall/beads/issues/5877 . Refresh its current contents;
   the earlier analysis used revision 4, R1–R31/R27a and scenarios S1–S16, and may
   not capture later feedback. Record what you actually reviewed.
3. Read the current Provenance V2 proposal and material feedback:
   https://github.com/gastownhall/beads/issues/7510 . Activity and revision provenance
   are defined there. Preserve that boundary; do not invent a competing Activity,
   evidence/provenance envelope or causality system. Escalate contradictions.
4. Read the current product/CLI Type proposal:
   https://github.com/gastownhall/beads/issues/7590 . It supplies product context;
   shared meanings belong in `specs/types.md`, not duplicated CLI rules.
5. Recover the existing Memory draft and research from BDP PR #60's authoring branch:
   https://github.com/gastownhall/bdp/tree/codex/trish-bdp-design-authority . Inspect:
   - `specs/types/memory.md`: starting proposal, currently one Memory Bead Type with
     knowledge-form kinds and six distinct informational Link Types.
   - `specs/types/memory-approaches.md`: historical A/B comparison; keep for comparison,
     not a second current specification.
   - `specs/types/issue.md`: Issue/Dependency contracts and observed product behavior.
   - `docs/design/memory-type-prior-art-20261013.md`: primary-source research.
   - `docs/design/memory-bead-link-model-20261013.md`: earlier rationale, historical.
   Use exact source commits in your notes. Copy only the Memory draft you own into
   your branch if it has not yet landed. Do not merge all of PR #60 to obtain it.

## Important reconciliation work

The existing Memory draft predates our current Type design. Its flat-Type/no-
conformance assertions and independent source/target OR lists are stale. Its
Issue/Dependency kind-discriminator assumptions also lag later decisions. Preserve
useful domain semantics and examples while reconciling these assumptions explicitly.

The current shared direction is:

- Optional Scope-wide Types profile; Core permits other Type systems. Types depends
  on Core, not Write. Domain write obligations apply when writing is supported.
- Type definitions are Beads. Instances retain a distinguished `type` field with
  an exact definition pin. Updates preserve it unless explicitly supplied; explicit
  retyping plus properties is atomic. Do not assume nominal affiliation is immutable.
- Type, BeadType and LinkType are foundational Bead Types; ConformsTo is a Link Type.
  BeadType and LinkType conform to Type. Bead-Type and Link-Type conformance remain
  separate. ConformsTo declarations are owned Links with exact target pins; historical
  owner snapshots determine meaning. Conformance is transitive, exact-revision
  acyclic and can only tighten inherited structural and semantic promises.
- Schemas apply conjunctively. Conformance supports readers of a general contract;
  it does not make every general-contract write safe for a more specific Type.
  Full replacement and writes must satisfy the actual Type. Semantics such as
  dollars versus cents matter even when their JSON shapes match.
- Link eligibility is a union of source/target pairs. Each side can have an OR-list
  or wildcard; both sides must match the same pair. Inherited pair sets intersect.
  Pinned Type selectors match exact affiliation/conformance; unpinned selectors
  match identity across revisions, not a repeatedly resolved latest definition.
- Arity counts by endpoint identity across pinned/floating endpoints and the local
  Scope's Link population, including relevant conformers/revisions. Bead Types may
  impose minimums and maximums; Link Types impose maximums. Constraints apply at
  final atomic commit. Read the current spec's precise applicability rules.
- Ordered-pair uniqueness and per-Link acyclicity have distinct rules. Acyclic
  adopting Links must not belong to a cycle through the relevant family; unrelated
  old-only cycles are not automatically prohibited. Do not simplify this to a
  whole-family DAG requirement or reset budgets for each Type revision.
- External resources are opaque; no promise to validate or monitor their state.
  Scope-local Link-table rules still apply. Local floating-endpoint revalidation
  and deletion behavior remain open.
- Issue and Dependency preserve established product semantics. Current target
  hierarchy has task/bug/etc. conforming to issue and blocks/parent-child/etc.
  conforming to dependency. Do not put issue_type/dep_type back into their proposed
  properties or generalize all Dependencies into blockers.
- Only the minimum bootstrap definitions are intrinsic/binary-supplied and cannot
  be updated or removed through ordinary operations. Memory is an ordinary domain
  Type graph; potential pre-installation does not make it intrinsic.
- Registry installation preserves global identity and exact revisions. It does not
  grant local publication authority over those identities. Authorized origin
  updates and explicit local forks are distinct. Default use requires Scope
  registration; explicit auto-install is possible; unvalidated use is deferred.
- Aliases are generic local names, may pin revisions, and cannot change canonical
  stored identity. Alias creation does not itself fetch/register anything. Alias
  root layout, registration granularity and unpinned write revision selection are
  unresolved. A Scope-selected default revision was suggested, NOT accepted.

The current Type spec wins over this handoff if it advances. Surface new needs to
Trish with a concrete Memory example; do not silently design a second Type system.
Production Type IDs, seed allocation, portable graph packaging, rich schema-admission
mechanics, removal/retention and deeper provenance details are still open. Use
clearly marked illustrative namespaces/revisions rather than inventing production
assignments. You can make progress without resolving those facilities.

## Deliverable

Evolve the existing recommended Memory model. Do not reopen A/B wholesale. If the
new conformance model exposes a concrete reason to change Type-versus-kind choices,
show the example and tradeoff and request Donna's decision; make an explicit
provisional recommendation rather than hiding it as an agreed requirement.

The draft should contain:

- A plain-language purpose and bounded catalog of all needed Bead and Link Types.
- Properties schemas (embedded or referenced), their meaning, required/optional and
  writable/computed distinctions, and explicit treatment of application metadata.
- Any declared conformance, plus why the structural AND semantic promises hold.
- For every Link: direction, allowed endpoint pairs, pin/floating use, ownership,
  arity/uniqueness/cycle requirements where needed, and what it does NOT imply
  about workflow, truth, authority or automatic replacement.
- Concrete examples for both field/service work and office/knowledge work. People
  must be able to save a useful note without first filling out an elaborate taxonomy.
- A traceability table from Chris's requirements/scenarios to Type data, shared
  protocol/operations, Beads product work, or explicit gaps. A Type definition by
  itself does not implement search, recall, consolidation, summarization or policy.
- Positive and negative acceptance cases, including historical references,
  conformance, changes of Type, conflicting claims and revision provenance versus
  Activity. Keep links to established work items and work artifacts meaningful.
- An honest designed/implemented/NYI table and a small decision list. Verify any
  implementation claim at an exact source head; do not infer it from the schema.

## Work and coordination boundaries

Use a new isolated BDP worktree/branch from main after the Type draft lands; follow
repository instructions. Own `specs/types/memory.md` and clearly named Memory-only
schema/example files. Trish owns `specs/types.md` and shared Type schemas. Keep the
historical A/B comparison intact. Do not edit canonical Core/Write, Issue/Dependency,
Provenance V2, runtime, graph CLI work, release branches or playgrounds.

If you need Beads implementation evidence, inspect the final `graph-preview2` tag
in `donnabox/beads`, peeled commit `703bb13e91aa2cab2092443319139006d74242c8`.
Janet requires any new Beads implementation branch to start there; later merge her
qualified Preview 3 base and recheck. That policy is not a reason to base BDP docs
on a Beads tag. There is no qualified Preview 3 base assumed by this handoff.

Coordinate shared Type questions with Trish through `donnabox/agent-coordination#1`
and record durable dependencies in BDP #59. Donna is asking Janet how Preview 3
work should be tracked; use that answer when available rather than creating a
competing release scheme. First report your branch/base, source revisions, scoped
plan and any immediate blocker. Continue independent drafting while decisions are
pending. Before marking a PR ready, run the applicable checks and Codex + Claude
review, record findings/dispositions and clearly separate WIP design landing from
protocol or product acceptance. Do not merge without authorization.
