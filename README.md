# Beads Protocol

BDP is an HTTP and JSON protocol for reading and changing Beads and Links across independently implemented stores.

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

The [editing routine](docs/spec-review/README.md) explains the VS Code comment/process/push loop. PR337 established the current working draft in main at `0bf00889b247491412703e02c1f2ce2b10fa3ff9`. Donna’s editorial review continues through small subsequent PRs. The reference client/service/tests align against that exact baseline in the single dependent [PR338](https://github.com/gastownhall/bdp/pull/338); its implementation checks and independent review remain separate from spec checks.

[Specification status and supporting schemas](specs/README.md) · [CLI design](docs/cli-design/bdp-cli.md) · [Historical inputs](specs/history/pre-canonical-20261101/README.md)

## Implementation and evidence

This repository also contains TypeScript protocol/client/server packages, a reference SQLite service, black-box conformance tooling and historical implementation evidence. Source publication is not a conformance claim. Product source, build, configuration and test evidence keep their own exact identities; the editorial branch does not promote any of them.

The current draft reference API is [documented here](docs/reference-service.md):
`RetainedClient` and `@bdp/server/reference` select ordinary Core/Write. Legacy
`BdpClient`, `bdptest` and adapter conformance evidence retain their original
contracts; their historical seals do not qualify the new composition.

See [implementation status](STATUS.md), [reference-service milestones](docs/design/bdp-reference-service-milestones.md) and the [conformance evidence guide](packages/conformance/matrices/README.md).

License: MIT. Copyright 2026 Gas City Inc.
