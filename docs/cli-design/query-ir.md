# Query language and portable AST

**Review draft, October 26, 2026.** Donna selected a small complete JSON AST as
the place to start. This document explains its CLI correspondence. The semantic
contract lives in [Resource selection and graph queries](../../specs/profiles/core/query.md).
The [schema](query-ir/query.schema.json) and [cases](query-ir/cases.json) propose
the encoding; they are not an advertised service capability or an implemented CLI.

## One model, useful subsets

List selects Resources by their own content. Graph follows relationships from
particular Beads. Query composes these operations and can ask whether related
Resources satisfy conditions. They use the same meanings for fields, Types,
identity, missing data, and Boolean tests.

```text
List:   scan → local filter → Resources or exact count
Graph:  roots → walk with a Type restriction → graph
Query:  compose scans, filters, walks, endpoint navigation and quantifiers
```

List and Graph are separate subsets of the same AST. A Graph implementation can
accept the rooted walk shape without parsing general predicates. A List
implementation can translate its small structured predicates directly to storage
or evaluate them itself. It need not parse JSONPath or support graph acquisition.
Capability admission must check the actual requested shape rather than guess
from a command name.

Whether Graph eventually receives its own wire operation or a focused carrier
is deferred. Its selected semantics fit this model either way. The retained
Core Selector remains unchanged until deliberately amended; existing Selector
strings never acquire new AST or graph meanings implicitly.

## Follow a path, then choose results

Start with a Bead and follow only Requires-family Links. Some Constraints in the
middle of a chain may already be ratified; we still need to find draft Constraints
farther along. Path restriction and result selection therefore have separate
positions:

```text
outgoing("A", depth: unbounded) as link
  through link is requires
  where link.target.status = "draft"
```

`through` tests a prospective Link before following it. `where` selects among
the Links found. This distinction is semantic. An optimizer may combine work,
but cannot cross an ineligible Reference Link merely because it later finds a
Requires Link that satisfies the result predicate.

The three traversal forms are `incoming`, `outgoing`, and `connected`. They accept
a Bead or a collection of Beads. Depth defaults to one; a number requests that
many hops and `unbounded` requests full closure. All three return distinct actual
Link editions. Source and target keep their authored direction, including in
connected traversal. Cycles and parallel Links do not turn the result into paths.

The draft AST for the example has a `walk` node inside a `filter` node. This is
the proposed structural correspondence; schema spelling remains reviewable.
It uses the constraints fixture and case `main-document-through-then-filter`:

```json
{
  "ir": "bdp-query-design-1",
  "profile": "query",
  "selection": {
    "op": "filter",
    "input": {
      "op": "walk",
      "roots": {
        "op": "refs",
        "collection": "beads",
        "references": ["https://work.example/acme/A"]
      },
      "direction": "outgoing",
      "depth": "unbounded",
      "bind": "link",
      "through": {
        "op": "typeIs",
        "of": {"op": "binding", "name": "link"},
        "type": "https://work.example/acme/requires",
        "match": "family"
      }
    },
    "bind": "link",
    "predicate": {
      "op": "compare",
      "operator": "eq",
      "left": {
        "op": "field",
        "of": {
          "op": "endpoint",
          "of": {"op": "binding", "name": "link"},
          "side": "target"
        },
        "path": ["properties", "status"]
      },
      "right": {"op": "literal", "value": "draft"}
    }
  },
  "result": {"form": "resources"}
}
```

The two `bind` fields are the AST locations for one source alias used by the
traversal clause and its outer selection. Neither invents an implicit alias or
makes two names for the same member. Predicate paths are literal segments, so a
property named `a.b` stays one key when emitted as `["properties", "a.b"]`.

## Name every predicate binding

A caller chooses the binding name. There is no automatic `item` or a hidden
change of subject. A nested predicate can use an outer name, and ordinary lexical
shadowing is allowed. Rename an inner binding if both levels need to be visible.

```text
beads as b where
  b.status = "open"
  and (
    any outgoing(b) as link
      through link is references
      where link.target.team = b.team
  )
```

`b` still means the outer Bead inside the quantifier. `link` means the actual
traversed Link. The AST retains these binding references. A service is free to
lower them to correlated joins or another equivalent plan; it need not construct
JSON binding records while executing.

Quoted Reference literals such as `"A"` are distinct from bindings
such as `b`. Ordinary string comparisons stay typed comparisons. A function or
operator accepting a Reference interprets that operand using the shared Reference
contract; arbitrary string fields are not silently converted to Resources.

## Quantify a collection

`any` and `all` are prefix special forms. The enclosed source, binding, optional
traversal restriction, and test remain visible to the compiler:

