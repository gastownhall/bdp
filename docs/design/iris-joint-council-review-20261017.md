# Joint native Codex and actual Claude draft review

Nonnormative evidence, October17,2026. Three sibling drafts163/164/165 from PR159.
Actual Claude CLI exit0 reviewed initial heads959c34a/6bdc621/8447dd2; Gemini excluded.
The unedited Claude findings follow. They refer to those initial heads and are
not the disposition of repaired source. Per-draft REVIEW.md records repairs and
remaining qualification limits. Native initially found four issues (commit-time
constraint wording; reverse owned-state agreement; independently discriminating
duplicate JSON; lifecycle annotation assertions). Native confirmed all four repaired
before this Claude report. Claude then narrowed what annotation checks prove;
we preserve that correction rather than claiming runtime semantics.

No files modified. All three checkers run offline from local cache; no engines, servers, CI, or production data touched.

**Review target moved during the session.** All three worktrees were committed under me mid-review. My findings reflect these commits, all parented on `d7197e9`:

| Worktree | Commit |
| --- | --- |
| bdp-batch-subsets | `959c34a` |
| bdp-lifecycle-events | `6bdc621` |
| bdp-interchange | `8447dd2` |

`ownership-facts.json`, the interchange reverse owned-state check, the `missing-inline-owned` vector, the `duplicate-json` digest recompute, and all three `REVIEW.md` files appeared after my first pass; I re-read and re-probed everything.

---

# Findings

## High

### H1 — `REVIEW.md` council claims are cross-contaminated across all three siblings
**File:** `specs/proposals/{batch-subsets,lifecycle-events,interchange}/REVIEW.md` §Council (lines 6–15, all three)

All three Council sections are **byte-identical** (verified by diff) and each claims "Native Codex review completed and confirmed its four findings repaired," naming repairs that exist only in the *other* drafts:

- "reverse current owned-state agreement under fixture facts" → exists only in interchange (`ownership-facts.json` + checker lines 100–109)
- "duplicate-member case independently discriminating" → only interchange (checker lines 156–160)
- "lifecycle scenario count assertions" → only lifecycle-events
- "Type-change wording … settled Types direction" → only batch-subsets (held-decisions row)

`batch-subsets.md` and `check_batch_subset_examples.py` contain **zero** occurrences of "owned", "duplicate-member", "duplicate JSON", or "lifecycle" — three of the four claimed repairs have no referent in that draft.

**Impact:** Draft publication review is the only authorized action, and `REVIEW.md` is the artifact that states each draft's review disposition. Read in isolation — which is how three independent siblings are read — each asserts a four-finding review that was not performed on it, making "No remaining native draft-publication blocker" unsupported per-draft.

**Fix:** Replace the shared paragraph with per-draft text naming only that draft's findings and repairs. If the council ran once across all three, say so explicitly and state which repair landed in which draft.

### H2 — interchange: in-Scope/out-of-Scope closure is decided by raw string prefix
**File:** `specs/proposals/interchange/transfer.schema.json:41-45`; `scripts/check_transfer_examples.py:74,91`

`sourceScope` is constrained only by `^https?://.+` — no trailing slash — and membership is `id.startswith(sourceScope)`. Verified end-to-end: a manifest declaring `sourceScope: "https://example.invalid/p"` makes `https://example.invalid/pirate/beads/x` an **accepted** in-Scope head.

Core requires the canonical Scope URL to end in `/` (`core.md:922`) and derives in/out-of-Scope by resolution against it, never by string prefix (`core.md:388-399`).

**Impact:** This is the exact dimension the draft says it protects — "A package naming a source Scope does not by itself permit an unrelated store to impersonate that authority" (`interchange.md:82`). A foreign authority's Resource can be classified in-Scope, and the Link endpoint classification at line 91 inherits the same flaw in both directions, so the advertised "required local endpoint/pin closure" is unsound at its boundary.

**Fix:** `"pattern": "^https?://[^?#]*/$"` on `sourceScope`; compare on a path-segment boundary (or resolve-and-compare). Add refusal vectors for a prefix-sharing foreign scope and for a `sourceScope` without the trailing slash.

### H3 — lifecycle-events: scenario-count assertions are tautological; ownership/rollback/no-op/self-dedup coverage is claimed but not exercised
**File:** `scripts/check_lifecycle_examples.py:16-18`; `lifecycle-events.md:81-87`

