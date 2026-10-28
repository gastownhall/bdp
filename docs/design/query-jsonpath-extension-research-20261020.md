# JSONPath graph extension boundaries and candidate BDP composition

Research date: 2026-10-20. This is design research, not an adopted BDP profile, wire schema, dependency choice, parser implementation, or provider qualification. Examples below are **candidate syntax**. Investigation used the RFC, upstream source, and the local Beads publication source; it installed no dependencies and ran no builds or evaluators.

**Recommendation:** make the portable surface a structured BDP graph query whose predicates are a named RFC 9535 JSONPath profile. Use genuine, typed function extensions for graph tests where useful. Define filter, expand, bounded walk, and semantic results in the BDP composition contract. Let `bd` sugar compile to that same request/plan. A single plain RFC query can answer useful graph membership questions, but cannot directly express every required graph/path/row/aggregate result. Capturing and rebinding an unquoted predicate argument would be a bespoke language extension.

## The actual standard boundary

RFC facts, condensed:

- Queries select nodes already in a JSON input tree; top-level syntax starts with `$` and proceeds through child/descendant segments.
- Functions occur in filters, comparisons, or arguments to other functions. Their parameters/results use `ValueType`, `NodesType`, or `LogicalType`.
- `ValueType` contains JSON values or `Nothing`; `NodesType` contains a nodelist; `LogicalType` contains logical true/false, distinct from JSON booleans. A singular query can supply a value; a general query supplies nodes. Nodes convert to logical existence, not implicitly to a value.
- Arguments include literals, queries, logical expressions, and function expressions. This is no lambda/predicate-capture type. `@` means the immediately enclosing filter's current node; nested filters cannot name an outer current node.
- Functions must be side-effect-free. Evaluation order and short-circuiting are unspecified. Invalid syntax/types cause query errors; structural mismatches select nothing. Execution resource failures remain possible and must not silently malfunction.
- Functions do not add top-level calls, stages, traversal selectors, projections, or output constructors. Duplicate selections are retained; `count()` counts occurrences without deduplication.

