---
status: draft
authority: non-normative
informative-for: [beads-data-model]
---

# PROPOSAL: Charter the Bead Protocol (BDP) as the beads kernel specification

- **Status:** draft for w57 ratification. Rev 2 (rev 1 was adversarially
  reviewed by four independent agents; this revision incorporates all
  blocker/major findings — corrected performance numbers, an honest account of
  the claim/lease and ready reclassifications, a rebuilt M4/M5, and a
  ratification table in §10).
- **Date:** 2026-08-01
- **Normative input:** `bdp.md` v0 (donbox/formula-language,
  `bdp/docs/specs/bdp.md`) — of which only the Abstract Data Model is
  currently selected law
- **Companion:** `link-identity-position.md` (delta D1's design input, and
  the worked example of the kernel/domain boundary)

---

## 1. Thesis

Beads should be layered into a **kernel** — a bead is a node with typed edges
and open properties, uniformly addressable and operable — and **domains**
built on top of it, of which today's task tracker is the first and largest.
BDP is the right normative home for the kernel, but it must be chartered
*into* the existing canonical-API governance (w57) rather than beside it, and
it must land as a sequence of incremental deltas under the running system, not
as a re-foundation.

This proposal does four things:

1. Defines the **kernel / domain / substrate** ownership boundary (§3) and the
   **six mechanisms** that connect kernel and domain (§4) — the actual contract.
2. Defines the **specification stack** (§5): S0 kernel law, S1 Work Item
   profile, S2 deployment profiles — and where surface A, the taxonomy's
   Layer-0 freeze, and bdp-lumen each sit in it.
3. Extends the w57 **governance flow** to cover the kernel spec (§6), with an
   evidence-gated promotion rule for BDP's non-normative sections.
4. Commits to a **strangler-fig sequencing** of five deltas (§7), each of which
   pays for itself against a live consumer before the next begins.

**What does not change:** surface A (`/v0/beads/*`) remains the normative
contract for all current consumers. The bts-rs conformance corpus remains the
behavioral oracle. The gascity migration continues against today's model.

## 2. Why now

Three independent consumers are pressing on the same missing kernel:

- **Gascity infra objects (w55).** The gc-enterprise track deleted ~21.9k
  lines of per-class stores (commit `1895553c35`;
  `engdocs/design/retired-typed-class-stores.md` in that tree) and now
  projects one beads engine into six class contracts
  (`internal/storebinding/beads_adapter.go`). It works — and every workaround
  it needed is a missing kernel feature: nudges type-squat as `chore` and
  extmsg as `task`, with a label-heuristic `Classify` function standing in for
  a type system (`internal/coordclass/class.go:30-36`); the nudge queue packs
  a lease token and deadline *into the assignee string* to get one-CAS claim
  semantics (`internal/storebinding/beads_nudge_queue.go:17-33`); sessions
  (which do have their own type) fight the work-item close-reason validator,
  whose short-reason rejections trigger reconciler flap
  (`internal/session/lifecycle_transition.go:524-533`); optional behavior is a
  sprawl of type-asserted capabilities returning `ErrBeadsAdapterCapability`.
- **Plane-on-beads.** Per `plane-beads` ADR-0002 (accepted 2026-07-31): edge
  *identity* is already served (bd's deterministic `Dependency.ID` is exposed
  and the facade uses it as its paging cursor), but bd's type-blind
  pair-uniqueness is a live defect — stock Plane permits a work item to be
  both sub-issue and relation of the same peer, and that is the one Plane
  shape bd cannot store (the facade maps it to a 409). Metadata-scalar
  ordering (`plane/sort_order`) has no query support.
- **The work-item domain itself.** Because infra types share one untyped
  namespace with tasks, work-item policy and cross-domain scoping are fused in
  one hardcoded list: `ReadyWorkExcludeTypes` bakes
  `merge-request`/`gate`/`molecule`/`rig` plus the infra types into the ready
  query (`internal/storage/sqlbuild/ready.go:13-27`). That is the cost of
  having domains without a kernel: each domain carves exceptions into the
  other's queries. (§4-M1 and D2 are precise about how much of this list is
  *scoping* a kernel fixes and how much is *policy* that must move into
  descriptors rather than disappear.)

Meanwhile there are already four rival "beads API" surfaces (A canonical, B
frozen, C gasworks target, D bts-rest unspecified) under a ratification
process that exists precisely to prevent a fifth. An uncharted BDP *is* the
fifth. Chartering it makes it the layer the other four hang off instead.

