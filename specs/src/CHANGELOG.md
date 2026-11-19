# BDP Core — Changelog

Versions of the BDP Core specification (`core/core.lumen`, the normative source,
and `bdp.md`, the narrative). This is pre-1.0 and `status: draft`: each entry
marks what moved so an implementer tracking the spec in parallel can diff against
it. Strict semver (patch = non-breaking) tightens once the draft stabilizes. The
version lives in `bdp.md` frontmatter and the `core.lumen` header; this file is
the delta log.

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
