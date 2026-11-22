# OpenAPI delivery and the URI roots (`bdp/` vs `sys/`)

Status: **design note**, driving the normative edits to [`bdp.md`](../../specs/src/bdp.md) and
[`core.lumen`](../../specs/src/core/core.lumen). It documents the OpenAPI-delivery rules before
they land normatively. One fork (below) is open; everything else is the agreed direction.

## The question

A BDP service must serve an OpenAPI document describing the **complete surface area** of a
scope. Two things have to be pinned first: (1) **where** that document lives, and (2) **how a
client gets there** — which turns on the reserved-root distinction.

## The URI roots, restated

Two first path segments are reserved. The distinction is sharpened:

- **`bdp/` — fixed protocol routes that are NOT the resource-primitive projection.** Reachable
  without resolving a resource id and without first knowing which primitives a scope offers.
  This is the *meta and bulk* surface: bootstrap discovery, the OpenAPI document(s), and the
  bulk operations (`/bdp/export`, `/bdp/import`).
- **`sys/` — well-known intrinsic BDP resources, addressed by id and read with the `get`
  primitive.** This is the primitive projection applied to well-known beads: `/sys/changes`
  (the changefeed), `/sys/installedPackages`, and any intrinsic capability bead.

The rule of thumb: **`bdp/` is what a client can do *before or outside* the BDP primitive
projection; `sys/` is BDP resources read *through* it.**

## Decision — discovery is a bootstrap route under `bdp/`

Basic discovery must live **outside** the primitive projection, because the capabilities
document is what *tells a client which primitives (including `get`) are offered*. Defining
discovery **as** a `get` makes it a projection of itself — a bootstrap circularity. So:

- **`GET /bdp/capabilities`** is the authoritative bootstrap discovery endpoint — a fixed,
  always-present route, independent of the advertised primitive set. Its body is the
  capabilities document (`{ scope, base, repModel, defaultType?, capabilities, packs[] }`).

> **Open** — does `/bdp/capabilities` **replace** `/sys/capabilities`, or do **both** exist (the
> authoritative bootstrap route at `/bdp/capabilities`, plus a `/sys/capabilities` intrinsic
> **bead** that mirrors the same content for uniform `get`-based access once bootstrapped)? The
> recommendation is **both** — keep the capabilities-as-intrinsic-bead model as an optional
> `sys/` mirror, but make the `bdp/` route the normative entry point that depends on nothing.
> This fork changes the discovery wording throughout `core.lumen`, so it is resolved before the
> normative edit lands.

## Decision — the scope's OpenAPI at `/bdp/openapi`, derived by rule

- **`GET /bdp/openapi`** serves the OpenAPI document for the **complete surface area** of the
  scope: the fixed route table (Core) × the scope's installed packs (types + operation
  signatures, from discovery) × each type/op schema.
- **Derived by rule, optionally materialized static.** This follows the precedent the spec
  already sets for the pack overlay: the live form is derived from discovery, and a static
  `catalog.json` MAY be checked in (byte-identical to `/sys/capabilities`.`packs`) for offline
  or build-time pinning. OpenAPI gets the same treatment — derive per request; a static
  per-scope or per-package document is an optional build-time materialization, **not** a
  required separate artifact per package.
- **Per-package slice:** `GET /bdp/openapi/{pack}` serves the derived OpenAPI for one installed
  pack (a filtered view of the same derivation).

> **Open** — default posture on static vs derived: the recommendation is *derive by rule*, with
> static materialization offered only as a build-time pin. Confirmed before the normative edit.

## Discoverability

The bootstrap capabilities document (`/bdp/capabilities`) carries a link to the scope's
OpenAPI document, so a client reaches the full surface from the one always-present route. (The
exact link shape — a field in the capabilities body vs an RFC 8631 `service-desc` link
relation — is a wording detail for the normative edit.)

## Where the corpus stands today

The current spec does **not** yet state any of the above — this note is what closes those gaps:

- Today `/sys/capabilities` IS discovery, modelled as a `get` on a `sys/` resource (an
  intrinsic capability bead). That is the bootstrap circularity above, papered over by
  declaring "`get` and discovery are both the mandatory floor."
- Today `bdp/` holds only the bulk ops (`/bdp/export`, `/bdp/import`); it had narrowed from the
  broader "non-primitive protocol surface" to "bulk routes."
- There is **no** home for an OpenAPI document and **no** way specified to get one. The
  generated catalog is an *informative core signature catalog with empty paths* — not a scope's
  concrete surface.

## Implementation notes

1. Serve **`GET /bdp/capabilities`** — the capabilities document, independent of the primitive
   set.
2. Serve **`GET /bdp/openapi`** (and `/bdp/openapi/{pack}`) — derived from the route table ×
   installed packs × schemas; a 200 OpenAPI 3.1 document covering the whole scope surface.
3. Carry the OpenAPI link in the capabilities document.
4. (Pending the fork) keep `/sys/capabilities` as an optional intrinsic-bead mirror.

## Next step

Once the fork is resolved, the normative edits land in [`bdp.md`](../../specs/src/bdp.md) (the
roots, the bootstrap principle, discovery and OpenAPI delivery) and
[`core.lumen`](../../specs/src/core/core.lumen) (the route table gains `/bdp/capabilities` and
`/bdp/openapi`). This note is retired when those land.
