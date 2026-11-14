---
status: draft
intended-status: non-normative
version: "0"
---

# Base-representation re-stratification — reconciliation map

**Design note, 2026-11-08. Non-normative. Not a merge.** Donna rules landing; Trish
coordinates `gastownhall/bdp`.

This note materializes the stratification settled in **decision packet 48** (*BDP
Representation, a base spec*) against the **existing** `specs/profiles/` tree, so the
shape can be reviewed **before** any full authoring pass. It is deliberately a *map*,
not a finished spec: for each piece of the stratification it states (a) where it lives
today, (b) what MOVES, (c) what is NEW, and (d) what RE-KEYS conformance. The authoring
pass (DSL fragments + codec/checks) follows review of this map.

Source of truth for the design: packet 48, `48-REPRESENTATION-SPEC-DRAFT.md`. Nothing
here re-opens a settled decision; where packet 48 and the standing tree genuinely
conflict, the conflict is surfaced under **Open reconciliation questions**, not resolved
unilaterally.

---

## 1. The stratification (packet 48, in one breath)

**Core is the fat keystone** — the state/data model (the nouns) *and* the operation
algebra (the verbs), plus the **three inseparable views** that co-change with the state
model, tied by one cursor:

- **Data model** — `Bead`, `Link`, `Reference`, and the representation envelope
  `{ id, kind, type, revision, storageClass, properties, metadata, revisionProvenance?, ownedLinks? }`.
- **Base definitions** — `storageClass` (`Durable{versioned} | Ephemeral | Intrinsic`),
  `transaction` and `cause` (both bare opaque synthesized ids, same shape, different
  scope), `revision`, and the **cursor** (opaque at the wire, with a documented guarantee
  that it encodes a transaction boundary).
- **Primitives (the RISC core)** — `get`, `pull`, `call`, `alias`/`unalias`,
  `create`/`update`/`delete`, plus the **transaction** primitive and **discovery**.
- **Capability-bead class** — `Callable` and `EventSource`, one family reached by
  `call`/`pull`/`get`; `EventSource` at the BDP level is `source(T)` only, `eventSchema`
  = JSON Schema for element type `T`.
- **The three views, tied by the cursor** — **snapshot** (via `get`; snapshot *is* the
  representation, delta is a partial view of it), **stream** (via `pull`; dual-mode finite
  poll floor `listEvents` + SSE `watchEvents`; `eventRetention` policy), **bulk**
  (export/import).
- **Optionality lives in Core** — each endpoint **declares** its supported ops via a
  capability/discovery mechanism; a read-only endpoint advertises `get`/`pull` but not
  `create`/`update`/`delete`. Optionality is **not** modeled as sub-profiles.

