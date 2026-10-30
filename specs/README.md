# BDP specification

**Main is the canonical specification source.** The entries below identify the
selected BDP v0.1 contract and its explicit proposal boundaries at the source
revision being read. `codex/bdp-v0.1` is the existing assembly branch for the
current CLI/Core/Read/Write reconciliation; an unmerged branch or PR is not
published main. A release label is not another wire version or evidence that a
product implements every profile.

Consumers and release notes use an exact **commit SHA**, not a moving branch.
Selecting a main commit does not require another blanket approval or a new tag;
its concrete receiving change still needs normal review and qualification.
Separate product source, build and conformance-evidence pins accompany an
implementation comparison. Publishing this specification changes none of them.

## Read the selected contract

| Surface | Entry point | Boundary |
| --- | --- | --- |
| Core | [Retained Core](profiles/core/retained-core.md) | Positive common discovery, reads, references, affiliations and required observation contract |
| Resource projection | [Shared projection](profiles/core/resource-projection.md) | Independently selected current GET, exact saved GET and ordinary List masks; full records remain the base contract |
| Write | [Retained Write](profiles/write/retained-write.md) | Ordinary atomic writes, safe retry and complete outcomes; batch is optional |
| Atomic publication | [Publication](profiles/core/publication.md), [batch](profiles/write/atomic-batch.md), [Events](profiles/core/events.md) | Final states per Resource, exact final ownership captures, net-zero and allocation distinctions |
| Types | [Types profile](profiles/types/types.md), [descriptor](types/type-system/type-system.md), [artifact status](profiles/types/README.md) | Optional Scope-wide interpretation; definition presence does not register a Type |
| Exact definition access | [Core binding](profiles/core/type-definition-read.md), [Types interpretation](profiles/types/exact-definition-read.md) | Complete exact records in explicit interpreting context; no general History or public Type CLI implied |
| Rooted allocation draft | [id-root1](profiles/write/id-root.md), [feature schema](profiles/write/id-root-v1.schema.json) | Optional server allocation on existing create/batch URLs; base carriers and result meanings remain unchanged |
| Common grammar | [v0.1 schema](profiles/core/bdp-v0.1.schema.json), [distribution mirror](../packages/protocol/schemas/bdp-v0.1.schema.json) | Retained entries determine selected semantics; inherited staging helpers do not add capabilities |
| Informative HTTP catalog | [OpenAPI operation catalog](openapi/README.md), [coverage](openapi/coverage.md) | Generated signatures reference the unchanged common grammar; discovered URLs still require a navigation adapter, and the synthetic tooling fixture is not a deployment API |
| Canonical CLI | [CLI entry](../docs/cli-design/bdp-cli.md), [command/wire correspondence](../docs/cli-design/wire-correspondence.md) | Paired design and worked correspondence; not a claim that product CLI/compiler/adapter exists |

The selected entries compose one contract. A field carrier or helper schema alone does not
establish Type interpretation, ownership, required Events or runtime conformance.
Scope-defined paths have no mandatory `beads/`, `links/` or `types/` prefixes, and
path spelling does not establish Resource kind. Exact Type affiliations, explicit
retyping and literal endpoint pins retain their selected meanings. Atomic batches
publish at most one final new revision per affected Resource; no shared token or
automatic endpoint repin is required. Public Type lifecycle/inventory commands,
broader aliases and general lifecycle operations remain explicitly deferred.

## Status and optional extensions

The source uses **selected**, **informative**, **proposed** and **deferred** to
distinguish requirements from supporting or unselected material. Optional is a
capability property of a selected feature, not a synonym for proposed. A helper
in a shared schema does not advertise a service capability or override its
selected entry point. A proposed module must not become a requirement through
an unqualified normative link or an existing capability/version.

| Family | Source status and boundary |
| --- | --- |
| Retained Core/Read and ordinary Write | Selected entries above; preserve independent Resource identity, exact References, authorization, ordinary optional guards, final committed outcomes and retry semantics |
| Resource projection | Optional selected version1 capability for current GET, exact saved GET and List; `projectionVersion`/`fields` and separate projected arms preserve the full-read baseline |
| Atomic batch | Optional selected six-CRUD contract; richer transaction-scoped selection/Query/set composition requires a coherent distinct binding and does not silently widen version1 |
| Types and exact-definition access | Optional selected semantics; registration/default selection differ from presence, and narrow definition access does not require general application History |
| Canonical CLI and overview | Informative correspondence to the selected protocol; proposed command/encoding sections retain their explicit status rather than acquire normative authority by publication |
| General Query and richer batch encodings | Separate selected semantic decisions and remaining proposed mechanisms; only an explicitly incorporated native contract/capability is advertised |
| Replica synchronization, public retained receipts and broader aliases | Experimental/proposed or deliberately deferred; not prerequisites to ordinary retained profiles |

Document/schema status is distinct from executed conformance. Authored acceptance
cases and offline schema checks are useful evidence within their scope; they do
not qualify a CLI compiler, provider, History service or database transaction.

## Historical source inputs

The existing assembly physically composed these reviewed source lines:

- CLI/Core/Write/batch/Events: [PR300 f4eb1a5](https://github.com/gastownhall/bdp/pull/300), including the separately reviewed prior increments and Event R1 repair.
- Types/descriptor/exact-definition access: [PR283 b924d08](https://github.com/gastownhall/bdp/pull/283).
- Published front-door/process input: [2cfc8d2](https://github.com/gastownhall/bdp/commit/2cfc8d2d249814dad8f27dfabc0245514fd12237).

These are historical input identities, not a claim that they are the latest main
commit. Their integrated successors and later accepted CLI/Read/endpoint decisions
are reconciled through the existing plan and ordinary reviewed source changes.
Clean composition is not combined-source qualification: actual incoming and
landed subjects retain their own checks. Prior checks remain bound to their
inputs; absent hosted checks are not green. No specification source activates
runtime behavior by itself.

[BDP#59](https://github.com/gastownhall/bdp/issues/59) remains the sole plan. Concrete
BDP issues are the amendment front door; accepted rulings, pending proposals and
intentional deferrals remain distinguishable in the [decision register](../docs/design/bdp-v0.1-decision-register.md).
Trish owns integration, Types and this front door; Sybil owns paired common
Core/Write/schema/CLI source; Melinda owns Read/History/Versions semantics and
their exact handoff to the shared writer.
Molly's requested curation unit is complete. The [historical POR snapshot](history/working-por-20261022.md)
preserves the prior approval, source and communication record without making old
pending markers current.

## Changes since the stage-1 notice

The retained Core/Write, affiliation, namespace, object-edit, final-publication,
Event and exact-definition source families have been physically composed; their
old draft-only markers in the historical register are not current incorporation
status. Donna also selected shared current/exact GET/List Resource projection and
[Link identity across correction of either endpoint](https://github.com/gastownhall/bdp/issues/59#issuecomment-6457645585).
The [current incorporation table](../docs/design/bdp-v0.1-decision-register.md#current-incorporation-october27)
separates those decisions, their paired source work and runtime qualification.
The [current source map](../docs/design/bdp-v0.1-current-source-map.md) supplies
paired prose/schema/CLI/example/case pointers and residual PR284/293 dispositions.
The current main-alignment instruction permits ordinary reviewed main landing;
it is not another vote on already selected semantics.

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
replication, set writes or public receipt services. Product/runtime/`serve` work
and paused timers retain their separately authorized scope. This specification
landing neither restarts them nor adopts every open implementation PR.