The checker computes `counts` **from** `case["facts"]` and compares it to `case["expectedCounts"]` — both authored in the same fixture. Every scenario-level negative (`owned-link-missing-source-refuses`, `rollback-extra-fact-refuses`, `no-op-extra-fact-refuses`, `ordinary-incidence-extra-bead-refuses`) fails only because its count annotation was deliberately written to disagree with its own fact list. There is no model of the operation that should have produced those facts.

Evidence: `rollback-extra-fact-refuses` and `no-op-extra-fact-refuses` are byte-identical apart from `name`; so are `rollback-zero-facts`/`ordinary-no-op-zero-facts` and `pinned-link-delete`/`ordinary-incidence-no-bead-version`. `self-link-projected-once` vs `duplicate-self-projection` differ only in `visibleFactIndexes`, and the sole mechanism is a duplicate-index check — no model of two endpoint Event Sources exists.

**Impact:** The draft claims the artifacts make "ownership, self-Link deduplication and rollback/no-op expectations inspectable" and that "Explicit per-scenario Resource-kind counts reject missing source or spurious endpoint/no-op facts." Only *missing Link deletion context* and *update-postimage drift* are actually enforced (by the schema's `if`/`then`). The rest checks the fixture author's arithmetic against itself.

**Fix:** Give each case an explicit scenario input (operation list + ownership facts — the pattern interchange now uses via `ownership-facts.json`) and derive the expected fact set from it. Otherwise narrow the prose to "shape and annotation-consistency vectors" and list ownership/rollback/no-op/self-dedup as unexercised.

### H4 — lifecycle-events: the carrier admits facts the draft's own prose forbids
**File:** `specs/proposals/lifecycle-events/fact-cases.schema.json:192-203, 168-191`

Verified **accepted** by `$defs/fact`:

| Probe | Contradicts |
| --- | --- |
| `imported` fact carrying `delta: {properties:{title:"faked"}}` | `lifecycle-events.md:52` "No fake property delta" |
| `imported` fact carrying `initialState` (full postimage) | `:22` delta-not-postimage principle |
| `deleted` fact carrying `initialState` + `delta` | `write.md:3556-3557` "Deleted Events do not retain the Resource's properties" |
| `created` fact carrying `previousRevision` + `delta` | `:21` "Creation carries the admitted initial state" |
| `imported`/`updated` with empty-string revisions | Core `revision` is `minLength: 1` |

No negative vector covers any of these.

**Impact:** The import transition is the draft's novel content and the one the interchange draft depends on. A carrier that accepts a fabricated import delta cannot make the "no fake property delta" rule inspectable, and the deletion case drifts against a current Write prohibition rather than an open decision.

**Fix:** Add `not: {anyOf:[{required:["delta"]},{required:["initialState"]}]}` to the `imported` branch; forbid `initialState`/`delta` on `deleted`; forbid `previousRevision`/`delta` on `created`; `minLength: 1` on every revision string. One refusal vector per rule.

---

## Medium

### M1 — interchange: the documented inline example is refused by its own colocated scaffold
`interchange.md:62` uses `"resourceContract":"urn:example:memory-v2-contract"`; `transfer.schema.json:38-40` pins it to a `const` of `urn:bdp:wip:core-carrier:d7197e9…`. Verified: the example fails at `$.resourceContract`. The example's link type (`memory-association`) also differs from the fixture's (`association`). The digest claim at `:59` is correct — I recomputed `daad2eb6…` and it matches.
**Fix:** Use the scaffold's value in the prose example and recompute the digest, or label the example explicitly as pre-freeze and schema-nonconforming.

### M2 — interchange: reusing `beadRecord` admits the derived incident-Link aggregate and makes `metadata` optional on heads
`transfer.schema.json:84,103`. Verified accepted end-to-end: a head Bead record carrying `links: {items:[], next:".../?view=links&direction=both&cursor=opaque"}`, and a head record with `metadata` entirely absent.

Core already solves both: `historicalBeadRecord` sets `links: false`, `currentBeadRecord` requires `metadata`, and `stateChange`'s upsert branch applies `links: false` for exactly this reason. `interchange.md:55` claims records "retain the same envelopes and Reference forms as canonical reads"; Core guarantees "Successful reads always expose `metadata`: `{}` means no members are set" (`core.md:1316`).

**Impact:** A cursored derived view page can be smuggled into a version record. Absent-vs-`{}` metadata becomes ambiguous in a profile whose stated obligation is preserving "derivation absence/empty/populated distinctions" (`:187`).
**Fix:** Reference `currentBeadRecord`/`currentLinkRecord` for `head: true` and `historicalBeadRecord`/`historicalLinkRecord` for `head: false`; or add `"links": false` + `required: ["metadata"]` to the wrapper. Add both refusal vectors.

### M3 — interchange: Resource IDs are not checked against the fixed `beads/`/`links/` roots
Verified: a package whose only Bead is at `…/alias/x` and only Link at `…/notlinks/y` is **accepted**. Core fixes exactly two roots — "No other Scope-relative path acquires Bead or Link semantics, except the alias root" (`core.md:252-258`) — and `alias/` is specifically not a Resource, while sharing one uniqueness namespace with canonical Bead segments (`core.md:274`).
**Impact:** An identity-preserving handoff could publish Resources at addresses the destination must never assign Resource semantics to, including the alias namespace.
**Fix:** Require bead IDs to match `^{sourceScope}beads/` and link IDs `^{sourceScope}links/`; add a vector per wrong root, including `alias/`.

### M4 — interchange: Core's number-admissibility rule is unexercised; the only number vector is NaN
Verified: `properties: {"n": 9007199254740993}` is **accepted** end-to-end. Core makes RFC 7493 §2.2 binary64 round-trip admissibility mandatory and names this exact literal as inadmissible (`core.md:713-731`); `write.md:519` routes inadmissible numbers separately from `malformed-request`. The checker sets `parse_constant` (NaN/Infinity) and `parse_float=Decimal` but never applies admissibility, and leaves `parse_int` default.
`interchange.md:43` claims "unsupported numeric values refuse rather than being replaced or rounded," and the vector name `non-json-number` reads as covering the number contract.
**Fix:** Apply the round-trip admission test to parsed `Decimal`/`int` values; add vectors for `9007199254740993` and a 20-significant-digit decimal. Otherwise rename the vector and state that Core's number model is unexercised.

### M5 — interchange: R27a Memory-body consent has zero fixture coverage while being asserted as a profile obligation
`memoryBodies` is inert in both positive packages (`true`, with no Memory-typed Bead present), and no refusal vector covers records-without-consent (I grepped the matrix; the only "memory" hit is the `remove-old-memory` mutation name). Yet `:78` states the refusal rule normatively and `:189` asserts the R27a row. The negative-fixture list at `:169` omits consent and the artifact section at `:240-248` does not name it as unexercised.
**Fix:** Add a declared Memory-Type fact file (mirroring `ownership-facts.json`) plus a `memoryBodies:false`-with-Memory-record refusal vector, or add consent to the explicit not-exercised list.

### M6 — batch-subsets: the fixture resolves a refusal-precedence question the draft leaves held
`check_batch_subset_examples.py:26-30` classifies *any* bundle-schema failure anywhere in the body as `malformed` before looking for an unsupported member, and the `unsupported-then-malformed` vector (unsupported at index 0, malformed at index 1) asserts `malformed`. The prose states only "Report the first unsupported member in request order" and "Malformed/unknown records … remain distinct" (`:28-33`). The held "Refusal wire" row covers fields and pointers; "Admission" covers retained-replay/support-check order. Neither states global malformed precedence — and the draft itself warns "These choices are not resolved by illustrative test-field spelling" (`:53`).
**Fix:** Either state the precedence normatively in §Selected direction, or move it into the held table and mark that vector as illustrating one candidate ordering.

Separately: the classification enum has no `unknown` class, so `unknown-operation` (`{"operation":"close"}`) folds into `malformed` — defensible under one reading of `:33`, but the artifact bakes in that reading. Worth one clarifying sentence.

### M7 — lifecycle-events: dropping `linked`/`unlinked` silently removes the `endpoint` role discriminator and reverses the current self-Link rule
Current Write requires a self-Link's one endpoint Bead to receive **two** graph facts, `source` before `target` (`write.md:3597-3600`), and `LinkDeltaData` carries `endpoint: source|target` so an endpoint consumer learns which role the Bead plays (`write.md:3567-3572`). The draft's "One self-Link lifecycle fact is projected once per applicable Source, not twice for its two endpoint roles" (`:36`) reverses the former, and the fixture carrier has no `endpoint` member at all. The held list mentions "Group/receipt Event counts and limits after incidence projection changes" but never the role discriminator or the self-Link rule being replaced.
**Fix:** Add both to §Decisions held explicitly — the replaced two-fact self-Link rule, and whether endpoint role survives as a projection member or must be derived by the consumer from `linkContext`.

### M8 — lifecycle-events: the carrier omits Link creation endpoint context that current Write requires
Verified: a `link` + `created` fact with no `linkContext` is **accepted**. Current `createdData` carries `source`/`target` as a `dependentRequired` pair, and `write.md:3552` states "For a Link, it also contains the Link's source and target endpoint references." The draft addresses endpoint context only for deletion (`:25-27`).
**Fix:** Require `linkContext` for `link`+`created` (and decide `updated`/`imported`), or record in the held list that Link creation endpoint context is deliberately unresolved.

### M9 — all three: test datasets placed against the repo's own stated layout rule, which none amends
`specs/README.md:45` (unchanged by all three) says "Test checkers live in `scripts/` and test datasets in `fixtures/specs/`." The existing precedent follows it: `scripts/check_type_examples.py` reads `fixtures/specs/issue/domain-property-cases.json`, documented in `specs/profiles/types/README.md`. All three new drafts instead place datasets under `specs/proposals/<name>/examples/`. The README's structural paragraph ("`core`, `write`, and `types` directory names organize documents") also never mentions the new `proposals/` tree. The base commit is specifically "reconcile PR150 with frozen specification layout."
**Fix:** Move datasets to `fixtures/specs/<proposal>/` (keeping schemas beside the prose), or amend the README's layout sentence and structural paragraph once to cover `proposals/`.

### M10 — interchange: the Polly recommendation citation does not resolve to the text it pins
`docs/design/iris-inception-format-review.md:7` pins the reviewed text to `/Users/dbox/.local/state/polly/inception-20261017/RECOMMENDATION.md`, SHA256 `b09e15e6…`. That file exists but now hashes to **`1e2b7786…`**; the `b09e15e6…` bytes are retained nowhere (the only occurrence of that hash anywhere I searched is the citation itself). The "subsequent reviewed recommendation" restated at `:44-49` and `interchange.md:256-263` carries no path, hash, or date at all. The path is also outside the repository, so it is unreviewable by anyone but this machine.
**Impact:** Settling the Provenance V2 representation is an explicit pre-freeze gate (`interchange.md:200-202`); neither the reviewed nor the superseding text is verifiable by the owner who must decide it.
**Fix:** Commit the reviewed and superseding text (or hashed excerpts) under `docs/design/` and cite both with hash + date. If that is not permitted, state plainly that the pinned revision is superseded and unavailable.

### M11 — interchange: owned-Link closure for retained non-head versions is undefined, and the checker enforces an unstated rule
`check_transfer_examples.py:95-99` requires every inline owned Link on *any* version record — head or not — to appear as its own `version` record with a byte-equal first-class copy. The include table admits only "Current heads plus retained versions required by included pins" (`:23`), which does not cover the historical owned-Link versions a retained owning-Bead version would inline. The fixture avoids the case (the retained `procedure` version owns nothing).
**Impact:** A package carrying a retained owning version would either be refused for omitting Link versions the profile never admits, or must carry versions outside the declared closure.
**Fix:** State the rule — include the historical owned Links, or refuse such versions as unrepresentable in the initial profile — and add a fixture.

### M12 — interchange: two distinct artifacts cited behind one URL
`docs/design/iris-batch-memory-retyping-note.md:9-10`. Bullet 1 ("Current batch decision record … This is local design, not an implemented batch replacement") and bullet 2 ("Public bounded request: BDP #152") both link `https://github.com/gastownhall/bdp/issues/152`. If bullet 1 is a local record, the public issue URL is the wrong citation.
**Fix:** Cite the local record by its actual path/hash, or merge the bullets.

---

## Low

- **L1** — interchange: `incomplete-provenance` does not test the all-or-none group it names. The mutation sets a bare `committedAt` string, failing Core's `contextTime` shape instead. I confirmed the group *is* enforced (a well-shaped `committedAt`-only envelope is refused), so the rule holds. **Fix:** use `{"committedAt":{"state":"present","value":"…"}}` and add a separate malformed-shape vector.
- **L2** — interchange: the `surrogate` vector's in-record mutation (checker line 138) is dead code — the candidate is rebuilt from `encode(base)` with a byte substitution. The special case is necessary (`json.dumps(..., ensure_ascii=False).encode()` would raise outside the try block), but the dead line misleads. **Fix:** drop it or comment why it is bypassed.
- **L3** — batch-subsets: "Frozen Core/updateBead wire" (`:51`) attributes a Write/bundle surface to Core; `updateBead`'s request wire lives in `write.md` and `updateBeadMembers`, Core only names operation URLs (`core.md:131-136`). The substantive claim is correct — I verified `updateBeadMembers` admits only `bead`/`propertiesChange`/`metadataChange`/`expectedRevision`/`revisionProvenance` and is shared by `updateBeadRequest` and `updateBeadOperation`, so same-ID retyping is unsupported. Same row cites "Types §2" for both whole-reference replacement (correct, `types.md:66-71`) and targeted-vs-replacement responsibilities (that is §3.6, `types.md:320-330`). **Fix:** cite Write/bundle and §3.6 respectively.
- **L4** — all three: the new `REVIEW.md` files are unlinked from the proposal, `specs/README.md`, and `STATUS.md`, so a reader following either index never reaches the validation-status page. **Fix:** link it from each proposal's artifacts section.
- **L5** — all three: each draft inserts its row at the same position in `specs/README.md` (immediately above the Memory PR143 row) and appends a `##` section to the same `STATUS.md` tail. All correctly preserve the PR143 pending row. As independent siblings they will textually conflict if landed together. **Fix:** note the expected conflict and intended row order in each `REVIEW.md`, or land the index rows through one coordinating change.
- **L6** — interchange: the "Shared Inception design update — October 17, 2026" paragraph is duplicated verbatim across `interchange.md:218` and `iris-memory-interchange-plan.md:100`, with a second near-duplicate pair at `iris-inception-format-review.md:44-49` / `interchange.md:258-263` — one normative-track, two nonnormative. Divergence risk. **Fix:** keep it in one place and link.
- **L7** — batch-subsets: the proposed `operation-not-supported` code requires extending the closed `directProblemCode` enum (the held "Refusal wire" row covers this, so not a defect). Worth noting concretely that the *diagnostic* members are already available — `transactionalProblem`/`readProblem` are open envelopes and `pointer` is an existing defined member — so only the code enum is a bundle amendment.

---

# Verified sound

Not praise — scope of what I confirmed, so you know what the findings do *not* cover:

- **No current wire touched.** No draft modifies `specs/profiles/**` or `specs/conformance.md`. Both schema bundles are byte-identical to base **and** to each other (`0baa5d5e…`) in all three worktrees.
- **All local links resolve.** I checked every relative link and `#anchor` across all three drafts, both READMEs, both STATUS entries, and the three design docs. Zero broken links, zero bad anchors.
- **All checkers pass offline** from local uv cache, no network: interchange 2 positive + 22 refusal; batch-subsets 10; lifecycle 20. The pre-existing type checker reports "6 schemas; 95 positive/negative shape cases," matching interchange `REVIEW.md`'s claim exactly.
- **Each refusal vector I traced fails for its intended single reason.** The `duplicate-json` digest recompute closes the one case that could previously have passed for the wrong reason (digest mismatch rather than duplicate-member detection).
- **Source claims verified:** `eventType` enum is exactly created/updated/deleted/linked/unlinked and the `#events-and-event-sources` anchor resolves; "Read+Update cannot simply advertise batch" matches `write.md:2411-2414`; `batchOperation` really is the eight-record union the batch checker validates against; `8d6671e` is the main-side parent of the base merge; `core.md#L333` at that commit is exactly "For a Bead, `id` and `type` are immutable"; `38791e4c` and `9048dc7` are real objects here. The inline example's digest recomputes correctly.
- **Brief constraints honored by the drafts:** six-operation cutline and the set-ops/parameterization/Rust/query-redesign exclusions stated consistently in all three; PR143 pending row preserved everywhere and "not implicitly adopted"; origin/entry/operation split presented as Polly-owned recommendation, "not adopted wire format"; unrecorded origin stays unrecorded and explicit unknown stays explicit; origin-account correction open and not an importer prerequisite; no independent-interop claim (`interchange.md:155` is explicit that self-round-trip cannot certify it).

---

# Blocking gaps

**Blocking for the authorized action (draft publication review): H1 only.** The review-status page is what you would use to judge publication readiness, and it misstates what was reviewed in each draft. Everything else is gated behind holds you have not released.

**Blocking for format freeze** (already gated, but naming them so they are not lost): H2, H3, H4, M2, M3, M4, M5, M6. The common pattern is that each draft's prose makes a closure or strictness claim its offline carrier does not enforce, and the artifact sections do not list the shortfall. Four of these (H2, M2, M3, M4) are in interchange's Scope/root/envelope/number handling — the dimensions the import-admission contract rests on.

**Not blockers; do not "fix" these.** The held wire choices in all three held-decisions tables (discovery/profile representation, refusal wire fields, admission ordering, Event discriminator/subject fields, imported payload policy, key/name and Inception representation); `resourceContract` naming only a current-Core carrier; LF-only reader policy (honestly disclosed at `interchange.md:254-256`); deferred cross-Scope copy, local-ID encoding, `updateWhere`/`deleteWhere`, Rust startup.

**Five-slice plan (I0/L1/I1/I2/I3).** Read as nonnormative only. It labels itself so (`iris-memory-interchange-plan.md:1,9`), states that approval would authorize bounded implementation without settling contract decisions, and keeps the four contract tasks as preconditions. I found no place where it claims implementation authorization or treats a recommendation as approved schema. No implementation approval granted or implied here.

---

# Residual limits

- The drafts were being rewritten while I reviewed. Findings reflect `959c34a` / `6bdc621` / `8447dd2`. Anything edited after 14:42 PDT is outside this review.
- No engines, servers, installed Go workflows, History server, CI, builds, or production data. No external messages. Gemini excluded.
- External references were not fetched and are unverified: bdp#152, #153, #59, beads#5877, PR143's GitHub state, donnabox PRs 86–88, Trish's plan file, and Janet's base `703bb13e` (not an object in this repo — expected, it is a beads commit).
- I did not assess runtime atomicity, receipt durability, authority admission, or interoperability; those are correctly out of scope for offline artifacts, and all three drafts say so.


# Actual Claude bounded repair verification

The following is the unedited exit0 repair review. Native independently reports
no remaining draft-publication blocker, with the same artifact counts and held
pre-freeze/runtime gates. Later metadata updates and a fixture-only coherent
identity-rewrite helper are identified separately in per-draft status.

No files modified. All checks run offline from local cache; no engines, builds, servers, or published messages.

# Repair verification: no remaining draft-publication blocker

All claimed dispositions verified against the three initial heads. Every expected count matches exactly, no regressions found, and all 42 originally-passing vectors are preserved identically.

| Check | Claimed | Observed |
| --- | --- | --- |
| batch support/shape | 10 | **10** ✓ |
| lifecycle shape/count-consistency | 29 | **29** ✓ |
| transfer positive + refusal | 4 + 32 | **4 + 32** ✓ |
| existing Types checker | 6 schemas / 95 cases | **6 / 95** ✓ |
| Core + distribution bundle bytes | unchanged | `0baa5d5e…` ×6, identical to base ✓ |
| Memory PR143 pending row | preserved | present in all three ✓ |
| Local links + anchors | pass | zero real problems ✓ |

---

## H1 — fixed and verified

Cross-contamination is fully gone. I grepped each `REVIEW.md` for every repair phrase: **zero overlap**.

| Draft | Artifacts named in its own findings |
| --- | --- |
| batch-subsets | Type-affiliation only |
| lifecycle-events | fixture counts, annotation inconsistency only |
| interchange | commit-time graph, owned-state, owned-Link agreement, duplicate-member, Type update notes |

The scope paragraph now states the council reviewed the **three-draft set**, "not four repairs in every draft," names the three reviewed heads, and excludes Gemini. Each draft's Claude paragraph lists only findings I actually raised against it.

The retained record (`docs/design/iris-joint-council-review-20261017.md`, 194 lines) carries my initial report **verbatim and unedited** — I diffed the Low section, Verified-sound, Blocking-gaps and Residual-limits against what I wrote; nothing softened or dropped, including the H1 finding against the then-current REVIEW.md files. Its header correctly discloses that the findings refer to the initial heads and "are not the disposition of repaired source."

Critically, `REVIEW.md` does **not** claim my sign-off: "focused native/Claude repair verification is pending on this working revision… Do not read this as full council approval, contract adoption or runtime qualification." That was accurate when written; this audit now supplies the missing verification.

## H2/M3, M2, M4, M5, M1, M11 (interchange) — fixed and verified

I re-ran my original probe battery against the repaired checker. **All seven previously-accepted cases now refuse**, and admissible values are still accepted (no false refusal):

```
refused   sourceScope without trailing slash
refused   prefix-sharing foreign scope .../p-foreign/beads/x
refused   bead at alias/ root
refused   link at notlinks/ root
refused   head record omits metadata
refused   bead carries derived links aggregate
refused   9007199254740993
ACCEPTED  1e300 / -0.0 / 9007199254740992   ← Core's explicit admissible examples
```

- **H2/M3**: `sourceScope` pattern is now `^https?://[^?#]*/$`; `local()` compares scheme + netloc + path-prefix against a guaranteed-trailing-slash path; the root check enforces `beads/`/`links/` with ≥1 identity segment and no query/fragment.
- **M4**: exact `Decimal`/`int` values compared against real Node `String(Number(s))` — the correct reading of Core's binary64 shortest-form rule, and genuinely not a Python substitute. Fails safe: a missing `node`, nonzero exit, or garbage output all raise rather than passing.
- **M1**: stronger than what I suggested — the checker now *extracts* the prose ```jsonl fence and requires byte-equality with `connected.jsonl`, so the example cannot drift again.
- **M11**: closure rule stated (retained first-class owned-Link versions, recursively, with required endpoint/pin state; refuse rather than revive terminal/deleted), with `historical-owned.jsonl` as a positive and `missing-historical-owned-version` as its refusal.

Ten new refusal vectors, one per new rule, plus two new positive packages.

## H3, H4/M8, M7 (lifecycle) — fixed and verified

- **H3**: narrowed exactly as needed — "Counts check fixture annotation consistency only: they are not derived from operation inputs," followed by an explicit list of what is unexercised (ownership causality, rollback, no-op execution, two endpoint Event Sources/self-Link projection). Checker output renamed to "fixture shape/count-consistency vectors." No toy operation engine added, as you required.
- **H4/M8**: all five rules enforced and probed — `created` forbids `previousRevision`/`delta`; `deleted` forbids `initialState`/`delta`; `imported` forbids `delta`; `link`+`created` requires `linkContext`; every revision is `minLength: 1`. Nine new vectors, one per rule.
- **Imported postimage correctly left open**: `imported` + `initialState` is still accepted. That matches your held decision and the prose ("does not prohibit a future agreed reconstructible postimage by fiat"). I am not demanding a prohibition.
- **M7**: the replaced rule is now named explicitly — "deliberately replaces current Write's two incidence facts (source before target)" — with endpoint-role encoding/disclosure held.

All 20 original cases preserved byte-identically; 9 added.

## M6, L3, L7 (batch) — fixed and verified

The precedence is now framed as the **current Write baseline**, not the amendment's ordering, and the combined vector is explicitly labeled as illustrating that baseline with "final new-control placement remains in the held admission decision." I verified the baseline claim against `write.md:2522-2524`: "a noncanonical local ID spelling, or a supplied `id` beneath the wrong fixed root is `400` `malformed-request`. Invalid complete grammar of an embedded Selector is also `400` `malformed-request` **before key lookup**." Accurate. Unknown-operation-is-malformed-under-closed-vocabulary is now stated rather than implied. §3.6 and Write/bundle citations corrected; pointer-exists-vs-code-enum inventory stated correctly.

## M9, M10, M12, L1–L7 — fixed and verified

M9: datasets moved to `fixtures/specs/<proposal>/`; the batch fixture is byte-identical across the move (`ace35a0a…` both sides). The README layout paragraph is amended with **identical text in all three**, so that hunk merges cleanly. M10: the hash is now labeled a superseded, unretained, non-public historical working revision — "the digest is not a resolvable citation… Do not use it to freeze a schema" — with Polly required to supply durable public evidence before freeze. M12 merged. L1 vector now uses well-shaped `{"committedAt":{"state":"present",…}}`, so it tests the `dependentRequired` group rather than a shape error. L2 dead code removed with a comment. L4 `REVIEW.md` linked from all three proposals. L5 index-conflict disposition with explicit row order in all three. L6 Inception prose deduplicated to one owning location; the `#shared-inception-design-update--october-17-2026` anchor resolves.

---

# Pre-freeze limits (named, not blockers)

1. **Non-canonical in-Scope endpoint spellings are classified external and skip closure.** `local()` compares netloc by exact string, so `https://EXAMPLE.invalid/p/beads/absent` and `https://example.invalid:443/p/beads/absent` are treated as opaque external references — I verified both are **accepted** in a package where the referenced Bead has no head, i.e. the closure requirement is skipped. Current Write is stricter (`write.md:2522`: a noncanonical local ID spelling is `malformed-request`). This sits inside the draft's stated "not a complete canonical-URI normalizer" disclaimer, but it is the one place where the disclaimer's failure direction is *admit* rather than *refuse*. **Fix before freeze:** refuse a reference whose scheme+host matches case-insensitively or after default-port removal but is not the canonical spelling, rather than reclassifying it as external — `scripts/check_transfer_examples.py:57-60,118`.
2. **Local-ID segment grammar unchecked.** `…/beads/x/` and `…/beads/a/../b` are accepted; Core (`core.md:1001-1007`) makes empty, `.`, `..`, backslash and encoded-separator segments invalid. Same disclaimer family. **Fix:** segment-grammar check plus two vectors.
3. **Node is now a hard prerequisite** of the interchange checker, but the documented run line is still only `uv run … python scripts/check_transfer_examples.py`; Node appears in the next paragraph. Fails safe (loud crash, never a false PASS), so this is a documentation nit — name Node in the run instruction.
4. **Latent, currently unreachable:** `base` is now read only by the surrogate branch while every other vector reads `positive[case.package]`. A surrogate-style vector attached to a non-`connected` package would mutate the wrong bytes.
5. **Carrier looseness (lifecycle):** a `deleted` **bead** fact may carry `linkContext` (verified accepted) though a Bead has no endpoints. Harmless in a fixture-only carrier. `link`+`updated`/`imported` context is deliberately held per the prose.
6. **M1's byte-equality guard covers only the first ```jsonl fence** in `interchange.md`; a second fence added later would be unchecked.
7. **The joint record exists only in the interchange worktree.** The batch and lifecycle `REVIEW.md` files reference it via the PR165 URL and say "in PR165," so no local link is broken, but a reader working only in those two trees cannot open it locally.
8. **Unchanged from the first review:** external references remain unverified (#152, #153, #59, beads#5877, PR143's GitHub state, PR165, donnabox PRs 86–88, Janet's `703bb13e`); no runtime, atomicity, receipt-durability, authority-admission or interop assessment; CI absent on these branches. Held wire/discovery/import-head/provenance/authority/recovery decisions remain open and I treated none of them as defects.

Native Memory Type-change direction reads as settled in both drafts that touch it — complete-result validation via either targeted edits or explicit replacement, with no BDP prerequisite — consistent with your instruction.


# Final fixture-helper audit

Native Codex and actual Claude independently reviewed the fixture-only identity rewrite and four negative-vector uses. Both report no blocker; 4 positive packages and 32 refusal vectors still pass. The helper rewrites exact identity values (not map keys or substrings); those limits match its four current callers. No admission rule or contract choice changed.

Guard-sensitivity experiments disabled one check at a time in memory: root, exact-number admission, and Memory consent. Each incorrectly admitted its intended negative, and the experiment detected that admission. These are checker sensitivity checks, not runtime or full semantic-coverage proof.

Actual Claude final helper report (unedited):

**No blocker.** The delta is correct and introduces no regression.

`replace_fixture_identity` (lines 148–156) is sound: exact-string equality, recursive over lists/dicts, `records[:] =` slice-assigns so the caller's binding sees the rewrite. Both `old` arguments (`records[2]`/`records[4]`) are evaluated before the call, so no self-referential staleness.

Verified for all four uses: **zero stale references to the old identity remain**, inline owned-Link copies are rewritten in step with their first-class records, and each case still refuses. The intent holds — each negative now fails on its target predicate rather than on leftover-head or inline/first-class disagreement:

- `foreign-id`, `scope-prefix` → `local()` scheme/netloc/path-boundary
- `wrong-bead-root`, `wrong-link-root` → fixed `beads/`/`links/` root check

Checker still reports `4 positive packages and 32 refusal vectors`. The helper is referenced only in those four `elif` branches, so the other 28 vectors and 4 positives are untouched.

Two cosmetic notes, neither a defect here:

1. `replace` rewrites dict **values** only, not keys. Harmless now (only Resource identities are targeted; `ownedLinks` keys are Link **Type** URLs), but a future vector mutating a Type URL would silently miss the key. One comment line would pin that.
2. Exact-equality means an identity embedded as a *substring* (e.g. inside a `next`/cursor URL or property text) is not rewritten. Not present in these fixtures.

Documentation-only changes noted, not re-audited. Format freeze and runtime remain unapproved; the canonical-URI/segment-grammar and Node-prerequisite pre-freeze limits stand as previously recorded, and I have not resolved any held decision.