**Profiles on top (depend on Core):** **Types** (owner Trish — `TypeDesc` → enforcement
→ catalog), **Core callables** (owner Melnda — the built-in callable *instances*: `query`,
`list`, `batch`, `versions`, `updateWhere`/`deleteWhere`, built on Core's `call`),
**Packs** (depends on Types), **Memory UDT** (depends on Core).

Settled decisions honored throughout: alias = normal bead `Alias{target}` +
`alias`/`unalias` ops, resolution plain HTTP; comment = normal bead + annotation link;
`Intrinsic` storage class universal across Bead *and* Link; two vocab words kept distinct
(**primitives** = intrinsic to BDP; **Intrinsic** = the storage class, intrinsic to the
service); snapshot = the rep, delta = the partial view; `transaction` + `cause` as two
bare base fields.

---

## 2. The tree today (what we are re-stratifying)

The standing spec is **mature and cumulative**, and this is the delicate part: the fold
is a re-stratification of a reviewed tree, not a blank slate.

**Profile documents** (`specs/profiles/`):

| Profile | Files (selected) | Status today |
| --- | --- | --- |
| **Core / Read** | `core/core.md` (6k lines), `core/query.md`, `core/read-operations.md` (proposed native list/query), `core/resource-projection.md`, `core/retained-core.md`, `core/type-definition-read.md`, `core/read-contracts.md` | Selected v0.1 working draft |
| **Write** | `write/write.md`, `write/atomic-batch.md`, `write/object-edits.md`, `write/link-updates.md`, `write/id-root.md`, `write/retained-write.md`, `write/write-contracts.md` | Selected v0.1 |
| **Events** | `events/events.md` (finite observation) — plus a second copy at `core/events.md` | Optional capability |
| **Types** | `types/types.md`, descriptors, schema resources | Optional |
| **Callables** | `callables/callables.md` (callable / callable-query / callable-batch Bead Types, invocation via Write batch, CLI correspondence) | **Editorial draft — preview-1, not selected until Donna marks it** |
| **Transfer** | `transfer/transfer.md` (bulk package + admission) | **PROPOSED** |

**Schema distribution** — one lossless bundle, `core/bdp-v0.1.schema.json` (+ a mirror
under `packages/protocol/schemas/`). It is **generated** from the HTML-delimited
`markdown-json-schema/0.6` fragments embedded beside the prose; authors edit the fragments,
the codec extracts the JSON (`scripts/markdown-schema.mjs`,
`scripts/generate-markdown-contracts.mjs`). The transitional `core/bdp-v0.schema.json` is
the reference client's historical input and carries no canonical authority.

**Conformance is keyed on a cumulative ladder, NOT on the profile documents**
(`specs/conformance.md`): **Read → Read+Update → Transactional**, with optional **History**,
**Events** and **Types** capability rows. A claim inherits lower-ladder rows and *retires*
named predecessors (e.g. `transactional.discovery.document` retires
`read-update.discovery.document`). This keying is the single biggest re-stratification cost
and is treated on its own below.

**Already present in Core's schema today** (so parts of packet 48 are *relocations*, not
new): `coreDiscovery`, `capabilityAdvertisements` / `capabilityVersionAdvertisements`,
`cardinality`, `changeGroup`, `changefeedPage`, `beadRecord`/`linkRecord`, `reference`,
`propertyChange`, `createBeadMembers`/`updateBeadMembers`/`deleteBeadMembers`,
`revisionProvenance`, and the SSE changefeed + snapshot machinery (keyed under
**Transactional**: `transactional.changefeed.*`, `transactional.snapshot.*`).

---

## 3. The reconciliation map

For each stratification element: **(a) lives today**, **(b) moves**, **(c) new**, **(d)
re-keys conformance**.

### 3.1 Data model / representation envelope

- **(a) Lives today:** `core/core.md` *Resources and References* (`beadRecord`, `linkRecord`,
  `reference`, `revision`, `revisionProvenance`, `ownedLinks`). Already Core.
- **(b) Moves:** the envelope gains two members carried **explicitly on every record** —
  `kind` (today kind rides HTTP header `BDP-Resource-Kind` and the record shape, *never*
  an envelope field) and `storageClass` (new, see 3.6). So `beadRecord`/`linkRecord`
  become `beadRepresentation`/`linkRepresentation` with `{id, kind, type, revision,
  storageClass, properties, metadata, revisionProvenance?, ownedLinks?}`.
- **(c) New:** `kind` as an explicit, URL-qualifiable envelope field; `storageClass` as a
  required envelope field.
- **(d) Re-keys:** every Read row that asserts record shape (`read.*`, `read.namespace.point-kind`
  carrying kind in a header) must additionally admit/require the `kind` and `storageClass`
  envelope members. This is additive but touches the sealed Read record contract — **a
  Core change Trish coordinates**.

### 3.2 Primitives — the RISC core (`get` · `pull` · `call` · `alias`/`unalias` · `create`/`update`/`delete`)

