# WIP Type specification landing council — 2026-10-15

## Scope and disposition

Native Codex and external Claude reviewed the immutable additions at **289bee12abdb92cf3e52f700a907965e20e641da**, base **9df574a9**. Claude completed successfully in about 9m35s, exit0, no stderr; Gemini omitted per instruction. Reports: [Codex](type-wip-landing-codex-20261015.md) and [Claude](type-wip-landing-claude-20261015.md). Codex separately reviewed the small parent follow-up (now committed as 3b0270bbfba6463424107c2ea2d42d24bc627abb); Claude did not review those later edits. No reviewer edited source or external records.

**No substantive blocker to landing this explicitly WIP design in main.** Both reviewers confirm that it preserves canonical protocol authority, does not claim implementation, and accurately records the new intrinsic/registry/acquisition/alias decisions. Unpinned write revision selection remains open. Do not delay for complete lifecycle/constraint/runtime implementation or merge wider PR60.

Native read-only verification passed `git diff --check` and the documented six-schema/95-case checker in the actual landing worktree. Claude ran the copied snapshot checker, reaching the final link assertion; its snapshot lacks the canonical docs/specs/bdp.md copied only in the full repo. That is a snapshot limitation, not a landed broken link. Neither checker is runtime or full Type admission qualification.

## Recommended bounded polish

1. **Medium — clarify settled lifecycle decisions under §7's heading.** specs/types.md:935 and §8 readiness table. Claude flags “Decisions still needed” as inconsistent with selected §7.2/7.3. The text itself labels those decisions accurately, so downgrade from its High blocker. Retitle §7 to include lifecycle and open decisions; add readiness entries saying origin/installation/acquisition direction and alias direction are selected while the explicitly listed details remain open. No need to renumber the whole document.

2. **Low — cross-reference open revision selection.** specs/types.md:67 and507. Resolution-before-commit is settled; which revision an unpinned write selects is not. Add a pointer to §7.2. This is explanatory, not evidence the current text secretly selects latest. Do not change exact stored-pin semantics.

3. **Medium — narrow the checker coverage claim.** specs/schemas/README.md:144–147. “Exact example references” can imply it validates every selector pin; checker currently resolves affiliation, declaration Type/target pins and owner consistency, not every descriptor selector. Claude reports in-memory mutations of ownership/endpoint selector references can pass. Narrow the prose to the actual checked references rather than expanding a shape checker into general admission during this WIP landing. Existing examples were inspected and no dangling reference is identified.

4. **Medium — make inherited Bead ownership explicit.** specs/types.md §5.7, in relation to §2.1. The foundation already relies on BeadType/LinkType inheriting Type's ConformsTo ownership; the general semantic-conformance rule supports this, but a direct sentence would help Melinda. State each inherited ownership/participation declaration continues to apply, and conforming Types cannot opt out. Avoid wording implying a Link must match *all* ownership selectors; matching any applicable ownership declaration makes it owned. Inherited bounds remain independent conjunctive checks.

5. **Low — reconcile alias responsibility wording.** specs/types.md:983–985 assigns alias persistence/resolution to CLI alone, whereas §7.3 correctly identifies Core/Write changes. Cross-reference §7.3 and distinguish CLI shorthand from shared alias representation/semantics. No new alias root or precedence decision.

## Native findings already addressed in parent follow-up

- Replace final instruction to develop on isolated old design branch with focused branches from BDP main.
- Domain schema comments and embedded copies point to immutable external Issue draft instead of absent local file.
- Mark installed globally addressed Type graph endpoint locality vs opaque external resources as an explicit open integration question. No promise to validate arbitrary external resources.

The pending per-slice/mixed-revision readiness wording could also distinguish selected §5 cases from remaining inherited-activation generalization; this is documentation clarity, not reopening decisions.

## Claude findings not promoted

- **“Merge blockers” severity is too high for §7 headings/cross-references.** The selected/open status is explicit in the body and WIP landing is user-authorized. Small clarifications suffice.
- **Activity subjects are not necessarily graph Link endpoints.** Do not infer that a Provenance Activity's BeadRef/LinkRef property needs to be admitted by Link endpoint constraints, or prohibit it in Memory. The explicit no typed-external/no local-Link-endpoint boundary already stands; any domain usage should honor that separately.
- **Do not replace deliberate pinned fixture selectors with identity-wide selectors.** Pins illustrate exact contracts; intrinsic metatype upgrades are open. An explanatory note is optional, not a schema correction or default-selection decision.
- **Embedded schema closure remains openly unresolved.** README already says references are preloaded and no network is fetched; schema shapes do not qualify an installed graph. A note that embedded fixture copies use the same authoring-only refs is optional; do not require an installer before WIP landing.
- **Empty Dependency property case is valid and intentional.** Dependency's base fragment has no required properties and discriminator removal is tested. Do not invent fields or claim domain coverage beyond the shape fragment. README already says it is not full domain validation.
- **The checker does not assert all inherited graph semantics.** Its limited finite matching/copy checks and runtime disclaimer are explicit. A generic inheritance test suite is later work; do not turn the landing into implementation.
- Adding draft comments to two schemas and README link coverage is optional low-priority polish, not required for publication; WIP labeling is already prominent.

## Evidence limits

Claude examined original289bee12 only; native follow-up review covers the saved small diff. Parent must run exact-head formatting/checks/CI after any further edits. Domain drafts are immutable references outside this landing; this review does not qualify them or reconcile Memory. No code/runtime qualification is claimed.

## Landing disposition

The parent accepts the five recommended polish items as nonblocking follow-up for
the next Type-design increment. Selected/open status is already explicit, no actual
dangling example pin was identified, and no new semantic rule is required to let
Melinda draft Memory. Report the exact limited checker coverage in PR/hand-off
evidence. Do not claim exhaustive reference or Type admission validation.
