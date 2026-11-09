# Beads Protocol

BDP is an HTTP and JSON protocol for reading and changing Beads and Links across independently implemented stores.

This repository — [gastownhall/bdp](https://github.com/gastownhall/bdp) — is the canonical source of truth for BDP. Wherever you are reading a vendored copy, the original lives here.

## Canonical specification review

Donna's review corpus has six directly editable documents:

- [Core](specs/profiles/core/core.md)
- [Write](specs/profiles/write/write.md)
- [Types](specs/profiles/types/types.md)
- [Events](specs/profiles/events/events.md)
- [Transfer — proposed](specs/profiles/transfer/transfer.md)
- [CLI](docs/cli-design/bdp-cli.md)

Transfer is a new proposal with explicit unresolved mappings; its location does
not adopt a capability or new wire binding. Its proposed command mapping is inline
in the existing CLI document.

Start with **Core**, not a retained-profile wrapper or an amendment map. The documents state the current draft rules in place. Types is optional; carrying a Type affiliation does not by itself require a descriptor engine.

The [editing routine](docs/spec-review/README.md) explains the VS Code comment/process/push loop. PR337 established the canonical draft; subsequent main changes deliver the canonical CLI, opt-in six-CRUD atomic batch and historical-source Update. Donna’s editorial review continues through small PRs. The [decision receipt map](docs/plans/decision-implementation-map.md) distinguishes landed source and qualification from remaining implementation and deferred design; implementation checks remain separate from specification-artifact checks.

[Stabilization plan](docs/plans/bdp-stabilization.md) · [Specification status and supporting schemas](specs/README.md) · [CLI design](docs/cli-design/bdp-cli.md) · [Historical inputs](specs/history/pre-canonical-20261101/README.md)

## Conformance tests: where to look and how to run them

Start with the [conformance testing guide](docs/conformance-testing.md). It
separates three kinds of evidence that answer different questions:

1. **Specification artifact checks** verify that schemas, generated projections,
   and authored specification contracts agree. Run `pnpm test:markdown` and
   `pnpm openapi:check`; the broader `pnpm test` also runs catalog and boundary
   checks.
2. **Endpoint interoperability checks** exercise behavior through public HTTP.
   The current [Core/ordinary Write provider kit](docs/current-provider-kit.md)
   runs against the reference endpoint with:

   ```sh
   pnpm install --frozen-lockfile
   pnpm build
   node scripts/current-provider-kit.mjs --provider "$PWD/scripts/current-provider-reference-adapter.mjs"
   ```

   To use another endpoint, provide a trusted adapter module that provisions an
   isolated Scope and fixture and owns its cleanup; the runner discovers the
   service routes and sends real HTTP requests to that Scope. This is a partial
   19-case slice, reports incomplete qualification, and is not a provider
   certification. There is not yet a one-flag `--scope <url>` mode or a complete
   standalone service/client conformance release.
3. **Implementation tests** exercise this repository's client, reference
   service, and supporting packages. Run `pnpm build && pnpm test`; the reference
   performance trend runner is documented in
   [`scripts/perf/README.md`](scripts/perf/README.md). These tests establish
   implementation behavior and reliability, not interoperability of an
   arbitrary implementation.

The guide links the normative obligations, executable matrices, current runner,
and each command's limits. Use it when preparing an endpoint for external review.

## Try the installed CLI during review

Use the [disposable reference review lab](docs/spec-review/reference-lab.md) for a
fresh local Scope, installed canonical CLI and explicit restart/recovery controls:
`pnpm build` then `pnpm review:lab` (or `pnpm review:lab --check` for the finite journey).
The foreground owner cleans up its privileged fixture on stop, EOF or interruption.
This is a review workstation, not full provider conformance.

## Implementation and evidence

This repository also contains TypeScript protocol/client/server packages, a reference SQLite service, black-box conformance tooling and historical implementation evidence. Source publication is not a conformance claim. Product source, build, configuration and test evidence keep their own exact identities; the editorial branch does not promote any of them.

The current draft reference API is [documented here](docs/reference-service.md):
`RetainedClient` and `@bdp/server/reference` select ordinary Core/Write. Legacy
`BdpClient`, `bdptest` and adapter conformance evidence retain their original
contracts; their historical seals do not qualify the new composition.

See [packed smoke routes](docs/test-smoke-routes.md), [shadow test routing](docs/test-routing-shadow.md), [implementation status](STATUS.md), [reference-service milestones](docs/design/bdp-reference-service-milestones.md) and the [conformance evidence guide](packages/conformance/matrices/README.md).

License: MIT. Copyright 2026 Gas City Inc.