- **(a) Lives today:** split across profiles. `get` (point read) is Core. `create`/`update`/
  `delete` are **Write** (`write/write.md` *Ordinary targets*; operation members in Core's
  schema, routes/admission in Write). `alias`/`unalias` are **Write** (`put-alias`/
  `delete-alias`). `pull` is **Events** (`view=events`, `scopeEvents`) + the Transactional
  changefeed. `call` is **Callables** (preview).
- **(b) Moves:** packet 48 names the verbs as *primitives intrinsic to BDP* and puts the
  **operation algebra** (the verb definitions + shared members) in Core. The mutation
  **members** (`createBeadMembers`, …) already sit in Core's bundle; what moves is the
  *framing*: Core owns the verb set and the one centralized `$defs` for their payloads;
  profiles bind them to transport.
- **(c) New:** a single Core *primitive catalog* (the eight ops + `transaction` +
  discovery) stated once, which the bindings reference rather than redefine.
- **(d) Re-keys:** **this is the most delicate cut.** Today the Read/Read+Update/Transactional
  ladder *is* roughly "get-only / get+singleton-writes / get+batch". If the verbs are Core
  primitives with per-endpoint optionality (3.8), the ladder stops being the unit of
  optionality. See **Open question Q-WRITE-CUT** — the Core/Write boundary (algebra in Core
  vs. route/batch/admission/idempotency binding in Write) must be drawn by Trish + Donna;
  this note does **not** presume it.

### 3.3 Snapshot view (via `get`)

- **(a) Lives today:** Core point read returns the complete record; the Transactional
  profile additionally has `transactional.snapshot.*` (snapshot checkpoint → changefeed
  rendezvous, closed projection, expiry, erasure ledger).
- **(b) Moves:** the *concept* "snapshot = the representation; delta = a partial view of it"
  is stated once in Core. The Transactional snapshot-checkpoint machinery (rendezvous into
  the stream, manifest, expiry) stays with the stream binding but is re-described as a Core
  view tied by the cursor (3.5).
- **(c) New:** explicit statement that `get` yields the snapshot and that a delta is a
  partial view of the same rep, not a separate type.
- **(d) Re-keys:** `transactional.snapshot.*` rows are re-keyed from "Transactional" onto the
  Core snapshot view (gated by the endpoint declaring `get` + stream, 3.8).

### 3.4 Stream view (via `pull`: `listEvents` finite floor + `watchEvents` SSE)

- **(a) Lives today:** **Events** profile (`events/events.md`) = the finite poll floor
  (`listEvents`-equivalent: `from`/`after`/`limit`, `cursor`/`next`, retention floor,
  hard-fail past floor). **Transactional changefeed** (`transactional.changefeed.sse`,
  `changefeedPage`, `changeGroup`) = the SSE push sibling. Two halves, two keyings today.
- **(b) Moves:** both halves fold into **Core** as the one dual-mode `pull`: `listEvents`
  (never refused for capacity, the compatibility floor) + `watchEvents` (SSE, refuses back
  to the floor). The op×kind **operation-record** (today `retainedEvent` /
  `retainedPostimageEffect` / `retainedDeltaEffect`) becomes the Core stream element; its
  three forms map to packet 48's `update`/`patch`/`snapshot` representations.
- **(c) New:** `watchEvents` stated as a *peer operation* to `listEvents` in Core (today SSE
  lives only in the Transactional changefeed); `eventRetention` as a first-class
  `Floor | Until` policy on the stream.
- **(d) Re-keys:** the **Events capability** rows and the `transactional.changefeed.*` rows
  are the biggest single re-key: they collapse onto one Core stream view, gated by the
  endpoint declaring `pull`. The `XFER-OBS` deferral (replication/streaming/cross-source
  order) is directly adjacent — folding SSE into Core must **not** silently adopt replica
  application, which `XFER-OBS` holds open. **Flagged.**

### 3.5 Bulk view (export / import) and the cursor tie

