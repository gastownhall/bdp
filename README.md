# Beads Protocol

BDP is an HTTP and JSON protocol for reading and changing Beads and Links across independently implemented stores.

## Canonical specification review

Donna's working specification is three directly editable documents:

- [Core](specs/profiles/core/core.md)
- [Write](specs/profiles/write/write.md)
- [Types](specs/profiles/types/types.md)

Start with **Core**, not a retained-profile wrapper or an amendment map. The documents state the current draft rules in place. Types is optional; carrying a Type affiliation does not by itself require a descriptor engine.

The [editing routine](docs/spec-review/README.md) explains the single branch/PR and the VS Code comment/process/push loop. The complete Core → Write → Types review precedes reference-implementation and test alignment. Main remains the published baseline until the review PR is approved and merged.

[Specification status and supporting schemas](specs/README.md) · [CLI design](docs/cli-design/bdp-cli.md) · [Historical inputs](specs/history/pre-canonical-20261101/README.md)

## Implementation and evidence

This repository also contains TypeScript protocol/client/server packages, a reference SQLite service, black-box conformance tooling and historical implementation evidence. Source publication is not a conformance claim. Product source, build, configuration and test evidence keep their own exact identities; the editorial branch does not promote any of them.

See [implementation status](STATUS.md), [reference-service milestones](docs/design/bdp-reference-service-milestones.md) and the [conformance evidence guide](packages/conformance/matrices/README.md).

License: MIT. Copyright 2026 Gas City Inc.
