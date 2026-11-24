# `conformance/` — the BDP wire-level conformance gate (Rust)

**Pin:** core spec **v0.2.3** = `gastownhall/bdp` `main` @`488a2d01` (merged commits, never draft tips; where
`specs/generated/` lands). This is the lockstep merge gate for the Beads Protocol.

## What this is

A native Rust, wire-level, **black-box** conformance suite: cases run over HTTP against a single
in-memory reference endpoint. It is its own **self-contained** cargo workspace — one `cargo build`
/ `cargo test`, mainstream deps, no Node, DB, or network — so it stays green on `main`. The gate's
purpose: a spec change that alters a wire shape **with no covering case fails CI and cannot merge**
(`fail-if-no-coverage`).

## The tier-1 gate (`gate/`)

- **Denominator** — `bdp_gate::denominator()` parses the repo's generated v0.2.3 OpenAPI catalog, read
  **live** from `specs/generated/openapi/core.openapi.json`, into the tier-1 coverage surface: every
  primitive operation plus each of its declared `>=400` fault statuses. The v0.2.3 surface is
  **54 rows** (13 ops + 41 faults). Reading it live is what makes the gate *lockstep*: when the spec's
  wire surface moves, the denominator moves with it (and a unit test tripwires on the row count so the
  change gets reviewed). A frozen vendored copy would silently stop catching spec changes.
- **Generator witness** — `bdp_gate::source_surface()` derives the SAME surface independently, straight
  from the normative `specs/src/core/core.lumen` `/// openapi =` annotations, and a unit test asserts the
  two agree. `check-generated.py` validates the generation pipeline from the source side; this validates
  it from the consumer side, in a different language, sharing no code — so agreement means the generator
  **invents no rows and drops none**, which neither side can establish alone. A divergence is a real
  signal: either `specs/generated/` is stale, or the lowering dropped or invented a response.
- **Two accepted annotation shapes** — anything counting this surface must read both. 12 primitives use
  `problem = { status = [...] }` (shorthand for "these statuses return a `Problem`"); `call` alone uses
  the explicit `responses = [ { status = ..., schema = ... }, ... ]`, which is load-bearing rather than an
  inconsistency — its statuses carry distinct schemas. A counter that knows only the shorthand
  undercounts by one and reports 51 instead of 52.
- **`call/409` is the one `>=400` row that is NOT a `Problem`** — it responds `application/json` with a
  `Reply` (a declared domain failure; the caller branches on the arm), where every other fault row
  responds `application/problem+json`. A case covering it must assert a `Reply`; expecting a Problem
  there fails for the wrong reason and looks like a reference bug. A unit test tripwires on the
  exception, so a second non-Problem row cannot be quietly assumed Problem-shaped.
- **Cases** — `gate/tests/gate.rs` drives a `RemoteScope` against `Server(InMemScope)` over loopback
  HTTP. Each case records the `SurfaceId`s it covers (e.g. `op/get`, `op/get/fault/404`).
- **Two signals.** A case expected to pass that FAILS always fails the gate (a real wire-level
  regression). Uncovered denominator rows are reported and, under `BDP_GATE_STRICT=1`, fail the gate
  (`fail-if-no-coverage`) — kept non-blocking while tier-1 is filled in, flipped to blocking once the
  surface is covered.

## The tier-2 obligation ledger (`gate/src/lib.rs`)

Tier 1 measures the **wire surface**. It cannot see an obligation with no wire status, and most of
`core.lumen`'s obligations have none. Under the conformance-plumbing policy every `/// normative:`
line IS a conformance obligation, so the ledger enumerates them and makes each one resolve to exactly
one disposition:

| disposition | meaning | evidence it must carry |
|---|---|---|
| **surface-bearing** | the wire carries it; covering those tier-1 rows covers it | the rows, which must exist in `denominator()` |
| **behavioural** | a tier-2 case exercises it; no wire status to key on | the case |
| **waived** | not covered yet | a tracking issue |