- **(a) Lives today:** **Transfer** profile (`transfer/transfer.md`, PROPOSED) = the portable
  package + admission; a `version` record is a `snapshot`. The cursor exists today as
  per-view tokens (Events `coverage`, changefeed checkpoint, snapshot anchor) rather than
  one named Core cursor.
- **(b) Moves:** bulk export/import folds into **Core** as the third view, because it
  co-changes with the state model. The **cursor** is unified: the watermark a snapshot is
  taken at is the watermark a stream resumes from is the watermark a package is cut at.
- **(c) New:** a single Core **cursor** definition — opaque at the wire, documented guarantee
  that it encodes a transaction boundary + intra-transaction ordinal — replacing today's
  per-view tokens as the one timeline primitive. (An enumerate/list pagination cursor is the
  Core cursor + a query-local position, built in the Core-callables profile.)
- **(d) Re-keys:** Transfer (proposed, so no sealed conformance yet) becomes Core's bulk
  view; `transactional.snapshot.rendezvous` (snapshot → changefeed continuity) is restated
  as "the cursor ties the three views." `XFER-RETAIN` (snapshot minima, continuity,
  erasure/publication races) is held open and must stay open — folding bulk into Core does
  not decide it. **Flagged.**

### 3.6 `storageClass` (universal `Durable{versioned} | Ephemeral | Intrinsic`)

- **(a) Lives today:** **absent as a universal field.** Durability is implicit (dolt-committed
  vs. not); capability resources have no storage-class marker.
- **(b) Moves:** nothing moves; this is additive.
- **(c) New:** a required 3-arm DU on **every** Bead *and* Link. `Intrinsic` spans nodes and
  edges (capability beads *and* synthesized links/aliases). Coherence rule: a stored Link to
  an ephemeral endpoint is itself ephemeral (`Link.durability ≤ min(endpoints)`); a
  synthesized (`Intrinsic`) link is computed and cannot dangle.
- **(d) Re-keys:** new record-shape obligation on all Read rows (as 3.1). New Transfer rule:
  only `Durable` ships; `Ephemeral`/`Intrinsic` do not manifest in export — this **agrees**
  with the standing ruling "Callables never manifest in export" and generalizes it.

### 3.7 Capability-bead class (`Callable` + `EventSource`)

- **(a) Lives today:** **Callables** profile (preview-1) defines the `callable` Bead Type,
  `callable-query`, `callable-batch`, invocation (`bdp/call/NAME`), argument checking,
  results, CLI correspondence. No `EventSource` bead type exists; EventSource behavior is
  implicit in the Events source + changefeed.