Sources: [RFC 9535 §§2.1–2.3.5](https://www.rfc-editor.org/rfc/rfc9535.html#section-2.1), [function extensions §§2.4–2.4.3](https://www.rfc-editor.org/rfc/rfc9535.html#section-2.4), [count §2.4.5](https://www.rfc-editor.org/rfc/rfc9535.html#section-2.4.5), [segments §2.5](https://www.rfc-editor.org/rfc/rfc9535.html#section-2.5).

Consequently, `outgoing_any(@, @.link... && @.neighbor...)` cannot acquire rebinding semantics merely by registering a function. Its second argument already denotes a logical result in the caller's context. Likewise `outgoing(...)[?...]`, a top-level `walk(...)`, and a `| return` stage require extra grammar. Call these BDP constructs if selected; do not advertise them as ordinary RFC function extensions.

## Three implementable approaches

| Approach | What it can do | Cost or gap |
| --- | --- | --- |
| Materialize an adjacency/binding view, use ordinary JSONPath | Correlated Link/neighbor filtering and selection from prepared records without graph-specific grammar | Host still constructs the view; nested outer correlation needs explicit fields/captures; paths/aggregates require prepared results or composition |
| Register typed graph functions with selector **string** arguments | Existential/negative graph tests, bounded reachability tests, counts used in filters; explicit correlation | BDP must specify nested selector evaluation, inputs, typing, limits and failures; function outputs cannot become top-level stages |
| Structured BDP graph query with JSONPath predicate slots | Filter, expand, walks, graphs, paths, semantic projection, grouping/aggregation and pagination | BDP owns a composition schema/plan, while reusing JSONPath for predicates; this is the recommended complete surface |

These approaches can coexist. The third can normalize the second into graph-test nodes and use the first as a reference evaluation model.

### A. Prepared binding records: simplest standard predicate use

Candidate host input contains one record per actual selected Link/neighbor pairing:

```json
{
  "bindings": [
    {
      "seed": {"key": {"id": "A", "revision": "a7"}, "resource": {}},
      "from": {"key": {"id": "A", "revision": "a7"}, "resource": {}},
      "link": {"key": {"id": "L1", "revision": "l3"}, "resource": {"properties": {"status": "active"}}},
      "neighbor": {"key": {"id": "P", "revision": "p2"}, "resource": {"properties": {"status": "ratified"}}}
    }
  ]
}
```

These abbreviated keys/resources illustrate an evaluation view, not BDP Resource wire JSON. The host obtains exact edition keys from its read contract; it must not invent revisions from JSONPath locations.

Candidate predicate and projection:

```text
$.bindings[?@.link.resource.properties.status == "active" && @.neighbor.resource.properties.status == "ratified"].neighbor
```

Both tests use the same binding. Two parallel Links produce two records even when their neighbor is identical. Returning distinct neighbors or returning outer candidates once is a host semantic operation. Precomputing `outgoing` arrays on each seed also permits `$.candidates[?@.outgoing[?...]]`; this trades graph functions for a larger declared input view. It does not make JSONPath itself a graph acquisition engine.

### B. Genuine function extension using a nested selector string

Candidate signature:

```text
bdp_outgoing_any(graph: ValueType, source: ValueType,
                 selector: ValueType, captures: ValueType) -> LogicalType
```

The `bdp_` names are unregistered candidates, not standard functions. Publication must define the extension set/version and address naming collisions; [RFC §3.2](https://www.rfc-editor.org/rfc/rfc9535.html#section-3.2) provides an Expert Review registration process.

The runtime domains are narrower than the RFC types: `graph` is a fixed authorized graph view; `source` is a selected-edition record; `selector` is a string containing an admitted JSONPath; `captures` is explicit JSON data. BDP must define the behavior for other values. Recommend rejecting nonliteral selector arguments during BDP validation so nested selectors are compiled and bounded before graph execution; this is an additional profile rule, not automatic RFC typing.

Candidate outer query argument has `graph` and `candidates`; every candidate is a `{key, resource}` edition record:

```text
$.candidates[?bdp_outgoing_any($.graph, @,
  '$.bindings[?@.link.resource.properties.status == "active" && @.neighbor.resource.properties.status == "ratified"]',
  @)]
```

The extension enumerates real outgoing pairs and evaluates the string as a **fresh query** against:

```text
{graph: <same fixed graph>, captures: <fourth argument>, bindings: [<binding records>]}
```

Each record has `seed`, `from`, `link`, and `neighbor` as above. The extension returns logical true exactly when the nested query selects at least one admitted binding. It returns the original outer candidate through the outer filter, once per candidate occurrence. No argument is captured as syntax and no caller `@` is rebound. Nested query `$` is the fresh envelope, not the caller's root. This evaluation contract is new BDP semantics inside a standard function extension mechanism.

Explicit correlation example for that nested query:

```text
$.bindings[?@.neighbor.resource.properties.owner == $.captures.resource.properties.owner]
```

Here the fourth argument was the outer candidate. For another nested graph test, pass the desired current binding as `captures`; a deeper selector can read `$.captures.seed`, `$.captures.link`, or `$.captures.neighbor`. No lexical outer-variable lookup is assumed. If multiple ancestor contexts are needed, the host must supply a defined capture record or a pure record-construction function; arbitrary object literals/closures cannot be assumed in JSONPath. Avoid recursive capture chains by specifying a small named capture schema per admitted construct.

Graph context could instead be captured by a request-specific evaluator closure. That is implementable, but query meaning would then depend on hidden state. Prefer explicit immutable graph input or a specified, immutable request context whose identity is part of the normalized query and cache keys. Never let a cached parser/evaluator close over a mutable current snapshot, authorization principal, or transaction.

Candidate complementary signatures, each requiring its own frozen definition:

```text
bdp_incoming_any(graph: ValueType, source: ValueType,
                 selector: ValueType, captures: ValueType) -> LogicalType
bdp_reachable(graph: ValueType, source: ValueType, target: ValueType,
              min_hops: ValueType, max_hops: ValueType,
              step_selector: ValueType, captures: ValueType) -> LogicalType
bdp_neighbor_count(graph: ValueType, source: ValueType,
                   selector: ValueType, captures: ValueType) -> ValueType
```

`bdp_neighbor_count` would need an explicit distinct-edition unit; a Link-occurrence count should have a different documented signature/name. A `NodesType` function can expose existing graph nodes for existence or `count(...)` within a filter, but does not unlock output stages. Generated binding/path objects should be returned as a JSON array/object `ValueType`, or materialized as actual nodes in the declared query input; do not silently claim invented objects have locations in the caller's original tree. A `LogicalType` predicate is the smallest interoperable graph extension to start with.

Reachability can select reachable resources by filtering a complete candidate universe with a membership predicate. It does not provide witness Links, paths, or graph output. Baking witnesses into a hidden side channel would violate the recommended pure model. Returning an existing root envelope whose contents a function secretly mutates is likewise unacceptable.

### C. Structured composition: full requirements without macro claims

Candidate request fragment; names and schema are illustrative:

```json
{
  "readContext": {"snapshot": "opaque-admitted-context"},
  "select": {"selector": "$[?@.resource.id == 'https://example.invalid/beads/A']"},
  "steps": [
    {
      "op": "walk",
      "direction": "out",
      "hops": {"min": 1, "max": 8},
      "stepSelector": "$[?@.link.resource.type == 'https://example.invalid/types/Requires']",
      "endpointSelector": "$[?@.neighbor.resource.type == 'https://example.invalid/types/Policy']"
    }
  ],
  "result": {"kind": "resources", "binding": "neighbor", "distinct": "edition"},
  "bounds": {"examinedLinks": 100000, "resultResources": 10000}
}
```

Numbers are demonstration values, not proposed public defaults. The two Type comparisons illustrate exact URI equality; family membership needs a separately declared pure Type function and resolved Type context. A short Type name in CLI sugar must resolve to the exact same operand before evaluation.

The `stepSelector` is evaluated on a singleton array containing the per-hop binding. It prunes traversal. The `endpointSelector` filters produced endpoints after walking and therefore permits non-Policy intermediate nodes. Keeping them separate prevents the common semantic error of pruning away the route to a Policy.

Candidate variations map to the same plan families:

| Intent | Composition |
| --- | --- |
| Filter seeds by matching outgoing pair | `select` plus graph-existence predicate; retain each selected seed edition |
| Produce one row per matching pair | `expand` step, preserve Link edition and neighbor edition |
| Return reachable editions | bounded `walk`, then edition distinct |
| Return graph | bounded `walk` plus explicit root/witness-graph result semantics |
| Return paths | bounded path enumeration with explicit simple-path/repeated-vertex policy and path budget |
| Count/group | aggregate stage over the declared binding/result unit before pagination |

For graph results, choose all traversed edges versus matching witnesses before admission. For paths, preserve ordered exact Link editions; parallel Link IDs distinguish paths. Reachability can include the seed through a positive-length cycle even when zero-hop inclusion is disabled; simple paths may exclude that repeated seed. Never enumerate all paths as an implicit implementation of a reachable-set request.

## CLI sugar must preserve the same meaning

Candidate sugar can use a familiar arrow/pipeline grammar without pretending that grammar is JSONPath:

```text
bd query 'type is Specification and exists { ($this)-[$r]->($p) where $r.status = "active" and $p.status = "ratified" }'
bd query 'id = "https://example.invalid/beads/A" | expand ($this)-[$r]->($p) | return distinct $p'
bd query 'id = "https://example.invalid/beads/A" | walk out via $r to $p where $r.type is Requires hops 1..8 | where $p.type is Policy | return distinct $p'
```

The first compiles to graph existence plus one correlated binding predicate; the second to expand plus neighbor edition distinct; the third to the request family illustrated above. Bare friendly `status` paths need a specified mapping to `resource.properties.status`. `$this` remains the seed; `$r` is the per-hop Link only within the walk guard; `$p` becomes the endpoint afterward. The compiler resolves names, emits escaped JSONPath strings or typed predicate IR, and serializes the same normalized request. It must never recover semantics by parsing rendered table text.

Require an explain/normalized-request output and equivalence corpus: exact same selected editions, Link identities, errors, counting units, completeness and order for sugar and explicit requests. Unknown or unsupported sugar must reject. Human convenience cannot add silent Issue defaults, URI unpinning, property coercions, traversal pruning, deduplication or live-head substitution.

## Read context, errors, purity and completeness

These are proposed BDP responsibilities, not properties supplied by a JSONPath library:

1. Resolve one coherent authorized read context for seeds, Links, endpoint editions, Type-family lookup and all nested tests. Preserve exact endpoint rules; no neighbor is synthesized from target URI spelling. Historical/exact-edition capability failures differ from empty answers.
2. Give `not exists` meaning only in the declared visible scope. An unavailable, incomplete, or exhausted search cannot become false and then be negated into true. A partial count cannot become an exact total.
3. Bound source bytes, outer/nested AST depth/nodes, nested-selector depth/count, hops, examined graph work, result Resources/Links, paths and serialized output independently. Hop limits alone do not bound branching or path counts.
4. Prevalidate every literal nested selector even under an outer `false && ...`. Keep graph predicate value behavior total over admitted input wherever possible. Classify acquisition/cancellation/budget failures at the host operation boundary, never as `LogicalFalse`, empty nodes, `Nothing`, or JSON null.
5. Do not use shared mutable counters, “first matching edge,” lazy network reads, or exception side channels to make answers depend on function evaluation order. Memoize only against immutable graph/edition/capture/selector inputs. BDP execution strategy can determine resource-exhaustion failures, but cannot claim RFC guarantees for a strict left-to-right predicate-error policy.
6. If an error in any otherwise admitted relationship must defeat an existing witness, prevalidate the relevant relationship domain or define that as an explicit BDP operation policy. Ordinary JSONPath guards cannot guarantee suppressing later faults. Prefer standard mismatch behavior and host failures unless Donna deliberately chooses a dialect.
7. Apply semantic projection, distinct, aggregation and total ordering before output paging. Keep representation masks separate from membership and traversal pruning. Continuation must retain the same query and read context.

The current design requirements are summarized in the [BDP Query exercise](../../specs/profiles/query/query.md), including bindings, walks, counts and execution. This research preserves those requirements while distinguishing their source from RFC capabilities.

## Real Go extension APIs and reuse costs

### Existing Beads bounded parser

The inspected [lexer](https://github.com/donnabox/beads/blob/9bc8c75ad22acd32d052ab132cecc9d45d94e292/internal/httpapi/graphread/selector_lexer.go#L37) explicitly rejects functions. The [parser](https://github.com/donnabox/beads/blob/9bc8c75ad22acd32d052ab132cecc9d45d94e292/internal/httpapi/graphread/selector_parser.go#L74) rejects absolute paths/joins, nested filters, and path-to-path comparisons; the [evaluator](https://github.com/donnabox/beads/blob/9bc8c75ad22acd32d052ab132cecc9d45d94e292/internal/httpapi/graphread/selector.go#L118) restricts first-level members to `id`, `type`, `source`, `target`, `properties`. It therefore cannot evaluate the shaped-record examples unchanged. Its byte/depth/node bounds and iterative immutable AST are useful existing infrastructure. Adding function typing, nested compilation, shaped contexts, and pure error propagation is substantive work. Reuse the semantics/bounds and keep the old core profile intact; decide whether to extend the parser or replace it only after a concrete feature/bound audit.

### theory/jsonpath

Inspected upstream commit `59f8036bf93f388edf67e0995762ac2abee269f1` (not installed). Its [registry](https://github.com/theory/jsonpath/blob/59f8036bf93f388edf67e0995762ac2abee269f1/registry/registry.go) has `Register(name, resultType, validator, evaluator)` with parse-time validation. Its [Path API](https://github.com/theory/jsonpath/blob/59f8036bf93f388edf67e0995762ac2abee269f1/path.go) supports `NewParser(WithRegistry(reg))`, reusable `Parse`, `Select` and located-node selection.

The [function implementation](https://github.com/theory/jsonpath/blob/59f8036bf93f388edf67e0995762ac2abee269f1/spec/function.go) defines `Validator func([]FuncExprArg) error` and `Evaluator func([]PathValue) PathValue`. Arguments are evaluated before the evaluator. The evaluator receives no context/cancellation parameter and cannot return an error; `Select` also returns no error. `NodesType` carries values rather than located-node records. These APIs fit pure in-memory tests better than fallible on-demand graph acquisition.

**Assessment:** credible reuse candidate for parsing/typing/basic evaluation. Explicit graph data plus prevalidated selectors avoids closure hazards. Host cancellation, fine-grained execution budgets, fail-closed provider errors and exact numeric/profile behavior need an adapter, a host evaluator over inspected AST, or a carefully scoped fork. No adoption or conformance claim follows from this API inspection. Do not use panic/recover as the normal graph failure channel. Upstream accepts only human-authored contributions under its [contribution policy](https://github.com/theory/jsonpath/blob/59f8036bf93f388edf67e0995762ac2abee269f1/README.md); this research proposes no upstream contribution.

### PaesslerAG/jsonpath with gval

Inspected `PaesslerAG/jsonpath` commit `3a740cf7976f0418c109091067b625c37d43f367` and `PaesslerAG/gval` commit `c622ea2f0e823f41ceff4fd90127e47e038049f1`. The [JSONPath API](https://github.com/PaesslerAG/jsonpath/blob/3a740cf7976f0418c109091067b625c37d43f367/jsonpath.go) returns a `gval.Evaluable`, composes `gval.Base()` with `$`/`@` parsers, and identifies the Goessner proposal as its basis. It offers `Language()` and an additional placeholder/object-construction dialect.

[gval's language API](https://github.com/PaesslerAG/gval/blob/c622ea2f0e823f41ceff4fd90127e47e038049f1/language.go) exposes `Function`, parser extensions, context-aware evaluation, an error return and `MaxParseDepth`. Its [built-in language definitions](https://github.com/PaesslerAG/gval/blob/c622ea2f0e823f41ceff4fd90127e47e038049f1/gval.go) include coercing arithmetic/logical operators. **Assessment:** useful machinery for a custom language, but weaker evidence for RFC reuse. Its flexibility does not establish RFC type checking, missing/null, equality, function-placement or regex semantics. Replacing those contracts could erase the expected ownership savings. Prefer it only if choosing a deliberate custom dialect after a conformance comparison.

## Decisions for Donna

1. **Recommended:** accept structured BDP graph composition with JSONPath predicate slots as the portable complete language. The alternative is a broader BDP textual dialect; it must be named and specified honestly.
2. Choose prepared binding views versus true graph predicate functions for the first filter capability. If functions are wanted, use explicit literal nested selector strings and explicit captures; admit a small set of total predicates first.
3. Freeze evaluation input schemas, root/capture scope, Type-family behavior, dynamic mismatch policy and host failure categories. Do not inherit the previous draft's required-access faults or strict short-circuiting accidentally.
4. Freeze graph witness membership, simple-path versus repeated-vertex modes, count units, numerical budgets and total orders before admitting those result kinds.
5. Choose parser reuse after a bounded prototype/conformance exercise. Existing parser, theory/jsonpath and gval have materially different extension and failure surfaces; none supplies the graph planner or snapshot contract.

No requirement forces a generic macro system. The full model is expressible as structured graph composition plus ordinary JSONPath predicates and carefully specified typed extensions. The human surface can remain concise while compiling exactly to that model.

## Author follow-up experiment

After this read-only research, the author ran a separate pinned-library mechanism
check. Its [source, evidence and limitations](../../experiments/query-jsonpath/README.md)
are distinct from this report and from the authored design corpus. Independent
review corrected the nested selector's result domain, a repeated-edition fixture
and the failure-policy caveat. Final experiment checks passed.
