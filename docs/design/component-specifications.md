# BDP implementation component specifications

Status: draft

This document specifies the implementation deliverables. Protocol requirements
remain in the [BDP v0 draft](../specs/bdp.md), and traceable implementation
requirements are in [requirements.md](./requirements.md).

## `bdp`: client library and executable

### Responsibilities

The client library provides the generic BDP client interface. The executable
provides generic protocol commands and the `bd` domain command family.

The generic surface must cover, as profiles become available:

- Scope discovery and profile/version validation;
- retrieval of Beads, Links, Type Descriptors, Resource views, and collections;
- bounded selection and pagination;
- the six singleton Read+Update mutations and ordered, non-atomic `sequence`;
- Transactional batch submission and receipt retrieval;
- snapshots, changefeed replay, and live Event observation; and
- stable structured failures and machine-readable results.

The exact command spelling is a Gate 0 design decision. The programmatic
interface should be designed before the command tree so the executable remains
a thin adapter for input and presentation rather than the location of protocol
semantics.

### `bd` domain surface

The complete compatibility inventory is:

```text
bd init       bd create     bd show       bd list
bd ready      bd update     bd close      bd reopen
bd delete     bd purge      bd dep        bd query
bd config     bd count      bd version    bd stats
```

Each command needs a compatibility sheet covering inputs, defaults, filters,
ordering, mutations, diagnostics, output records, exit statuses, unsupported
cases, and profile requirements. `dep` and `query` require subcommand inventory
before their surface is frozen.

The first slice is read-only `bdp bd ready`:

1. Discover the Scope and require the Read profile.
2. Retrieve candidate work Beads using generic collection reads and selection.
3. Retrieve incident dependency Links through the Bead `links` view or Link
   collection using generic Link behavior.
4. Apply `bd` readiness rules in the `bd` domain module.
5. Produce deterministic human and JSON output.

The implementation must not call a hypothetical BDP `ready` operation. Against
`bdpbd`, acceptance should also prove that the result is derived from generic
BDP resources rather than delegated to `bd ready`. That is the evidence that
domain behavior genuinely belongs to the client.

### Acceptance criteria

- The library can be used without invoking the executable.
- Unsupported versions and profiles fail before an unsupported operation is
  attempted.
- Machine-readable output is not contaminated by diagnostics.
- The same `bdp bd ready` scenario produces equivalent results against
  `bdptest` and `bdpbd`.
- Client tests include malformed responses, pagination, timeouts, disconnects,
  and safe/unsafe retry cases.

## `bdptest`: deterministic test rig

### Responsibilities

`bdptest` is a real BDP HTTP server with deterministic state and a separate
test-control interface. It exists to validate clients and exercise protocol
edge cases, not to stand in for a production deployment.

It must support:

- fixture-defined Scopes, Type Descriptors, Beads, Links, revisions, history,
  limits, and authorization views;
- selectable Read, Read+Update, and Transactional behavior;
- deterministic time, identifiers, positions, and Event ordering;
- reset and fixture loading between scenarios;
- injected latency, disconnects, malformed envelopes, retryable failures,
  expired cursors and receipts, conflicts, and retention changes; and
- inspection sufficient for harness assertions without exposing controls
  through BDP routes.

Fixtures should be declarative and portable. A seed plus fixture plus request
sequence must reproduce the same observable result.

### Acceptance criteria

- Two clean runs of a scenario produce byte-equivalent machine-readable
  evidence except for fields the scenario explicitly marks variable.
- Profile-specific discovery omits unsupported targets and behavior.
- The server can demonstrate at least one positive and one negative case for
  every implemented normative requirement.
- Client failure tests do not require patching or subclassing client internals.
- Test controls cannot be mistaken for BDP conformance surface.

## `bdpbd`: `bd` CLI adapter

### Responsibilities

`bdpbd` presents a BDP Scope backed by one configured `bd` workspace. It uses
only supported `bd` command behavior and machine-readable output; the `bd`
database is private to `bd`.

The adapter owns:

