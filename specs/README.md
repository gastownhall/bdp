# Beads Protocol specification

The editorial review corpus contains four selected protocol documents, the proposed Transfer profile and the shared client specification. Read them in this order:

1. [Core](profiles/core/core.md) — common Resources, identity, reads, authorization, and HTTP.
2. [Write](profiles/write/write.md) — mutations, retries, final effects and optional atomic batches.
3. [Types](profiles/types/types.md) — optional Type definitions, interpretation, conformance and constraints.
4. [Events](profiles/events/events.md) — optional finite observation, coverage, replay and Event carriers.
5. [Transfer — proposed](profiles/transfer/transfer.md) — complete retained-data packages and original-state admission; [remaining design work](../docs/spec-review/transfer-review.md) is explicit.
6. [CLI](../docs/cli-design/bdp-cli.md) — shared command behavior, output and protocol correspondence. The [mismatch audit](../docs/spec-review/cli-mismatches.md) records its current reconciliation work.

Editorial drafts for the preview pin, not selected until Donna marks them: [Callables](profiles/callables/callables.md), and the Issue package in two halves, [Issue and Dependency Types](types/issue/issue.md) and [Issue and Dependency Callables](types/issue/callables.md).

Each document states its current rules directly. No retained-profile wrapper, amendment list, source map or historical document is required to reconstruct a rule. Core works without Write or Types. Write and Types add their stated responsibilities without changing Core identity or read meanings.

## Editorial review status

This is the working specification for Donna's section-by-section review. It consolidates the selected v0.1 draft; it is not a completed human approval or a release. The [editing routine](../docs/spec-review/README.md) identifies the files and the comment/process/push loop. Donna has authorized this round to land as the current working draft while her review continues. This does not mark the full editorial review complete.

Reference client/service/test alignment follows this structural round against its exact merged specification commit. A specification edit does not qualify a build, update a consumer pin or make an implementation conform.

## Supporting material

The two BDP v0 schema copies, [specs source](profiles/core/bdp-v0.schema.json) and [protocol-package mirror](../packages/protocol/schemas/bdp-v0.schema.json), remain transitional inputs for the reference client's existing tests. They carry no external back-compatibility promise, may evolve with the implementation, and do not define the current canonical specification.

- [Common JSON schema](profiles/core/bdp-v0.1.schema.json) and [Types schema](profiles/types/types-v1.schema.json) are machine-readable companions. Unused historical helper definitions do not add operations to the canonical prose. Their alignment is checked explicitly as the specification is reviewed.
- The [current OpenAPI catalog](openapi/README.md) is generated from visible profile appendices. Its checks are separate from implementation qualification.
- The CLI is a client specification, not another protocol profile. Its proposed encodings remain proposals unless expressly selected.
- [Historical source](history/pre-canonical-20261101/README.md) preserves the inputs to this consolidation and their immutable original revisions.
- [Query design context](profiles/core/query.md), [native structured-read proposal](profiles/core/read-operations.md) and [experimental work](../experimental/README.md) do not add requirements to Core, Write or Types merely by being present.

Protocol semantics, client design, implementation support and release qualification are distinct. A document's location or a schema-valid example is not an implementation claim.
