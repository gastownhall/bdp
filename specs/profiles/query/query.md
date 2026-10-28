---
status: proposed design exercise
intended-status: draft proposal
version: 0
---

# BDP Query — JSONPath predicates and graph composition

## Status, ownership and relationship to Core

This October 20, 2026 design exercise proposes a portable query contract for
Beads and Links. BDP owns its semantics and portable representation; the Beads
CLI owns readable syntax and exact translation into this contract. This document
is a proposal for review, not an adopted profile, new discovery value, HTTP
operation, capability advertisement, schema version or implementation claim.

This author branch starts from `codex/preview3-integration` at
`b12665d64c2aaf6172bd1cdab409cef31ef28f44`. The existing
[Core/Read Selector](../core/core.md#selection) remains unchanged. Existing
[Write](../write/write.md) set mutations keep their current Selector contract;
this draft does not authorize graph-based mutation targeting. The directory
name `query` organizes prose; it creates no advertised Query profile. No
[Types profile](../types/types.md) dependency is inferred from placement.

The accepted architecture is two surfaces with one meaning: a standards-friendly
BDP query contract based on RFC 9535 JSONPath and reviewed graph extensions,
and human-friendly CLI sugar. JSONPath missing-field behavior is selected.
Exact graph composition, extension names, input schemas, transport and admission
remain proposals. This exercise recommends a composition boundary; it does not
claim every graph requirement fits an ordinary JSONPath function.

## Required capabilities

| Requirement | Contract that must survive the syntax change |
| --- | --- |
| Candidate population | Beads, Links, or their explicit union in an authorized Scope; no implicit Issue/status filter. Union is a client/query operation until a portable carrier is selected. |
| Generic predicates | Reserved Resource roots, ordinary properties, metadata, exact JSON kinds and explicit literal substring matching. |
| Missing and null | A missing path selects no node. Present null is a selected node whose value is null; physical presence includes false and null. |
| Exact Type versus family | Distinguish declared affiliation from refinement-family membership using the selected Type/Reference contract. |
| Correlated existence | Link and neighbor conditions concern the same actual binding. Existence does not multiply outer candidates. |
| Incoming/outgoing | Explicit direction, without reversing stored Link ownership or endpoint meaning. |
| Nested correlation | Preserve selected outer bindings explicitly; no accidental shadowing or scope leakage. |
| Expansion | One occurrence per source-edition/Link-edition/neighbor-edition membership; preserve parallel Link identities. |
| Bounded reachability | Separate seed, current-hop source, Link, neighbor and final endpoint; traversal pruning differs from endpoint filtering. |
| Results | Resource, binding-row, graph and path results are explicit semantic operations, not field masks. |
| Identity | Exact selected identity plus revision; unchanged Link identity can participate in several source editions' adjacency. |
| Counts and groups | Counting unit explicit; distinct Link editions, binding occurrences and neighbor editions may differ. Aggregate before paging. |
| Bounds and completion | Hops, examined work, output Resources/Links, paths, bytes, deadline and cancellation are separate. Exhaustion cannot imply absence or an exact count. |
| Read consistency | One coherent authorized read context, retained across nested tests and continuation; exact pins are never substituted with current heads. |
| Pure queries | No persisted evaluation, mutation, live identity allocation, accepted evidence or export transfer is implied. |
| Shared output | Representation and framing remain separate from query membership, acquisition, aggregation and traversal. |

Conversions remain deferred. Regex, arbitrary user functions, federation, general
constraint solving and graph mutation syntax are outside this exercise. Existing
Issue/Dependency-specific operations and purpose-built Memory commands remain
separate rollout inputs, not new implementation assignments.

## What RFC 9535 supplies

[RFC 9535](https://www.rfc-editor.org/rfc/rfc9535.html) supplies a JSON-tree query
syntax and semantics. Its [function extension point](https://www.rfc-editor.org/rfc/rfc9535.html#section-2.4)
uses declared `ValueType`, `NodesType` and `LogicalType` arguments/results.
Function arguments are values, node lists or logical expressions evaluated in
their existing context; there is no predicate closure/lambda type. `@` identifies
the immediately enclosing filter's current node. Functions must preserve results
across permitted evaluation orders and short-circuit/full evaluation choices.

For an ordinary Resource candidate collection:

```text
$[?@.properties.status == "open" && @.properties.priority <= 2]
$[?@.properties.review]
$[?@.properties.review == null]
$[?!@.properties.review]
```

The latter forms mean present, present null, and absent respectively. RFC
JSONPath's missing-path behavior and incomparable-ordering result must not be
silently replaced by the earlier CLI draft's access faults or dynamic ordering
errors. Expression syntax/typing, unsupported capability and provider execution
failure remain distinguishable from a predicate's ordinary false result.
The selected BDP JSON number/string/Reference contracts still require explicit
reconciliation with the chosen library; standard syntax alone is insufficient.

### Boundary: ordinary functions do not introduce graph syntax

The earlier illustration `outgoing_any(@, @.link... && @.neighbor...)` cannot
rebind its second argument through ordinary function registration. A top-level
`walk(...)`, postfix filtering of a function result or a pipeline `| return`
likewise needs a separate composition contract. None is ordinary RFC grammar.
A function returning nodes can be tested or counted inside a filter, but does not
add a new top-level result constructor.

## Proposed complete portable surface

**Recommendation for review:** a small structured graph composition contract
whose predicate slots are an explicit RFC JSONPath profile, with true typed
function extensions where useful. This reuses a standard predicate parser and
leaves graph acquisition/result semantics visible. It is an author recommendation,
not a newly accepted request schema.

The logical operations are select/filter, correlated exists/not-exists, expand,
bounded walk, semantic projection/distinct, aggregate/order and continuation.
This document introduces no final JSON property names or HTTP endpoint for them.
The following object demonstrates the decomposition only:

```json
{
  "select": {
    "collection": "beads",
    "selector": "$[?@.resource.id == 'https://example.invalid/beads/A']"
  },
  "steps": [
    {
      "op": "walk",
      "direction": "out",
      "hops": {"min": 1, "max": 8},
      "stepSelector": "$[?@.link.resource.type == 'https://example.invalid/types/Requires']",
      "endpointSelector": "$[?@.neighbor.resource.properties.status == 'ratified']"
    }
  ],
  "result": {"resources": "neighbor", "distinct": "edition"}
}
```

The Type comparison is schematic for a string-form Core fixture, and exact
rather than a Requires-family test. It is not a proposed interpretation of a
pinned Type Reference; the selected Reference projection remains to settle. A separately declared
Type-family operation/extension is needed to include Defines. No bound defaults,
context-token shape or installed Type identity is inferred from this example.

### Standard predicates over explicit binding records

The graph plan can expose an evaluation record with selected edition keys kept
separate from Resource values. Illustrative input, not public Resource wire JSON:

```json
{
  "bindings": [
    {
      "this": {"key": {"id": "A", "revision": "a7"}, "resource": {}},
      "from": {"key": {"id": "A", "revision": "a7"}, "resource": {}},
      "link": {"key": {"id": "L1", "revision": "l3"}, "resource": {"properties": {"status": "active"}}},
      "neighbor": {"key": {"id": "P", "revision": "p2"}, "resource": {"properties": {"status": "ratified"}}}
    }
  ]
}
```

A standard predicate over that view is:

```text
$.bindings[?@.link.resource.properties.status == "active" && @.neighbor.resource.properties.status == "ratified"]
```

Both conditions concern one binding. Explicit ancestor bindings can be fields
in the input, so ordinary singular JSONPaths compare their values without a
second lexical-variable language. The planner may lower directly to SQL rather
than materialize records, provided identities, multiplicity, values and failure
semantics remain equivalent. Resources acquire no stored fields from this view.
The exact record/capture schema remains a decision before implementation.

### True function extension option

A genuine graph predicate can take a nested selector **string**, avoiding an
unquoted predicate-rebinding dialect. Candidate signature:

```text
bdp_outgoing_any(graph: ValueType, source: ValueType,
                 selector: ValueType, captures: ValueType) -> LogicalType
```

Its narrowed runtime domains are a fixed authorized graph, selected source
edition, literal admitted JSONPath string and explicit captured JSON values.
The function evaluates the selector as a fresh query over a defined envelope
containing the graph, captures and actual binding records. Admit only selectors
that return actual binding records, such as `$.bindings[?predicate]` or
`$.bindings[*]`; reject envelope/capture selection, descendant selection and
post-filter projection. Otherwise a selector such as `$` could make existence
true even when no outgoing binding exists. Nested `$` names that
fresh envelope; no caller `@` is rebound. Prevalidate and bound every nested
selector before graph work. Wrong argument kinds and graph failures need an
explicit contract; they cannot be hidden as false, null or an empty node list.
The candidate `bdp_` name is not a registered standard function.

This can express graph existence and bounded reachability membership. Returning
a graph, ordered paths or aggregate rows still needs result composition or a
prepared input view. Functions must not collect witnesses through hidden mutable
side channels or change authorization/snapshot context through cached closures.

## Graph semantics retained by either candidate

- Step predicates prune each hop; endpoint predicates apply after traversal.
  Unmatched intermediate nodes can lead to matched endpoints.
- Reachability returns selected editions; graphs preserve actual Link witnesses,
  including parallel and cycle-closing Links. Paths preserve ordered exact Link
  sequences and need an explicit cycle policy and path budget.
- Minimum zero-hop inclusion is explicit. A positive-length cycle can return a
  seed even when zero-hop results are excluded. Default simple paths do not repeat a selected Bead identity-and-revision
  pair. Such paths and reachable sets answer different questions.
- Binding occurrences, distinct Link editions and distinct neighbor editions have
  separate count units. Projection, distinct, grouping and aggregation precede
  paging and use total orders defined by the admitted result contract.
- All graph reads use coherent authorized selected editions and the appropriate
  owned-Link state. Unavailable retained history or unresolved neighbors cannot
  silently disappear through SQL joins or become negative findings.
- Validate all admitted expressions before execution. Keep ordinary JSONPath
  mismatch results distinct from acquisition, cancellation and work-budget
  failures. A provider unable to answer completely refuses the strict request.

## Reuse evidence and validation path

The independent research inspected RFC 9535, the existing Beads bounded Selector,
and public Go extension APIs. The existing bounded parser intentionally refuses
functions, path-to-path comparisons and several full-RFC forms. Its existing
admission contract must remain stable. `theory/jsonpath` offers parse-time
function validators and an extension registry, but its evaluator callbacks and
`Select` return no execution error or cancellation context. Fallible graph reads
therefore need a host planning/admission layer, an AST evaluator adapter, or a
separately justified library change; a registered callback alone is insufficient.

An isolated experiment with `theory/jsonpath v0.12.2` executed nine standard
predicate/binding examples, a pure literal-substring extension, a true graph
predicate taking a literal selector string and explicit captures, and rejection
checks for nonstandard graph forms, invalid/nonliteral nested selectors, and
selectors that could claim existence by selecting an envelope instead of a
binding. All passed after a
setup-only package-file naming error was corrected. The experiment supplied
prepared in-memory values, not a graph provider. Complete and well-formed input
was an explicit precondition: the demo callback returns false on malformed
arguments/adjacency and therefore does not implement or qualify the proposed
fail-closed provider/error contract. It did not implement graph
acquisition, traversal, serialization, CLI translation, complete numeric/Unicode
qualification or an installed BDP capability. Authored semantic corpus cases
remain distinct from these executed mechanism checks.

Required conformance work compares friendly and portable forms over the same
selected inputs: missing/null, present false, exact kinds, name collisions,
Type identity/family, same versus independent witnesses, outer captures, seed
versus hop source, parallel/shared Links, exact pins, zero hops/cycles, graph/path
membership, count units, complete failures and stable continuation. No new
conformance capability or test identifier is allocated by this prose.

## Open decisions before a protocol amendment

1. Select structured graph composition plus JSONPath predicate slots, or choose
   and explicitly name a broader textual dialect. The former is recommended.
2. Choose prepared binding inputs, true nested-selector graph functions, or both,
   including exact record/capture schemas and root rules.
3. Reconcile full predicate semantics and numeric admission with Core, and define
   the narrow extension set, signatures, naming/version and capability admission.
4. Set result/witness, count/group, path/cycle, work-limit and ordering contracts
   before admitting each operation. Requirements do not make every operation
   mandatory in the first implementation.
5. Select discovery/transport/request/result schemas and adoption sequence after
   the operation contract is reviewed. Read collection selectors and mutation
   selectors do not acquire graph features merely because a CLI can express them.

The Beads facade translates its readable grammar into the selected portable
contract. It owns CLI spelling and compatibility, while this BDP document owns
the eventual shared meaning. Neither document may silently supply semantics
missing from the other.
