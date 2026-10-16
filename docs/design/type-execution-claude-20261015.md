Read all three. Findings only, ordered by severity.

---

## Critical

**1. Critical — The mandated merge-down flow has no corresponding merge-up (integration) strategy, creating a silent-regression path.**
*Lines 90–96 ("Release branch policy").*

**Issue:** The plan mandates merging the qualified Preview 3 base *into* each workstream branch (line 90–92) and requires dependent changes to pick up prerequisites *through the qualified integration base* (line 95–96). It never states how workstream PRs are merged *into* Preview 3. "Preserve shared branch history" (line 92) is weaker than the binding "no history rewrite" and does not forbid squash or rebase merges, which are common repo defaults.

**Impact:** If prerequisite PR A is squash-merged into Preview 3, and dependent branch B already contains A's original commits, the Preview 3 → B merge has no common ancestor for that content. Conflicts resolve plausibly in either direction, and taking the B side silently reverts review fixes applied during A's integration. This is the exact flow the plan requires for every dependent slice (1→2→3→4), so the hazard is structural, not incidental.

**Fix:** State explicitly: workstream PRs land in the integration base as true merge commits — no squash, no rebase, no force-push on any branch another branch has merged from. Record the merge-base SHA in each dependent PR, and require `git merge-base --is-ancestor <prereq-head> <integration-head>` to pass before a dependent branch merges the integration base. If the repo's PR settings force squash, say so and route prerequisites via branch-to-branch merges instead.

---

## High

**2. High — The base commit's repository and the PR target repository are different and unreconciled.**
*Lines 6, 37, 79–84, 86–88, 99–100.*

**Issue:** The product issue (`gastownhall/beads/issues/7590`, line 6) and the shipped `bd types` reference (proposal line 268, `gastownhall/beads/blob/v1.3.1`) are in `gastownhall/beads`. The pinned base `703bb13e…` and the `graph-preview2` tag are in `donnabox/beads`, and the notes record that the tag "was not found in `gastownhall/beads` at this check" (line 82). The policy says start branches from that commit; it never says which remote holds the workstream branches, where PRs are opened, which repo hosts the frozen `release/preview2-integration` and the future Preview 3 branch, or whether `703bb13e…` is an ancestor of anything in `gastownhall/beads`.

**Impact:** The very first action of a time-critical workstream can target the wrong remote. If `703bb13e…` is not reachable from `gastownhall/beads`, a PR there from a branch based on it carries every fork-only commit as unintended diff — unreviewable and unmergeable. Equally, work pushed to `donnabox/beads` may never be visible to the Preview 3 qualifier.

**Fix:** Add to the branch-policy section: the remote that hosts workstream branches, the repo and branch that PRs target, the repo that hosts Preview 3 and the frozen integration branch, and one verified statement of the ancestry relationship between the two repos (`git merge-base`/`--is-ancestor` result, with the command). Also define what "frozen" permits for `release/preview2-integration` (no merges in, no merges out, read-only comparison allowed).

**3. High — The "settle three bounded contracts" gate (line 48) is not wired to the slices table; no slice has a definition of "settled."**
*Lines 48–53 vs. 119–127.*

**Issue:** Line 48 states a real pre-execution gate — seed identities/revision allocation, the old-descriptor/new-definition-ID compatibility boundary, and historical declaration traversal/closure indexing. The slices table restates these as "Required decisions/dependencies" *in the same cell as the slice's own scope and acceptance* (lines 122–124), with no ordering, no artifact, and no owner. Nothing says a slice may not start until its decisions are recorded, or what recording looks like.

**Impact:** "Required decision" co-located with "scope" reads as a deliverable of the slice. The predictable outcome is that implementation convenience settles the product question inside a PR — precisely what line 108–110 prohibits. For Slices 1–3 these are not minor details; they determine stored meaning.

