# Beads Protocol specification

The editorial review corpus contains three protocol documents and the shared client specification. Read them in this order:

1. [Core](profiles/core/core.md) — common Resources, identity, reads, authorization, HTTP and Events.
2. [Write](profiles/write/write.md) — mutations, retries, final effects and optional atomic batches.
3. [Types](profiles/types/types.md) — optional Type definitions, interpretation, conformance and constraints.
4. [CLI](../docs/cli-design/bdp-cli.md) — shared command behavior, output and protocol correspondence. The [mismatch audit](../docs/spec-review/cli-mismatches.md) records its current reconciliation work.

Each document states its current rules directly. No retained-profile wrapper, amendment list, source map or historical document is required to reconstruct a rule. Core works without Write or Types. Write and Types add their stated responsibilities without changing Core identity or read meanings.

## Editorial review status

This is the working specification for Donna's section-by-section review. It consolidates the selected v0.1 draft; it is not a completed human approval or a release. The [editing routine](../docs/spec-review/README.md) identifies the files and the comment/process/push loop. The existing main commit remains the published baseline until the review PR is approved and merged.

Reference implementation and conformance-test alignment follow the complete specification pass. A specification edit does not qualify a build, update a consumer pin or make an implementation conform.

## Supporting material

- [Common JSON schema](profiles/core/bdp-v0.1.schema.json) and [Types schema](profiles/types/types-v1.schema.json) are machine-readable companions. Unused historical helper definitions do not add operations to the canonical prose. Their alignment is checked explicitly as the specification is reviewed.
- The CLI is a client specification, not another protocol profile. Its proposed encodings remain proposals unless expressly selected.
- [Historical source](history/pre-canonical-20261101/README.md) preserves the inputs to this consolidation and their immutable original revisions.
- [Query design context](profiles/core/query.md), [native structured-read proposal](profiles/core/read-operations.md), [Issue/Dependency domain draft](types/issue/issue.md) and [experimental work](../experimental/README.md) do not add requirements to Core, Write or Types merely by being present.

Protocol semantics, client design, implementation support and release qualification are distinct. A document's location or a schema-valid example is not an implementation claim.
