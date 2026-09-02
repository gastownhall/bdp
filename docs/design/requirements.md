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
- **PROTO-005**: A generic client MUST be able to parse and issue protocol
  requests without retrieving a Type Descriptor. Descriptor retrieval is for
  validation assistance and domain understanding, not basic wire parsing.
- **PROTO-006**: The reference implementation MUST accept open property objects
  when their effective Type contract permits them. It MUST NOT silently impose
  closed-schema behavior.
- **PROTO-007**: Type Descriptor installation, replacement, governance, and
  evolution MUST NOT be added to the core client or BDP HTTP surface. They are
  reserved for a follow-on operator specification.
- **PROTO-008**: Read+Update MUST retain the six independent singleton
  operations and expose the normative `sequence` carrier. Sequence members
  MUST execute strictly in declaration order without parallelism, but without
  a sequence-wide lock or rollback; unrelated mutations may interleave,
  successful prefixes remain committed, and later independent members continue
  after failure. Successful creates MAY bind local IDs for later members. Every
  member MUST carry its own idempotency key and terminal result. `batch` remains
  reserved for the Transactional profile's ordered, atomic carrier.
- **PROTO-009**: Transactional behavior MUST preserve atomicity, validation,
  revisions, receipts, ordering, snapshots, and replay semantics once their
  wire contracts are closed.
- **PROTO-010**: BDP failures MUST use the normative HTTP status and RFC 9457
  problem taxonomy once adopted. Implementation-specific failures MUST not be
  exposed as successful protocol responses.

## Client requirements

- **CLIENT-001**: The reusable client MUST expose generic BDP concepts rather
  than one method for every domain command.
- **CLIENT-002**: The client MUST resolve discovery links, canonicalize
  references, enforce version/profile availability, and preserve opaque
  revisions, positions, cursors, and Event IDs.
- **CLIENT-003**: The client MUST make retries only when the protocol and the
  request's idempotency guarantees make the retry safe.
- **CLIENT-004**: The executable MUST support deterministic machine-readable
  output and useful human-readable output. Diagnostics MUST be written
  separately from machine-readable results.
- **CLIENT-005**: The `bd` command family MUST be a client-side domain module
  layered over the generic client interface.

## `bd` compatibility requirements

- **BD-001**: The compatibility inventory is `init`, `create`, `show`, `list`,
  `ready`, `update`, `close`, `reopen`, `delete`, `purge`, `dep`, `query`,
  `config`, `count`, `version`, and `stats`.
- **BD-002**: Exact flags and behavioral cases for `dep` and `query`, and then
  for every other command, MUST be inventoried against the supported `bd`
  baseline before that command is declared compatible.
- **BD-003**: Compatibility MUST be measured as observable behavior, including
  result selection, ordering, exit status, diagnostics, and JSON output where
  applicable. It MUST NOT be inferred merely from similarly named commands.
- **BD-004**: True physical purge MUST remain outside core BDP. If the
  compatibility executable eventually exposes purge, it MUST be identified as
  an adapter-administration operation rather than a generic BDP mutation.
- **BD-005**: The supported `bd` version range and fixture corpus MUST be pinned
  before `bdpbd` compatibility is claimed.
- **BD-006**: The repository MUST contain one language-neutral reference-domain
  fixture set at `fixtures/reference-domain/` defining the Type IDs, Type
  Descriptors, and JSON Schemas for every Bead and Link Type exercised across
  the reference implementations and conformance corpus. Those implementations
  MUST consume the shared artifacts rather than maintain independent copies.
  The fixture set is non-normative implementation evidence: it neither defines
  universal BDP Types nor constrains which Types a product deployment uses.

## `bdptest` requirements

- **TEST-001**: `bdptest` MUST be deterministic for a given fixture, clock,
  identifier source, and request sequence.
- **TEST-002**: It MUST be able to advertise and exercise each conformance
  profile independently.
- **TEST-003**: Test controls such as fixture loading, time advancement, fault
  injection, and reset MUST remain outside the BDP HTTP interface.
- **TEST-004**: It MUST support positive cases and programmable protocol
  failures needed to validate clients, including malformed responses,
  disconnects, expiry, conflicts, and retry dispositions.
- **TEST-005**: Its state MUST be inspectable by the test harness without making
  implementation-only state part of BDP.

## `bdpbd` requirements

- **BDBD-001**: `bdpbd` MUST use the supported `bd` executable and documented
  machine-readable output. It MUST NOT depend directly on `bd`'s private
  database schema.
- **BDBD-002**: A configured `bd` workspace MUST map to one BDP Scope with a
  stable canonical Scope URI.
- **BDBD-003**: The adapter MUST advertise only guarantees it can preserve over
  `bd`. It may initially be Read or Read+Update rather than Transactional.