- mapping stable `bd` identities to canonical BDP local IDs;
- mapping each supported issue kind to its own nominal Bead Type;
- mapping dependency and other relation data to nominal Link Types;
- translating generic reads, selections, and supported singleton mutations;
- detecting races or lost-update limitations and advertising an honest
  conformance profile;
- translating process failures into BDP problems; and
- containing child-process execution and local-path information.

The initial target should be the Read profile needed by `bdp bd ready`.
Read+Update follows after its wire guarantees and the adapter's concurrency
behavior are proven. Transactional conformance is not assumed and must not be
advertised unless `bd` can supply all required authority and replication
guarantees.

Non-paginated operations may share one in-flight materialization and reuse a
completed projection for at most one second. The first operation after that
bounded lifetime re-reads `bd`; the process does not retain a permanent
workspace snapshot. Tests may set the adapter's `snapshotTtlMs` construction
option to zero when every sequential operation must force a refresh.

For paginated reads, `bdpbd` materializes the selected projection behind an
opaque, expiring server-side cursor so later pages cannot silently restart
against changed `bd` output. Expired or evicted materialization returns the
normative cursor-expiry problem. The cache lifetime and bounds belong to the
reviewed startup configuration and need not be advertised. `bdpbd` omits optional
maximum-endpoint-multiplicity discovery unless it can truthfully enforce a
configured policy.

### Acceptance criteria

- The adapter starts from an explicit workspace and canonical Scope URL.
- It performs no shell interpolation and enforces process deadlines and output
  bounds.
- Six initial issue kinds appear as distinct nominal Bead Types.
- Generic Bead and Link reads supply enough information for the client-owned
  readiness algorithm.
- A mutation of the underlying workspace between pages cannot silently change
  an existing cursor's selected projection.
- A compatibility corpus compares representative results with the pinned `bd`
  executable.
- Unsupported semantics fail explicitly rather than weakening an advertised
  profile.

## Conformance kit

### Responsibilities

The conformance kit is a black-box scenario runner. A scenario declares its
required profile, setup needs, requests, observable assertions, cleanup, and
applicability. Reports identify the specification requirement and preserve
enough request/response evidence to reproduce a failure without leaking
credentials.

Scenario families are:

- discovery and profile negotiation;
- canonical identity and reference handling;
- records, views, collection retrieval, and selection;
- Type Descriptor and effective-contract validation;
- singleton mutation semantics;
- transaction validation, atomicity, results, and receipts;
- concurrency and conditional requests;
- snapshots, changefeed, Event replay, SSE reconnect, and expiry;
- error taxonomy, limits, malformed inputs, and retry behavior;
- cache, checkpoint, CORS, and browser-visible headers; and
- cross-implementation fixture equivalence.

Normative conformance scenarios and implementation-specific diagnostic
scenarios must be labeled separately.

### Acceptance criteria

- The same normative scenario can run against any reachable BDP Scope.
- Results distinguish pass, fail, not applicable, unsupported profile, and
  harness error.
- Every failure names the requirement and observable mismatch.
- The kit does not rely on private server modules to decide pass or fail.
- CI runs the applicable matrix against `bdptest` and `bdpbd`; release evidence
  also records a passing run against the exact shipping-product commit.

## Protocol module

The protocol module is shared plumbing, not an independently useful product.
It owns exact vocabulary and schema-derived validation so clients, servers, and
tools do not hand-copy wire rules.

Acceptance requires:

- one reviewed source for each normative JSON Schema and its generated static
  types;
- validators for every request and response envelope used by an implemented
  profile;
- canonical URI/reference and opaque-token handling with published test
  vectors;
- stable problem identifiers and retry classification; and
- no dependency on client, server, adapter, or `bd` domain modules.

## Server module and Scope port

The server module implements BDP HTTP behavior once. A Scope adapter supplies
authority behavior through a narrow port. The exact port is a design artifact
that must be tested against both the deterministic and `bd` adapters before it
is frozen.

Acceptance requires:

- routing, discovery, profile enforcement, schema validation, response headers,
  and problem serialization are not duplicated by the executables;
- lower-profile adapters do not implement fake Transactional methods;
- HTTP tests can exercise all behavior through a running server;
- cancellation propagates into adapter work; and
- backpressure and disconnect behavior are explicit for streaming operations.
