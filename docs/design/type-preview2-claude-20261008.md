# Claude council review — consolidated Type design, October 8, 2026

Complete independent reviewer output follows. Input snapshot:
`659bc85e3931f934db7a4642c1ea6a9a04ce1c7c`; review-only CLI exited successfully.
The [council disposition](type-preview2-council-20261008.md) records accepted
corrections, rejected overstatements and open product choices. Findings and
recommended policies here are reviewer opinion, not adopted BDP rules. This review
predates the resulting corrections; it is not a re-review of the final revision.

---

## Independent review — Preview 2 Type design

Scope read: `docs/design/type-lifecycle-preview2.md` (551 lines), `docs/design/type-preview2-decision-packet.md`, `CONTEXT.md` §"Proposed Type lifecycle vocabulary". `docs/specs/bdp.md` used only for existing-law crosschecks (line cites verified). No files written, nothing delegated.

---

### F1 — Critical. Guarantee 1 is stated at contract level but applied at stored-data level; the two readings give opposite family verdicts

**Where:** `type-lifecycle-preview2.md:153-156` (clause 1: "every A-valid instance remains valid under B") vs. `:207` (table row "Add an optional typed field where old data could contain other values | **Not guaranteed**") and `:446` (T35: "an A-valid instance **already uses** an incompatible value"). Related: `:166-172`, `:178-197`.

**Counterexample.** Invoice A has no `dueDate`. v0 mandates open property roots (`bdp.md:3624-3631`; preserved by `:470-471` and T30 `:441`), so A *necessarily* permits `{"dueDate": 42}`. B adds `dueDate: {type: "string", format: "date"}`.
- Contract-level reading of clause 1: an A-valid instance exists in the contract's accepted set that B rejects → B is breaking, always, in every deployment. Since open roots are mandatory, **no constrained additive field is ever same-family**, for any Type, ever.
- Data-level reading (what `:207` and T35 actually use): B qualifies in a Scope that happens to hold no non-conforming `dueDate` value and does not qualify in the Scope next door. Family membership then becomes deployment-dependent, which contradicts globally published immutable exact definitions (`:67-70`) and a globally published SemVer label (`:226-228`).

**Impact.** This is the center of the document. Under reading 1, the compatibility family can hold no structurally distinct member at all — `:167-172`'s set-equality corollary becomes a theorem, the only compatible changes in the entire draft are documentation (`:208`) and recognition of already-permitted values (T40 `:452`), and §1's motivating complaint (`:20-23`, "requiring a completely new nominal Type for every contract change makes ordinary evolution difficult") is answered only by crossing a major boundary — whose migration policy is wholly deferred (`:220-224`, D10). Under reading 2 the two guarantees are not properties of the definitions at all, and D05's "claim evidence" has nothing stable to evidence. Both readings are present in the same section, so every "Same-family conclusion" cell and T07/T33/T34/T35/T42 are two-valued — failing the draft's own settled-spec test that "every included behavior has one expected outcome" (`:518-519`).

**Smallest fix.** Three sentences in §4: (a) state that both guarantees are evaluated against **contracts**, not stored data, and reword `:207` and T35 to drop "already uses"; (b) state the corollary plainly — *within a family no definition may change the accepted instance set, so all structural change is a major boundary and minor/patch designations carry no additive structural capability*; (c) relocate §1's evolution promise to the real mechanism (one nominal identity spanning major families, `:221-222`) and record under D05 whether a declared reserved extension area with publisher-reserved narrowing rights is in Preview 2 scope or explicitly out. This does not reopen the operator's ruling; it states its unstated consequence.

---

### F2 — High. Family membership is declared in §4 but evidence-gated in §5, and withdrawal of a false claim silently changes what a family predicate matches

**Where:** `:152` ("For every earlier definition A and later definition B **within one major family**" — membership presupposed, guarantees as obligations) vs. `:304-305` ("a family predicate can be fixed while future definitions **qualify under its rules**; evidence and trust still need design") and `CONTEXT.md:38-40`, which defines "Type compatibility family" by the property ("An ordered family of definitions **preserving** both…"), i.e. the earned reading. Also `:216-217`, `:229-231`, T26 `:437`.