- **BDBD-004**: Subprocess execution MUST have explicit argument construction,
  cancellation, timeouts, output limits, and separate stdout/stderr handling.
- **BDBD-005**: `bd` failures and races MUST be translated into the normative
  BDP problem taxonomy without leaking incidental local paths or process data.
- **BDBD-006**: `bdpbd` MUST expose generic Beads and Links. It MUST NOT expose
  `ready`, `close`, `reopen`, or other domain commands as custom BDP operations.

## Conformance and quality requirements

- **CONF-001**: Conformance tests MUST exercise implementations over their
  public HTTP interface. They MUST NOT reach through the server module's
  internal seams to declare conformance.
- **CONF-002**: The conformance kit MUST validate normative schemas and
  observable semantics independently of the server implementation wherever
  practical, reducing common-mode defects.
- **CONF-003**: The matrix MUST cover positive, negative, profile, concurrency,
  disconnect, expiry, restore, and cross-implementation cases applicable to
  each profile.
- **CONF-004**: Every discovered protocol defect MUST result in one of: a spec
  correction, a conformance case, an explicitly deferred issue, or an
  implementation correction.
- **QUAL-001**: TypeScript MUST run in strict mode. Public interfaces and
  protocol schemas MUST have compile-time and runtime validation coverage.
- **QUAL-002**: Builds and tests MUST be reproducible from a clean checkout.
  Runtime, package-manager, and lockfile versions MUST be pinned before coding
  begins.
- **QUAL-003**: Tests MUST exercise the same interfaces used by callers. Test
  seams MUST not enlarge a production interface solely for test convenience.
- **QUAL-004**: Logs MUST never corrupt machine-readable CLI output or HTTP
  response bodies. Secrets, credentials, and authorization headers MUST not be
  logged.

## Implementation blockers inherited from the draft

The following protocol questions block a no-assistance implementation and MUST
be resolved or explicitly deferred with a required behavior before the affected
profile is considered ready:

1. **Resolved 2026-08-08:** profile advertisement and the minimum Read surface
   are fixed in the normative draft's open-question ledger.
2. **Decision recorded; wire artifact pending before Wave 4:** Read+Update uses
   the ordered, separately committing `sequence` model in the normative
   draft's open-question ledger. The sequence envelopes and the complete
   per-member idempotency contract remain to be authored and reviewed before
   mutation implementation begins.
3. **Resolved 2026-08-08:** discovery, operation-name, and link-relation
   vocabulary are fixed in the normative draft's open-question ledger.
4. **Resolved 2026-08-08:** the optional advertised-limit groups, names, units,
   and binding semantics are fixed in the normative draft's open-question
   ledger.
5. **Read artifact recorded 2026-08-12; later-profile definitions pending:**
   one normative JSON Schema 2020-12 bundle holds every public envelope. Its
   discovery and Read definitions are recorded; completing every later-profile
   definition closes the question and BDP v0.
6. **Read table recorded 2026-08-12; later-profile rows pending:** compact RFC
   9457 families, normative codes, statuses, retry dispositions, and operation
   locations must cover every failure before the affected profile.
7. **Resolved 2026-08-08:** checkpoint, cache, CORS, and SSE fields are fixed in
   the normative draft's open-question ledger.
8. **Resolved 2026-08-08:** Event-ID and checkpoint character profiles are
   fixed in the normative draft's open-question ledger.
9. **Resolved 2026-08-08:** reads after deletion use non-disclosing `404`
   semantics while retained Transactional Event history remains independently
   readable.
10. **Resolved 2026-08-08:** authority-attested actor attribution is excluded
    from BDP v0. **Amended 2026-09-02:** a common carried-but-asserted
    `attribution` member exists (PROTO-014); attestation remains excluded
    and any future attested form is a distinct member.
11. **Resolved 2026-08-08:** BDP defines no universal root Bead or Link Types.
12. **Resolved 2026-08-08:** per-service OpenAPI is optional tooling; the BDP
    project may publish one generated document per version.
13. **Decision recorded; artifact pending:** the portable profile-cumulative
    black-box conformance matrix, fixtures, and expectations must be authored
    and reviewed.
14. **Resolved 2026-08-08:** optional Scope maximum-multiplicity discovery and
    atomic replacement semantics are fixed in the normative draft.
15. **Resolved 2026-08-08:** every v0 Link has at least one in-Scope endpoint;
    external-to-external indexing is deferred to a future profile.

Separately from the 15 resolved questions, a joint product/protocol decision
selects `https://github.com/gastownhall/bdp/` as the provisional v0
protocol-identifier prefix. The normative schema will be housed in the open
source repository. The prefix may be replaced consistently before the first v0
release; pre-release implementations must then rewrite persisted draft
identifiers before claiming v0 conformance. Published v0 identifiers remain
stable afterward, even if the repository moves.

These decisions are resolved explicitly and recorded rather than silently
chosen in code.
