# Four complete lowering examples

These examples use the [contract candidate](../../../specs/profiles/core/query.md)
and the [proposed design schema](query.schema.json). The JSON requests are complete
logical requests, not complete HTTP messages. Friendly syntax uses selected
constructs; final token/command/file grammar remains under review. Expected
results are authored obligations. The validator checks AST shape and admission,
not the parser, evaluator, product, or backend.
Expected identity/edition arrays are unordered sets, sorted for readability.
Runtime/authority refusals are marked separately from static admission refusals.
Run the checks with `uv run --no-project --with 'jsonschema[format-nongpl]==4.23.0' python docs/cli-design/query-ir/validate.py`.

The [example index](examples/index.json) binds each expression, fixture, request,
and expected result to the [case ledger](cases.json). Concrete names are resolved
to absolute identities in the AST. The fixtures are Scope-local assumptions,
not a required Type installation.

## List: draft notes

```text
beads as b where b is note and b.status = "draft"
```

The [complete List request](examples/list-draft-notes.json) is `filter(scan(beads))`.
Its predicate combines `typeIs` and literal `compare`, both on `b`. In the overview
fixture, the selected Resource is `csv-review`. `note` also includes its
`encoding-note` refinement, but that Bead is ratified rather than draft.

Replacing `result.form: "resources"` with `"count"` asks the service for the exact
count of this same selection. The count is one, before delivery paging. The
predicate and profile are unchanged. Generic List flags can construct the same
request without parsing the friendly expression.

## Graph: a two-hop Reference neighborhood

```text
outgoing("csv-plan", depth: 2) as link
  through link is references
```

The [Graph request](examples/graph-references.json) is `walk(refs(csv-plan))` with
`result.form: "graph"`. The selected Links are `csv-plan-format`,
`csv-plan-format-alt`, and `csv-format-review`. The graph contains root `csv-plan`
and endpoint Beads `csv-format` and `csv-review`. Both parallel plan-to-format
Links survive. `explains` is included through family affiliation.

`csv-review-plan` lies beyond the requested expansion boundary. A third hop
collects it and exposes the cycle. Returning two-hop content is complete for that
request without claiming complete connectivity. A Graph-only profile need
understand references, walk direction/depth, one Type test, and graph formation.

## Query: a related target qualifies the starting Bead

```text
beads as b where (
  any outgoing(b) as link
    through link is references
    where link.target.status = "ratified"
)
```

The [correlated Query request](examples/query-any-ratified-reference.json) has an
outer `filter(scan(beads))`. The `any` input walks from the outer binding `b`.
Its `through` tests the Link Type; its predicate acquires the target Bead's status.
The result is `csv-plan` once, even though two Links reach the same ratified target.
It does not return the witness Links or construct an evaluation claim.

There is no hidden `item` and no binding record to persist. The service may use a
semijoin/EXISTS plan, indexed lookup, or another equivalent operation. It can stop
after a valid witness. A backend cannot turn an unavailable required endpoint
into a negative result.

## Query: universal check over full closure

```text
beads("A") as b where (
  all outgoing(b, depth: unbounded) as link
    through link is requires
    where link.target.status = "ratified"
)
```

The [universal Query request](examples/query-all-ratified-requires.json) uses the
separate constraints fixture. `defines` refines `requires`. Traversal crosses
only that family, preserving cycles, the self-Link, and parallel Link identities.
The outer selection is empty because a reached target does not have ratified
status. This is a stored-property check, not constraint satisfaction evaluation.

The AST puts the predicate on the `all` node, not in an input filter. A
counterexample establishes false without enumerating everything. Returning true
would require complete relevant closure. Work exhaustion cannot become a
successful universal answer or an exact count. Empty input still makes `all`
true under the selected rules.

## What the comparison establishes

List and Graph requests are structural subsets of Query. They contain no opaque
source strings or provider instructions. The same Type/field/comparison nodes
retain their meaning in each profile. Count and graph are explicit result modes;
the AST does not add scalar top-level evaluation, `select`, or arbitrary record
construction to obtain these answers.

The next implementation exercise can admit these requests directly, without a
friendly parser, against one disposable graph. That work is not executed by this
documentation contribution.


## Native request wrappers

The complete [native binding proposal](../../../specs/profiles/core/read-operations.md)
places the AST in `query`, with sort and per-page size outside the language.
These are authored requests, not captured HTTP exchanges:

- [List request](examples/native-list-draft-notes.json), dispatched to the
  discovered operation with `readVersion=1&operation=list`.
- [Graph request](examples/native-graph-references.json), dispatched with
  `readVersion=1&operation=query` under the restricted Graph profile.

[Binding schema](read-binding.schema.json), [binding cases](read-binding-cases.json)
and [binding checker](validate-binding.py) check request/response shape and bounded
static invariants. No server dispatch, header, cursor or parser behavior is proved
by those checks.
