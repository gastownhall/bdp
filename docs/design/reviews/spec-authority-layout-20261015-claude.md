# External editorial review

Historical review of `8614b4f5`; findings are dispositioned in
[the migration record](../spec-authority-migration.md#review-dispositions).
Later commits repair the findings; this is not the current specification.

Review of `8614b4f5` vs `aed21767`. All claims below verified by running against the `8614b4f5` tree (Node 24.16.0 / pnpm 11.20.0).

---

## Blocking

**1 — High · `packages/protocol/src/read-update-values.test.ts:542`**
Blind path replacement: `new URL("../specs/profiles/core/bdp-v0.schema.json", import.meta.url)` resolves relative to `packages/protocol/src/`, i.e. `packages/protocol/specs/profiles/core/bdp-v0.schema.json` — a path that does not exist. Every other rewrite in the commit used `workspaceRoot`/repo-root resolution and is correct; this one is file-relative.
*Impact:* ENOENT; test `requires RU aliases/operations and exact directory names` fails.
*Fix:* restore the package-local read `new URL("../schemas/bdp-v0.schema.json", import.meta.url)` (byte-identical copy, and a package-internal test should not reach outside the package), or resolve from `workspaceRoot` like the sibling wire tests.

**2 — High · `packages/protocol/src/read-update-wire.test.ts:27`, `packages/protocol/src/transactional-wire.test.ts:30`**
Both files were only half-migrated: the schema path was moved to `specs/profiles/core/bdp-v0.schema.json`, but `const specification = readFileSync(path.join(workspaceRoot, "docs", "specs", "bdp.md"))` was left alone. They then call `markdownSection(specification, "Problem details" | "Read+Update problem details" | "Transactional problem details")` against the 601-line navigation stub.
*Impact:* `missing specification section: …` — 10 failing assertions (`keeps the Read table closed and unchanged in its own section`, `places exactly the Read+Update additions in their own section`, `keeps inherited rows in their owning tables and exactly three additions in Transactional`, `keeps every Mutation Receipt aligned…` ×2, `pairs every response with its status, media type, cache policy, and response fields` ×4). These are the only checks that keep the normative problem-code tables and the schema bundle `$defs` in agreement.
*Fix:* use `readProtocolSpecification()` from `packages/conformance/test-support/spec-source.ts`. Note this makes `@bdp/protocol` tests depend on conformance test-support; prefer relocating the helper to a shared test-support module to avoid the inverted package direction.

**3 — High · `packages/server/test-support/schema-graph-policy.json` (vs `packages/protocol/src/index.ts:41`)**
The commit edited a doc comment in `packages/protocol/src/index.ts`; that file's SHA-256 is pinned by the interpretation-policy tripwire, and the pin was not refreshed. Pinned `92e547e8…`, actual at this commit `887c5cfc…`.
*Impact:* `installed-schema-graph.policy.test.ts` fails. The pin exists specifically so a change to that module gets explicit review, so refreshing it silently is also wrong.
*Fix:* for a documentation-only migration, leave `packages/protocol/src/index.ts` untouched (its stale comment can be fixed in a commit that also records the policy review), or refresh the pin and state the review decision the tripwire demands.

> Net effect: `pnpm test` at `8614b4f5` is **11 failed / 8822 passed** across 4 files. `pnpm format:check`, `pnpm lint`, `pnpm check:boundaries`, `pnpm typecheck` and `pnpm evidence:verify` pass. The reported "342 tests" does not correspond to a set I could reproduce; the migration-affected conformance/protocol subset is 211 passing, and the full gate fails.

---

## Source-authority contradictions

**4 — Medium · `specs/README.md:45` vs `packages/conformance/src/read-update-catalog.test.ts:38`, `transactional-catalog.test.ts:114`, `numeric-model-catalog.test.ts:21`, `owned-wildcard-catalog.test.ts:21`**
`specs/README.md` states "New requirements and authoring should cite the files here directly," but the catalog tests assert `requirements.every(({ source }) => source === "docs/specs/bdp.md")` and keep `CITATION_SOURCES` limited to `{docs/specs/bdp.md, docs/design/requirements.md}`.
*Impact:* the first citation written against the new authority fails CI; the compatibility alias is de facto mandatory, inverting the stated rule.
*Fix:* export the three authoritative paths from `spec-source.ts` and accept them (plus the legacy alias) wherever a citation source is validated.

**5 — Medium · `packages/conformance/src/profile-catalog-boundaries.test.ts:289`**
`if (requirement.source !== "docs/specs/bdp.md") continue;` — any requirement citing a `specs/` path is skipped rather than checked.
*Impact:* a future row citing `specs/profiles/write/write.md#batch-operation-target` with `requiredProfile: "read"` passes unnoticed; the cumulative-profile boundary guard quietly stops covering the new layout.
*Fix:* resolve the anchor owner per source document, assert the cited document physically owns the anchor, and throw on any `specs/` source that is not one of the three current protocol documents.

**6 — Medium · `docs/design/startup-configuration.md:44`, `:156`**
Both still name `docs/specs/bdp.md` as "the normative source" / "the normative draft" for the three profile tokens. The identical sentence in `packages/protocol/src/index.ts` *was* migrated, so this is a missed sibling; `docs/specs/bdp.md:3-9` now reads "non-normative navigation only … Do not add requirements here."
*Impact:* a live document directs implementers to a file that disclaims authority.
*Fix:* point both at `specs/profiles/core/core.md#scope-discovery-and-human-documentation`.

**7 — Low · `specs/profiles/types/types.md:1137`**
"this draft does not silently amend docs/specs/bdp.md or active Write work" — inside the tree that declares itself the sole authority. Line 6 of the same file was updated; this prose mention (not a Markdown link, so no link test sees it) was not.
*Fix:* "does not silently amend `specs/profiles/core/core.md`, `specs/profiles/write/write.md` or active Write work."

**8 — Low · `docs/design/README.md:5`, `docs/design/component-specifications.md:6`, `docs/design/requirements.md:7`, `specs/profiles/types/types.md:6`**
General "the protocol draft governs" statements that previously pointed at the whole monolith now point at `specs/profiles/core/core.md`, which contains no Read+Update or Transactional requirement.
*Impact:* a design document can now conflict with Write and still claim consistency with "the BDP v0 draft" it cites.
*Fix:* point whole-specification claims at `specs/README.md`; keep per-section links on the owning document, as `docs/design/spec-present-contract-map.md` correctly does.

---

## Stale references and anchors

**9 — Medium · `specs/profiles/core/core.md:1238`**
"The canonical `typeDescriptor` definition exists only in the single BDP v0 schema bundle at `schemas/bdp-v0.schema.json#/$defs/typeDescriptor`." The two sibling occurrences (lines 57-area and 1037) were updated; this third was missed. It is a backtick span, not a link, so `spec-layout.test.ts`'s link check cannot see it — while line 53 of that same test asserts the old path no longer exists.
*Impact:* normative text points at a deleted file.
*Fix:* `specs/profiles/core/bdp-v0.schema.json#/$defs/typeDescriptor`.

**10 — Low · `specs/profiles/core/core.md:2027` (and `docs/specs/bdp.md:205`, `docs/design/spec-path-map.json`)**
`<a id="part-ii--readupdate"></a>` is left dangling as the last line of Core. In the base it sat immediately before `## Part III — Read+Update` (bdp.md:2019/2021), and its sibling alias `part-iii--transactional` *was* correctly carried into `write.md:1644` above `## Part IV`.
*Impact:* legacy `#part-ii--readupdate` links land at the bottom of Core, just after "Read conformance", with no Read+Update text in sight. Two reasons no test catches it: `spec-layout.test.ts:22` only checks the anchor exists in its mapped document, and in `spec-source.ts`'s in-memory assembly the anchor happens to end up immediately before write.md's `## Part III`, so `markdownAnchors` still aliases it to the right section — the assembly masks the physical defect. No catalog cites it, so impact is navigation-only.
*Fix:* move the anchor into `specs/profiles/write/write.md` above `## Part III — Read+Update`, retarget `spec-path-map.json` and the stub link, and add an assertion in `spec-layout.test.ts` that each stub link's destination document equals the mapped owner.

**11 — Low · `specs/profiles/types/README.md:16-17`**
Link text still shows removed paths: `[examples/domain-property-cases.json](../../../fixtures/specs/issue/domain-property-cases.json)` and `[examples/type-foundation.json](definitions.json)`. Targets are right; the rendered labels contradict the new layout.
*Fix:* relabel to `domain-property-cases.json` and `definitions.json`.

---

## WIP Issue draft and its checks

**12 — Medium · `scripts/check_type_examples.py:211` and `specs/profiles/types/README.md:147-148`**
The README text was changed from "its inline-schema correspondence was checked in the source authoring branch" to "The Issue/Dependency prose is the existing WIP authoring draft, relocated with its inspected Preview 2 evidence intact" — the disclosure was removed, but no check was added. The script's link loop still covers only `types.md` and `README.md`, and nothing compares `issue.md`'s two inline `properties` schemas to `specs/types/issue/{issue,dependency}.properties.schema.json`.
*Impact:* the newly colocated draft's inline schemas can drift from the adjacent artifacts it claims to embed, with the README asserting the opposite. Its only machine check is `spec-layout.test.ts`'s link resolution.
*Fix:* add `ISSUE / "issue.md"` to the loop and assert each inline `$schema` block equals its artifact modulo `$id`/`title`/`$comment`.

**13 — Low · `specs/types/issue/issue.md:43`, `docs/design/spec-authority-migration.md:41`**
The draft's source-of-evidence row was repointed from the repo-relative `docs/design/issue-dependency-preview2-audit-20261014.md` to a `cbd59b60` blob URL. That commit is not an ancestor of main, so the audit is not in the repository; the migration note says the "inspected Preview 2 evidence remain[s] unchanged" without disclosing that the evidence document itself was left behind.
*Impact:* the field inventory and source-line citations behind every Preview 2 claim in the WIP draft are unverifiable from the branch.
*Fix:* migrate the audit alongside the draft, or state plainly in both `spec-authority-migration.md` and the `specs/README.md` Issue row that the source audit is unmerged.

**14 — Low · `packages/conformance/src/artifact.test.ts:40`**
`readText` changed from `readFileSync(resolveArtifactPath(p), "utf8")` to `readSpecificationSource(p)`, dropping the `artifact path escapes the repository root` guard, while `readBytes` keeps it. The same manifest-supplied path is now read under two different resolution rules.
*Fix:* keep `resolveArtifactPath` on the non-specification branch, or move the guard into `spec-source.ts`.

---

## Verified clean

- **Semantic preservation holds.** A normalized line diff of base `docs/specs/bdp.md` (7041 lines) against `core.md` + `write.md`(post-marker) + `conformance.md`(post-marker), with cross-file link paths stripped, yields 34 diff lines confined to: the H1, the added preface, "The entire document is a single draft" → "The Core/Read and Write documents and shared conformance index form a single draft", two schema-path strings, and "The four parts below" → "The four parts across Core/Read and Write". No requirement sentence changed. `sequence` non-atomic / `batch` atomic and the existing Type contract are byte-identical and restated in both prefaces. No new wire form adopted; no OpenAPI manufactured.
- **Anchors.** All 148 base anchors (142 headings + 6 explicit) are present in `spec-path-map.json` and exist in their mapped document (core 49 / write 91 / conformance 8). No duplicates, no additions, no omissions.
- **Bytes.** All 9 moved JSON artifacts have identical git blob hashes. `specs/profiles/core/bdp-v0.schema.json` and `packages/protocol/schemas/bdp-v0.schema.json` are both `0baa5d5e…`, unchanged from base; `$id` and `$defs` untouched; `schema-graph-policy.json`'s bundle digest still matches.
- **Links.** Zero broken relative file links repo-wide. The 34 broken same-document fragments in `docs/design/w1-transactional-packet.md` are pre-existing (47 bare fragments before and after the commit) — not a migration defect.
- **Type checker.** `scripts/check_type_examples.py` passes: 6 schemas, **95** shape cases, 8 definitions, 4 declarations. Checkers in `scripts/`, datasets in `fixtures/specs/` — placement matches the requirement. `issue.md:382`'s repaired anchor `#validation-limits-and-reproduction` is correct (the authoring branch's `#reproduce-document-validation` never existed).
- **Issue draft provenance.** Verbatim from `7bc1758:specs/types/issue.md` apart from 5 link repairs; no new decisions, no relabelled evidence runs.
- `pnpm check:boundaries`, `pnpm typecheck`, `pnpm format:check`, `pnpm evidence:verify` all pass.

---

**One procedural note:** the branch HEAD moved under me during this review — `a604ce82` ("test: preserve citation boundaries and repair relocated source readers") landed at 23:13 and `c105ec77` after it, and a concurrent session was rewriting files in this worktree at 23:12:16 and 23:12:47. My full-suite run completed at ~23:12:10 against a clean `8614b4f5` tree, so the 11 failures are attributable to the reviewed commit. Findings 1–5 and 12 are already addressed by `a604ce82`; findings 6–11, 13 and 14 were still open at `c105ec77`. Worth confirming that `a604ce82`'s revert of `packages/protocol/src/index.ts:41` is intentional rather than a workaround for the unrefreshed pin — it restores a now-wrong `docs/specs/bdp.md` reference in shipped source.
