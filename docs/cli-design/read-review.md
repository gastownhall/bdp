# Reading and querying a Bead graph

**Review draft, October 26, 2026.** Start with the
[walkthrough](overview/02-explore-graph.md), then review the
[complete CLI surface](query-language.md). The walkthrough shows what a caller
is trying to do. The command reference spells out inputs, conflicts and lowering.
The [native operation proposal](../../specs/profiles/core/read-operations.md)
defines what the client sends and what the service must establish.

## The model

Use **Show** to read one known Resource. Use **List** to choose current Beads or
Links by their own fields. Use **Query** when the question involves related
Resources. **Graph** is a focused way to ask Query for a neighborhood: choose
roots, a direction, depth and eligible Link Types.

Filtering chooses members. Projection chooses which fields are transferred.
Sorting orders the chosen members. Paging controls delivery. None changes what
it means for a member to match. Exact count asks the service for the number of
matching Resource editions before paging, instead of transferring their bodies.

The language returns existing Resources. It does not construct arbitrary records,
compute new columns or expose a storage language. The portable JSON AST records
that logical request. A service can translate it to SQL, use a graph engine, or
combine provider queries with its own evaluation. It must preserve the answer,
required failures and authorization context whichever plan it chooses.

A simple service can support structured List without traversal. Graph is another
obvious restricted shape. General Query adds composition and related-resource
predicates; it does not change the meanings of the simpler forms.

## Read in this order

1. [Explore existing content](overview/02-explore-graph.md): Show, List, projection,
   Type families, parallel Links, cycles, Graph and a related-content query.
2. [CLI grammar and command matrix](query-language.md): generic field flags,
   Boolean filters, explicit bindings, any/all, through/where and file inputs.
3. [Logical semantics](../../specs/profiles/core/query.md): collections, values,
   edition equality, pins, traversal, quantifiers and completeness.
4. [Native protocol](../../specs/profiles/core/read-operations.md): capability,
   dispatch, masks, sort, Resource/count/graph results and continuation.
5. [Revisions walkthrough](overview/05-revisions.md): saved editions, local numbers,
   exact tokens, guarded changes and current versus pinned References.
6. [AST and native examples](query-ir/EXAMPLES.md), schemas and authored cases.

Shared Scope/reference parsing, CRUD, Events, batch and the overall narrative
assembly remain their existing owners' sources. This read contribution does not
replace them or change release/integration gates.

## What is selected and what is proposed

The semantic contract marks Donna's selected behavior. The starting representation
is a small complete JSON AST. The friendly grammar, exact flag/file spellings,
capability/transport names and carrier fields are complete author proposals for
this review, not new human rulings or installed behavior.

Particular review choices are the scalar-only sort order, strict required endpoint
acquisition, current-only traversal incidence, fail-fast before a definitive proof,
atomic/unpaged graphs, frozen native projection on continuation, and the boundary
between existing incident views and the first structured List binding. These keep
the first implementation bounded; each is visible in the detailed proposal.

Legacy `bd query`, `bd sql`, dependency mode, Issue defaults and existing specialized
Memory commands keep their actual contracts. Canonical command examples require
an explicit product rollout/routing decision. A draft command name does not change
what an installed binary accepts.

## Evidence

The static checkers validate authored AST and native-binding cases, local document
links and selected narrative state. They do not implement the friendly parser,
HTTP service or complete evaluator. Separate disposable provider experiments test
specific lowerings and current product commands. Their SQL timings are not full
provider or CLI qualification. Council reports and exact source manifests accompany
this draft; review findings are resolved or explicitly recorded before handoff.

## What the provider experiments changed

The [measured lowering report](query-ir/experiments/20261026/README.md) separates
current product cost from SQL acquisition and typed semantics. It supports the
logical design while exposing expensive current hydration and some poor recursive
plans; it does not qualify an entire provider.

Two compatibility questions remain visible. Current bounded Memory facades can
add matching Links induced by reached Beads, whereas the proposed walk returns
traversed Links. Also, a staged SubjectTo-then-Requires graph must preserve both
its initial witnesses and later Requires Links; the initial direct-walk graph
result has no general Link-set union/result-composition form. The pattern can be
implemented by a fixed domain operation, but this first AST does not claim to
replace every existing Memory facade. Deciding whether to align those facades or
extend the general result model is follow-on design, not a hidden lowering.