**Fix:** Split the table column into *Blocking decisions (must be recorded before coding)* and *In-slice design work*. For each blocking decision, name the artifact that constitutes "settled" (a specific comment/section on BDP #59 plus a spec-section update) and reference line 48's gate explicitly from Slices 1–3.

**4. High — The design contract implementation is supposed to follow is itself unpinned.**
*Lines 103–110; cf. proposal line 6.*

**Issue:** The notes pin Beads source (`703bb13e…`, with tag object `d8229914…`) and BDP main (`67a2842e…`) — good. But `specs/types.md` lives on the moving BDP branch `codex/trish-bdp-design-authority` (proposal line 6) and is never pinned. "Freeze only the contract it needs: exact spec revision/sections" (line 105) therefore has no mechanism: no commit SHA, no freeze location, no section list. The candidate descriptor artifacts the slices actually need — `schemas/type-definition.properties.schema.json`, the BeadType/LinkType/ConformsTo schemas, `schemas/examples/type-foundation.json` (specs/types.md §2.1, §2.3) — are not referenced anywhere in the notes.

**Impact:** The document pins the code it changes and leaves the specification it implements floating. A frozen-contract discipline that cannot name its frozen object cannot detect drift, so the impact-note rule at line 108–110 is unenforceable.

**Fix:** Pin the BDP design draft by commit SHA alongside the two existing pins, list the exact sections each slice freezes (e.g. Slice 2 → §§2, 2.1, 2.3, 7.0), and name the concrete descriptor/example artifacts the slice implements against, by path and commit.

**5. High — Step 1 requires a bootstrap mechanism the same document classifies as unevaluated, and the self-pinning seed may be unsatisfiable at the baseline.**
*Lines 15–16 and 52–53; specs/types.md §2.3, §7.1.*

**Issue:** Step 1 requires "trusted … seeds with exact pins through an explicit atomic bootstrap mechanism." Line 52–53 then says the graph model mints opaque revisions and transaction-local preallocation is "worth evaluating … not yet an adopted protocol mechanism." The candidate seed has BeadType pinning itself (specs/types.md §2.3), and §7.1 warns revision allocation is substantive "especially if revision tokens are content-derived" and that atomic batch alone does not solve forward pins or recursive allocation.

**Impact:** If revision tokens at `703bb13e…` are content-derived, BeadType's self-pin is a fixed point with no solution and the first milestone is unreachable as written. There is no go/no-go check, and no acceptance case covering the self-pin at all (lines 58–68).

**Fix:** Make this the first named Slice 0 deliverable: determine empirically whether revisions at the baseline are content-derived or server-minted, and whether any preallocation seam exists. Then either adopt preallocation as an explicit experiment-scoped mechanism, or record an explicit, experiment-scoped deviation from §2's "pins an exact revision" rule for the four seeds only (sentinel/deferred pin), with the deviation written into the acceptance table so it cannot silently become production behavior.

**6. High — "Two open-schema Link Types" is not constructible under the candidate contract.**
*Lines 59 and 137; specs/types.md §5.1; proposal line 309.*

**Issue:** The milestone requires creating two open-schema Link Types. But §5.1 requires `linkConstraints.typeConstraints` to be a **nonempty** list of endpoint pairs, and the proposal states that for Link definitions "an explicit baseline endpoint policy must also be selected; local Beads with wildcard Types is a bounded candidate, not a selected universal default." "Open schema" governs `properties` only (notes line 29–30); it says nothing about endpoints.

**Impact:** The first milestone's Link-Type creation path has an unselected required field. An implementer will either invent a default (establishing a product decision by convenience) or stall on day one.

**Fix:** Adopt the bounded candidate — local Bead endpoints, wildcard `types`, no scope restriction — explicitly for the experiment, label it experiment-scoped and non-precedential, and add an acceptance case asserting what the created Link Type's stored `linkConstraints` actually contains.

**7. High — The fixed-count/fingerprint catalog integrity check will trip as soon as the experiment creates a definition Bead, with no stated containment.**
*Line 44; Slice 2 ("Agree on fixed-catalog coexistence," line 123).*

**Issue:** The notes record that catalog checks "require a fixed count and exact descriptor fingerprints" and correctly warn "do not relax release integrity checks blindly." Coexistence is then listed as a Slice 2 decision. Nothing says how the experiment proceeds in the meantime.

**Impact:** This is a first-hour blocker, not a later rollout condition: the smallest end-to-end experiment adds four seeds plus user definitions and breaks a release integrity invariant. Under time pressure the cheapest local fix is to loosen the check — the one outcome line 44 warns against.

**Fix:** Select the containment now and write it into Step 1 / Slice 2: scope the fixed-count and fingerprint assertions to the installed-descriptor set only, or gate dynamic definitions behind an experiment-only flag/build tag, so the integrity check remains unmodified on the release path. State which of the two the experiment uses.

**8. High — "New storage/installation boundary" and "No new Type store" are both instructed, with no invariant distinguishing them.**
*Line 44 vs. lines 122 and 125; line 131.*

**Issue:** Line 44 concludes that dynamic definitions "require a deliberately new storage/installation boundary." Slice 1 says "Reuse existing reference/Write mechanisms; do not invent another transaction layer" (line 122). Slice 4 says "No new Type store" (line 125). Line 131 asks for "no competing edits to shared storage/Write code." These are reconcilable, but the document never states the reconciliation.

**Impact:** Directly against the review's duplicate-implementation concern: an implementer reading line 44 can legitimately build a parallel definition store with its own write path, then discover at Slice 4 that it violates "No new Type store" after the storage shape is baked in.

**Fix:** State the invariant once, early: definition Beads are stored in the ordinary Bead store and written through the existing Write transaction and reference machinery; the only new component is an admission/integrity gate that replaces the fixed-catalog check for dynamically authored definitions. Everything else — persistence, revisioning, ownership effects, atomicity — is reused, not reimplemented.

**9. High — Two overlapping plans with two divergent acceptance sets and no mapping between them.**
*Lines 9–32 and 55–68 ("First implementation candidate" + its acceptance table) vs. lines 117–142 (slices table + "First working milestone").*

**Issue:** The 5-step candidate and the 7-slice table describe substantially the same first increment with different scopes and different acceptance criteria, and nothing maps one onto the other. Concretely, Step 4 (line 22–23) includes "a small specialized create/list/validate path," while Slice 4 gates exactly that surface on "Slices 2–3 for end-to-end behavior" (line 125). The two acceptance sets overlap partially (lines 58–68 vs. 135–142) with neither declared authoritative.

**Impact:** Two acceptance lists drift. Scope disputes have no tiebreaker, and "done" is ambiguous — which is costly precisely because the plan is meant to be handed to implementers while product choices stay open.

**Fix:** Declare one authoritative acceptance table. State whether the 5-step candidate *is* the disposable-workspace execution of Slices 2–4 (and if so, that it runs on the throwaway branch and is never submitted to Preview 3), or delete the duplicate. Resolve the Step 4 / Slice 4 ordering contradiction explicitly.

**10. High — No acceptance case for incomplete conformance closure, the plan's most dangerous silent-failure mode.**
*Acceptance table lines 58–68; milestone lines 135–142; cf. specs/types.md §3.8, §3.10, §6.*

**Issue:** The spec requires that exact required definitions be available before a Type is accepted for use, that a Type with incomplete conformance knowledge be refused, and that "missing required records do not permit falling back to newer revisions." The notes' acceptance table and milestone contain no such case. Slice 3's "closure-index correctness" (line 124) does not cover the unavailable-record path.

**Impact:** A fallback-to-latest on a missing pinned ancestor produces confidently wrong conformance answers and silently defeats the immutable-meaning property the whole experiment exists to demonstrate. It is also the easiest bug to write accidentally when reusing live adjacency.

**Fix:** Add acceptance cases: (a) a Type whose transitive closure contains an unresolvable pinned revision is refused for use, with a distinguishable error; (b) when an ancestor identity has a newer revision available, the missing pinned revision still fails rather than resolving to the newer one; (c) a two-hop chain T@r → A@2 → B@1 resolves through recorded owned state after A gains new revisions and new declarations.

**11. High — Acceptance depends on baseline facilities the plan never confirms exist.**
*Lines 22–23, 60, 67; acceptance table lines 58–68.*

**Issue:** The acceptance cases assume a revision-precondition facility on update/retype ("stale revision precondition," line 67; "optimistic concurrency," line 23), an atomic multi-record write able to commit a definition plus its owned Links together ("Atomic definition/owned Link state," line 60), and a historical owned-set read. The `--if-revision` requirement is a *proposal* in the CLI document, not a confirmed baseline capability, and the notes assert no finding either way for `703bb13e…`.

**Impact:** Three of ten acceptance cases may be unexecutable at the pinned baseline. Discovering this mid-slice turns a bounded experiment into unplanned Write-layer work — the exact collision risk with other owners that Slice 0 is supposed to prevent.

**Fix:** Add to Slice 0's deliverables an explicit capability inventory at the pinned commit — revision preconditions on Bead and Link update, atomic multi-record write/batch, historical owned-Link read, revision minting semantics — recorded with file and symbol references. Gate the dependent acceptance cases on that inventory.

---

## Medium

**12. Medium-High — Acceptance criteria are not observable.**
*Lines 58–68 and 135–142.*

**Issue:** "Refuse atomically," "Refuse without partial effects," "Report unsupported behavior," "proper category and exact target pin," "Demonstrate old pins … still mean the same thing" specify intent, not observation. No command, no exit class, no error identifier, no post-state assertion. The CLI proposal concedes "Exact diagnostic JSON/exit codes remain to specify" (line 344), so there is no inherited convention to fall back on.

**Impact:** For an exercise whose only product is evidence, unfalsifiable criteria let a partially correct implementation pass. "Atomic" in particular is routinely claimed while leaving an orphan Link or a bumped owner revision behind.

**Fix:** For each case give the invoking command, the expected outcome class (accept / reject-with-provisional-error-identity), and the post-state assertion — e.g. for atomic refusal: source definition revision count unchanged, no new Link identity, owned-set bytes identical before and after. Provisional error identifiers are sufficient; they need not be the final diagnostic contract.

**13. Medium-High — Unsupported-constraint handling is specified three incompatible ways.**
*Line 30–31, acceptance line 68, Slice 5 line 126; cf. specs/types.md §2.1 ("Roots remain open for extensions").*

**Issue:** Line 30–31 requires unsupported rich schemas/constraints to "fail explicitly." Line 68 requires "Report unsupported behavior; do not claim successful validation" — accept-and-report. Slice 5 says "Explain/check expose only checks that are actually implemented." The spec meanwhile keeps extension roots open and inert. Nothing distinguishes unknown root keys, known-but-unimplemented constraint keys, and unsupported JSON Schema features.

**Impact:** Strict write-time rejection of known-but-unimplemented constraint fields makes the candidate foundation definitions unauthorable (they carry `unique`, `acyclic`, arity fields destined for Slice 5). Permissive acceptance without a hard marker lets a definition look validated when its constraints are unenforced — the worst outcome for later adoption.

**Fix:** State three rules separately: (a) unrecognized extension roots are stored inert and reported as unrecognized; (b) recognized constraint fields whose enforcement is NYI are stored but mark the definition as *not fully enforced*, and any `validate`/`check` output must name each unenforced constraint; (c) malformed descriptor shapes and unsupported schema dialect features are rejected at write. Add an acceptance case per rule.

**14. Medium-High — Slice 1 changes BDP read/write paths while the notes disclaim wire changes and the profile is unadopted.**
*Line 38–39 vs. Slice 1, line 122.*

**Issue:** Line 38–39 states this design "does not modify its current wire contract or assert draft-profile adoption." Slice 1's scope is "Carry the whole Type reference through model, persistence, BDP and CLI read/write paths," with "Select treatment of legacy unpinned/catalog records and wire compatibility" listed as an in-cell decision. The authority for that representation is BDP #60, unmerged, on a separate branch (specs/types.md §1 and §8: "Beads CLI/storage implementation of this draft — Not established by this document").

**Impact:** The first substantive coding slice depends on a protocol representation with no adopted spec and no frozen section, and the wire-compatibility decision is scheduled to be made inside the implementation. That is the highest-leverage place for implementation convenience to become a product decision.

**Fix:** Split Slice 1: 1a carries the exact reference through the internal model, persistence and CLI behind an unchanged external representation; 1b changes the BDP-visible representation and is gated on a frozen, pinned §2 affiliation section plus a recorded legacy/unpinned-record decision. Add an acceptance case that 1a leaves wire output byte-identical for pre-existing records.

**15. Medium — No legacy-record acceptance case for existing Issue/Dependency classifications.**
*Slice 1, line 122; cf. proposal lines 48–50.*

**Issue:** Slice 1 touches every Bead and Link affiliation and offers one protective criterion — "Old revisions round-trip unchanged." But the proposal describes translating existing storage classifications at the graph boundary without retaining `issue_type`/`dep_type` as duplicate authorities. There is no acceptance case for a pre-existing record created before the change, and the domain-owner approval gate sits in Slice 6 (line 127), five slices downstream.

**Impact:** Slice 1 can change the observable classification of existing Issues and Dependencies long before the domain gate, in a workspace someone may later treat as upgradeable.

**Fix:** Add acceptance cases: a pre-existing Issue and Dependency created at the baseline still report the same classification through existing CLI and JSON output after Slice 1; the baseline test suite for Issue/Dependency classification passes unchanged; and `issue_type`/`dep_type` are read-translated, not written as a second authority.

**16. Medium — No evaluation or abandonment criteria, though the experiment's stated purpose is to evaluate the representation.**
*Lines 135–147; cf. specs/types.md §3.11.*

**Issue:** §3.11 frames ConformsTo-as-Links as "a bounded first use" to be evaluated across editing, retraction, provenance display, historical closure reads, and query/index behavior — "Measure query and index behavior rather than assume Links are faster than indexed fields" — and says an unfavorable result is reason to revisit the representation. The milestone proves functional behavior only. No slice carries a measurement deliverable, and no criterion would trigger reconsideration.

**Impact:** An experiment that cannot fail its own evaluation question is a construction task. The representation choice gets locked in by sunk implementation rather than by result.

**Fix:** Add an explicit evaluation deliverable to Slice 3: measured historical-closure resolution cost at a stated definition-graph size, and recorded findings on declaration editing/retraction ergonomics and graph display. State what result would trigger a deliberate revisit, and who reviews it.

**17. Medium — Declaration retraction is missing from the slices and acceptance, and its gating is ambiguous.**
*Slice 3 line 124, Slice 4 line 125; cf. specs/types.md §3.10, §3.11, §6.*

**Issue:** Slice 3 covers "Create/edit declarations." Deletion/retraction of a ConformsTo declaration appears nowhere, in any slice or acceptance case. Slice 4's "Deletion waits for retention policy" plainly concerns *definition* deletion, but nothing says it does not also block declaration retraction. The spec treats retraction as a core evaluation case and requires historical owner revisions to retain the retracted declaration.

**Impact:** The single most revealing ownership-snapshot test — retract a declaration, confirm the old owner revision still carries it and the old closure is unchanged — is absent. The ambiguity also leaves implementers unsure whether to build it.

**Fix:** State that declaration retraction is in Slice 3 scope (it is an owned-Link mutation, distinct from definition deletion and not subject to the retention gate), and add the acceptance case above.

**18. Medium — "The repository's prescribed checks" is never resolved to commands.**
*Line 154.*

**Issue:** Per-change evidence requires running "the repository's prescribed checks at the branch head, including historical round trips, failed-write atomicity and CLI/BDP parity where affected," and re-running after the Preview 3 merge (line 155–156). The actual check commands at `703bb13e…` are never enumerated, nor is producing that list a Slice 0 deliverable.

**Impact:** Per-PR evidence varies by implementer; the "passing on Preview 2 alone does not qualify a Preview 3 submission" rule (line 156) has no concrete re-run target.

**Fix:** Make the check inventory an explicit Slice 0 output: exact commands, where they live at the pinned commit, which are required per slice, and which must be re-run post-merge. Reference it from line 154.

**19. Medium — Long-lived divergence from a frozen tag has no mitigation.**
*Lines 88–98.*

**Issue:** All branches start from a fixed Preview 2 commit; there is no qualified Preview 3 base; Slices 0–5 touch model, persistence, storage and CLI. The only upstream-drift provision is "identify the concrete missing facility to Janet before choosing a different starting point" (line 97–98) — a one-time escalation with no cadence and no time bound.

**Impact:** By the time Preview 3 qualifies, the merge may be large enough that the mandated merge-down becomes a high-risk event, concentrating all integration risk at the worst moment.

**Fix:** Keep the policy and add drift instrumentation compatible with it: a periodic throwaway trial merge against Janet's catch-up branch, for information only and explicitly never a base, with conflict surface reported in the tracker. Plus a bias toward landing Slice 0 and Slice 1a as early, small PRs to shorten branch lifetimes.

**20. Medium — The three critical-path design decisions have no forum, artifact, or driver.**
*Lines 164–174; line 76.*

**Issue:** Line 76 correctly declines to assign work, and lines 164–170 list the three decisions that gate Slices 2–3. But no decision venue, required artifact, or review mechanism is named. Line 121's "Confirm current ownership before assigning overlapping files" has no actor and no blocking condition, and Vickie is named once with no role.

**Impact:** The critical path depends on three unresolved decisions with no path to resolution. Under time pressure, unowned decisions get made inside PRs.

**Fix:** Without assigning people: name the venue and artifact for each decision (e.g. BDP #59 comment plus a spec-section update), state that the decision must be recorded there before the dependent slice begins, and name the file-ownership confirmation as a Slice 0 deliverable with a concrete output (owner per module, from recent history in the pinned repo).

**21. Medium — Slice 6 lists Memory, whose draft is known-unreconciled, without a reconciliation dependency.** *(later rollout condition, not an immediate blocker)*
*Slice 6, line 127; lines 112–114; cf. specs/types.md line 12.*

**Issue:** The spec records that the Memory draft "still contains older flat-Type assumptions and needs explicit reconciliation" and that this document "does not silently reinterpret its endpoint lists." The notes correctly disclaim any Memory edit or product commitment (line 112–114), yet Slice 6's scope includes exercising Memory contracts while its dependency cell lists only "Corresponding enforcement is implemented; domain owners approve behavior."

**Impact:** Slice 6 would exercise the system against a contract known to be stale, producing findings that are artifacts of the unreconciled draft rather than of the Type mechanism.

**Fix:** Add "Memory draft reconciled against §§2–5, or Memory explicitly deferred out of Slice 6" to Slice 6's dependency cell.

---

## Low

**22. Low — Slice 0's status is self-contradictory and unverifiable.**
*Line 7 vs. line 121.*

**Issue:** Line 7 states "No implementation has begun," and line 121 lists Slice 0 as a slice that "Can begin now" while simultaneously asserting "initial source audit already matches the final tag." No record states which files were audited, at what depth, or by whom.

**Impact:** A reader cannot tell whether Slice 0 is unstarted, partial, or complete, and the independent source-audit agent has nothing to reconcile against. The "already matches" claim cannot be re-verified.

**Fix:** Separate the factual audit result (what was checked, at which commit, with what finding) from Slice 0's remaining scope, and state Slice 0's status in one place.

**23. Low — Two specified behaviors have no acceptance case.**
*Acceptance table lines 58–68; cf. specs/types.md §2 and §3.10.*

**Issue:** (a) "Supplying a Type reference replaces that reference as a whole, rather than merging its identity and revision members" (specs/types.md §2) — an easy-to-get-wrong behavior with no case. (b) Concurrency: because owned-Link mutation produces source revision effects, two concurrent declaration edits on the same definition revision must leave the second failing its precondition; line 23 asks for "optimistic concurrency" generally but only the retype path has a case (line 67).

**Fix:** Add a case supplying identity-only and revision-only Type references and asserting whole-reference replacement rather than member-wise merge; and a case for a concurrent second declaration edit against a stale owner revision failing with no partial effect.

---

### Immediate blockers vs. later rollout conditions

Blocking the start of work: **1, 2, 3, 4, 5, 6, 7, 8, 9, 11** — all are resolvable in hours to days, mostly by writing down a decision or adding a Slice 0 deliverable, not by building more of the type system.

Blocking first-milestone credibility: **10, 12, 13, 16, 17, 23**.

Correctly deferred and left deferred: removal/retention, floating-endpoint revalidation, rich constraint checks, import/export, existing-workspace upgrade safety, full-profile advertisement. Lines 144–147 and 172–174 handle these well — no finding; the plan does not overblock the bounded experiment there.

Later rollout conditions: **14 (part 1b), 15, 19, 21**.
