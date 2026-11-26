# BDP stdlib — Changelog

Versions of the BDP **stdlib** pack (`packs/stdlib/stdlib.lumen`) — the shared
types and cross-cutting operations that sit above the core primitive floor
(`get` + `list`). This is pre-1.0 and `status: draft`: each entry marks what moved
so an implementer tracking the pack in parallel can diff against it. The pack is
tagged independently as `bdp-stdlib-*` (a monorepo stopgap until the package
system is real); this log opens with the 0.2.3 line and does not reconstruct
earlier history.

## 0.2.3 — unreleased

Draft changes toward the next release (pre-1.0, status: draft).

- **`getMany` (§2.6) — miss-partitioned bulk point-read (new op).** Resolves many
  `ref<any>` within ONE scope against a single consistent snapshot, returned as
  `found: [GetManyHit]` + `missing: [MissingRef]`. A ref is partitioned by how it
  resolves (as core `get`): a ref that resolves — including a pinned `rev` naming a
  tombstone revision, or a pinned earlier live revision — is a `found` hit; an
  unpinned retired ref is `missing { retired: true }` (the `410` case); a ref that
  does not resolve is `missing` without `retired` (the `404` case). Request order is
  preserved, a duplicate ref resolves once, and `select` projects each hit. A
  `Problem` is raised only for a whole-request error (malformed, past `maxBatch` →
  `limit-exceeded`, or a cross-scope ref); an absent or retired ref never faults the
  request. New types `GetManyResult`, `GetManyHit`, `MissingRef`.
  (`cli.name: "get"` → `bd get <id>...`.)
- **`deleteResource` (§3.5) — multi-id delete facade (new op).** The stdlib facade
  over the core `delete` primitive: an array of `unpinned<any>` with a chosen
  inbound-reference disposition and an optional dry run, settling per-ref as a
  `DeleteOutcome` (`deleted` / `would-delete` / `skipped` / `not-found` / `blocked`),
  one per target in request order. Each target is retired as by core `delete` (a
  tombstone revision, `retired: true` + `body: null`, idempotent). `onIncident`
  governs SOFT inbound references (a `ref<T>` body property pointing at a retired
  resource) — `dangle` (default; leave them resolving to the tombstone), `fail` (the
  one whole-request mode: faults `referential-integrity` and nothing commits),
  `sever` (retire the holders, listed in `severed`), `cascade` (transitively retire
  soft-ref dependents, listed per target in `retired`); structural `rel<>` endpoints
  are NOT governed here (a relationship's own cascade/restrict stays core behaviour).
  `fail` / `sever` / `cascade` require inbound-reference tracking or fault
  `capability-not-supported`. Guards `ifRevision` (single-ref only — `400` when
  `len(refs) ≠ 1`) and `precondition` (a `Filter`; else `blocked`); `dryRun`
  computes the full outcome without committing. New types `OnIncident`,
  `DeleteOutcome`. (`cli.name: "delete"` → `bd delete`.)
- **CLI arity-dispatch.** `bd get` / `bd delete` route a SINGLE id to the core
  primitive (`get → rep`, `delete → Rev`) and MULTIPLE ids to these stdlib ops
  (`getMany → GetManyResult`, `deleteResource → [DeleteOutcome]`); the output shape
  follows the arity. A client whose scope does not advertise stdlib fans the
  multi-id form out to N core primitives and synthesizes the partition / outcome
  list itself.
