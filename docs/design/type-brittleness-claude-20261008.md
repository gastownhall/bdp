# External Claude review — October 8, 2026

Reviewer opinion, preserved verbatim below. Review-only CLI completed with exit
status 0. Inputs: the Type lifecycle draft based on PR60
`82bbf31bc019fb96e93470be6a837622630365b7`, latest operator decisions supplied in
the review prompt, and focused `docs/specs/bdp.md` source crosschecks. The reviewer
was not given the primary brittleness map. No runtime testing was requested.

**Do not treat recommendations or claimed impossibilities here as accepted
rulings.** Several conflict with agreed input semantics or overstate the available
choices. Read the [triangulation dispositions](type-brittleness-map-20261008.md#triangulation-and-disposition)
for the synthesis and explicit corrections.

---

## Conceptual brittleness map — `docs/design/type-lifecycle-preview2.md`

Read the draft in full; crosschecked against `docs/specs/bdp.md` at Beads and Links (258–490), Types (491–615), Revisions (698–780), Validation and results (1150–1197), Set mutation (1586–1660), Resource records (2886–2970), Types and Type Descriptors (3409–3715), Collection retrieval and selection (5367–5456), Version erasure (5727–5850), and the open-question ledger (6668–6940).

Framing: the draft is unusually disciplined about *not* claiming rulings it doesn't have, and most of what follows is not "the draft asserts something false" — it is "two things that are each individually reasonable cannot both be true, and the draft has not yet been forced to notice." I've taken the latest operator positions as given and not re-litigated bootstrap, Types-as-Beads, or affiliation placement. One existing-law confirmation up front, because several items depend on it: the operator's reason for an intrinsic affiliation field is correct under current law — an in-Scope Link endpoint "MUST identify a live Bead" and an out-of-Scope endpoint is opaque and never dereferenced, so a Link genuinely cannot be an endpoint and affiliation genuinely cannot be an ordinary Link. That forcing is also the source of B5.

---

### B1 — A Type identity guarantees nothing across its versions, but the model hands clients identity as their primary tool
**Severity: Critical.** §3 invariant 1, §4 table, D02/D05, T07–T09, T29.

- **Scenario.** A generic client lists `type=https://work.example/types/invoice` — a floating nominal filter, which the operator confirmed means "identity across versions." Definition A says `amount` is dollars with `status ∈ {open, closed}`; definition D says cents, adds `paused`, and drops a parent. The filter returns one population with no common field, unit, or parent.
- **Interacting rules.** "Do NOT assume consecutive Type versions are structurally or semantically compatible" + floating nominal filters match identity across versions + the uniformity principle places *all* domain behavior in "clients that interpret nominal Types" + a descriptor contributes "only a nominal Type ID, an optional JSON Schema over `properties`, conformance to other Types, and … constraints on in-Scope source and target Beads."
- **Consequence.** Nominal identity becomes an unconstrained bag. The floating filter — the one cheap cross-version instrument the design offers — carries no contract, so every correct client must pin, and every pinning client loses the ability to follow a Type forward. `conformsTo`, `linkConformsTo`, and `ownsOutgoing` keying all inherit this (B10–B12).
- **Smallest question.** What is the minimal invariant every version of one identity MUST preserve? Realistically two answers: (a) category (`describes`) only — then state out loud that a floating filter is a provenance filter with no shape guarantee; or (b) category plus a frozen identity core that successors may only refine. There is no free middle.
- **Classification.** Inherent tradeoff. The draft is right to refuse to infer compatibility; what's missing is a positive statement of what identity *buys*.

### B2 — An affiliation-only change is invisible under the revision and no-op laws
**Severity: Critical.** "October 8 ruling" section, §3 invariant 4, T06/T14, D03/D12.

- **Scenario.** The already-ruled explicit adoption: `--bead-type Invoice@B` with no property edit. The resulting `properties` equal the preimage.
- **Interacting rules.** Revisions: "every update that changes `properties` or, for a Bead whose Type owns outgoing Link Types, its owned Links — produces a fresh opaque Resource revision," and the no-op law "retains the existing revision and emits no `updated` Event." Version erasure enumerates revision-determining durable state exhaustively: "`properties` and, for a Bead, its complete inline owned-Link set."
- **Consequence.** A validated, committed affiliation change mints no revision, no Event, no change group, no changefeed row, no `view=versions` entry, no `ETag` change. Replicas and history clients never learn of it; `expectedRevision` cannot guard it; two distinct states share one address, which contradicts the retained-address law ("its existing address remains bound to exactly that state"). This is a hole in behavior the operator has already approved, not in an open choice.
- **Smallest question.** Is the stored affiliation pin part of the revision-determining durable state? If yes (almost certainly), exactly three places change: the Revisions rule, the no-op comparison, and the erasure-successor "MUST differ in the durable state that determines its revision" clause.
- **Classification.** Avoidable ambiguity — and the cheapest high-value fix on this list.

### B3 — What a definition version token *is*, and who mints it, is pulled three ways
**Severity: Critical.** D03, T03/T28, §4 closing paragraph.

- **Scenario.** Scope 1 and Scope 2 both install "Invoice v2" from the same publisher. A record pinned in Scope 1 is exported, replicated, or compared in Scope 2 (T28).
- **Interacting rules.** The operator's requirement that global identity and coherent definitions work across Scopes regardless of representation, plus "an exact Type version must describe immutable structure AND semantics," against existing law: "Human-readable documentation may improve without changing the contract"; "A client compares revisions only for equality and must not derive meaning from their spelling"; and the draft's own "Opaque revision tokens are not ordered version numbers."
- **Consequence.** Three mutually exclusive pulls. Content-digest tokens give cross-authority identity for free, but then any documentation correction mints a version — and since semantics are normative and immutable, normative prose *is* contract-bearing, so the doc/contract split v0 relies on gets harder, not easier. Authored labels keep documentation free but are unverifiable and forgeable across authorities, which is exactly T28's divergent-bytes case. Bead revisions (if Types are Beads) are per-Scope opaque and unordered, so there is no "current," no "consecutive," and no cross-Scope equality at all — and "current" then diverges per Scope, so the same floating command against two Scopes stores different pins.
- **Smallest question.** Rule the token's derivation and the contract-bearing/documentation line in one decision. Escape hatch: a canonical contract payload (digested, including normative semantic statements) plus a separate non-digested presentation layer; and "current" declared explicitly as a per-Scope installed-set selection reported in every result, never a protocol-global claim.
- **Classification.** Inherent tradeoff; the doc/semantics boundary inside it is avoidable ambiguity.

### B4 — Types-as-Beads inside the data Scope collides with uniformity and with the administrative-only posture
**Severity: High.** §3 "If Types become Beads…", D01, T18.

- **Scenario.** A client issues an ordinary update against a Type Bead's URL; or lists `beads/` and gets Type Beads interleaved with Invoices; or runs `selector=$[?@.type == …]` across both.
- **Interacting rules.** "If you know how to work with *one* Bead Type, you know how to work with *all*" and one operation vocabulary for all Beads, against "Installing, replacing, and governing Type Descriptors are administrator or operator concerns. BDP v0 … deliberately does not define a client-facing Type-installation protocol," "Core BDP clients do not receive those powers," and "The pinned contract closure is immutable for that Type ID."
- **Consequence.** A fork with no third branch *inside one Scope*: either generic writes can mutate executable validation policy, or Type Beads are the first Bead Type whose instances reject generic operations. Separately, if Type Beads are in-Scope Beads then every Scope mechanism now applies to them — collections and filters, Selector, snapshots, changefeed, authorization views, deletion safety, aggregate policies, retention windows.
- **Smallest question.** Are Type Beads in the data Scope at all? Escape hatch: a dedicated Type Scope whose authority *is* the administrative surface. Uniformity holds inside each Scope, bootstrap stays local, and D02's "do not silently move them to `beads/`" becomes a ruling rather than a caution.
- **Classification.** Inherent tradeoff (the fork) wrapping an avoidable ambiguity (placement).

### B5 — Intrinsic affiliation has no referential-integrity machinery, because all of BDP's is Link-shaped
**Severity: High.** §3, D01/D09, T12/T13/T25.

- **Scenario.** Types are Beads. An operator tombstones the Invoice Type Bead, or erases its live version, while 10,000 Invoices affiliate with it.
- **Interacting rules.** Affiliation is intrinsic *precisely because* Links cannot be endpoints — and every existing protection is Link-shaped: `DeleteBead` fails only "if any live Link is incident upon … the Bead" (`incident-links-exist`); a live-version erasure requires a successor or a tombstone, and the tombstone "is subject to deletion safety — a Bead with a live incident Link cannot be tombstoned."
- **Consequence.** The property that makes affiliation workable also exempts it from every deletion guard. Nothing in current law stops a Type Bead from being deleted or its definition content erased out from under live instances. §6 forbids *reuse and rebinding* of an identity, which is a different obligation from forbidding removal.
- **Smallest question.** Does affiliation create a deletion-blocking dependency equivalent to incident-link safety — and is it enforced only within one Scope (checkable) or claimed across authorities (not checkable)? Escape hatch: an explicit same-Scope affiliation-dependency rule, plus an honest declaration that cross-Scope affiliation is unenforceable with a defined unavailable outcome instead of a guarantee.
- **Classification.** Avoidable ambiguity — a named gap, not a tradeoff.

### B6 — An unavailable definition can make its instances permanently undeletable
**Severity: High.** §6 removal paragraph, D09, T12/T25.

- **Scenario.** Memory Bead `m1` has wildcard `ownsOutgoing` and three owned `cites` Links. Its Bead definition version is deactivated or purged. The operator tries to delete `m1`.
- **Interacting rules.** `DeleteBead` "fails if any live Link is incident upon … the Bead," so the owned Links must go first. "Every mutation of an owned Link versions the source Bead," and the authority validates the resulting staged state (owned-set bounds, complete inline owned-Link set) — which requires the source's pinned closure. "A mutation that names an unavailable Type fails as `type-not-installed`; the mutation does not initiate installation," and validation may use only the pinned local copy.
- **Consequence.** Deleting the Links requires minting a source version that cannot be validated, so neither the Links nor the Bead can ever be removed. Deactivation becomes a one-way trap on exactly the Types most likely to be retired. This cannot arise today: closures are immutable for the ID's life and retained "while any live or retained historical representation refers to them."
- **Smallest question.** Which checks a deletion path may skip when the closure is unavailable — specifically, whether owned-set bound evaluation and inline-set re-validation are required to mint a *strictly shrinking* source version. Escape hatch: define removal as closure-independent (identity-only liveness and ownership) for shrinking operations; or decide that D09 inherits rather than weakens the existing retention duty, which already nearly forbids the state.
- **Classification.** Avoidable ambiguity.

### B7 — The combined update carrier: a floating selection is an implicit version adoption, and set carriers turn it into a mass retype
**Severity: High.** "October 8 ruling," D08/D12, T04/T06, D10.

- **Scenario (a).** `bd update inv-7 --status paid --bead-type Invoice`. The author restates the Type to be *explicit*, intending no version change. But floating input "selects the current definition and is resolved to an exact pin for storage" — so the resource adopts D, validates against D, and stores D's pin. The ruling's protection rewards omitting the flag and punishes naming it.
- **Scenario (b).** Transactional `UpdateWhere(Beads, $[?@.type == "…/invoice"], change)` carrying a Type selection is a whole-population retype with no guard: "BDP v0 deliberately does not add an expected-member-set guard," and a job split across chunks is explicitly non-atomic — "a later chunk may fail after earlier chunks committed."
- **Interacting rules.** Also note the abstract vocabulary is `UpdateBeadProperties(bead, change, expectedRevision?, attribution?)`. A Type selection is a new parameter or a new operation, fanning out into the singleton records, sequence members, the eight batch operation records, and the two set-mutation records.
- **Consequence.** The operator-approved per-resource atomic combined update is sound; its most natural CLI spelling and its bulk carrier are not.
- **Smallest question.** On an *update*, is a floating selection an assertion of identity (no-op when the identity already matches) or an adoption of the current version? And may a set-mutation carrier carry a Type selection at all? Recommendation: require a version-exact selection to change a pin; treat floating as an identity assertion that fails on mismatch; keep Type selection off `UpdateWhere`/`DeleteWhere` until D10 has a ruled atomicity story.
- **Classification.** Avoidable ambiguity; extending set mutation would be scope creep.

### B8 — When a floating selection resolves within a multi-member carrier, and what a replay re-resolves
**Severity: Medium-High.** §3 invariant 5, D08, T04.

- **Scenario.** A Read+Update `sequence` creates five Invoices with a floating selection; definition D is published mid-sequence.
- **Interacting rules.** "A sequence does not reorder or parallelize members, but it takes no sequence-wide lock and permits unrelated requests to interleave." The nearest precedent is explicitly per-member: "Each Read+Update singleton or sequence member observes the policy current at that member's execution point." Idempotency keys are per member, and D08 wants resolved pins retained across replay.
- **Consequence.** One user action yields instances pinned to two definitions. T04's "one exact pin recorded and reported" stays true and becomes useless for predicting a command's outcome.
- **Smallest question.** Is the resolution point carrier admission or member execution? Escape hatch: resolve once at carrier admission, report the resolved pin in the envelope, make mid-carrier publication invisible — and state it as a deliberate departure from the per-member aggregate-policy precedent rather than letting the two rules collide silently.
- **Classification.** Avoidable ambiguity.

### B9 — The stored pin is a reference kind BDP's taxonomy has no slot for
**Severity: High.** §2 reference paragraph, D03/D04/D11, T28.

- **Scenario.** A record pinned to `https://work.example/types/invoice` at version X is replicated, exported (D11), or copied to another authority that lacks the definition or holds different bytes for X.
- **Interacting rules.** v0 has exactly two reference classes: an in-Scope reference that "MUST identify a live Bead in the Link's Scope," and an out-of-Scope URI that is "opaque" — never dereferenced, kind and Type never inferred, "lifecycle not part of the Scope's integrity guarantees." Plus: pins "record provenance; they do not automatically select a historical endpoint," and Type IDs are "globally scoped absolute URLs" whose descriptors "may be hosted inside or outside the Scope."
- **Consequence.** Affiliation needs in-Scope strength (validation depends on it) while pointing into a namespace the Scope does not own — the one combination v0 has no slot for. Treated as opaque, validation is unfounded; treated as in-Scope, the Scope asserts integrity over another authority's content, which the spec explicitly disclaims.
- **Smallest question.** Does the pin denote a *locally installed closure identity* (a Scope-owned fact, with the global URL as provenance), or a global address? Recommendation: the former. It preserves "installed and pinned before admission, no validation-time network," makes T28's missing-definition case a local fact rather than a fetch, and — importantly — keeps the still-open deployment-addressing / protocol-namespace question off the critical path. Do not let the pin's representation quietly settle that ruling.
- **Classification.** Inherent tradeoff, surfaced as a missing taxonomy slot.

### B10 — `conformsTo` forces a materialize-vs-recompute dilemma, and the query grammar can't express the version-qualified form
**Severity: High.** §4 D05 proposal, D05/D12, T26/T29.

- **Scenario.** `GET beads/?conformsTo=https://work.example/types/work-item` in a Scope where Invoice@A conforms to WorkItem and Invoice@D does not.
- **Interacting rules.** `conformsTo` is a *Read-profile* predicate meaning "Effective conformance to the named Type ID"; effective Types are the declared Type plus its pinned definition's transitive `conformsTo` closure; yet a read-only service is explicitly **not** required to "resolve every Type that appears in data before it can return the Resource record"; and "A parameter may occur at most once in BDP v0; repeated parameters are errors rather than implicit unions."
- **Consequence.** Recompute at read → a Read authority must hold every pinned version's closure it never agreed to install, and D09 purge/erasure silently changes filter results for unchanged data. Materialize at write → the effective set freezes into the stored version, so a withdrawn or corrected conformance claim (T26) never reaches existing rows, and the materialized set becomes record shape (digest, Selector, old clients). Separately, if conformance nodes become `(identity, version)` pairs as §4 proposes, the filter argument must be version-qualified or it silently means "any version" — a disjunction the grammar cannot express and a pinned closure cannot evaluate. Also note that Selector predicates are ordinary string equality over the served record (`@.type == "…"`), so any change to the `type` member's shape silently breaks every stored client filter.
- **Smallest question.** Is effective conformance a stored per-version fact or a read-time computation, and is the `conformsTo` argument identity-only or version-qualified?
- **Classification.** Avoidable ambiguity concealing a real dilemma; the version-qualified form is where it tips into scope creep (a new query algebra).

### B11 — Scope aggregate policies are keyed by identity but counted through version-dependent effective Types
**Severity: Medium-High.** §5 D06 table, T29; spec "Scope aggregate constraints."

- **Scenario.** Policy `{ linkConformsTo: parent-child, endpoint: source, max: 1 }`. `assigned-to@A` conforms to `parent-child`; `assigned-to@D` drops that parent. Bead `b1` already holds one A-pinned Link.
- **Interacting rules.** The policy counts "the live Links in the Scope whose effective Link Types contain `linkConformsTo`"; its key is a bare `LinkTypeId`; and policy *replacement* is atomic and "rejected when the live graph already violates the proposed maximum" — but publishing a definition is not a policy replacement and gets no such check.
- **Consequence.** Publishing D is an unreviewed back door around a Scope maximum: D-pinned Links are uncountable, so `b1` ends up with one A-pinned plus unbounded D-pinned Links and no invariant was ever formally violated. Symmetrically, a definition that *adds* a parent can push the live graph past an existing maximum with no admission point that would have caught it.
- **Smallest question.** Does `linkConformsTo` name an identity, an exact version, or a conformance relation — and does publishing or adopting a definition get the same already-violated check that policy replacement gets?
- **Classification.** Avoidable ambiguity.

### B12 — `ownsOutgoing`/`ownedLinks` keying forces a choice that breaks either closure pinning or record shape
**Severity: High.** §5 owned-Links paragraph, D06, T19–T21.

- **Scenario.** A Bead Type owns `cites` explicitly (`max 2`) beside the wildcard (`max 10`). One `cites` Link adopts a new definition version.
- **Interacting rules.** Ownership is "keyed by owned Link Type URL"; the wildcard "declares every outgoing Link Type not listed explicitly"; `ownedLinks` "carries one entry per owned Link Type actually present … plus an entry, possibly empty, for each explicitly declared Link Type," and `"*"` is never a key; the owned set is covered by the source's revision and inlined in its record; and draft invariant 3 says the chosen definition's closure "cannot silently float."
- **Consequence — a genuine fork.** (a) Ownership matches exact definition → the re-pinned Link drops out of the explicit entry into the wildcard, so a different `max` governs it *and the served `ownedLinks` entry set changes shape* (always-present empty explicit entry vs. presence-conditional wildcard entry) with no change to the Bead; the `read.owned-wildcard.*` conformance rows stop describing reality. (b) Ownership matches identity → the source's revision-covered, inlined state includes Link content governed by a definition the source never pinned, so the "complete pinned closure" is not complete, contradicting invariant 3.
- **Smallest question.** Pick (a) or (b) explicitly for `ownsOutgoing` keys, and state separately that `ownedLinks` keys stay identity-only (they are record shape — see B2 and B10). Recommendation: identity-keyed ownership and identity-keyed `ownedLinks`, with ownership named as one of the identity-only constraint locations the operator left open, and bound counting declared a nominal rather than a contract check.
- **Classification.** Inherent tradeoff. The draft already asks the question; what it doesn't say is that branch (a) changes served record shape.

### B13 — Link affiliation collides with immutable `type` and with the existing meaning of "re-pinning"; and repair atomicity is profile-stratified
**Severity: Medium-High.** §5, D06/D10, T21, §9 immutable-member item.

- **Scenario.** Owned Link `assigned-to-81` adopts definition D.
- **Interacting rules.** "For a Link, `id`, `type`, `source`, and `target` are immutable… Assigning a new value to an immutable member is not an update." And: "Because a Link's endpoints are immutable, repointing or **re-pinning** an owned Link is a delete-and-create pair, each of which versions the source." Immutable-member rules are their own validation stage. Note the term collision: "pin" and "re-pin" already name endpoint provenance with a defined, destructive consequence, and the draft uses "pin" throughout for Type versions.
- **Consequence.** For Links, "identity stays, pin changes" requires `type` split into an immutable identity part plus a mutable version part *and* a new word — otherwise Link adoption is delete-and-create, which destroys Link identity permanently (IDs "must never previously have been committed"), versions the source twice, and discards the Link's own history. §5 treats Bead and Link adoption symmetrically; they are not symmetric. Separately, D06's "one atomic graph repair" option exists only in Transactional — Read+Update "validates each singleton or sequence member independently," has no cross-resource rollback and no `UpdateWhere` — so choosing repair makes an adoption's success depend on the authority's profile, which is new for Type validation. The operator has explicitly not approved whole-graph repair.
- **Smallest question.** Which member carries a Link's affiliation, and is it mutable? Recommendation: reject-only for incompatible adoption in both write profiles (operator-consistent and profile-uniform), and reserve a distinct word for the Type version so "re-pinning" keeps its endpoint meaning.
- **Classification.** Avoidable ambiguity (terminology plus member placement); profile-dependent repair would be scope creep.

### B14 — Legacy absent-pin is permanent, so every rule needs a two-population form
**Severity: Medium-High.** §3 legacy paragraph, D02, T17/T27, plus the §2 Beads source evidence.

- **Scenario.** `type=Invoice@A` (pinned nominal filter) over a store whose older half has no pins; `maximumEndpointMultiplicity` counting across both halves; a `validation-failed` diagnostic that must "identify the failing effective Type" for an unpinned record.
- **Interacting rules.** The draft's own correct constraints — retained records are never backfilled, no version is guessed, missing pins are not corruption — combined with the working assumption that "every stored affiliation is pinned." Both hold forever, so unpinned affiliation is a permanent first-class state, not a migration phase. The existing implementation compounds it: the installed-set check "accept[s] the legacy four or current six descriptors; partial, unknown or **replaced** sets are invalid," with bindings fixed at initialization — a fixed enumeration that a set-of-versions contradicts head-on.
- **Consequence.** Pinned filters silently exclude every legacy row, so an operator auditing "everything governed by A" gets a confidently wrong answer; aggregate counts must span two representations; old clients are a third population reading records whose `type` member may have changed shape. Related discipline point: the erasure digest is defined over "the record the authority served for that revision," which is correct as written — but an implementation that recomputes digests with current serialization logic will manufacture replica mismatches that existing law instructs replicas to report as audit signals.
- **Smallest question.** What does an absent pin match under each filter form, and does it participate in conformance and aggregate evaluation? Recommendation: make absent-pin a named matchable state in the filter table (floating matches; pinned never matches; conformance evaluated from the installed legacy contract) rather than leaving it to implementations.
- **Classification.** Inherent tradeoff on permanence (it follows from the correct no-rewrite rule); avoidable ambiguity on filter semantics.

### B15 — PR60's asks expose a gap pinning cannot close: history-spanning constraints have no governing definition
**Severity: Medium.** §4/§5, D05/D06; spec "Scope aggregate constraints" and "Deferred model features." *Treating both PR60 items as unapproved stakeholder input only.*

- **Scenario.** A declared lifecycle permits `open → paused`. The resource's previous version is pinned to A (no `paused`); the proposed new version is pinned to D (has `paused`). Which definition's transition table governs the step?
- **Interacting rules.** A Type Descriptor "owns constraints that can be validated from one Resource and its in-Scope endpoints"; anything inspecting other Resources "belong[s] to the Scope, not to the globally identified Type contract"; "Minimum multiplicity, tuple uniqueness, acyclicity, and other aggregate graph policies are deferred"; "A Type Descriptor cannot add an operation, query, view, Event Type, or protocol method."
- **Consequence.** A transition constraint is a predicate over two versions potentially governed by two definitions, so the exact-pin model has no answer — unlike schema and endpoint checks, which evaluate one resulting state. Minimum counts, cycles, and uniqueness land on the other side of the same line: they are Scope-owned aggregates, and B11 shows the identity/version keying problem already present for the single aggregate v0 has. Neither PR60 item solves semantic compatibility; both would enlarge the surface the version model must pin.
- **Smallest question.** Does the versioned-definition model intend to admit any constraint not evaluable from one resulting state? Recommendation: record "no" for now, keeping pinning to a single evaluation point; lifecycle and categories stay client-interpreted over nominal Types, consistent with the uniformity principle.
- **Classification.** Scope creep if adopted; worth one boundary sentence now so the extensibility risk is on the record.

---

## Connected failure modes

Four clusters, not fifteen independent bugs.

**1. The invisible write (B2 → B14 → B10).** If the affiliation pin is not revision-determining, an adoption produces no observable version — so replicas, changefeeds, history pages, and digests all diverge from the authority's state, and the two-population legacy problem becomes undetectable rather than merely awkward. Every "we'll reconcile later" story depends on the change being observable in the first place.

**2. The removal trap (B5 → B6 → B9 → B3).** Type availability is a hard dependency with no integrity owner: affiliation isn't a Link, so deletion safety doesn't cover it (B5); making a definition unavailable blocks even shrinking mutations, so the instances can't be cleaned up (B6); and the pin points into a namespace no Scope owns, so no authority can promise resolvability (B9). B3 decides whether a receiver can even tell it has the right definition. These four fail together: the realistic bad day is "we retired a Type, and now a subtree of the graph is neither valid nor deletable nor replicable."

**3. Nominal keying vs contract checks (B1 → B10 → B11 → B12 → B14).** Every place v0 keys on Type identity does so because identity *was* the contract: the `type` filter ("Exact Type ID"), `conformsTo` ("Effective conformance"), `linkConformsTo`, `ownsOutgoing` keys, `ownedLinks` keys, Selector `@.type` string equality, and endpoint validation's "exact declared-Type match" (spec line 1170 — a phrase implementers will read two ways the moment versions exist). Splitting identity from contract means auditing all of them and labeling each identity-only or version-exact. The operator has correctly flagged three as unresolved; the list is longer, and the unflagged ones (`ownedLinks` keys, Selector, `linkConformsTo`, the `type` filter) are the ones that change served record shape or stored client queries.

**4. The authoring footgun (B7 → B8 → B13).** The combined update is right at the resource level and underspecified at every carrier level: which spelling adopts, when it resolves, what a replay does, which carriers may do it at all, and whether Links can do it without delete-and-create.

## Highest fan-out choices

1. **B3 — what a version token is.** B1, B9, B10, B11, B12, B14, all of D11 packaging, and the entire legacy story inherit it. It is the only item that cannot be deferred behind something else.
2. **B1 — the per-identity invariant.** Decides whether identity-keyed mechanisms can survive unchanged.
3. **B2 — where the pin sits in the record, and whether it mints a revision.** One ruling settles revisions, events, changefeed, digests, Selector compatibility, and old-client record shape.
4. **B9 — the pin's reference kind.** Determines whether validation rests on a local fact or a cross-authority claim.
5. **B4 — Type Bead placement.** Collapses the hardest branches of B4, B5, and B9 in one stroke.

## Likely dead ends and impossible combinations

- **Same-identity conformance plus widening.** The draft already says it (lines 219–223); restate it as a hard limit: the only machine-checkable version relationship available is *narrowing*. Widening successors are permanently unverifiable, so don't build a mechanism that implies otherwise.
- **Content-digest tokens + "documentation may improve freely" + "a version describes semantics."** Pick two.
- **Exact pinned closure + identity-keyed `ownsOutgoing` + mutable Link definitions.** Pick two (B12).
- **"Every stored affiliation is pinned" + "retained records are never rewritten."** Jointly satisfiable only by making absent-pin permanent, so stop phrasing the first as universal (B14).
- **Types-as-Beads in the data Scope + uniform generic operations + administrative-only Type governance.** Pick two (B4).
- **Atomic graph repair + Read+Update + the operator's non-approval of whole-graph policy.** Reject-only is the only currently authorized branch (B13).
- **A floating `conformsTo` argument under version-qualified conformance nodes.** Requires a union the query grammar forbids and a disjunction a pinned closure cannot evaluate (B10).

## Resolve these first

**1. D03 — what a definition version token is, who mints it, and where the contract/documentation line falls.** Everything downstream inherits it: whether a pin means anything across authorities, whether packaging can detect conflicts (T28, D11), what "floating/current" resolves to, whether "structure AND semantics" is checkable or purely declarative, and how legacy absent-pin is even addressed. Settling B1 or B10 before this means re-deciding both afterward.

**2. D02/D05 — the minimal invariant every version of one identity must preserve.** Cheapest ruling with the widest relief. It decides whether a floating nominal filter means anything, whether `conformsTo`, `linkConformsTo`, `ownsOutgoing`, and `ownedLinks` can stay identity-keyed, and what a domain client is entitled to assume. "Category only, clients must pin" is a legitimate answer and immediately unblocks B10–B12 and B14 — but it needs to be *said*, because today identity silently carries the whole contract and every existing mechanism is built on that.

**3. Whether the affiliation pin is revision-determining state, and where it sits in the record.** Unlike the first two, this is not an open choice — the October 8 ruling is committed, and under current law the behavior it authorizes produces no observable version, no Event, and no changefeed row, while two distinct states share one address. It also fixes record shape, digest discipline, and Selector/old-client compatibility for the whole amendment, and it is independent of whether Types become Beads.

Worth taking in the same sitting because it is cheap and collapses several hard branches: **is a Type Bead a Bead in the data Scope?** A "no — dedicated Type Scope" answer preserves uniformity, keeps bootstrap local, and turns B5 and B9 from contradictions into stated non-guarantees.

Two things the draft already does that this review leans on rather than disputes: §9's insistence that the string-valued Type discriminator "must not be silently widened in only one artifact," and §2's refusal to let Type-definition erasure inherit Bead-version erasure. The gap next to the second one is retention *windows* — distinct from erasure, non-propagating by design, and in direct tension with the Scope-lifetime ID-and-fingerprint duty if definitions become Bead versions.
