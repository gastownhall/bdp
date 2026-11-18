# BDP Core — Changelog

Versions of the BDP Core specification (`core/core.lumen`, the normative source,
and `bdp.md`, the narrative). This is pre-1.0 and `status: draft`: each entry
marks what moved so an implementer tracking the spec in parallel can diff against
it. Strict semver (patch = non-breaking) tightens once the draft stabilizes. The
version lives in `bdp.md` frontmatter and the `core.lumen` header; this file is
the delta log.

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