- **It pins each obligation's RESOLUTION, never the cardinality.** A count cannot be pinned coherently
  here: #428 takes the obligations from 67 to 79, so a ledger asserting 67 breaks when it lands and
  one asserting 79 cannot be built before it does. Pinning dispositions is correct from either side of
  that merge — verified by running it against both `origin/main` (67 obligations, 12 pending) and
  `refs/pull/428/head` (79, 12 registered, 0 pending). A new or reworded line surfaces as an
  **unregistered obligation naming the line**, which is an error a spec author can act on; a count
  mismatch is not.
- **Registered-ahead-of-the-spec is a real state, reported as `pending`.** That is what lets #428's
  twelve be registered before #428 merges, which is what its merge gate needs.
- **Report-only, staged exactly like tier-1.** The backlog is expected to be non-empty today, so an
  unregistered obligation prints; `BDP_GATE_STRICT=1` makes it fail. Current ledger: **67
  obligations, 1 registered, 66 backlog** on `main`.
- **The parse is ANCHORED, and a test enforces that.** `core.lumen` documents its own annotation
  syntax *using that syntax*, so an unanchored `grep -c '/// normative:'` counts two lines that are
  not obligations and reports 69 where the answer is 67. That hazard has now hit this file three times
  (it previously gave 61 for 59, and 15 for 13). `the_normative_parse_excludes_the_self_documentation`
  asserts those two lines never enter the set **and** that they still exist in the file, so the guard
  cannot rot into one that guards nothing. The weakened, unanchored implementation passes 11 of the
  12 lib tests and is caught only by that one — the vacuity check passes too, because 69 is a
  plausible count.
- **The 14 store-wide guarantees are NOT in the ledger.** They live in a plain `//` block, so
  `normative_surface()` cannot pick them up, and `EXPECTED_GUARANTEES` already checks them. One
  obligation, one checker: the ledger references an existing checker rather than re-counting it.
- **First pre-existing find.** The ledger immediately surfaced an obligation normative on `main` all
  along with no case and no waiver — *"a write that would leave the state unchanged mints no new
  revision"*, guarded for `delete` only (#412) and not on `put`/`patch`. Tracked separately in
  gastownhall/bdp#433, because it predates #428's cohort.

**Current coverage: 29/54** — measured by running the gate, not derived. Read the composition below
rather than the number: a count that restates a list is a second source of truth about that list, and
this one has drifted from it four times. One drift was produced *mechanically* — a merge auto-resolved
this figure from one branch while hand-resolving the list it summarises, leaving them independent. The
figure was right by arithmetic coincidence (`call` + `call/409` arriving while `get/400` and
`delete/400` stopped being reachable), and **four rows had changed while the total did not.** A count
that survives a merge is not evidence its list did.

Across three case families:

- **Typed happy-path** — `op/{create,get,put,patch,delete,call,cancel,revisions,list,export}` (the
  primitives the Server routes and InMemScope implements).
