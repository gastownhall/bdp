# Native Codex review — WIP main landing

Reviewed commit 289bee12abdb92cf3e52f700a907965e20e641da against 9df574a9, using immutable copied additions plus read-only checks in the clean landing worktree. No runtime files changed. `git diff --check` passed; checker passed 6 schemas, 95 shape cases, 8 definitions, 4 owned declarations, closure/copies/domain cases/local links. These checks are correctly labeled non-runtime qualification.

**No merge-blocking finding for a clearly labeled WIP documentation landing.** README and spec introduction distinguish the design from current protocol authority and implementation. Recent intrinsic/registry/acquisition/alias decisions are accurately recorded; unpinned write revision selection is explicitly unresolved, not defaulted. The domain author can proceed against the agreed model while marking dependencies on open rules.

Bounded refinements:

1. **Low — final working-location instruction is stale after main landing.** specs/types.md:1147 says “Develop here on the isolated design branch,” while lines3–9 expressly move collaboration to main. This can send Melinda back to PR60 or a stale authoring branch. Replace with a short instruction to use main as the shared WIP baseline and submit bounded follow-up changes, retaining the prohibition against merging accumulated PR60 as a runtime migration.

2. **Low — schema comments point to an absent local domain file.** specs/schemas/issue.properties.schema.json:5 and dependency.properties.schema.json:5 say `See specs/types/issue.md`, but this landing deliberately does not include that file. README supplies the correct immutable external link; use that reference in the comments or point to schemas/README.md. The foundation fixture embeds these schema copies, so update them together if changing schema comments. This is navigation polish, not an unresolved semantic dependency.

3. **Medium, follow-up rather than landing blocker — installation and endpoint locality need an explicit cross-reference.** specs/types.md:548–560 limits nonlocal endpoint validation, while 1044–1077 retains externally identified definition graphs locally and 1103–1104 leaves replica exposure open. A domain author should not infer that locally installed global Type Beads automatically satisfy `scope:same` for ConformsTo endpoints, or that they must be remotely fetched. Add to the open questions the treatment of locally installed, globally addressed definition Beads in endpoint Scope classification and authoritative owned-snapshot traversal. Do not settle it here; external resource validation remains excluded.

4. **Low — readiness/open list should distinguish settled mixed-revision examples from remaining generalization.** specs/types.md:953–955 and1140 call changing bounds/cross-revision evolution open, while §§5.4,5.6,5.8 select important cases. Those cases are detailed enough for Memory authoring; refer explicitly to the selected cases and state that inherited activation/constraint identity remain open. This prevents a reader treating all mixed-revision behavior as undecided.

No request to finish bootstrap allocation, removal, registration granularity, alias root, schema closure policy or runtime implementation before landing. The schema/checker correctly scope themselves as review artifacts; open extensions do not constitute support promises. The literal fixture is labeled final state, not an installer or source of client-chosen revisions.

## Native-only follow-up review

Reviewed the parent's uncommitted 4-file diff against289bee12 (saved as native-followup-reviewed.diff). It replaces the stale branch instruction, updates schema comments and embedded fixture copies to the immutable external Issue draft, and explicitly marks installed-global-ID endpoint locality as unresolved. All three fixes are appropriate; no new issue. Claude still reviews the original snapshot; no two-reviewer claim covers this follow-up.
