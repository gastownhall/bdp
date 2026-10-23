# BDP Preview3

**Reconciliation candidate — final release pin not yet selected.** BDP Preview3 names
one frozen specification baseline that Beads Preview3 can reference. Its protocol
identity remains the **BDP v0.1 candidate**; the release label is not another wire
version or a claim that Beads implements every profile.

The single working branch is `codex/bdp-v0.1`. Release notes must pin the final
reconciled **commit SHA**, not follow the moving branch. The separate Beads source,
build and conformance-evidence pins must accompany that comparison.

## Read the candidate contract

| Surface | Entry point | Boundary |
| --- | --- | --- |
| Core | [Retained Core](profiles/core/retained-core.md) | Positive common discovery, reads, references, affiliations and required observation contract |
| Write | [Retained Write](profiles/write/retained-write.md) | Ordinary atomic writes, safe retry and complete outcomes; batch is optional |
| Atomic publication | [Publication](profiles/core/publication.md), [batch](profiles/write/atomic-batch.md), [Events](profiles/core/events.md) | Final states per Resource, exact final ownership captures, net-zero and allocation distinctions |
| Types | [Types profile](profiles/types/types.md), [descriptor](types/type-system/type-system.md), [artifact status](profiles/types/README.md) | Optional Scope-wide interpretation; definition presence does not register a Type |
| Exact definition access | [Core binding](profiles/core/type-definition-read.md), [Types interpretation](profiles/types/exact-definition-read.md) | Complete exact records in explicit interpreting context; no general History or public Type CLI implied |
| Common grammar | [v0.1 schema](profiles/core/bdp-v0.1.schema.json), [distribution mirror](../packages/protocol/schemas/bdp-v0.1.schema.json) | Retained entries determine selected semantics; inherited staging helpers do not add capabilities |
| Canonical CLI | [CLI entry](../docs/cli-design/bdp-cli.md) | Paired design and worked correspondence; not a claim that product CLI/compiler/adapter exists |

The entries compose one candidate. A field carrier or helper schema alone does not
establish Type interpretation, ownership, required Events or runtime conformance.
Scope-defined paths have no mandatory `beads/`, `links/` or `types/` prefixes, and
path spelling does not establish Resource kind. Exact Type affiliations, explicit
retyping and literal endpoint pins retain their selected meanings. Atomic batches
publish at most one final new revision per affected Resource; no shared token or
automatic endpoint repin is required. Public Type lifecycle/inventory commands,
broader aliases and packaging remain explicitly deferred.

## Candidate inputs and reconciliation work

This candidate physically composes the reviewed source lines:

- CLI/Core/Write/batch/Events: [PR300 f4eb1a5](https://github.com/gastownhall/bdp/pull/300), including the separately reviewed prior increments and Event R1 repair.
- Types/descriptor/exact-definition access: [PR283 b924d08](https://github.com/gastownhall/bdp/pull/283).
- Published front-door/process input: [2cfc8d2](https://github.com/gastownhall/bdp/commit/2cfc8d2d249814dad8f27dfabc0245514fd12237).

Clean composition is not combined-source qualification. Before freezing the release
pin, Trish must finish source correspondence and stale-draft reconciliation,
run applicable combined artifact/document checks, and record the normal integration
disposition. Prior source checks remain bound to their exact inputs; absent hosted
checks are not green. This candidate does not activate runtime behavior.

[BDP#59](https://github.com/gastownhall/bdp/issues/59) remains the sole plan. Concrete
BDP issues are the amendment front door; accepted rulings, pending proposals and
intentional deferrals remain distinguishable in the [decision register](../docs/design/bdp-v0.1-decision-register.md).
Trish owns integration and Types; Sybil owns the paired common protocol/CLI source.
Molly's requested curation unit is complete. The [historical POR snapshot](history/working-por-20261022.md)
preserves the prior approval, source and communication record without making old
pending markers current.

## Beads Preview3 comparison

Use the [release conformance record](../docs/releases/beads-preview3-conformance.md)
to bind the BDP commit to a separate Beads source/build and known gaps. Shipping
Beads Preview3 does not require a passing grade for every BDP profile. It requires
an honest, reproducible comparison with explicit untested and unsupported areas.

The existing [v0 schema](profiles/core/bdp-v0.schema.json) and [v0 conformance accounting](conformance.md)
remain historical/implementation comparison sources at their own pins. They do not
silently become v0.1 evidence. [Issue/Dependency](types/issue/issue.md) remains a domain
library input; Memory product evidence is tracked separately in [Beads7656](https://github.com/gastownhall/beads/issues/7656).
Domain publication does not imply runtime/catalog adoption.

[Experimental](../experimental/README.md) is non-normative exploration, not POR or a
product commitment. No retained Core/Write/Types obligation depends on implementing
replication, set writes or public receipt services. Existing product/runtime/main,
`serve`, Vickie and paused-timer boundaries remain unchanged.