- **Typed semantic faults** — `create/409`, `get/404`, `get/410`, `patch/404`, `patch/412`,
  `delete/404`, `delete/412`, `put/409`, `put/410`, `put/412`, `patch/410`, `call/409`,
  `cancel/404`, `cancel/409` (triggered through the typed `RemoteScope`, which also reads the
  scope's declared traits).
- **Raw-HTTP protocol faults** — `create/400`, `put/400`, `patch/415`, `patch/422`
  (crafted malformed requests via `bdp_protocol::http::send`, exercising the Server's wire validation
  that the well-formed client never reaches). `get/400` and `delete/400` **left** this family when the
  pre-0.2.3 binding was retired: both malformed the *id*, which only the retired convention made
  reachable. `create/400` and `put/400` survive because they malform the *body* on a valid route —
  *malformed body* and *malformed id* look like one producer class and are two.

The remaining 25 rows are uncovered for concrete, recorded reasons:

- **13 of the 25 need the subject to implement 3 more primitives** — `import`, `pull`, `push`: the 3
  `op/*` rows plus 10 of their declared faults. Counted from the gate's own uncovered list, not
  estimated. These are ROUTED by the fence but answer `501` ("not implemented by this scope"), and
  `RemoteScope` has no client method for them. *Routed but not implemented* is a different
  statement from *unroutable*, and the gate can tell them apart.
- **The other 12 are faults on primitives already implemented** — `create/422`, `delete/400`,
  `delete/409`, `export/400`, `get/400`, `get/406`, `list/400`, `list/406`, `patch/400`,
  `patch/409`, `put/422`, `revisions/400`. Every one was probed and none is producible without a
  subject change; the measured table below says what each probe returned. The `400`s and `406`s
  among them share one reason: Appendix D.8 names no normative producer for either status, so the
  gate could not ground them even if the subject produced them (see the ungrounded-rows section).
  **`list` and `export` contributed their `op/*` rows and nothing else for exactly that reason** —
  every fault they declare (`list` `[400, 406]`, `export` `[400]`) is ungrounded. **`cancel` is the
  mirror image and contributed all three of its rows**: `[404, 409]` are the two statuses D.8 has
  entries for, so neither was blocked the way a `400` or a `406` is (see the `cancel` section below
  for which of the two producers is *named* by D.8 and which is derived from the declared set).
- **`call` contributes nothing to the uncovered list.** It declares `[409]` only, and that row is
  covered. Its other reachable faults **structurally cannot have a declared row**, and that is by
  design: `call`'s dispatch rule mandates the fault's *shape* — a `Problem` with no `Outcome` — and
  names its producers longhand (unresolvable `operation`, malformed `request`, unauthorized,
  idempotency-key mismatch), but names no status. The 404 this subject answers is its own choice,
  and D.8's catch-all puts a fault at its Problem's own status. So this is the open-ended fault
  channel working as intended — distinct from a fault D.8 gives a *specific* status and producer
  that no operation declares, which would be a genuine enumeration gap.
- **`export` now REFUSES a stream that does not end with `ExportEnd` — a fix, claiming no row.**
  `RemoteScope::export` parsed the body line by line and returned `Ok` with whatever it accumulated,
  never checking the final record was the terminator, so a truncated backup read as successful and
  whole. The refusal lives in `parse_export_jsonl` with five unit tests, which claim **no surface
  row**: there is no declared fault for a truncated body and there should not be, because the stream
  never reached a state the wire could report on. They are unit tests rather than gate cases because
  the reference server never writes a truncated stream, so no case driven through it can produce the
  input, and fault injection would mean a server that lies on request.
  **RULED, and the obligation now names its subject.** When this landed, the line did not say which
  reader was bound, so it was recorded as a defect fixed rather than an obligation discharged. #428's
  merged text settles it: *"An export MUST end with the `ExportEnd` line. ANY reader of an export
  stream MUST refuse a file that does not end with `ExportEnd` (truncation detection) and MUST NOT
  treat it as whole."* So this refusal is **on-obligation**, not merely strictness gained — and
  `ExportEnd` is a truncation sentinel on the FORMAT, which is why it binds every consumer rather
  than one named primitive. The obligation is still **waived** in the tier-2 ledger, not behavioural:
  "any reader" is not discharged while `import` — the other reader — is unbound, and `import` needs
  the same guard when it is bound. The export half is covered by `export_truncation_tests`.
- **The faults on routed ops are NOT reachable by probing — measured, not estimated.** This list
  previously claimed ~14 of them were "reachable with more raw-HTTP probing". That was speculation and
  it was wrong: every candidate was probed against the subject and **none is producible without a
  subject change.** What the probe actually returned:

  | row | probe | observed | why it is not producible |
  |---|---|---|---|
  | `get/406` | `Accept: application/xml` | `200` | no content negotiation; `Accept` is ignored |
  | `put/422`, `create/422` | malformed payload | `400` | malformed bodies are rejected at the wire, so these need a *valid-but-unprocessable* body the subject does not distinguish |
  | `patch/400` | non-array, then non-JSON | `422` | both land on `patch/422`, which is already covered; `patch/400` has no producer |
  | `delete/409` | plain delete | `200` | referential integrity is an advertised capability the subject does not claim |

  **Two rows left this table by being FIXED rather than explained.** The probe also returned `200` for
  `put/412` (`If-Match: stale-rev`) and `put/409` (`If-None-Match: *` on a live id) — because `put`
  could not carry a guard at all: the trait took no `if_rev`, so the server read no precondition and a
  guarded write proceeded against a stale revision while reporting success. That was a **lost-update
  vector**, not a coverage gap. `put` now carries `Guards` and the subject enforces them, so both rows
  are covered above.

  **That is the distinction this table exists to draw.** A row that is unreachable because the subject
  is *silent* (no content negotiation, no referential integrity) is a gap. A row that is unreachable
  because the subject *accepts a precondition and ignores it* is a defect, and the only way to tell them
  apart is to probe each one and read what came back.
- **All three `410` rows are now covered** (`get`, `put`, `patch`). A write that TARGETS a retired
  resource faults Gone, reachable **only under `idModel: permanent`**, so each case keys on the
  declared model rather than asserting terminality outright. `put/410` was the last declared row
  blocked on the subject rather than on a ruling: `put` over a tombstone used to start a fresh
  lifecycle, reviving a spent identity, which is the **subject contradicting a merged rule** rather
  than a gap. A subject test had pinned that behaviour by name, so the defect could not be corrected
  without it going red — which is the useful kind of failure.
- **`get/410` was re-keyed, not deleted.** It had asserted terminality outright and *happened* to be
  right, because this subject is `versioned` and `versioned` REQUIRES `permanent`. Being right for a
  reason a case never checked is still worth fixing: it now reads the declared `idModel` and asserts
  `410` under `permanent` or `404` under `reusable`, so the next subject need not be versioned for the
  case to stay honest.

### `cancel`: what the three rows cost, and what the spec does not settle

`cancel` was the expensive primitive and the reason is structural: **there is nothing to cancel
until an operation can be minted asynchronously.** Binding it was not binding one primitive, it was
building the `AsyncResult` lifecycle — `?mode=async` minting a pending handle, a `CallMode` on the
trait's `call`, a 202 carrying `rep<AsyncResult>`, and only then the three rows. Before this,
`do_call` answered `?mode=async` with `501` and `InMemScope` advertised `asyncSupported: false`.

Each row's producer, and where it comes from:

| row | producer | grounding |
|---|---|---|
| `op/cancel` | cancel a pending handle; `reply.outcome = canceled` is then readable on it | the description names the write |
| `cancel/404` | a handle id that was never minted | D.8 names it: *"404 get of an absent resource"* |
| `cancel/409` | the handle is already SETTLED (`reply` present) | **derived**, see below |

**The 409's status is grounded and its producer is derived, and the difference matters.** D.8 has a
`409` entry — unlike `400`, `406` and `422`, which have none anywhere — but that entry names `call`'s
declared failure, id collisions, and "also some Problems". It does not name this producer. The
derivation: `cancel` declares `[404, 409]`; D.8 gives 404 to absence and this target demonstrably
exists; `cancel` acts on a *running* handle (its description), and `Outcome`'s normative line says
*"A present `outcome` means the invocation is settled, whichever arm it holds; a transient state
(running/waiting) is NOT an arm"*. So settled ⇒ not running ⇒ the remaining declared status.

**That same normative line settles whether `cancel` is idempotent, and the answer is no.** `delete`
is idempotent on an existing resource and declares no `410` as a consequence; `cancel` declares a
`409`, and "settled *whichever arm it holds*" deliberately refuses to privilege one arm — so
"already `canceled`" is not a state distinguishable from "already failed", and reading a second
cancel as a no-op would invent the distinction the spec flattens. Double-cancel is therefore how the
409 is reached here. The race the spec is really about — the operation settling on its own just
before the cancel lands — needs a scheduler, and this store has none: a minted handle stays pending
forever, which is also what makes it cancellable at all.

**An absent fault did real work again.** `cancel` takes `unpinned<AsyncResult>` and declares no
`412`, while `put`, `patch` and `delete` each carry a revision guard (D.3) and each declare one. The
missing parameter and the missing fault agree, which is what makes this a derivation rather than a
preference: `cancel` has no precondition channel, so a revision on the handle is an argument its
declared type forbids and is REFUSED rather than dropped. Dropping it is the `do_put`-ignored-
`If-Match` defect exactly — a caller who asked "cancel only if still at this revision" gets a
success and cannot learn from the result that nothing checked.

This has a consequence worth naming, because it is forced by the types and reads like a wart:
`call ?mode=async` answers `rep<AsyncResult>`, whose `id` is PINNED, and `cancel` takes `unpinned`.
**The handle you are handed is not in the form the primitive that kills it accepts**, so a caller
must unpin it — which is sound, since `cancel` declares no `412` and could not have used the
revision anyway. The gate does that step explicitly (`unpinned()` in `gate.rs`) rather than letting
a client do it invisibly.

Three things the spec does not settle, flagged rather than resolved:

- **The async disposition is declared twice.** `Request.async: bool = false` is a member of the
  request BODY; `call`'s `openapi.params` declares `mode` on the REQUEST LINE; and Core's `call`
  prose speaks only of the query form. No precedence rule is given. This binding carries it on the
  request line and adds a `CallMode` parameter to the trait's `call` so there is exactly one source
  of truth; the body's `async` member is not read. A mode mismatch in either direction is refused
  with `mode-refused` — **at `500`, not `409`**, because `call/409` is the one `>=400` row in this
  binding whose body is declared to be a `Reply` rather than a `Problem`, so a bare Problem at 409
  from `call` is unrepresentable: a conformant client reads the status as a declared failure and
  looks for an `outcome` that is not there. (Found by red-then-green, not by reading.) `500` also
  says whose fault it is — the server checks `asyncSupported` before dispatching, so reaching a
  mismatch means the scope advertised a mode and did not honour it.
- **`cancel` declares no `410`.** Under the declared `permanent` id model a write targeting a retired
  id is Gone and a cancel is a write, so this subject faults `410` there via D.8's catch-all
  (*"any fault — the body is the Problem, carried at the Problem's own status"*). But `put` declares
  `410` for exactly this situation and `cancel` does not, so either the declaration is short a row
  or a retired handle is meant to answer something else. No case asserts it either way.
- **D.9 names no problem code for the 409.** The nearest entries (`precondition-failed`,
  `identity-taken`) are bound to other statuses and other producers, so `already-settled` is coined
  and the gate keys on the STATUS, which is what the surface declares. This is a pre-existing
  condition rather than a new one: the subject's whole code vocabulary already diverges from D.9
  (`not-found` vs `resource-not-found`, `erased` vs `resource-erased`, `already-exists` vs
  `identity-taken`). Reconciling it is its own change.

One correction fell out of choosing an encoding: the sync `Reply` emitted `"cause": {"id": …}` and
`"callId": {"id": …}`, which no declaration supports — `type Cause is string` and
`type CallId is string`. It was caught while writing the same two members onto a minted
`AsyncResult`, where they sit at top level precisely so they stay queryable while `reply` is absent,
and `cancel` reads them back so the settlement it writes is correlatable to the call it settles.

### 44% of the declared fault surface has no normative producer

**18 of the 41 fault rows are declared without any normative line naming what produces them.**
Appendix D.8 is a status-to-producer table and it covers `404`, `405`, `409`, `410`, `412` and `415`.
It does not cover:

| status | rows | state |
|---|---|---|
| `400` | 11 | the only grounded `400` is length-related and attributed to **intermediaries, not the origin** |
| `406` | 2 | **zero** prose anywhere — and a probe shows `Accept: application/xml` returns `200`, so it is declared, undefined *and* unimplemented |
| `422` | 5 | mentioned only incidentally |

So **the denominator counts rows the spec does not define.** 54 overstates the *defined* surface, and
the useful question is not "what produces a `400`" but **does the surface declare faults the spec does
not define, and for each, define it or undeclare it?** On the second answer the denominator drops toward
36. That is a ruling rather than a gate change, and it follows the precedent set for `delete/404`:
ground it in the spec, not in an implementation's behaviour.

A related limit, from the same appendix: *"4xx/5xx — any fault — the body is the Problem, carried at the
Problem's own status."* So **any operation may answer a status its own declaration omits.** The declared
fault lists are a subset of what can occur, by design — which means this denominator measures the
*declared* surface and cannot measure the reachable one.

### Two rows retired with the legacy binding

`get/400` and `delete/400` were produced by the router rejecting a `:`-bearing id as an unknown verb —
the pre-0.2.3 `id:verb` convention the action fence replaces. A `:` is now an ordinary id character, so
those requests are well-formed reads of absent resources and correctly answer `404`. There is no
spec-grounded producer to move them to, per the table above, so they are recorded uncovered rather than
kept alive by retaining a dead convention.

**`create/400` and `put/400` survived the same change, and the difference is the lesson:** they malform
the *body* on a valid route, which is a real producer. The retired two malformed the *id*, which was
only a producer because of the convention. Four rows looked at risk; two actually were — and the way to
tell was to run it, not to reason about it.

### Counting honestly

**Coverage counts rows a case TOUCHES. It is not a claim that each row is independently verified.**
Those are different properties, and conflating them is how a suite comes to overstate itself:

- `delete+erased` was **vacuous** — it passed with its seed `put` never having run, because the
  subject minted a tombstone for an id that never existed, so both `op/delete` and
  `op/get/fault/410` were falsely claimed. Fixed in the subject and the case.
- **5 of the covered rows do not depend on the scope at all** (the four malformed-id `400`s and
  `patch/415`): the `Server` produces them in route parsing and media-type validation, before the
  scope is consulted. The anti-vacuity test names that set exactly — see `SCOPE_INDEPENDENT_ROWS`.
- A case that has **never been seen to fail is not yet evidence.** Each fix here was verified
  red-then-green: the fix removed, the case observed failing with the right diagnostic, the fix
  restored.

## Not the TypeScript `packages/conformance`

The existing `packages/conformance` is the Sprint-1 **TypeScript** suite. This Rust `conformance/`
does not path-collide with it. Intended shape: **one language-neutral case corpus**, re-derived
against the v0.2.3 model, with Rust + TS as two runners over it. Coexist / supersede / reuse is an
open ruling, not settled here.

## Layout

```
conformance/
  Cargo.toml          # the gate workspace
  gate/               # the TIER-1 gate
    src/lib.rs        #   denominator(): the generated OpenAPI -> 54-row coverage surface
                      #   (include_str! of ../../specs/generated/openapi/core.openapi.json, LIVE)
    tests/gate.rs     #   wire-level cases + coverage report (BDP_GATE_STRICT to block)
  reference/          # bdp-ref: the ONE green endpoint (InMemScope over HTTP), pin-agnostic
    src/main.rs       #   Server::new(InMemScope).with_public_base(base).serve(listener)
    tests/liveness.rs #   RemoteScope <-> Server over HTTP: a create -> get round-trip
  subject/            # the SUBJECT UNDER TEST — suite-internal, no external contract (see below)
```

## `subject/` — the subject under test

Four crates, **owned here**, which the cases drive:

- `bdp-primitives` — the `BdpScope` trait + wire types.
- `bdp-jsonpatch` — the RFC-6902 subset used by `patch`.
- `bdp-protocol` — the framework-free HTTP `Server` + the `RemoteScope` client (`impl BdpScope`).
- `bdp-inmem` — the in-memory scope the reference serves.

### No external contract

These crates are **suite-internal**. They are owned in `gastownhall/bdp` and they exist to be
measured by the cases next to them. There is **no semver, no published API, and no stability
promise**, and there is no upstream to track or re-vendor from — they change whenever a case needs
them to. `publish = false` enforces the mechanical half of that; this section is the half that
reaches a person before they depend on the wrong thing.

An implementation may copy them and then owns whatever churn follows. **Divergence from any
similarly-named crate elsewhere is expected, not a defect to reconcile.**

The directory was previously called `vendor/`, which was the wrong name: it implied these were
copies tracking an upstream. They are not.

### The subject is implemented from the spec, never from the cases

> The subject is implemented **from the spec, never from the cases**; the cases are derived **from the
> spec, never from the subject**. Two artifacts independently derived from the same normative text
> remain independent even when one hand writes both — the tautology only materialises when one is
> written by reading the other.

This matters more now than it used to. The subject is owned here, so the gate and the thing it
measures share one owner, and that erodes the property that makes a conformance suite worth running:
that something in the loop has **no authorship stake in the artifact it checks**. The rule above
preserves most of that independence under a single owner.

What makes it worth writing down rather than merely intending is that it turns a matter of care into
something **reviewable**. The question at review time is concrete:

> Does this subject change cite normative text, or does it cite a case?

A change justified by *"to make the case pass"* is the failure mode, and it is visible in a diff. So
is a correct change for a case-shaped reason — see the `415` check in `subject/bdp-protocol`, which
cites the media-type clause and flags the one sub-case the spec leaves ambiguous rather than settling
it by appeal to existing behaviour.

**Flagging beats resolving.** When the spec is genuinely ambiguous, the discipline does not tell you
which reading to take — it tells you to take one and *say so*. Record which reading, and why the other
is live, in the code. That is what makes a wrong choice correctable:

> The discipline's value isn't that it makes you right. It's that it makes you **legible when you are
> wrong.**

The `415` check is the worked example. Its first version exempted an absent `Content-Type` on the
narrower reading that the fault clause named only *"another media type"* — and flagged the ambiguity
rather than closing it by appeal to what the code already did. The spec then ruled present-or-fault,
against that reading, and the fix was one condition because the open question was already written down.
Had it instead said *"preserves existing behaviour"*, the gap would have sat there looking deliberate
and the ruling would have had nothing to land on.

This is a different claim from the independence principle above. That one is about **who** checks; this
one is about **why flagging beats resolving** when you cannot check.

**Two limits, so this isn't oversold:**

- It does **not** protect against the spec itself being wrong. That is what the independent
  `core.lumen` witness (`source_surface()`) and cross-lane probing are for. Someone reading only the
  discipline could conclude they are covered when they are not.
- The mechanism is cheap **only when the checker already exists for another reason**. A discipline
  that requires standing up a new checker for each artifact will not hold.

### Fixing the subject is in scope

When a case covers a row the subject does not implement correctly, **fixing the subject is part of
the work**, not a cross-repo request. Two consequences worth stating, because they cut against the
instinct to treat a green run as success:

- A spec change propagates to the subject **only as far as coverage reaches**. The gate grows with
  coverage; it does not hold the spec to implementation speed.
- `not_implemented` is an **`Ok` signal**, not an error (a 501 is converted to it client-side, since
  `RemoteScope` is itself a `BdpScope`). So a case that merely propagates errors passes against a
  subject that implements *nothing*. The harness refuses a `not_implemented` response for any row a
  case claims, rather than trusting each case to remember — see `record()` in `gate/tests/gate.rs`.

## Run

```
cargo test -p bdp-gate                   # denominator asserts + wire cases + anti-vacuity + report
cargo test -p bdp-gate implements_nothing # the anti-vacuity backstop on its own
cargo test -p bdp-gate -- --nocapture    # also print the covered/uncovered surface
BDP_GATE_STRICT=1 cargo test -p bdp-gate # fail-if-no-coverage (blocking)
cargo test -p bdp-ref                    # the liveness round-trip
cargo run  -p bdp-ref                    # serve the reference at 127.0.0.1:8787 (BDP_REF_ADDR)
```
