# BDP Core — Changelog

Versions of the BDP Core specification (`core/core.lumen`, the normative source,
and `bdp.md`, the narrative). This is pre-1.0 and `status: draft`: each entry
marks what moved so an implementer tracking the spec in parallel can diff against
it. Strict semver (patch = non-breaking) tightens once the draft stabilizes. The
version lives in `bdp.md` frontmatter and the `core.lumen` header; this file is
the delta log.

## 0.2.3 — unreleased

Draft changes toward the next release (pre-1.0, status: draft).

- **Deletion is terminal — no resurrection.** A deleted id is never reused and never
  revived: `create`/`put` over a retired id fault `identity-taken`, and an unpinned
  read or `update` of a tombstone faults `410 Gone` (distinct from a missing
  target's `404`). Dropped the resurrection vestige — `Provenance.inception` no
  longer offers a `"revive"` basis, and `delete-and-bring-back` leaves the parked
  list — and reversed the CLI's create-family resurrection design (`bdp-cli.md`
  §452) to match. `--from-revision` recovers *content* from a live resource's
  history only; it does not revive a deleted identity.

- **`rep<T>` and the `Bead` / `Content` markers — the canonical resource/bead form**
  (reintroduces `rep<T>`, dropped in 0.2.2, with a cleaner motivation). A resource
  splits into a uniform envelope and a typed body: a domain type is written as the
  body ALONE and tagged (`type Issue is Bead { title, status }`), and `rep<T>` — the
  envelope around `body: T` — is applied at use (`get(ref<T>) -> rep<T>`). `Resource`
  is `rep<any>`. `Bead` / `Content` are vacuous kind markers (intention + static
  enforcement; the kind-path root). No firewall rule and no envelope-field magic —
  the wire is root-addressed (`/body/…`, `/type`, `/metadata/…`) with no remapping;
  the CLI MAY sugar the `/body` prefix. The `…Bead` wrapper types collapse
  (`type TypeDef is Bead`, its resource `rep<TypeDef>`), and `rel<F, T>` is a `Bead`
  body type.
- **`patch` is root-addressed** over the representation (`/body`, `/metadata`,
  `/type`, `/authority`; the immutable envelope and computed properties are
  read-only). This is how `type` / `authority` are mutated — no distinct arguments.
- **Operation result model.** A primitive returns its value or faults with a
  `Problem` (no declared `E`, not cancellable); an operation (`call` callable)
  settles as `Outcome<T, E> = Result<T, E> | fault | canceled`, so a command with a
  domain refusal declares `Result<T, E>` (`E` = business refusals; not-found /
  malformed stay Problems). Documented the `call` dispatch rule: a pre-dispatch
  failure is a bare `Problem` (no `Outcome`); a post-dispatch failure rides the
  `Outcome`.
- **Smaller core edits.** `ListFilter` → `Filter`; `BeadSchema`'s `Opaque` arm →
  an inline `JsonSchema { text }` (dropped the redundant standalone type); `create`
  / `put` body is `any` (the typed `body: T` is the pack-level view).
- **Tombstone is a revision — `retired?` + `body: null`.** `delete` mints a final
  revision carrying `retired: true` and `body: null` (new `retired?: bool` envelope
  member on `rep`). The tombstone appears in `revisions`, resolves through a pinned
  ref (a pinned `get<T>` of a tombstone yields `rep<any>`, not `rep<T>`), and an
  unpinned read faults `410 Gone`. `retired` is service-managed — minted only by
  `delete`, refused on `create`, ignored on `put`, read-only to `patch` — and
  `delete` returns the bare tombstone `Rev`. Sharpens the deletion-terminal model
  above into an observable log event.
- **`import` is caller-driven and resumable.** Records arrive in the request
  (`records: [ExportRecord]`, was `source: snapshot<ExportRecord>`) — no
  service-initiated pull; mirrors `push`. Resume keys are absolute: `importId?:
  ImportId` keys the accepted high-water mark and `fromOrdinal?: Ordinal` positions
  `records[0]`. Chunk framing: `ExportBegin` only in the first batch, `ExportEnd`
  only in the final. A tombstone record is applied by minting the tombstone.