## 3. Definitions: kernel, domain, substrate

One-sentence versions:

- The **kernel** is everything that must be true of a bead *regardless of what
  it means*.
- A **domain** is everything that gives a set of beads meaning: its types'
  schemas and invariants, derived state, queries, operations, and vocabulary.
- The **substrate** is how a deployment persists, replicates, and migrates:
  Dolt, JSONL files, SQL schemas, sync. Both kernel and domain are expressible
  over any substrate; neither may depend on one — but the substrate imposes
  obligations the kernel contract must name (see M4's merge obligation).

Ownership table. "Mechanism" means the kernel defines how the thing is
declared, discovered, and served uniformly; "content" means the domain
supplies what it says.

| Concern | Kernel | Domain (profile) | Evidence / note |
| --- | --- | --- | --- |
| Identity & representation envelope | URL identity, canonical JSON, self-describing `id`/`type` | — | bdp.md Abstract Data Model (selected law) |
| Nodes (beads) | open property record, CRUD, tier axis | which properties exist, schemas, invariants | gascity treats storage tier as orthogonal to class (`coordclass/class.go:24-28`) → tier is a kernel axis |
| Edges (Links) | existence, identity, properties, CRUD, incident traversal, scope-declared aggregate constraints (each with declared merge semantics) | edge-type *semantics*: which types block, which subset is acyclic, naming policy | `AffectsReadyWork` (types.go:1210-1213) and the write-time cycle-check set (issueops/dependencies.go:453-474) are Work Item law. See companion paper. |
| Type descriptors | descriptor mechanism, `conformsTo`, uniform discovery | descriptor content: schemas, operations, events, named queries | Selected law deliberately does *not* require type Resources to be Beads (ADM, "Beads, Links, and Resources"); "Bead types are themselves Beads" is the Fodder position for Bead types only. This charter proposes promoting it via D2 — flagged as promotion, not assumed. |
| Collections & queries | scope, discovery, paging, cursors, result forms | filter dialects, named queries (`ready`), projections backing them | bdp.md (Fodder): "`ready` is a Work Item Bead query rather than a root Bead operation"; the bd query language stays the Work Item dialect |
| Derived state | projection *registry*: maintenance contract, read-time consistency hooks, substrate merge obligation | the projections themselves (`is_blocked`, molecule progress) | bts-rs: ready(100) ≈ 4-20ms maintained-projection vs 537ms indexed recursion at 100k (~27×), vs ~9000ms *projected* for the original unindexed recursion (the ~450× headline) — docs/PERF.md |
| Concurrency | revision/ETag, generic CAS (single- and multi-field via M3 ops) | claim/lease *patterns* and their bindings (see the honest note below) | |
| Operations | declaration, discovery, atomicity contract, idempotency | operation semantics: close, reopen, claim, defer | bts-rs `try_claim_ready`: `FOR UPDATE SKIP LOCKED` candidate-select + mutate + emit in one statement — unexpressible as generic CRUD; `ready --claim` went ~34 → ~2 round-trips when folded server-side (PERF_PG_VS_YB.md) |
| Events / monitor | event log, cursors, replay, SSE monitor links, merge-arrival synthesis (M4) | domain event types and payload schemas | bdp-lumen's `watch()` is the Lumen projection of the kernel feed (spec repo, `bdp/docs/specs/bdp-lumen.md`) |
| Validation | schema attachment + enforcement machinery | the schemas; profile subsetting rules | surface A's Profiles section states five subset-refinement rules (`internal/httpapi/spec/openapi.v0.yaml:116-175`) |
| Errors | problem+json envelope, closed kernel codes | domain problem types | |
| — Substrate (neither layer) | | | Dolt sync/federation, JSONL framing, SQL migrations, workspace discovery, deterministic id *allocation* policy, the merge obligation of M4 |

Two classification calls deserve their honest form, because rev 1 overstated
both:

- **Ready is domain, not kernel — but its exclusion list is two things, not
  one.** The list mixes *cross-domain scoping* (agent/role/message infra,
  `rig` identity beads — which a kernel type system genuinely absorbs) with
  *intra-domain policy*: `merge-request` and `molecule` are work-item types
  (gascity's own class taxonomy counts merge-requests as work) that must stay
  out of ready anyway, and BDP's own `milestone` ("no directly executable
  work") conformsTo work-item yet should never be claimable. So descriptor
  scoping alone would re-admit them — a behavior change. The mechanism is an
  explicit descriptor member (ready-eligibility / "directly executable"), and
  the accurate claim is: **the list moves from code into descriptors; it does
  not disappear.** D2 carries the compatibility constraints.
- **Claim/lease: what the evidence actually supports is generic CAS + atomic
  compound ops; a kernel *lease* is a proposal that must earn its contract.**
  bd's lease and gascity's nudge lease share only single-winner CAS — which
  the store already exposes generically (revision-CAS via
  `UpdateIssueChecked`; the assignee-CAS `Claim`/`ReleaseIfCurrent` the nudge
  queue builds on). Everything a kernel lease must specify, the two instances
  *disagree* on: residency (bd's lease lives in a clone-local, dolt-ignored
  `leases` table — single-winner is per-server and undefined under
  federation; the nudge lease rides in-band in the replicated assignee
  field), expiry (active `ReclaimExpiredLeases` reverting status vs passive
  expiry-by-arithmetic), renewal (heartbeat vs none), and post-expiry policy
  (revert-to-ready vs redelivery/backoff). And the nudge queue's
  assignee-packing is most directly evidence that *single-field* CAS was too
  narrow — an argument for M3 multi-field atomic operations. Accordingly: the
  kernel Concurrency row above claims only revision/CAS + M3 compound
  atomicity as kernel now; **D4 is the proposal to define a kernel lease
  contract** (winner scope under replication, residency, renewal, expiry
  visibility, reclaim hook) with the acceptance bar that *both* existing
  instances are expressible as bindings of it without behavior change.

## 4. The kernel↔domain contract: six mechanisms

This is the heart of the proposal. A domain plugs into the kernel through
exactly these six mechanisms — nothing else. If a domain needs a seventh,
that is a kernel amendment, not a domain hack.

### M1. Type descriptors (`conformsTo`)

The domain declares its types as descriptor resources: representation schema,
creation schema, operations, events, named queries. Chains compose
(`task -> work-item -> bead`). The kernel serves and dereferences descriptors
uniformly; it never interprets their content.

*Rule (anti-inflation):* no descriptor is minted without at least one
invariant that rejects a real instance its parent accepts. The spec proposes
this test itself — "if the type-specific schemas do not eventually encode
meaningful invariants, these may collapse back into one Work Item type with a
classification field" — while listing candidate distinctions for five of its
nine types. The rule here adopts the spec's test as a hard gate: a type
without an invariant is a label; use a property.

*What this buys today:* gascity's nudge/extmsg/wait records stop squatting on
`chore`/`task`/`gate`; `Classify`'s label heuristics become a type URI; and
ready's *scoping* half derives from the type system, while its *policy* half
moves into an explicit descriptor member (§3 note; D2).

### M2. Named queries — with the optimize-never-gate law

A domain declares named queries on its type descriptors (`ready` on Work
Item); collections bind them to concrete URLs. Two-part law:

1. **Every named query has a normative generic evaluation** — a definition in
   terms of kernel reads (nodes, edges, properties, plus time and the event
   log). This is the semantics, and it is what conformance tests.
2. **A store MAY register an accelerating projection** for a named query.
   Projections **optimize core behavior, never gate it**: absence of the
   projection degrades speed, never correctness, and never removes the query.

Law 2 is written in blood: in the bts-rs seam validation, the "Showing N of
TOTAL" ready-truncation notice was wired through the optional Readiness
capability, so the backend without the projection silently *dropped a core
behavior*. The fix — derive it generically when the capability is absent — is
this law.

The performance evidence for why projections must exist at all (numbers per
bts-rs `docs/PERF.md`, stated against both baselines): at 100k issues,
`ready(100)` over the *unindexed* recursive CTE is ~9000ms (projected — never
run to completion); over the *indexed* CTE, 537ms measured; as a maintained
`is_blocked` projection (event log + O(affected-subgraph) catch-up), ~4-20ms
— **~27× over the indexed query, ~450× over the original**. Either way the
conclusion holds: "ready" can never be a client-side traversal over kernel
reads; the domain deploys its projection *into* the store behind uniform
discovery.

### M3. Descriptor-declared operations

Domain operations (close, reopen, claim) are declared on descriptors and
execute **atomically inside the engine**, not as client-side compositions of
kernel CRUD. Evidence: bts-rs folded `ready --claim` into one-or-two
server-side statements (`FOR UPDATE SKIP LOCKED` candidate-select + update +
event emit), taking the operation from ~34 round-trips to ~2; no sequence of
generic reads and writes can express that contention behavior. The kernel
contributes the envelope: discovery, `If-Match`, idempotency keys,
multi-field atomic writes, problem reporting. The domain contributes the
transition semantics and guards (e.g. close's open-blocker check). M3 is also
where gascity's "packed lease" pressure is honestly relieved: an atomic
multi-field swap (assignee + state + deadline in one guarded write) is the
primitive that evidence demands even before D4's lease question is settled.

### M4. Registered projections — with a substrate merge obligation

The generalization of M2's acceleration path, available to any domain. The
kernel owns the registry, the maintenance contract, and the consistency
contract; the domain owns the projection logic (`is_blocked`, molecule
progress, epic-eligible-for-closure).

Two variants exist in the wild, and the contract must name which is
normative — rev 1 conflated them:

- **Event-driven** (bts-rs): every readiness-affecting write emits into an
  event log in the same transaction; the projector catches up incrementally.
- **State-recompute** (bd on Dolt): rows arriving via `bd dolt pull` never
  pass the engine's write path and emit no events, so bd maintains
  `is_blocked` by *post-merge state-diff recompute* keyed on the pre-pull
  HEAD (`internal/storage/dolt/federation.go:146`). And at least one live
  write path mutates without an event by design (the idempotent same-type dep
  re-add updates edge metadata and deliberately writes no event —
  `issueops/dependencies.go:249-256`).

**Contract:** a projection is *defined* as a function of current state (plus
time); the event log is an optimization path. A substrate on which mutations
can arrive outside the write path (merge, import, repair) MUST either
synthesize kernel events for them or trigger a bounded recompute of every
registered projection — bd's post-merge recompute is the existing compliant
implementation of that obligation. D5's monitor feed inherits the same
requirement (merge-arrived changes must appear on the feed, synthesized if
necessary), or the feed is a lie on every federated clone.

### M5. Profiles (representation subsetting) — as a promotion condition

A profile is a conformant subset of a domain surface for a deployment class.
Surface A already ships the machinery — its Profiles section states five
rules (verbatim-or-absent, no re-spelling, bounds-only tightening, required
members retained, declared ratcheting extensions;
`openapi.v0.yaml:116-175`) — and the w57 governance scratchpad already frames
C as a conformant profile of a core Issue. BDP's refinement rule ("a
representation refinement must accept a subset of the representation admitted
by the conformed-to type") is the same idea one layer down. So the chain is:
kernel type → Work Item domain type → A's wire schema → C's bounded closed
DTO (`additionalProperties: false`, `maxProperties: 64` become *legal
subsetting* instead of unverifiable divergence).

Rev 1 demanded an "amendment without which C is non-conformant by
construction." That was wrong twice — the descriptor machinery is Fodder (so
nothing is non-conformant by construction today), and the selected ADM
already allows availability to "vary by Resource, authorization, and
requestor." What is genuinely unfinished, restated as **conditions on
promoting the descriptor/query/operation sections to normative**:

1. **Non-binding must be legal and discoverable.** The Fodder already makes
   named queries per-namespace bindings (a namespace that binds no `ready`
   simply has none); promotion must state what a generic client observes for
   an unbound query/operation (absence from the namespace document vs 404/405
   vs a typed problem) and whether any mandatory floor exists that a
   deployment cannot decline.
2. **The operation asymmetry needs a hook.** Operations are declared with
   type-descriptor `targetTemplate`s (`{+bead}/operations/close`), not
   namespace bindings — "decline to bind" currently has no mechanism for
   operations at all.
3. **Deployment profiles must be able to decline kernel-uniform surfaces with
   declared deviations.** C's negative-space corpus forbids not just
   `/ready` and `/claim` but `/dependencies`, `/comments`, and `/history`
   (`internal/apicontract/lint_test.go:31-36` on the api-1-10 branch) — the
   Link-CRUD surface that the ADM makes kernel-uniform. Either the profile
   vocabulary includes "declines surface X" declarations, or C's conformance
   claim is scoped honestly to S1's representation subset with its kernel
   omissions enumerated.

### M6. Per-collection filter dialects

Query *discovery* (scope, paging, result forms) is kernel; predicate
*language* is a collection-advertised dialect. bd's `query` language is the
Work Item dialect — its field names, substring-equality on title, and
closed-item defaults are domain semantics and stay there. A's enumerated
params and C's narrower param set are smaller dialects on the same mechanism.
No universal query language is selected until a second domain's evidence
exists (BDP and this proposal agree).

## 5. The specification stack

```
S0  BDP kernel law            identity, envelope, nodes/Links, descriptors,
    (bdp.md, promoted          operations/queries/events *mechanisms*,
     section by section)       scopes + aggregate constraints, problem model
        ▲ conformsTo / binds
S1  Work Item profile         the work-item type descriptors (as many as
    (new doc; absorbs the      survive M1's rule), ready + its projection
     taxonomy Layer-0          contract, close/reopen/claim semantics, the
     conformance manifest)     bd query dialect, JSONL interchange,
                               carrier-field freeze
        ▲ HTTP binding
    Surface A (/v0/beads/*)   S1's service API. Unchanged. Canonical today.
        ▲ profile
S2  Deployment profiles       gasworks C (bounded, closed, authz-partitioned);
                               future: loopback/agent profile, public profile
        ◀ projection
    bdp-lumen                 Lumen-facing projection of S0+S1 (watch(),
                               handles); peer of A, not part of the stack
```

Reconciling the two "kernels": the July taxonomy's Layer-0 "frozen protocol
kernel" is a *behavioral compatibility surface of the work-item domain plus
its substrate* (CLI shapes, JSONL fields, exit codes, stub errors). It is not
the BDP kernel and does not compete with it — it becomes **S1's conformance
manifest**. Its "frozen carrier fields" rule is a closed-schema artifact and
dissolves only when (if) S1's representation moves to open properties; until
then both freezes coexist, each guarding its own layer.

**Provenance caveat (decision item 3 prerequisite):** the taxonomy proposal
(`PROPOSAL-feature-taxonomy-and-packs.md`) and its `conformance.toml` design
exist today only as a recovered authoring transcript — the worktree that held
the 520-line document was deleted before anything was committed. Before the
ratifier can adopt it as S1's manifest, the document must be re-landed as a
reviewable artifact in-tree. (This is also a process lesson: proposals of
record belong in git, which is why this pair should be committed on a branch
rather than left untracked.)

## 6. Governance

Extend the existing w57 flow — downstream proposes, w57 ratifies, the
ratifier is mandated to counter-specify ("correct, not expedient") — to two
tiers:

- **S0 amendments** (kernel law): proposed by any domain owner (w55 infra,
  Plane, gasworks, the work-item domain itself, the BDP editors); ratified by
  w57. **Evidence gate:** a Fodder section or open question is promoted to
  normative only with implementation evidence attached — a consumer need
  demonstrated in shipped code, or a differential-oracle result. (The
  companion paper is the template: every position cites the code that forced
  it, and where it must touch selected law — P1 — it says so and drafts the
  amendment.)
- **S1/S2 amendments**: the current A ratification process, unchanged; S1
  documents may cite S0 but never weaken it.

Source note: the governance framing cited here ("A is canonical; downstream
proposes, w57 ratifies"; "C as a conformant profile — sharing the vocabulary
matters more than sharing the field set") lives in the w57 PM session's
working docs (`API-RECONCILIATION.md`, `CANONICAL-API-PROTOCOL.md`, currently
in that session's scratchpad, not in any git tree). Ratifying this charter
should include adopting those two documents into a tree for the same
provenance reason as §5's caveat.

**Spec home (decision item):** ratified S0/S1 text should live in (or be
mirrored into) the beads repo — proposed: `docs/protocol/` — so conformance
manifests, generated descriptors, and CI gates version with the code.
donbox/formula-language remains the editors' drafting space. Alternative:
spec stays in donbox and beads pins a ratified tag. Either works; pick one,
because a spec that versions apart from its conformance suite is how surfaces
B and D happened.

**Non-goals:** no change to surface A's contract or its x-go-type pinning (a
loopback-profile decision that S1 can later revisit); no new obligation on
bts-rs (stays deferred; its corpus remains the oracle; if BDP lands it is the
natural first clean-room kernel implementation — later); no storage
re-foundation; no Markdown/Obsidian projection (explicitly out of BDP v0).

## 7. Sequencing: five deltas (strangler-fig)

Each delta is independently valuable against a live consumer, lands behind
the existing conformance harness, and retires BDP open questions with
evidence. Order matters only where noted. (Ratification inputs per delta —
owner, effort, corpus impact, gating measurements — are in §10's table.)

| # | Delta | Consumer it pays off | BDP items it answers |
| --- | --- | --- | --- |
| D1 | **Link identity + writable edge properties** (companion paper): store-wide scope binding; per-`(type, source, target)` uniqueness; deterministic allocation incl. `type`; flag-day + arrival-repair migration; mutable edge metadata on the API | gascity `DepMetadata` becomes writable; Plane's parent+relation-on-one-pair 409 becomes two stored edges; bd retires the `AlsoBlocks` edge-collapse workaround (GH#3783). **Work-item behavior changes and is enumerated** (second-typed edges accepted; `DependencyTypeConflictError` retired; corpus scenarios updated) | binds 4 open clusters (scopes, cardinality/duplicates, rewiring, endpoints) + one clarifying **S0 law amendment** (allocation vs identity — paper P1). Note: the spec's new "Local IDs and protocol URLs" section (2026-08-01) already resolves the bd-short-ids-vs-URL-identity question — D1's allocator operates in local-ID space beneath it |
| D2 | **Type descriptors as data**: extend `types.custom`/`types.infra` config machinery to descriptor records (conformsTo, schema ref, named-query list, **ready-eligibility member**); `bd types` serves them. Compat constraints: explicit `--type` bypass of exclusions is preserved (`sqlbuild/ready.go:120-127`), and the known engine-list vs `types.infra`-config divergence (list respects config, ready does not — `workapi/list.go:325-329`) is unified, direction chosen at ratification | gascity stops type-squatting; ready's exclusion list moves from code into descriptors (merge-request/gate/molecule/rig keep today's behavior via the eligibility member — corpus stays green) | descriptor schemas, conformance model (work-queue items 2–3); promotes "descriptors are Beads" (§3 note) |
| D3 | **Typed metadata-scalar comparison + ordering**: ranges and ORDER BY on declared metadata properties (equality and has-key filters already exist — `sqlbuild/filter.go:302-324`; D3 is the narrower missing half) | Plane `plane/sort_order`; nudge "due" query stops being label-scan + client filter | query discovery/dialect boundary (item 13, partially) |
| D4 | **Kernel lease contract**: define single-winner claim + lease as a kernel primitive — winner scope under replication, residency, renewal, expiry visibility, reclaim hook — with the acceptance bar that both existing instances (bd's clone-local lease table + heartbeat/reclaim; gascity's in-band nudge lease) are expressible as bindings without behavior change. Falls back to M3 multi-field atomic ops alone if the unification fails the bar | nudge queue deletes its assignee-string packing either way (M3 suffices for that); a passing D4 additionally converges bd claims and queue leases on one primitive | operations/idempotency (item 12, partially) |
| D5 | **Monitor/event feed**: per-bead and per-collection event log with cursors + SSE, per BDP's monitor model — **including M4's merge obligation** (merge-arrived and repair-arrived changes are synthesized onto the feed; the no-event dep re-add path is either given an event or documented as feed-invisible) | gascity reconciler stops tick-polling; bdp-lumen `watch()` becomes implementable | events/replay (item 14) |

D1 before D2 (descriptors reference edge types with settled identity); D3–D5
are independent.

Each delta ships with: the S0 text it implements promoted from Fodder to
normative (via §6), a conformance addition (Tier-1 + differential scenario),
and a consumer sign-off from the window that motivated it.

## 8. Conformance

The house discipline — differential oracles over unit belief — extends to
the kernel: every S0 behavior lands with (a) a Tier-1 in-process conformance
case run on every backend, and (b) a CLI-differential scenario against the
work-item surface where observable. S1's manifest is the taxonomy
`conformance.toml` (once re-landed per §5's caveat). This is also BDP
work-queue item 18 (shared conformance suite), which the beads repo is better
equipped to host than the spec repo — another argument for §6's spec-home
recommendation.

## 9. Risks

- **R1 — The spec has selected almost nothing.** True: only the Abstract Data
  Model is law; descriptors, queries, Work Item contracts are Fodder; 18
  work-queue items are open. *Mitigation:* the evidence-gated promotion rule
  (§6) means we never build on unselected text; the deltas (§7) promote
  exactly the sections they implement. The thin core is a reason to charter —
  the selections will be made somewhere, and it should be where the evidence
  is.
- **R2 — Fifth rival surface.** *Mitigation:* this charter. BDP enters as the
  layer under A, through A's own governance.
- **R3 — Content-hash / JSONL re-baseline.** Moving domain fields to open
  properties changes `ComputeContentHash` inputs and interchange.
  *Mitigation:* deferred entirely; not in D1–D5. When it comes, typed columns
  become *indexing projections over properties* (M4), and the hash change
  ships as a versioned migration — under a real fence protocol, which D1's
  P3 work will have built (the current remote-migrate gate does not cover
  data re-keys; see the companion paper).
- **R4 — Type inflation.** The spec's nine work-item descriptors differ only
  in name/description/schema-URI today, and their *schemas* may remain
  aliases of `work-item-v1` — the spec itself proposes the collapse test M1
  adopts. *Mitigation:* the M1 invariant rule as a hard gate; S1 should
  expect most of the nine to collapse into Work Item + a classification
  property unless real invariants materialize.
- **R5 — Stranding mid-flight tracks.** *Mitigation:* explicit non-goals
  (§6); A normative, corpus stays oracle, gascity migration proceeds. Every
  delta is additive under them — with D1 the one deliberate exception
  (enumerated behavior change under P2, priced in §10).

## 10. Ratification package

### Decision items

1. Adopt the kernel/domain/substrate ownership table (§3), including the
   honest scoping of the two reclassifications (ready → domain query whose
   exclusion policy moves into descriptors; concurrency → generic CAS + M3
   now, kernel lease only via D4's acceptance bar).
2. Adopt the six-mechanism contract (§4) including the optimize-never-gate
   law, the M1 anti-inflation rule, and M4's substrate merge obligation.
3. Adopt the S0/S1/S2 stack (§5) — conditional on the taxonomy manifest being
   re-landed in-tree first (§5 caveat).
4. Approve the two drafted S0 amendment texts for proposal upstream: the P1
   allocation-vs-identity clarification (companion paper §4-P1, drafted) and
   the M5 promotion conditions (§4-M5, items 1–3).
5. Choose the spec home (§6): `docs/protocol/` in-repo vs pinned external
   tag; and adopt the two w57 scratchpad governance docs into a tree.
6. Approve D1 — **conditionally** on the two gating inputs in the table below
   (corpus enumeration; production-scale re-key measurement).

### Per-delta ratification table

Owners are proposed as the windows whose work motivated each delta; effort is
a placeholder scale (S/M/L) for the ratifier to correct.

| Delta | Proposed owner | Effort | Corpus impact (must be enumerated before approval) | Gating measurement |
| --- | --- | --- | --- | --- |
| D1 | beads core (this repo) + w55 sign-off; Plane sign-off on cursor versioning | L | scenarios pinning pair-uniqueness / `DependencyTypeConflictError` / idempotent re-add, in the 522-scenario corpus + Tier-1; count TBD, list as appendix | re-key timing on a production-scale federated clone; arrival-repair idempotence under concurrent merge |
| D2 | w57 (descriptor schema) + beads core (config/engine) | M | ready/list exclusion scenarios; explicit-`--type` bypass scenarios | none beyond conformance |
| D3 | beads core | S | new scenarios only (additive) | query-plan check at 100k (no regression on list) |
| D4 | beads core + w55 | M | claim/lease conformance suite (Gas Station v1.1 cases) must pass unchanged | both-bindings-expressible demonstration |
| D5 | bd-serve (w57) + w55 | M | none existing (new surface) | feed completeness under `bd dolt pull` (merge-synthesis test) |

### Evidence map (what a ratifier can and cannot dereference from this tree)

Verifiable in-tree or in named repos: every bd code citation; surface A's
spec; bts-rs `docs/PERF.md` / `PROJECTION.md`; gasworks lint corpus (branch
`feat/api-1-10-canonical-openapi`); gascity citations (w55 worktree,
`gc-enterprise-staging`); Plane ADR-0002
(`/data/projects/plane-beads/docs/adr/0002-edge-identity-and-pair-uniqueness.md`);
bdp.md and bdp-lumen.md (donbox/formula-language, `bdp/docs/specs/`).
Not currently dereferenceable, adoption prerequisite flagged where it
matters: the taxonomy proposal (§5 caveat), the two w57 scratchpad governance
docs (§6).