**Counterexample.** A Link's requirement is a fixed "family 1 of Invoice" predicate. Invoice 1.3.0 is published with a compatibility claim, instances adopt it, and the claim is later discovered false and trust withdrawn (`:229-231`, T26). Under `:152`/label membership the predicate still matches those instances and the Link stays valid, but the family's MUST is now known violated with no model-level consequence. Under `:304-305`/qualification membership the predicate stops matching, so **an administrative trust action flips graph validity with no data change** — which collides with `:174-176` ("these promises do not bypass … independent Scope policies") and with `:343-344` ("Publishing a new definition alone does not change the closure of an already pinned instance"). T26 settles admission, existing data, retained evidence and diagnostics *separately* but says nothing about matching.

**Impact.** D05 cannot specify false-claim handling and D06 cannot choose creation-time vs. continuous validation without choosing; the §4 table's verdict column and §5's requirement table are reading-dependent.

**Smallest fix.** One sentence after `:152`: family membership is the publisher's declared major partition; the two guarantees are obligations on publication, and a violating member is non-conforming (handled by D05 trust withdrawal and diagnostics), never silently removed from the partition. Then add to T26's expected outcome: "a family predicate's result for already-matched instances does not change on withdrawal," and align `CONTEXT.md:38-40` to the declared-partition definition.

---

### F3 — High. Both guarantees quantify over instances, so a tightening of consumer obligations passes them — although §4 says consumer handling is part of the semantic contract

**Where:** `:153-160` (both clauses quantify over instances only) vs. `:183-184` ("A consumer's handling of unknown fields/values and absent optional fields **must also be part of the semantic contract**"). T40 `:452` is the only "compatible" acceptance case and it turns on exactly this untested dimension.

