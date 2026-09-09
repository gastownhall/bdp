# BDP reference implementation requirements

Status: draft

This document records requirements for the BDP reference implementation. It is
not a second protocol specification. Protocol behavior comes from the
[BDP v0 draft](../specs/bdp.md); unresolved protocol behavior remains unresolved
here rather than being invented by an implementation.

## Product requirements

- **PROD-001**: The repository MUST contain a Node/TypeScript reference stack
  consisting of a reusable client, a `bdp` executable, a reusable BDP HTTP
  server module, `bdptest`, `bdpbd`, and a black-box conformance kit.
- **PROD-002**: The implementation MUST preserve BDP's uniformity principle.
  Domain Bead and Link Types MUST NOT add protocol operations, queries, views,
  Events, or representation shapes.
- **PROD-003**: Domain behavior such as work readiness MUST be implemented by
  clients using generic BDP reads and mutations.
- **PROD-004**: `task`, `bug`, `feature`, `chore`, `epic`, and `decision` MUST
  be modeled as distinct nominal Bead Types, not as values of a secondary type
  discriminator.
- **PROD-005**: The first end-to-end product proof MUST be read-only
  `bdp bd ready`, producing equivalent results against `bdptest` and `bdpbd`.
  The initial proof excludes `bd ready --claim`, which is a mutation workflow.
- **PROD-006**: The non-normative `bd` mapping appendix MUST be harvested from
  the working `bd ready` implementation rather than written in advance.
- **PROD-007**: BDP v0 MUST NOT be declared complete until the repository that
  ships the product exposes an applicable BDP profile and passes the
  corresponding black-box conformance matrix at a recorded commit. If the
  shipping product moves to a different repository, this requirement follows
  it.

## Protocol requirements

- **PROTO-001**: Every advertised conformance profile MUST implement its exact
  required surface and guarantees. A module MUST NOT advertise a higher
  profile to expose a partially implemented feature.
- **PROTO-002**: Profile negotiation MUST begin with Scope discovery and MUST
  reject unsupported BDP versions rather than guessing compatibility.
- **PROTO-003**: Bead and Link records, Type IDs, local and absolute identities,
  selections, mutations, receipts, Events, snapshots, and changefeeds MUST use
  the normative wire forms once those forms are closed in the draft.
- **PROTO-004**: Every Link endpoint MUST be a Reference: a URI, or a
  Pinned Reference with exactly `uri` and `revision`. An in-Scope endpoint
  MUST identify a live Bead by its canonical URL. Any Reference may carry a
  pin: an authority MUST preserve and echo the pin byte-identically, MUST
  compare it only for equality, and MUST NOT validate, dereference, or
  interpret it in v0. Reference equality uses the URI alone.
  At least one endpoint of every v0 Link MUST be an in-Scope Bead.
- **PROTO-011**: A Bead Type MAY own outgoing Link Types, declared per
  (Bead Type, Link Type) pair with a required bound. Every mutation of an
  owned Link — creation, deletion, or property update — versions the
  source Bead; an incoming Link never versions its target. A Bead whose
  Type owns outgoing Link Types MUST carry its `ownedLinks` member — one
  entry per declared owned type, keyed by Link Type URL, valued by the
  owned Links' complete records in ascending code-unit order of their
  canonical `id`s — on every record read, and the member MUST be absent
  for Beads whose Type owns nothing. An Authorization View that projects
  a Bead projects its owned Links and their in-Scope targets.
- **PROTO-012**: An alias is a repointable locator beneath the fixed
  `alias/` root and is not a Resource. Alias resolution MUST be
  redirect-only: `GET` and `HEAD` return `307` with `Location` set to the
  target's absolute canonical Bead URL and no body. An alias MUST target a
  canonical Bead URL only, never another alias. An unknown alias returns
  the same `404` `resource-not-found` as an unknown Resource. An authority
  without aliases omits the `aliases` discovery member.
- **PROTO-013**: The disclosure vocabulary is three sibling `410`
  conditions — `event-history-expired`, `resource-pruned`, and
  `resource-erased` — gated on the single retained-history authorization.
  A `resource-pruned` problem MAY carry one `archivedAt` Reference,
  echoed and never validated; a `resource-erased` problem MUST NOT carry
  condition-specific extension members beyond its ordinary problem
  members. Unauthorized callers MUST receive the uniform
  `404` `resource-not-found`. Erasures MUST propagate through the
  changefeed as erasure records carrying a `{scheme, value}` digest of
  the erased version; retention removals MUST NOT propagate.
- **PROTO-014**: Bead and Link records MAY carry a common `attribution`
  member — `{ principal, status }` with `status` one of `claimed`,
  `unknown` — that is carried per version and never attested: the
  protocol transports it, attests nothing, and a generic client MUST NOT
  treat it as an authority claim; no status asserts authentication. It is
  supplied with every version-minting operation — creating, updating, set
  mutation, or an owned-Link deletion that mints the source's fresh
  version — outside `properties`, absent from the properties view,
  immutable for its version, and
  excluded from the semantic no-op comparison. Domain Types MUST NOT need
  to declare attribution as a property. A future attested form is a
  distinct member.
- **PROTO-016**: Number equality under the no-op law is over exact decimal
  values. An authority MUST refuse at admission any number literal in
  `properties`, at any depth, whose exact decimal value does not round-trip
  through IEEE 754 binary64 unchanged, as `validation-failed` with a
  diagnostic naming the member; a content-derived revision-token scheme
  MUST declare its number model by name, and `sha256-jcs` names RFC 8785
  serialization with numbers as binary64.