- **`export` surfaces `request: ReadRequest`.** `jsonl` is the bulk default; `page`
  (a `Page<ExportRecord>`) where `request.format` asks. Honors only `after` /
  `limit` / `format`; `filter` / `select` / `from` are rejected `400` (projection is
  the op's own `where` / `select`).
- **`Page<T>` / `PushEvent<T>` parameterized** (were `Page { items: [any] }` /
  `PushEvent { body: {…: any} }`). Authoring-surface generics; the
  `PushEvent<T>.body` widening (record → any) is intentional.

## 0.2.2 — 2026-11-18

Breaking draft changes to the core model (pre-1.0, status: draft).

- **Core-model simplification** — dropped `rep<T>` (a read yields the type itself;
  `get(ref<T>) -> T`), the `Bead<T>` constructor (a bead is now `type X is Resource
  { fields }` — the firewall is the default — whose authority is a package), and the
  nominal `Relationship` base (`rel<F, T>` is the sole relationship construct).
  `namedDeclarations` splits into `PropertyDeclaration` (`{ name, type, computed? }`
  plus the sibling access modes) on `TypeDef.properties` and `ParameterDeclaration`
  (`{ name, type, required? }`) on `Signature.parameters`. Renamed `ElementRef` →
  `PackageElementRef`.
- **Relationships are resources** — a relationship is a resource, declared
  with the `rel<F, T>` form (`type X is <modifiers> rel<F, T> { <edge-fields> }`,
  refined with `is`) and refining it into a bead whose body implicitly carries
  `source` / `target` plus its own properties — identity, revision history and
  provenance like any resource; no separate edge or link type, and `ref<T>` stays
  single-parameter. Uniqueness is an optional `unique` modifier (natural key over
  the endpoints → a deterministic id; otherwise a surrogate, admitting many; the
  relationship `type` is not part of the key); graph modifiers (`acyclic`,
  `symmetric`, `reflexive`) constrain the relation. Referential integrity follows
  the reference KIND (structural `source`/`target` bind the relationship to its
  ends; soft references tolerate a dangling target). Creating or deleting a
  relationship does not touch its endpoints' revisions. A relationship is a valid
  reference target, and its endpoints may themselves be relationships. Supersedes
  the 0.2.0 "no links" baseline.
- **Computed properties** — `computed` is a body-property modifier (with the
  access-mode modifiers), not a type: a field marked `computed` is derived and
  revision-transparent — a change in its value alone mints no revision, emits no
  change event, and it never enters a content hash. Its storage is unspecified
  (recompute or cache); the derivation formula is supplied by a pack, not Core.
- **Change-event correlation** — rename `Frame` → `CallId` (and the `frame`
  fields → `callId`); `calledBy` stays the parent-call pointer. A call's
  correlation token now reads as what it is — a node in the call tree — distinct
  from `cause` (correlation to an initiation) and `transaction` (the atomic
  commit).
- **Call / cause / transaction model** (`bdp.md` §6, §8) — three orthogonal axes
  with their propagation rules: cause propagates unconditionally; transaction
  propagates by enlistment (Required / RequiresNew / detach); crossing a scope
  forces a transaction boundary but carries the cause.
- **Operation-frame events** — `CallEnter` / `CallLeave` arms on `ChangeEvent`
  bracket an operation's effects (enter names the operation, leave carries the
  outcome), emitted for unsafe operations only; a safe op leaves no frame. The
  envelope splits: `ChangeEnvelope` (common, no subject) + `ResourceChange` (adds
  the subject) for the Created / Updated / Deleted arms; the frame arms carry no
  subject. `transaction` is now required — a read carries the OCC snapshot it saw.

## 0.2.1 — 2026-11-17

Corrections — propagate the `(authority, type)` model to the last two spots the
migration missed:

- **ChangeEnvelope** — `subjectKind: PathString` + `subjectType: ref<TypeBead>`
  → `subjectType: PathString` + `subjectAuthority?: Authority`. The subject's
  denormalized type now mirrors `Resource.{type, authority}`; the stale `kind`
  field name and the lone `ref<TypeBead>` are gone.
- **list filter** — `isKind { kind: RelativeId }` → `isType { type: RelativeId }`,
  reconciling the filter condition with the advertised `ConditionKind.isType`.

## 0.2.0 — 2026-11-17

First complete working draft, released for implementation. Baseline:

- **Resource model** (no links) — `Resource` / `ref<T>` / `rep<T>` / `get`;
  `Bead<T>`; `kind` is the derived `type.id`; a type is `(authority, type-path)`.
- **Primitive set** — get, list, pull, push, create, put, patch, delete,
  revisions, call, cancel, export, import.
- **push** — accept-events, pusher-owned pump, credit/watermark backpressure,
  `(channel, ordinal)` first-write-wins idempotency.
- **Capabilities / discovery** — à-la-carte; `get` + `/sys/capabilities` as the
  mandatory floor; scope-wide `revisionModel` (`versioned` | `unversioned`).
- **Change events** — the changefeed, plus export / import.
- **Editorial** — the Scope decoder-ring (`null` arm) leads §1.1; §1.4/§1.5
  reorder (Resource shape before the authority/type pair); `TypeDef.bodySchema`;
  the fault-model normative on `Problem`.