```text
any outgoing("A") as link
  through link is requires
  where link.status = "draft"

all outgoing("A", depth: unbounded) as link
  through link is requires
  where link.target.status = "ratified"
```

The test is a quantifier predicate, not an instruction to discard failing input
members before `all` sees them. `any` can omit its test to ask whether eligible
Links exist. `all` requires a test. Empty input makes `any` false and `all` true.
Parenthesize a whole quantified expression when it participates in a larger
Boolean condition, as in the preceding example.

The proposed AST has explicit `any`/`all` nodes with `input`, `bind`, and
`predicate`. This eliminates any need to infer quantification from an already
filtered collection. A witness can establish `any`; a counterexample can refute
`all`. Establishing the opposite answers needs exhausted relevant input. A work
limit cannot quietly supply a successful negative or universal answer.

## Navigate to existing Resources

A Link's `.source` or `.target` acquires that endpoint Bead under the read
context, honoring any pin. The same navigation over a Link collection produces
distinct endpoint Bead editions:

```text
(
  outgoing("A", depth: unbounded) as link
    through link is requires
).target as bead
where bead.status = "ratified"
```

The AST uses `endpoints` for collection navigation and `endpoint` when a predicate
needs one member's endpoint. Missing optional fields use the shared missing-field
rules. Required unavailable content is an acquisition failure whenever it prevents
the answer from being established. It does not become a missing property.

Resource equality compares identity plus selected revision. `id(resource)` exposes
identity and `rev(resource)` exposes the concrete selected revision. Current
selection is established in the read context once, never substituted for an
explicit pin. Inspecting whether a stored Reference was originally floating or
pinned is a separate, deferred surface.

## Ask the service for the right result

Resource collection, graph, and exact count are result modes of the request.
Count is outside the expression language but inside the service evaluator. List
and Query count distinct selected Resource editions before paging; masks do not
change the number. Exact zero is a valid result. A partial count is not exact.
The selected canonical flag is `--count-only`, including Link variants. Remaining
command/file grammar questions do not reopen that spelling or count semantics.

Graph preserves explicit roots, collected Links, and endpoint Beads. Roots remain
when no Link is found or depth is zero. The initial graph profile restricts the
walk by Link Type and has no outer result filter. The canonical Graph direction
facade maps in/out/both to incoming/outgoing/connected; exact flag grammar remains
a command-reference incorporation task.

Include/omit use the [shared Resource projection](../../specs/profiles/core/resource-projection.md)
contract. Sorting and continuation retain their shared carriers. No `select`,
computed columns, general scalar top-level result, or path enumeration is needed
for this first slice.

## Draft surface grammar and remaining decisions

The selected constructs now have a consistent lowering story. The following
details are author proposals for grammar review, not additional human rulings:

- Use `beads` and `links` for current inventory sources; `beads(REF, ...)` and
  `links(REF, ...)` for explicit selection. AST `refs` performs actual selection.
- Bare ordinary fields after an alias address properties: `b.status`. Explicit
  `b.properties["status"]` and `b.metadata["owner"]` avoid key ambiguity. `.source`
  and `.target` are endpoint navigation; use `id()`/`rev()` for Resource context.
- `is TYPE` means family affiliation, including refinements; `is exactly TYPE`
  means nominal Type identity. Resolve the Type operand against authoritative
  Scope naming before emitting the absolute unpinned Type identity. Final quoting
  of named Type operands remains lexical review work.
- Boolean precedence is proposed as NOT, AND, OR. Parentheses delimit nested
  quantified conditions. Predicate delimiters, escaping, reserved names and final
  command argument/file spellings need a parser/grammar pass before freezing.

The CLI should construct the AST from List/Graph flags directly. A friendly Query
parser produces the same AST. A JSON-file request input can expose it to generated
clients without a friendly parser; its flag name and command assertion matrix
remain open. This document does not present a provisional flag as installed CLI.

## Authoring evidence and integration

The [authored fixture sets](query-ir/fixtures.json) include a cycle, parallel Links,
family refinements, isolated roots and pinned/current endpoint differences. The
case ledger separates schema/admission expectations from semantic result
obligations. The [validator](query-ir/validate.py) checks schemas, static admission,
local links and correspondence; it does not execute the product or a Query engine.
Its documented environment includes URI format checkers and asserts they are
active, rather than silently accepting relative wire References.

Transport/discovery, exact capability identifiers, response completeness fields,
graph component masks, and shared sorting details remain explicit in the
[contract integration list](../../specs/profiles/core/query.md#integration-and-validation-still-required).
JSONPath is a possible future representation and a reference for selected local
value semantics. The initial wire proposal contains no executable query strings.