**Counterexample.** A's contract: "consumers MUST ignore unrecognized `labels` keys." B's contract: "consumers MUST reject a record carrying unrecognized `labels` keys." No schema text changes. Clause 1 holds (identical accepted sets). Clause 2 holds (every B-valid instance satisfies A's instance-level structural and semantic guarantees). So B qualifies as same-family — yet every B client rejects data the family exists to keep usable. Symmetrically, T40's B tells clients they *may display* a key A told them to ignore; neither clause evaluates that change, so T40's "Both guarantees can hold" verdict is reached without testing the thing that actually moved.

**Impact.** The guarantee pair does not cover the one direction §4's own extension-point discussion depends on; D05's evidence rules would check instance sets and declare victory.

**Smallest fix.** Add clause 3 to the §4 ruling: "B's stated consumer obligations MUST NOT be stricter, with respect to A-valid data, than A's." Add a T40 sibling case where only the consumer obligation tightens, expected outcome: not same-family.

---

### F4 — High. "A generic reader needs no Type definitions" is false under existing law for Bead records, and the read-path definition dependency is unaddressed

**Where:** `:76-78` ("A generic reader can traverse Beads and Links and compare nominal Type identity without interpreting Type definitions"). Existing law: `bdp.md:456-468` (the `ownedLinks` member is present/empty per the Type's `ownsOutgoing`), `bdp.md:1818-1822` ("empty `ownedLinks` entries follow from the Type Descriptor rather than from the Event: a consumer that reconstructs a record from Events alone cannot know which empty entries the record carries without the Type Descriptor"), `bdp.md:3556-3557` (the read-only exemption, written when the catalog was fixed).

**Counterexample.** `invoice-123/state x` pins definition a with `ownsOutgoing: {cites: {max: 5}}`; state y pins b with `{"*": {max: 20}}` and no `cites` entry. The two versions' records have different `ownedLinks` key sets over the same Links, so a read-only replica or changefeed consumer must resolve the **per-version pinned definition** to render either record. If a is later deactivated or purged (§7 `:362-363`, T13 `:424`), no retained version pinned to a can be read conformantly — and the Read profile's problem table is closed and contains no Type-related code at all (`bdp.md:2452-2470`), so there is no expressible outcome. Note this also means an affiliation-only pin change (T38 `:450`) alters derived read output with no property and no owned-Link mutation.

**Impact.** Definitions become a read-path and replication dependency, not only a mutation-path one — which undercuts the "bounded offline validation from installed artifacts" framing (`:375-376`) and the retention argument in `:476-479`. T25 covers *delete* with an unavailable closure; nothing covers *read*.

**Smallest fix.** Scope `:76-78` to traversal and nominal-identity comparison, and add one sentence noting that `ownedLinks` projection already requires the pinned definition. Add "`ownedLinks` derivation and the Read-profile problem table" to §11's reconciliation list (`:505-513`). Add one acceptance case: read a retained version whose pinned definition is deactivated/purged — outcome owned by D09.

---

### F5 — High. Floating selection that resolves to the already-stored pin has two stated outcomes inside the same confirmed ruling

**Where:** `:256-257` ("Explicit floating selection requests selection of the currently chosen definition; it is **not** an identity assertion or a **no-op**") vs. `:274-275` ("Re-selecting the already stored exact pin **adds no affiliation change**; ordinary property/owned-state change rules still apply"), both inside "§5 October 8 ruling." Existing law: `bdp.md:700-707` (a revision is minted only by a change to `properties` or owned Links; an equal-properties update retains the revision and emits no `updated` Event) and `bdp.md:3909-3910` (a semantic no-op returns `updated` with the retained revision).

**Counterexample.** `update --bead-type Invoice` (floating), no property change, where the Scope default already resolves to the stored pin b. Reading `:256-257`, this is an explicit adoption and must be observable per `:272-274` and T38 → new revision, new event. Reading `:274-275`, resolution lands on the stored pin, so it degrades to a v0 semantic no-op → retained revision, no event. A client polling revisions to confirm adoption, and an `expectedRevision` guard in a Read+Update sequence, behave differently under the two readings. T04 (`:415`) and T38 (`:450`) both assume the pin actually changed.

**Impact.** D08's "retain resolved pins across replay" cannot be specified without this; the ambiguity is observable in revisions, events, history and concurrency guards — the exact surfaces `:272-274` says must observe pin changes.

**Smallest fix.** Reword `:256-257` to say floating selection always performs resolution and resulting-state validation, and that **observability is determined solely by whether the resolved exact pin differs from the stored pin**; add that case to §9. Separately, add "Revisions, no-op detection and `expectedRevision` semantics (`bdp.md:698-707`, `3908-3910`)" to §11's reconciliation list — it is the one v0 clause §5 and T38 directly amend and §11 does not name it.

---

### F6 — High. Metatype definitions' status as resources is undecided in a way that leaves packaging and cross-authority copy with no reachable outcome

**Where:** `:113-126` (finite built-in bootstrap; "The metatype can itself have versions"; "A Type definition retains its exact metatype affiliation just as any other Bead retains its Type pin"), `:303-304`, T18 `:429`, T37 `:449`, T28 `:439`, D01 `:390`, D11 `:400`.

**Counterexample.** Authority X publishes Invoice definition b pinned to metatype v2. §7's Package row requires "a resolvable dependency closure"; b's closure includes metatype v2. Import into authority Y whose built-in bootstrap is metatype v1:
- If metatype definitions are retained first-class Type Beads, v2 is an installable closure member and the import is fixable — but then the built-in bootstrap must be addressable, retained under `:476-479`, erasable under D09, and visible to the floating nominal filter of T39, none of which §3 or §7 states.
- If metatypes are implementation-supplied capabilities, v2 can never be installed, the import is *permanently* unresolvable, and T28's "defined missing-definition behavior" is the wrong frame — it is a capability mismatch, not a closure gap resolvable by installation (and `bdp.md:2501`/`2556`'s `type-not-installed` is the wrong code for it).

**Impact.** T37's "admission requires supported semantics" and D11's "resolvable dependency closure" conflict for exactly the metatype closure member. This is a missing design explanation, not merely an open mechanism: the operator ruled metatype versioning possible, which makes the question unavoidable.

**Smallest fix.** One D01 sub-decision — are metatype definitions retained, addressable, packagable resources, or implementation capabilities? — plus one acceptance case: import a definition pinned to an unsupported metatype version, with the outcome explicitly distinguished from a missing installable dependency.

---

### F7 — Medium. Type Beads in a data Scope create an authorization asymmetry the draft never raises, in both directions

**Where:** `:135-141` (placement open: dedicated Scope or shared data Scope), `:104-107` ("permits ordinary graph relationships involving the Type Bead, subject to normal rules" / "An affiliation is nevertheless an intrinsic dependency, not an ordinary incident Link"). Existing law: `bdp.md:473-486` — an Authorization View's closure runs over *owned Links and their target Beads* only.

**Counterexample.** Type Beads share the data Scope. A view grants a reader the Invoice instances but hides the `Invoice` Type Bead under ordinary Bead-level policy. The reader can read instances but cannot resolve their pinned definitions — cannot validate, cannot render the derived projections of F4, cannot tell whether a filter result is contract-homogeneous. v0's view-closure rule gives no coverage here precisely because affiliation is deliberately *not* a Link (`:105-106`). The reverse channel is equally real: a definition discloses field names, enum values and ownership bounds to parties denied the instance data.

**Impact.** An intrinsic dependency that the authorization model does not track; the consequence is created by the Types-as-Beads choice itself, so it is in BDP's shared-semantics lane, not Beads'.

**Smallest fix.** Add to §3's placement paragraph and D01/D09 the obligation that a definition's read access be at least as broad as read access to any resource pinned to it (or state the failure outcome), and note explicitly that affiliation sits outside v0's view-closure rule.

---

### F8 — Medium. Existing saved Selectors silently under-match once instances carry versioned affiliation; v0's own pin-transparency precedent is not cited

**Where:** `:293` (row "Conformance queries and saved selectors" — flagged, but with no acceptance case), T39 `:451`, T17 `:428`, `:511-513`. Existing law: `bdp.md:825` ("A Selector compares stored values exactly") and `bdp.md:827-829` (dedicated `source`/`target`/`endpoint` collection filters are "the pin-transparent way to select by endpoint").

**Counterexample.** A stored selector `$[?@.type == "https://work.example/types/invoice"]` matches every Invoice today. Once the stored discriminator carries a version — any widening §11 contemplates — the same selector returns zero or partial results with `200 OK`: no error, no diagnostic, no `type-not-installed`. This is exactly the hazard v0 pre-empted for endpoint pins by adding pin-transparent dedicated filters rather than touching exact-compare selectors.

**Impact.** Silent result change for every saved query, SDK selector and set-mutation selector (`bdp.md:831-833` — the same Selector drives set mutation, so a silent under-match is a silent under-*write*). §11 warns against widening the discriminator "in only one artifact" but §9 never tests it.

**Smallest fix.** Add one acceptance case: unchanged `@.type ==` selector evaluated over new-model instances (retrieval *and* set mutation). Record under D12 that v0's endpoint precedent — exact-compare selectors untouched, pin-transparency via dedicated filters — is the candidate shape.

---

### F9 — Medium. The publication plan points at an artifact that does not exist, and existing law defers Type evolution to a *follow-on specification*, not a v0 amendment

**Where:** `:531-533` ("The subsequent amendment must also add or reconcile the canonical spec's **open-question ledger entry for Type evolution**"), `:505-513`, `:469-470`. Existing law: `bdp.md:230-233` — "Installing, replacing, and governing Type Descriptors are administrator or operator concerns… That protocol **and Type evolution belong in a follow-on specification**." The 17-item ledger (`bdp.md:6668-6940`) contains no Type-evolution entry.

**Counterexample.** A reader following `:531-533` goes to the ledger to find the entry to reconcile and finds none; the actual existing hook is prose in the uniformity-principle section, and it names a *follow-on specification* — a different artifact from §11's "actual BDP amendment," with a different conformance-matrix and old-client-transition obligation than §11's gate list assumes.

**Impact.** The Monday criterion "one authoritative BDP home" (packet `:63-68`) is stated against a nonexistent ledger row, and the amendment-vs-companion choice silently changes which gates in `:515-527` apply. The draft's strongest existing-law support — v0 already deferring this exact work — is also uncited in §10.

**Smallest fix.** Cite `bdp.md:230-233` in §10's baseline paragraph, and in §11 record the amendment-vs-follow-on-companion choice as an explicit open item with the gate difference named.

---

### F10 — Medium. The only working evolution path needs a primitive the draft declines to scope, and its retained-version/changefeed amplification is unstated

**Where:** `:277-281` ("This does not authorize arbitrary multi-resource transactions or bulk adoption"), `:326-330`, §7 Migrate/rollback row `:364`, `:272-274` (every pin change is durable, event-bearing state), `:476-479` (retention duties unchanged), D10 `:399`.

**Counterexample.** Per F1, any structural Invoice change is a major boundary, so 10⁶ instances plus their owned Links must each be explicitly adopted. `:277` forbids inferring a multi-resource transaction; `:326-330` states that per-resource atomicity does not solve the connected case (adopt the endpoint first and the incident Link is invalid; adopt the Link first and it fails against A), so a mid-migration graph has no stated ordering rule. Independently, each affiliation-only adoption mints a retained resource version and a changefeed/event record even with byte-identical properties (`:272-274`), and D09/`:476-479` keep them — so a single major migration multiplies retained versions, snapshot size and replication volume by the instance count. Owned-Link sources are versioned again by each owned Link's own adoption (`bdp.md:440-448`), compounding it.

**Impact.** This is intrinsic to "every version stores an exact pin" plus "adoption is explicit per resource," not an implementation detail — and the draft's operational sections never state it, so a release owner accepting this scope has no view of the cost.

**Smallest fix.** In §7's Migrate/rollback row, name the missing primitive (a bounded, resumable, per-resource adoption plan with an explicit ordering rule for owned sources and incident requirements) and add one sentence stating the retained-version/changefeed amplification as a known consequence D09/D10 must bound.

---

### Minor (below the 10, one line each)

- `CONTEXT.md:34-36` defines **Type affiliation** as requiring *both* nominal identity and exact governing definition version, which cannot describe the legacy absent-pin records that `:80-84`, `:266-267` and T27 deliberately keep in the model and match nominally. Smallest fix: add "under the new model" to the term, or add a second term for nominal-only binding.
- `:202` (table row "Remove closed from that enum") puts a conclusion — "Structural narrowing alone is insufficient" — in the earlier-consumer-guarantees column where the other rows put Preserved/Violated. For that change guarantee 2 is in fact *preserved* (every B-valid instance is A-valid); only guarantee 1 fails. Smallest fix: write "Preserved" and let the verdict column carry "Breaking (clause 1)."
- §3's `:138` "no URL rewrite" and D02's "URL/location rules" use *URL* where the glossary's `CONTEXT.md:7-11` reserves URI for identity independent of hosting; given that the protocol-namespace question is still open, the smallest fix is to say "identity URI" in both places.

---

## Publishability

**As a coherent publishable DESIGN DRAFT: yes, conditional on F1 and F5.** The document is unusually disciplined about its own status, keeps BDP/Beads authority separate, faithfully records every operator decision I was given (Types-as-Beads, intrinsic field on Beads *and* Links, finite built-in metatype bootstrap with metatype versioning, stable nominal affiliation, exact versions freezing structure and semantics, exact stored pins with floating-resolves-to-pin and omission-preserves-pin, properties-plus-selection as one resulting state, nominal vs. exact filters with neither meaning conformance, both compatibility directions, SemVer as candidate designation only), and consistently refrains from inventing rulings on the areas marked open — D01–D12 and the §7 table are honest deferrals, not gaps. F2/F3/F4/F6 are real missing design explanations but each is fixable in a few sentences without new rulings. F1 and F5 are different in kind: they leave a *confirmed ruling* two-valued, which fails the draft's own stated bar (`:518-519`, "each included behavior has one expected outcome"). Both fixes are editorial and need no new product decision — F1 picks the contract-level reading already written at `:153-156` and states its corollary; F5 separates "performs resolution" from "produces new state."

**As an implementation-ready or adopted normative spec: no, and the draft does not claim otherwise.** `:8-14`, `:515-527` and packet `:77-82` correctly separate the two bars. On top of the draft's own list, F4 and F8 show that two existing normative surfaces — `ownedLinks` derivation plus the closed Read-profile problem table, and exact-compare Selectors — change observably under this model and appear in neither §11's reconciliation list nor §9's cases; F9 shows the target artifact (v0 amendment vs. the follow-on specification `bdp.md:233` already anticipates) is itself unchosen. Nothing here reads as an accidental v0 violation: the departures from `bdp.md:493-532` (immutable whole Type binding) and `bdp.md:700-707` (revision minting) are deliberate amendments, correctly labelled as requiring one. My disagreement is only that two of them are not yet on the draft's own reconciliation list.
