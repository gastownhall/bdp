# bdpbd: frozen legacy Read projection

`bdpbd` preserves the inherited v0 Read adapter for the old `bd` Issue/dependency
JSON interface. It is no longer recommended for new deployments. Its source,
tests and recorded evidence remain available while replacement targets are
implemented and qualified.

The application composes `createBdProcessScopePort` from `@bdp/adapter-bd` with
the shared Read HTTP server. It invokes `bd list` and bounded `bd dep list`
fallbacks, projects their output, and derives Resource revisions from projected
content. It supplies no canonical CRUD/batch subprocess backend. The exact
[projected revision discipline](../../packages/adapter-bd/README.md) remains
unchanged.

The selected contract starts at [retained Core](../../specs/profiles/core/retained-core.md)
and [retained Write](../../specs/profiles/write/retained-write.md). Required Events,
durable original mutation outcomes and the selected Reference/ownership semantics
need their own implementation and wire acceptance. The legacy Read evidence does
not establish those guarantees.

The [retirement and test-transfer inventory](../../docs/design/bdp-reference-service-milestones.md)
records the remaining build, test, smoke and evidence dependencies. The first
documentation slice leaves all of them active. Removing default participation
requires qualified replacement targets and reviewed changes to the coupled gates.
Historical evidence retains its original source and payload identities.