- **(b) Moves:** the *class* ("data beads vs. capability beads; a source bead + its optional
  `send` callable") is stated in **Core** as the base cleave. The built-in callable
  *instances* (`query`/`list`/`batch`/`versions`/`updateWhere`/`deleteWhere`) stay in the
  **Core-callables profile** (owner Melnda) built on Core's `call`. The existing Callables
  profile is the natural home for that profile content.
- **(c) New:** `EventSource` as a first-class capability bead (`source(T)`, `eventSchema`,
  `eventRetention`, `cardinality single|broadcast`), answering `get` (descriptor) + `pull`
  (stream); `send` as an optional extern callable over a source, validated against
  `eventSchema`. The base changefeed is `source(BdpEvent)`. **App-typed EventSources** are
  the one new BDP dependency flagged for coordination with Trish (Transactional profile).
- **(d) Re-keys:** Callables conformance is preview-only today (`callables.§11`), so little
  sealed to re-key; the capability-bead *class* statement is new Core text. Note the
  `CALL-PREVIEW` deferral already lists "how an endpoint advertises what it supports" —
  which **is** packet 48's capability declaration (3.8); these must be reconciled, not
  duplicated. **Flagged.**

### 3.8 Optionality via capability declaration (not sub-profiles)

- **(a) Lives today:** optionality is expressed **two ways**: (i) the cumulative
  Read/Read+Update/Transactional **ladder** (the main axis), and (ii) `capabilities`
  advertisements for History/Events/Types/atomic-batch.
- **(b) Moves:** packet 48 collapses axis (i) into axis (ii): each endpoint **declares** its
  supported primitives (`get`/`pull`/`call`/`alias`/`create`/`update`/`delete`),
  callables and EventSources. A read-only endpoint advertises `get`/`pull` and simply omits
  `create`/`update`/`delete`.
- **(c) New:** a Core `endpointCapabilities` declaration enumerating supported primitives +
  the transaction primitive + advertised callables/EventSources.
- **(d) Re-keys:** **the deepest re-key.** If optionality is per-primitive declaration, the
  Read/Read+Update/Transactional ladder is no longer the unit of conformance. Options for
  Trish + Donna: (1) keep the ladder as *named bundles* of declared primitives (least
  disruption to the sealed matrix), or (2) re-key the matrix per-primitive (faithful to
  packet 48, large). This note does **not** choose; it is **Open question Q-LADDER**.

### 3.9 Alias and comment as beads + links

- **(a) Lives today:** alias is a **repointable locator**, *not a Resource* (no rep, no
  revision), resolved via `307` redirect (`core/core.md` *Aliases*/*Alias resolution*);
  managed by Write `put-alias`/`delete-alias`. Comment has no base model.
- **(b) Moves:** alias becomes a **normal bead** `Alias{target: Reference}`, storageClass
  `Durable{versioned:false}`, managed by the `alias`/`unalias` primitives; resolution becomes
  plain HTTP on `GET` (`200` + `Content-Location` default; `HEAD` probe; `Prefer: no-resolve`
  → the Alias bead's own rep; `Prefer: redirect` → `307`). This is a **semantic change** from
  today's redirect-only, no-representation alias.
- **(c) New:** comment = normal bead `Comment` + a distinguished annotation link
  (`target: any`); threads via comment→comment links; a live comment stream is an EventSource
  over them. The `{kind, body}` non-resource lane is **dropped**.
- **(d) Re-keys:** the `read-update.alias.*` and `transactional.alias.*` rows (locator-only,
  no revision, no Event, excluded from batch, `307`) are **contradicted** by alias-as-bead
  and must be re-keyed, not inherited. The Events `alias-state` non-resource fact and
  Transfer's alias retained-fact family are affected. **Flagged as the most behavior-changing
  item** — standing conformance explicitly asserts the opposite today.

---

## 4. Cross-cutting consequences

### 4.1 What MOVES into Core (summary)

- The **operation algebra** framing (verbs as primitives) — from Write.
- The **stream** (finite floor + SSE) as one `pull` view — from Events + Transactional changefeed.
- **Bulk export/import** as the third view — from Transfer (proposed).
- The **snapshot/cursor** tie and one cursor definition — from per-view tokens.
- The **capability-bead class** statement — abstracted above the Callables preview.

### 4.2 What stays a PROFILE (does not merge into Core)

Per packet 48 §4 "What does NOT merge": batch **atomicity** + `@local` resolution +
synchronous receipts; the stream's **gaplessness/cursor/resync** binding; a call's
**opacity and authorization**; **capability versioning**. Plus the standing profile content:
**Types** interpretation/enforcement/catalog (Trish); the **built-in callable instances**
(Melnda); **Packs** (on Types); **Memory UDT** (on Core).

### 4.3 Conformance re-keying — the headline cost

The cumulative **Read/Read+Update/Transactional** matrix is the main thing the fold
disturbs. Three families of rows are affected: (1) record-shape rows (additive — `kind`,
`storageClass`); (2) **stream rows** (Events capability + `transactional.changefeed.*`
collapse onto one Core `pull` view); (3) **alias rows** (`*.alias.*` are contradicted by
alias-as-bead and must be re-keyed). The matrix's *shape* (ladder vs. per-primitive
declaration) is **Q-LADDER**. Recommendation: re-key in a **separate, later** pass once the
map's shape is accepted — do not entangle it with the first authoring pass.

### 4.4 Deferred-registry interactions (`specs/deferred.md`)

The fold touches several live deferrals; it must respect, not pre-empt, them:

| Deferral | Interaction |
| --- | --- |
| `XFER-OBS` (replication/streaming/cross-source order) | Folding SSE `watchEvents` into Core must **not** adopt replica application; keep the finite floor as the only guarantee. |
| `XFER-RETAIN` (snapshot minima, erasure/publication races) | Folding bulk into Core does not decide snapshot minima; current erasure/publication fences stay mandatory. |
| `CALL-PREVIEW` ("how an endpoint advertises what it supports") | **Same mechanism** as packet 48's capability declaration (3.8). Reconcile — do not create a second advertiser. |
| `PROV-NEXT` | `revisionProvenance` stays *data, not evidence*; the envelope's three placements are unchanged by the fold. |
| `CALL-SYS` (reserve `sys`) | Independent Core change already selected; capability beads under `sys`/`bdp` must respect it. |

---

## 5. Open reconciliation questions (for Donna + Trish)

Surfaced, **not** resolved here:

- **Q-WRITE-CUT.** Packet 48 §3 keeps **Write a binding** that "stitches the operation
  algebra onto routes and the batch envelope," while the materialization brief says "the
  ENTIRE wire protocol lives in Core." Where exactly is the Core/Write line — algebra +
  members + primitive catalog in Core, with routes/batch/atomicity/idempotency/admission the
  Write binding? This is the central cut and is Trish's + Donna's call.
- **Q-LADDER.** Keep Read/Read+Update/Transactional as named bundles of declared primitives,
  or re-key the conformance matrix per-primitive? (3.8 / 4.3.)
- **Q-ALIAS.** Alias-as-bead with `Content-Location` resolution **reverses** the standing
  "alias is not a Resource, redirect-only, mints no version, excluded from batch" contract
  and its conformance rows. Confirm the behavior change is intended to land (packet 48 marks
  it settled; the standing spec asserts the opposite).
- **Q-EVENTS-DUP.** `events/events.md` and `core/events.md` both exist; the fold assumes
  `events/events.md` is canonical and `core/events.md` is stale. Confirm before editing.
- **Q-BASE-NAME (packet 48 Q4).** Name a `Base`/`Core` profile explicitly, or keep the base
  as shared `$defs` the profiles reference? The map is written profile-agnostic; the authoring
  pass needs the decision.
- **Q-SNAPSHOT-PROMOTE (packet 48 Q5).** Promote `snapshot` beside the rep (it is also
  Transfer's `version` record), or keep it only in the stream view?

---

## 6. Authoring plan (phase 2, after this map is accepted)

Author **in the repo's markdown DSL**, not by hand-maintaining JSON:

1. Core owns description-rich **`markdown-json-schema/0.6` fragments** (HTML-delimited
   `bdp-schema:start/end`) beside the prose — five-column field tables for shapes; the sister
   Schemas/Parameters/Request body/Responses/Response headers tables for the primitive
   operations.
2. All data structures centralized in **Core's `$defs`** (one bundle, no forks); profiles
   `$ref` them.
3. Extract + check with the existing toolchain — **do not invent one**:
   `scripts/generate-markdown-contracts.mjs` (fragment → JSON distribution copies),
   `scripts/markdown-schema.mjs` (the lossless codec), `scripts/generate-openapi.mjs`
   (informative OpenAPI projection), `scripts/canonical-spec-revision.mjs`,
   `scripts/cli-spec-correspondence.mjs`, `scripts/check-spec-editorial.py`,
   `scripts/generate-callable-catalog.mjs`, `scripts/spec-schema-fragments.mjs`, plus the
   pnpm workspace `markdown:check` / `test:markdown` targets.
4. Conformance re-keying (4.3) is a **separate later pass**.

The order is deliberate: **map → review → author**. This PR delivers the map.
