# Council flags — v0.2 plans (for Donna's morning review)

Review-council pass on the v0.2 plans, triaged by Eva overnight. **Nothing design-level was
silently edited** — the calls below are yours. Mechanical guards already folded are listed at
the bottom.

## Council coverage (read accordingly)
Ran **2 of 3**: Codex ✅, Claude ✅, **Gemini ❌** (API 500, then a 5-min timeout, no output).
Coverage is reduced, not full. Clean structural news both reviewers confirmed: **no dependency
cycles**; every *absolute* cross-area ref (`graph/…`, `types/…`, `corelib/…`) resolves to a real
declared node; BLL hygiene clean (no dup titles, no body on an undeclared node, no area-name
collisions, nothing deeper than one level). The holes are in the resolution *rule*, in missing
gate edges, one taxonomy text, and coverage.

---

## Design calls — need your ruling

### 1. Reference-resolution rule — THE crux; gates the shred
Body files reference nodes by bare name, and a single file needs **two different bases at once**.
Proof, from `graph/core.md` (one file):
- `primitives: after(data-model)` — `data-model` must resolve as a **sibling within the node**
  being elaborated → `graph/core/data-model`.
- `data-model: after(dsls/json-schema, …)` — `dsls/json-schema` must resolve against the
  **area** → `graph/dsls/json-schema` (`dsls` is a sibling of `core`, not a child of it).

One flat rule can't satisfy both. Two ways to fix it, **same resulting graph either way** — this
is a DSL-ergonomics call, not a change to the plan's meaning:

- **Codex — one-layer, rewrite the refs.** Rule: everything is area-relative, period. Rewrite
  ~16–21 bare sibling refs to carry their node segment (`data-model` → `core/data-model`). Dead
  simple rule, no fallback, but verbose refs and churn now.
- **Claude — layered, fix the spec (zero file churn).** Rule: resolve a bare first segment
  against (1) children of the node being elaborated, else (2) the area namespace, else (3)
  absolute if it's an area name, else (4) another plan's name. Terse refs, matches author intent,
  but introduces fallback shadowing (a name present at two layers).

**Eva's recommendation: Claude's layered rule + a hard no-shadow invariant** — the generator
*errors* if a bare name resolves at more than one layer (so terseness is safe). This refines the
two-layer "relative-to-area" framing I gave Rachel earlier; her forms are unaffected (they were
area-root level), and I'll re-sync her to whichever rule you pick. **Must be settled before the
graph is shredded — the generator hinges on it.**

### 2. Alias taxonomy (adjudicated — your confirm)
Claude flagged `identity/aliases: after(capability/callables)` as mis-wired (claiming alias/unalias
are primitives); Codex found **no** taxonomy violation. **Adjudication: the edge is correct.**
Aliases are intrinsic *callables* per your locked alias-as-callables ruling, so hanging them off
the callable layer is right. The stale artifact is the **`primitives` node title**, which still
reads *"get, pull, call, alias/unalias, CRUD"* — it lists alias/unalias as primitives (contra the
locked 6) and is redundant (`get` + `CRUD`). **Recommend retitle to the canonical six: "get,
create, update, delete, call, pull."** Flagged not folded because it touches the
primitive/callable boundary you own.

### 3. Landing gate isn't wired
Canon: everything blocks on the Generic Graph Model **landing**. But `types/` and `corelib/`
depend only on graph **spec** nodes (`graph/dsls/callable`, `graph/capability/callables`,
`graph/core/views`) — none on `graph/go-apis`, `graph/head`, or `graph/storage`. So the executable
intrinsics can be marked complete before the thing they run on has landed. (`types/conformance/suite`
correctly waits on `graph/head`; the intrinsics don't.) **Recommend:** add landing edges for the
execution-bound corelib nodes (`batch`, `versions`) → `graph/head` (or `go-apis`); keep dev
prerequisites separate so concurrent dev still works. Modeling call is yours.

### 4. No proposal-wide acceptance/conformance (highest-value gap)
The only conformance node is `types/conformance`, scoped to the Types cases. There's **no
Core/Write/Events-profile conformance** and no home for R1–R31 / S1–S16 traceability (it would
live in `memory/`, currently a stub). So root `done` can go green **without proving the headline
goal**. **Recommend:** a Core/Events-profile conformance node (waiting on `graph/head` like the
Types suite) + an R/S traceability node, and make `done` depend on the acceptance suite.

### 5. Provenance/attribution + export/import are nominal only
`graph/provenance` is an unelaborated leaf (only consumer: `go-apis`); export/import is buried in
the single `graph/core/views` leaf. Named proposal goals with no structure or dependents.
**Recommend:** elaborate provenance (split provenance vs attribution); surface export/import when
`views` grows. Eva can do this with your eye.

---

## Flagged-ready — Eva will apply on your nod (held, not folded)

- **Bindings mis-wire (#4 council).** `graph/dsls/bindings` (Go-interface generator) is consumed by
  nothing, and `core: after(dsls)` waits on the whole `dsls` subtree — so binding generation
  precedes the callable/EventSource mechanism it's built from (reversed order). Fix direction:
  keep only declaration **formats** in `dsls`; let `go-apis` consume binding generation. Held
  because it carries a modeling question (is a binding generated from the callable **format** or
  the callable **mechanism**? — that decides whether it feeds `go-apis` or follows it) and because
  its ref syntax depends on the resolution-rule call above.

## Routed to Melinda (corelib area)
- `batch` ← `graph/core/correlation` (transaction/cause; currently consumed by nothing).
- `versions` ← a retention / storage-class edge (pending the storage-class naming below).
- corelib landing edges (pending your landing-gate call, #3 above).

## Folded overnight (mechanical, already in this PR)
- **Stub placeholders** so `done` can't go *vacuously* green: `memory/plan` and `packs/plan` were
  empty `all{}` (vacuously satisfied); each now carries a `pending` node.
- **packs → types is now a real edge** (was prose only): `packs/plan` → `pending: after(types/plan)`.

## Minor, noted for later
- L1: `eventsource` doesn't name `core/primitives` though `pull` is a primitive (covered
  transitively — clarity edge, not a bug).
- L3: naming hazard — `graph/core/storage-class` (retention) vs `graph/storage` (the phase).
