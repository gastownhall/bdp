---
status: draft
authority: non-normative
informative-for: [beads-data-model]
---

# POSITION: Link identity, uniqueness, and offline merge — bd evidence for BDP's open questions

- **Status:** draft position paper for the BDP editors, via w57 ratification. Rev 2
  (rev 1 was adversarially reviewed by four independent agents; this revision
  incorporates all blocker/major findings — notably a corrected §3, an honest
  amendment framing in P1, an explicit scope binding in P2, and a rebuilt
  migration story in P3).
- **Date:** 2026-08-01
- **Companion:** `beads-kernel-charter.md` (this paper is delta D1's
  design input, and the worked example of the charter's kernel/domain boundary)
- **Scope:** binds four of bdp.md's open-question clusters — **scopes** ("Which
  Links can a server speak for?"), **cardinality/duplicate rules**,
  **rewiring**, and **non-Bead endpoints** — and proposes **one clarifying
  amendment to selected law** (the Abstract Data Model's "never derives a
  Link's identity from that tuple" sentence, in "Beads, Links, and Graphs" →
  "Links"). Link identity itself is *not* an open question — it is the ADM's
  selected law — which is exactly why the amendment in P1 is called out as an
  S0 law change, the highest-bar item in this paper.
- Code citations were verified against beads main on 2026-08-01; Plane
  citations are to `plane-beads` ADR-0002 (accepted 2026-07-31). Spec
  citations were re-verified against formula-language main `f26391ea`
  (2026-08-02) and are anchored to **section names and verbatim quotes, not
  line numbers** — the spec moved twice while this paper was in review (the
  same lesson ADR-0002 records for code anchors). The new "Local IDs and
  protocol URLs" section added in `55e73852` is addressed in P1 and §7; it
  strengthens rather than disturbs the positions here.

---

## 1. The implementation record

What a bd edge is today (`internal/types/types.go:1054-1072`; migrations
0002 → 0041 (typed targets) → 0043 (surrogate id PK) → 0050 (deterministic
id)):

```
dependencies(
  id CHAR(36) PRIMARY KEY,         -- surrogate; deterministic since 0050 (F1)
  issue_id,                        -- source
  depends_on_issue_id |            -- exactly one target column non-null
    depends_on_wisp_id |           --   (the composite (issue_id, depends_on_id)
    depends_on_external,           --    PK and column were dropped in 0043)
  type,                            -- 'blocks' default; 19 well-known + custom
  created_at, created_by,
  metadata JSON, thread_id,        -- real edge properties
  UNIQUE uk_dep_{issue,wisp,external}_target (issue_id, <target col>)
)
```

Five facts, each load-bearing:

**F1 — Identity is deterministic, and that determinism IS the merge
mechanism.** `internal/storage/depid/depid.go` derives `id` as
UUIDv5(fixed-namespace, `issue_id ␟ target`); migration 0050 made that the
primary key. 0050's header states the mechanism exactly:

> Migration 0043 gave the dependencies table a surrogate primary key
> `id CHAR(36) NOT NULL DEFAULT (UUID())`. UUID() is per-clone-random, so two
> clones that create the same logical edge — or that apply 0043 independently
> — end up with the same row under two different primary keys. Dolt then
> either refuses the merge ("different primary keys in its common ancestor")
> or pulls in both rows and trips the uk_dep_* unique keys. Either way
> `bd dolt pull` breaks with no bd-level recovery. (#4259)

Random, allocation-independent Link identity was tried **on a table with
uniqueness keys**. It broke replication. The fix was deterministic derivation
from the edge's natural key. (The qualifier matters — see §3.)

**F2 — Type is deliberately excluded from identity, and uniqueness is
per-pair across ALL types.** depid.go: "The dependency `type` is deliberately
NOT part of the identity (it is not in any unique key)." Consequently at most
one edge of *any* type may exist between a pair: a second, different type is
refused with `DependencyTypeConflictError`; a same-type re-add is an
idempotent metadata update that emits no event
(`internal/storage/issueops/dependencies.go:243-265`).

**F3 — Edge semantics are type-keyed and live in the domain, not the storage
layer's mechanics.** Which types block ready work is
`AffectsReadyWork() = {blocks, parent-child, conditional-blocks, waits-for}`
(`internal/types/types.go:1210-1213`). The write-time cycle guard walks only
`{blocks, conditional-blocks, parent-child}` — waits-for is deliberately
excluded from the acyclicity requirement (`issueops/dependencies.go:453-474`,
comment at :494). Note for P6: this guard is **write-time only**; nothing on
the pull/merge path checks cycles, and `bd doctor` carries an out-of-band
cycle detector (`cmd/bd/doctor.go:691-696`) — bd's acyclicity is *advisory
under merge*, a fact P6 must model rather than idealize.

**F4 — Endpoints already leave the graph.** `depends_on_external` has carried
`external:` targets since migration 0041; the typed target columns are a
storage projection of "endpoint is a URI, classified."

**F5 — Edge properties exist but are second-class, and deletion is
destructive.** `metadata` and `thread_id` are on every edge, but the same-type
re-add path is the only metadata write on an existing edge, gascity's
`DepMetadata` is a read-only bolt-on capability, and surface A exposes
`Dependency.id`/`metadata` read-only. Deletion: deleting a *source* issue
cascades its outgoing edges (0002 `fk_dep_issue ON DELETE CASCADE`); deleting
a *target* cascades only issue-target edges (`fk_dep_issue_target`, added with
the 0041/0043 shape) — external-target edges have no FK and dangle. No
tombstones anywhere.

## 2. The expressiveness gap F2 causes

One edge per pair regardless of type means bd **cannot state two different
relationships between the same two beads** — `blocks` and `relates-to`
between A and B is a hard error. The evidence this bites is first-party and
third-party:

- **bd itself** ships a workaround: `WaitsForMeta.AlsoBlocks` "marks a
  waits-for edge that was collapsed from a redundant depends_on/needs blocks
  edge onto the same spawner" (GH#3783; `internal/types/types.go:1229-1238`) —
  two logical edges folded into one row with a metadata flag because the
  schema cannot hold both.
- **Plane** hits it as a live defect: stock Plane allows a work item to be
  both sub-issue and relation of the same peer; the facade must map beads'
  pair-occupancy refusal onto a 409, and parent + relation on one pair is the
  one Plane shape bd cannot store (plane-beads ADR-0002, Decision on
  pair-uniqueness).
- **Retype** has no clean semantics: identity would survive a retype (type is
  outside the key) but the API refuses retype via the conflict error, so the
  capability is simply absent.

This is the single strongest argument that the current model is a
work-item-era compromise rather than kernel law.

## 3. The convergence constraint

Rev 1 stated this section as a "pick two" trilemma; review broke it (the
convergence property smuggled in "same fact = same tuple", and a
CRDT/set-semantics reading achieves all three under the natural definition).
What survives is narrower and is exactly the case bd is in:

**C1 — Convergence-on-same-fact requires allocation derived from what
individuates the fact.** In a scope whose replicas mutate offline and merge,
if two replicas independently asserting *the same fact* must converge to *one
Link* with a stable URL, the Link's URL must be computable from the fact's
immutable content. Random allocation makes the two assertions two Links;
merging them afterwards would be exactly the tuple-derived identification the
spec forbids.

**C2 — Therefore a tuple-uniqueness scope must allocate from the tuple.** A
scope that declares "one Link per `(type, source, target)`" has defined the
tuple as the fact. Combined with C1: deterministic allocation from the tuple
is not an optimization there, it is the only replication-sound choice. This is
what #4259 proved empirically — the breakage F1 records arose from the
*incoherent pairing* of tuple-uniqueness keys with per-clone-random ids, and
the repair was to align allocation with the declared uniqueness.

**C3 — Duplicates-permitted scopes are not broken — they trade dedup, not
convergence.** Without uniqueness keys, Dolt merges independently-created
rows cleanly; replicas converge on the set of all assertions. The cost is that
retried or independently-repeated same-tuple assertions accumulate as
distinct Links forever (deduplicating them would derive identity from the
tuple). Rev 1 called this "fatal"; it is not — for bd's blocking semantics
duplicate edges would even be harmless (`is_blocked` is an OR). It is a
semantic choice a scope must make with open eyes.

**C4 — Scopes wanting intentional duplicates AND retry convergence extend
the derivation basis.** Allocate from the tuple *plus an immutable,
creation-time discriminator on the Link itself* (an assertion key, an
asserted-by property): replays of one assertion converge, distinct assertions
coexist. Still a function of the edge alone — no origin tagging, no
per-clone divergence.

**Conclusion:** the open questions on cardinality and on Link allocation are
coupled through the replication model — **a scope's id-allocation policy must
be derived from its declared uniqueness constraint** (C2 for unique scopes,
C3/C4 for duplicate scopes). The spec already gestures at both halves: the
Fodder permits "a stronger domain-specific uniqueness rule" above the generic
model (Fodder → "Relationships" — close to P2's position), and the selected
cardinality discussion requires a recovery mechanism so "a retried create can
recover without treating that tuple as identity" ("Where do cardinality and
duplicate-Link rules live?", closing paragraph). What it does not yet do is
bind them together; that binding is this paper's contribution.

## 4. Positions

**P1 — Keep URL identity; amend the selected sentence to sanction
deterministic allocation as scope policy.** Rev 1 claimed this left kernel
law "unchanged"; that was wrong, and the honest version is stronger. The ADM
selects: "A Link's type, source, and target describe it but do not identify
it, so a Beads Service never derives a Link's identity from that tuple"
("Beads, Links, and Graphs" → "Links"). A UUIDv5-of-tuple allocator *is*,
under the letter of that sentence, deriving identity from the tuple. We
therefore propose a **clarifying S0 amendment** separating the two things the
sentence currently fuses.

The spec's new "Local IDs and protocol URLs" section makes the amendment
cleaner to state: bd's deterministic dep id is a **local ID** within an
identifier context, and the URL is minted by resolution against the context's
base URI. Deterministic allocation is therefore a *local-ID allocation
policy* — it never touches the URL-resolution machinery, and the amendment
below slots directly beneath that section's model:

> *A Link's type, source, and target describe it but do not identify it. A
> Beads Service never treats that tuple as a retrieval key, never merges,
> replaces, or resolves Links by it, and clients are never required to
> compute a Link's URL from it. A scope that declares tuple-uniqueness MAY
> allocate Link URLs deterministically from the tuple; allocation policy is
> not identity semantics, and a duplicate create in such a scope is answered
> by reporting and locating the existing Link* (mechanism per the recovery
> requirement the cardinality section already states; we propose
> 409 + `Location`).

What is preserved: retrieval is by URL only; no wire operation takes a tuple
as an identifier; the recovery response names the existing Link rather than
treating the tuple as its identity. What is admitted honestly: same fact →
same URL is observable across replicas and across delete/re-create, and that
observability is precisely why replicated scopes need it (C2).

**P2 — Aggregate constraints are scope-owned; the scope is bound explicitly;
the Work Item store's rule relaxes — which is a behavior change.** Adopt
BDP's option 3 (scope-owned cardinality and uniqueness). Rev 1 left "the
scope" undefined while promising gascity multiple typed edges per pair *and*
the work-item domain "identical behavior" — impossible, since both live in
bd's one shared `dependencies` table under the same `uk_dep_*` keys. This
paper binds the scopes cluster as follows for bd v1:

- **One deployment store = one authoritative scope.** Its constraint
  declaration is owned by S1 (the Work Item profile), because the work-item
  domain is the store's resident senior tenant; co-resident domains (gascity
  infra) live under the same declaration until per-domain sub-scopes exist
  (deliberately not designed here — machinery without a consumer).
- **The declaration relaxes store-wide to unique per `(type, source,
  target)`**, closing §2's gap for every tenant at once. This **changes
  observable work-item behavior**: `bd dep add` accepts a second,
  differently-typed edge between a pair; `DependencyTypeConflictError` is
  retired from storage law (S1 may keep a narrower domain rule for specific
  type pairs if ratification demands it — but then §2's gap partially
  survives, and the merge semantics of that stricter rule must be declared
  per P6). The conformance corpus pins the old behavior in a countable set of
  scenarios; enumerating them is a D1 ratification prerequisite (charter §10).
- Scopes electing duplicates use C3/C4: no uniqueness declaration, random or
  discriminator-extended allocation, and a declared stance on non-dedup.

**P3 — Type joins the allocation basis; the re-key is a flag-day migration,
because the existing fence does not cover it.** With per-`(type, source,
target)` uniqueness, the deterministic allocator must include `type` (today
it doesn't — F2). This re-keys every existing edge once, deterministically.
Rev 1 claimed "the remote-migrate fence" makes the mixed-version window safe;
review refuted that with code, and the honest story is:

- **What the fence actually does:** the remote-migrate gate
  (`internal/storage/schema/remote_migrate_gate.go:399-430`) fires only when
  the *local* database has migrations pending for the *running* binary. An
  old-binary clone whose DB matches its binary never trips it, and nothing on
  the pull path compares schema versions before merging (the forward-drift
  guard at `dolt/store.go:1758` fires at the *next open*, after the merge).
  So an old clone with unsynced edge writes can pull a re-keyed remote and
  strand v1-id rows — the same-fact-under-two-ids geometry the repo's own
  cross-upgrade test calls "the one that corrupted production"
  (`internal/storage/dolt/cross_upgrade_merge_test.go`), and whose current
  handling is refuse-and-re-clone
  (`cmd/bd/dolt.go` printAncestorPKMismatchGuidance).
- **What #4259 actually proved:** deterministic re-keying makes *independent
  migration* convergent (two clones applying the migration separately produce
  identical rows). It did not make the mixed-version *window* safe, and the
  depid namespace comment ("hardcoded here forever") warns against exactly
  this hazard. P3 overrides "forever" by neutralizing the stated hazard, not
  by ignoring it. Three mechanisms, at least one mandatory:
  1. **Flag-day protocol** — every federated clone synced and quiesced before
     a designated migrator moves; the discipline already documented in the
     recovery playbooks.
  2. **Arrival-time idempotent re-key repair** — the v1→v2 mapping is a pure
     function, so a repair pass on every migration/open/post-merge can
     converge straggler v1 rows instead of colliding with them (the
     migration-repairs machinery is the natural home).
  3. **Pull-side version gate** — refuse to merge across the re-key boundary
     (a schema-version comparison before `DOLT_PULL`), turning silent
     corruption into an instructed upgrade.
- **Deterministic ≠ stable.** Every edge id changes exactly once. That is
  consumer-visible: bd's own reads keyset-paginate on the dep id
  (`internal/types/types.go:1054-1060`) and the Plane facade uses
  `Dependency.ID` as its inbound paging cursor (ADR-0002), so in-flight
  cursors and any stored edge ids invalidate at the boundary. The migration
  must version cursors (reject-with-restart, not silently mispage) and the
  old→new mapping should be servable during a transition window.
- **Gating measurement, not falsifier:** the re-key must be timed on a
  production-scale federated clone *before* D1 is approved (charter §10),
  not shipped and watched.

**P4 — Rewiring: immutable structure.** Adopt BDP's option 3: `type`,
`source`, `target` are immutable for the life of a Link; only properties
mutate; rewiring is delete + create. Three reasons: (i) constraint
evaluation concentrates at creation — no update-time revalidation races;
(ii) under P1 deterministic allocation a retarget *must* change the URL (the
allocation basis changed), so in-place rewiring is unimplementable without
breaking same-fact→same-URL; (iii) in Dolt terms an in-place retarget diffs
as delete+insert regardless — the model should say what the substrate does.
This also finally gives retype clean semantics: delete + create, two events,
no identity ambiguity.

**P5 — Endpoints: uniform URI endpoints with optional scope closure.** Adopt
BDP's option 3 for non-Bead endpoints. F4 is years of production evidence:
`external:` targets work as inert leaves — the blocked-computation never
traverses them, and (per the spec's framing of option 3) guarantees such as
endpoint-type validation, reverse traversal, and logical deletion apply only
to endpoints that are Beads in the relevant authoritative scope. bd's typed
target columns are an implementation projection of exactly that rule.

**P6 — New aggregate-constraint kind: acyclicity over a declared edge-type
subset — with merge semantics declared per constraint.** BDP's constraint
vocabulary lists cardinality and tuple-uniqueness; bd needs a third, and F3
shows its shape: the store requires the subgraph of `{blocks,
conditional-blocks, parent-child}` to be acyclic while exempting `waits-for`.
It is not Link-Type-global (waits-for proves a type opts out per scope) and
not kernel law (a citation domain wants no such rule). But F3 also shows what
rev 1 idealized away: **bd's acyclicity is enforced at write time and merely
*detected* after merge** — two clones can each add an individually-acyclic
edge and merge into a cycle, which persists silently (every member
permanently unready) until `bd doctor` finds it. So the amendment must
require every scope-declared aggregate constraint to state its **merge
semantics**, one of: `merge-reject`, `deterministic-repair`, or
`advisory-with-detection`. bd's shipped position is
advisory-with-detection; a ratifier may choose to keep that and say so, but
the constraint vocabulary must make the choice explicit rather than implying
enforced invariants that replication cannot honor. (The same field covers any
domain rule stricter than the scope default — e.g. if S1 retains a
one-blocking-edge-per-pair rule, two clones adding `blocks` and `waits-for`
merge into a domain-invalid state that needs a declared outcome.)

**P7 — The kernel/domain boundary at the edge layer (the worked example).**

| Layer | Owns |
| --- | --- |
| Kernel | Link existence, URL identity, open properties, CRUD, incident traversal, scope membership; *enforcement mechanics* for scope-declared constraints (uniqueness, cardinality, acyclicity-over-subset, each with declared merge semantics); the duplicate-create recovery contract (P1) |
| Work Item domain (S1) | the 19-type vocabulary and custom-label policy; which types affect readiness (`AffectsReadyWork`); which subset must be acyclic and its merge semantics; the `is_blocked` projection and the `ready` query consuming it; parent-child's dotted child-id naming policy; any residual pair rule stricter than the scope default |
| Substrate | deterministic allocation policy (P1) and its namespace versioning; typed target columns as a storage projection; Dolt merge behavior; the flag-day/repair machinery (P3) |

The rule of thumb this table compresses to: **the kernel knows an edge
exists; only a domain knows what it prevents.**

## 5. Migration sketch (D1 in the charter's sequencing)

1. Schema: relax `uk_dep_*` to include `type`; re-key `id` via depid-v2
   (namespace bump, pure-function old→new), shipped under the P3 protocol —
   flag-day + arrival-time repair, with the pull-side gate as
   defense-in-depth. Not "one migration behind the existing fence": the
   existing fence does not cover this geometry (P3).
2. Issue content hashes are untouched — `ComputeContentHash`
   (`internal/types/types.go:177`) hashes issue fields only, no edge data
   (verified against the function body on main).
3. JSONL export/import carries edge ids from this version forward (today they
   are derivable, so old exports re-derive on import; exporters should emit
   them explicitly once the allocator is versioned).
4. API: expose Link id + writable `metadata` on the dep surfaces (library,
   then A as a ratification proposal). Cursor versioning per P3.
5. Conformance: enumerate and update the corpus scenarios that pin
   pair-uniqueness, `DependencyTypeConflictError`, and idempotent re-add
   (the count is a §10 ratification input); add Tier-1 cases: two types
   between one pair; deterministic re-key idempotence; straggler-repair
   convergence; acyclicity merge-semantics behavior.

## 6. What each consumer gets

| Consumer | Today | After D1 |
| --- | --- | --- |
| gascity (w55) | `DepMetadata` read-only bolt-on; one edge per pair store-wide | writable edge properties through the kernel surface; multiple typed edges per pair; ids re-keyed **once**, deterministically (old→new is a pure function; stored ids must be re-derived at the boundary) |
| Plane | pair-occupancy surfaces as 409 (`RELATION_PAIR_OCCUPIED`); parent + relation on one pair is unstorable — the one Plane shape bd cannot hold (ADR-0002); `Dependency.ID` already serves as its paging cursor | parent-child + a relation type become two stored edges on one pair, retiring the 409 for the common case; paging cursors re-anchor across the re-key (versioned cursors, P3) |
| Work-item domain | one edge of any type per pair; `AlsoBlocks` metadata-flag workaround (GH#3783) | behavior **changes** per P2: second-typed edges accepted, conflict error retired, `AlsoBlocks` collapse becomes two honest edges; blocking semantics unchanged (`is_blocked` ORs across edges); acyclicity + merge semantics declared per P6 |
| bts-rs (w59) | conformance corpus pins tuple-identity behavior | corpus updated with the migration (enumerated scenario list per §5.5); the deterministic allocator is a pure function, trivially portable |

## 7. What this paper does not decide, constraints it exports, and falsifiers

**Not decided here** (no bd evidence either way): symmetric Links and
endpoint role naming; inline Link projection in Bead representations;
per-domain sub-scopes within one store (P2 deliberately defers).

**Constraint exported to the deletion work-queue item:** deterministic
allocation resurrects identity across Link generations — delete
`(A, blocks, B)`, re-create it later, and the new Link receives the identical
URL. Invisible under bd's destructive cascade (F5: no tombstones), but if BDP
selects logical deletion for Links, the re-created Link's URL collides with
its own tombstone, and one URL then names two Link lifetimes — cutting
against the immutable-structure rationale that a Link URL never changes which
fact it identifies. The spec's new Local-IDs section now states the governing
rule directly: "an ID must not be reused for a different Resource while the
earlier identity can still be observed." So under tombstones, deterministic
re-creation is legal only if the re-created edge is defined as *the same
Resource re-activated* — otherwise it is forbidden reuse. Whichever deletion
model is selected must therefore either define tombstone re-activation
semantics (the duplicate-create response resurrects the tombstone), extend
P1's allocation basis (a generation qualifier), or accept URL reuse
explicitly as same-Resource semantics. D1 hands the deletion item this
constraint; it is not deferrable detail.

**Falsifiers:** **P1/P2** fall if a real consumer needs intentional
duplicate tuples *and* offline replication in one scope without an available
discriminator (C4) — the positions force that conversation, which is the
point. **P3** is gated (not falsified) by the production-scale re-key
measurement and by the straggler-repair mechanism proving out; if
arrival-time repair cannot be made idempotent under concurrent merges, D1's
cost rises to a coordinated flag day and the ratifier should re-price it.
**P6** weakens if scope-level constraint declarations prove too coarse
(per-subgraph exemptions), which would push constraints to named resources
instead.
