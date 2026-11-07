# BDP conformance testing: where it lives and how to run it

This page is the entry point for people implementing or reviewing BDP. The
repository has three distinct testing responsibilities. Passing one category
does not stand in for another.

## 1. Specification artifact consistency

These checks catch drift among authored specification text, schemas, and
generated projections. They do not prove that a server or client implements the
protocol.

From the repository root, using the pinned Node and pnpm versions:

```sh
pnpm install --frozen-lockfile
pnpm test:markdown
pnpm openapi:check
```

`pnpm test` also runs the conformance package's catalog, schema, citation, and
boundary tests as part of the wider Vitest suite. The normative obligations are
indexed in [`specs/conformance.md`](../specs/conformance.md); executable matrix
artifacts and their evidence limits are described in
[`packages/conformance/matrices/README.md`](../packages/conformance/matrices/README.md).

## 2. Public endpoint interoperability

The closest runnable endpoint-facing suite is the [Current Core / ordinary
Write provider kit](current-provider-kit.md). It sends real HTTP requests through
the public Scope interface and currently contains 19 executable cases. The
runner checks a deliberately bounded Core/Write slice; it reports uncovered
obligations and never claims complete qualification.

To run the kit against the repository's reference implementation:

```sh
pnpm install --frozen-lockfile
pnpm build
node scripts/current-provider-kit.mjs --provider "$PWD/scripts/current-provider-reference-adapter.mjs"
```

To exercise a different service endpoint, pass a trusted ES module implementing
the provider adapter described in the kit guide:

```sh
node scripts/current-provider-kit.mjs --provider /absolute/path/to/provider-adapter.mjs
```

The adapter provisions an isolated Scope with the requested fixture, provides
its authorized connection details, and cleans up only resources it owns. The
runner then discovers the service's routes and sends requests over HTTP. It
does not mutate an arbitrary existing Scope, and it does not accept fixture data
or expected answers from the adapter as evidence. Adapter modules are trusted
operator code and must be reviewed before use.

To exercise one Scope you already have, without an adapter, pass `--scope <url>`. It
sends no mutation unless you add `--allow-mutation`. A Scope that does not advertise
Write reports the Write cases not applicable by discovery; see the
[guide](current-provider-kit.md#a-provider-without-write).

The current kit is an interoperability slice, not a full conformance suite: it
has no complete obligation census, no complete qualification path, and its
durability cases require adapter-provided lifecycle conditions.
The package matrices under `apps/bdptest` and `packages/conformance` are also
repository-run test infrastructure, not a published standalone conformance
command for arbitrary service and client implementations.

## 3. Reference client/service implementation tests

These tests cover the implementation in this repository, including package
units, integration paths, emitted CLI behavior, and server behavior:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

For the canonical CLI's built executable checks, use `pnpm test:cli` (it builds
first). The `pnpm smoke` command exercises packaged executable routes. These
implementation checks are useful for local development, but they are not a
substitute for running public-HTTP interoperability tests against an independent
endpoint or for running a client implementation against independently hosted
servers.

Reference performance observations are maintained separately from functional
conformance and reliability tests. See
[`scripts/perf/README.md`](../scripts/perf/README.md) for bounded commands and
the limits on interpreting measurements.

## Current gap

The next step toward independent conformance is to make the endpoint runner
easy to invoke without writing bespoke adapter code, while keeping fixture
provisioning and cleanup explicit and safe. Client implementations also need a
portable suite that can exercise them against controlled protocol peers and
independent services. Until those interfaces and complete obligation sets exist,
the provider kit's partial report and this repository's implementation tests
must not be described as full BDP conformance.
