# BDP reference implementation architecture

Status: draft

## Architectural intent

The reference implementation is one stack with reusable modules, three
executables, and two real server-side adapters:

```text
                         BDP HTTP
  bdp executable ──> client module ───────────────┐
                                                  │
  conformance runner ─────────────────────────────┤
                                                  v
                                           server module
                                             Scope port
                                           /            \
                              deterministic adapter   bd CLI adapter
                                       |                    |
                                    bdptest               bdpbd
```

The server module is deep: routing, discovery, wire validation, profile
enforcement, problem responses, caching headers, and transport behavior live
behind a small interface. The Scope port is a real seam because two adapters
vary there. Neither HTTP details nor `bd` subprocess details belong in that
port.

## Planned repository layout

```text
apps/
  bdp/                 executable entry point
  bdptest/             deterministic test server executable
  bdpbd/               bd-backed server executable
packages/
  protocol/            vocabulary, wire values, schemas, parsing
  client/              reusable BDP client
  server/              reusable BDP HTTP server
  conformance/         black-box runner and scenario corpus
  bd-domain/           reference-domain bindings, commands, presentation
  adapter-in-memory/   deterministic Scope adapter used by bdptest
  adapter-bd/          bd CLI Scope adapter used by bdpbd
fixtures/
  reference-domain/    shared non-normative Bead and Link Type fixtures
tests/
  fixtures/            portable protocol and scenario fixtures
  integration/         executable-level and cross-implementation tests
docs/
  specs/               normative protocol draft
  design/              non-normative implementation design
  decisions/           accepted, hard-to-reverse architectural decisions
```

These directories may be workspace packages without all becoming independently
published packages. The client is intended to be reusable; publication needs
for other packages will be decided from actual consumers.

## Module responsibilities

### Protocol module

Its interface supplies protocol vocabulary, immutable wire value types,
runtime validators, canonical-reference utilities, and problem classification.
It does not perform network I/O, retain Scope state, contain `bd` concepts, or
choose policy for unresolved draft questions.

To keep runtime validation isolated from mutable public JSON-module imports, the
module lazily reads the exact schema bytes shipped in its own package and memoizes
compiled validators. This trusted local artifact read performs no network I/O and
retains no Scope or target state.

Generated TypeScript types may be derived from the normative BDP v0 schema
bundle, but generated artifacts and runtime validators MUST come from that one
reviewed source. Hand-maintained schemas and independently drifting static
types are not acceptable.

### Client module

Its interface accepts a Scope URI and transport configuration and exposes
generic discovery, read, selection, singleton mutation, Read+Update sequence,
and Transactional operations according to the advertised profile. It owns URL
resolution, content negotiation, response validation, conditional headers, safe retry
decisions, pagination, and replay mechanics.

The module returns protocol results and typed failures. It does not print, exit
the process, implement `bd` workflows, or assume a specific authentication
scheme.

### Server module

Its interface accepts Scope configuration and a Scope port. It owns BDP HTTP
routing, representation validation, profile gating, discovery, HTTP status and
headers, problem serialization, and streaming framing. Callers do not recreate
those rules in each executable.

The initial Scope port should be designed from the two actual adapters and
tested through the server's public HTTP interface. It should describe generic
reads and mutations at the level the server needs, not mirror HTTP routes and
not pretend every backend is a relational store.

Transactional commit, ordered history, snapshots, and replay may require a
deeper authority interface than Read and Read+Update. The design MUST permit a
lower-profile adapter without forcing it to fake Transactional guarantees.

### Conformance module

Its interface runs named black-box scenarios against a Scope URL and returns
structured evidence. It owns scenario setup contracts, HTTP observations,
schema checks, timing tolerances, and result reporting.

It may share normative vocabulary and schemas with the protocol module. It MUST
not share server decision logic or inspect adapter state when determining
protocol conformance. Separate implementation-control hooks may establish and
inspect `bdptest` fixtures without being counted as BDP observations.

### `bd` domain module

Its interface implements the compatibility command model and presentation over
the generic client interface. It consumes the language-neutral Type IDs, Type
Descriptors, and schemas in `fixtures/reference-domain/`; it owns dependency
semantics, readiness evaluation, command option mapping, and human/JSON result
formatting. The package does not maintain a second Type-definition copy.

It MUST NOT enlarge the BDP protocol interface. A domain operation that cannot
be expressed through generic BDP behavior is a requirements or protocol-design
finding, not permission to add a private server operation.

## Process topology

- `bdp` is a short-lived client process.
- `bdptest` is a standalone HTTP process using the deterministic adapter.
- `bdpbd` is a standalone HTTP process using the `bd` CLI adapter.
- The conformance runner is a separate process and treats each server as a
  black box.
- `bdpbd` invokes `bd` as a contained child process. It does not embed or modify
  `bd` storage.

## Configuration

Configuration precedence and names are a Gate 0 implementation artifact. The
reviewed contract must specify at least:

- Scope URL and authentication for `bdp`;
- listen address, canonical Scope URL, profile, and fixture for `bdptest`;
- listen address, canonical Scope URL, workspace path, supported `bd` binary,
  and advertised profile for `bdpbd`; and
- target Scope URL, scenario filters, seed, and report format for conformance.

Configuration that changes a canonical Scope identity or advertised guarantee
must be explicit. A default intended only for local tests must not become a
production identity accidentally.

## Security and robustness

- URI and JSON parsing is untrusted-input handling.
- Schema validation and size limits occur before expensive execution.
- `bdpbd` constructs argument arrays without shell interpolation.
- Child processes have cancellation, deadlines, output limits, and explicit
  environment inheritance.
- HTTP clients have connection and overall deadlines and bounded bodies.
- Authorization is a deployment concern in v0 unless the protocol draft later
  standardizes it, but credentials and authorization views must be preserved
  correctly.
- Browser interoperability follows the profile-specific CORS and exposed-field
  contract in the normative draft; enabled cross-origin deployments must pass
  those conformance cases before claiming browser support.

## Testing architecture

Tests cross the same interfaces used by production callers:

1. Protocol schema and canonicalization tests exercise the protocol module.
2. Client tests run against `bdptest` over HTTP, including injected faults.
3. Server tests use both adapters through HTTP.
4. Adapter tests verify translation against deterministic fixtures and pinned
   `bd` behavior.
5. Conformance tests run unchanged against `bdptest`, `bdpbd`, and eventually
   independent BDP implementations.
6. Cross-implementation tests compare observable results, not private state.

The deterministic adapter's control interface is an internal test seam. It is
not exported as BDP and cannot be used as evidence for behavior that was not
observable over HTTP.

## Architectural non-goals

- A general plugin system for domain operations.
- A new persistence engine for `bd`.
- Direct coupling to the current `bd` database schema.
- Making every internal helper a public package or interface.
- Hiding unresolved protocol choices inside adapter-specific behavior.
- Reproducing the product implementation's Issue/Dependency domain types or
  storage layout.

The repository shipping the product is a required BDP implementation and
black-box conformance target. Its authority,
transaction, revision, snapshot, cache, and replay behavior pressure-test the
design, while BDP's generic Bead/Link model and HTTP contract remain
authoritative over its current compatibility-shaped Issue/Dependency surface.
