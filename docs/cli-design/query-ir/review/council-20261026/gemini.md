### Missing Captured Context

The following documents and execution fixtures are referenced by the reviewed specifications but were not provided in the captured snapshot:
1. `docs/cli-design/query-ir/query.schema.json` and `specs/profiles/core/bdp-v0.1.schema.json`: Complete JSON schemas defining native request/response bodies, AST schema structures, and type definitions.
2. `docs/cli-design/query-ir/cases.json`, `EXAMPLES.md`, and `fixtures.json`: Authored AST test cases and fixture definitions. Note: these are authored static design cases only; no actual evaluator, CLI parser, or HTTP integration test suites have run.
3. `docs/cli-design/query-ir/validate.py`: The static Python schema validator script.
4. `specs/profiles/core/core.md`, `contract-binding.md`, and `read-delivery.md`: Underlying BDP Core protocol, framing, and delivery specifications.
5. `docs/cli-design/reads-and-paging.md` and `read-framing.schema.json`: Baseline read command references and schema-2 Cleo descriptor registries.

---

### Numbered Findings

#### 1. EBNF Grammar Permits Illegal Clauses, Unbounded `through`, and Untested `all` Quantifiers
- **Severity**: Critical
- **File & Section**: `docs/cli-design/query-language.md` — Section "Complete grammar candidate"
- **Concrete Issue**: The formal EBNF defines:
  ```ebnf
  collection = navigation, [ clause ] ;
  clause     = "as", name, [ "through", predicate ], [ "where", predicate ] ;
  quantified = ( "any" | "all" ), navigation, [ clause ] ;
  ```
  This grammar suffers from three major specification flaws:
  1. Both `through` and `where` are marked optional in `clause`. The grammar accepts `as name` with neither clause, directly contradicting the requirement: *"A bare `as NAME` with no clause is rejected because it has no scope in which the name could be used."*
  2. `clause` is placed on `collection` and `quantified` without restriction, permitting `through` on non-traversal sources (e.g., `beads as b through P`), directly contradicting: *"`through` requires a direct walk source without endpoint navigation... A filter on any other collection uses `as NAME where P`."*
  3. In `quantified`, `clause` is optional and `where` inside `clause` is optional. The grammar therefore accepts `all navigation` and `all navigation as x through P` without a test predicate, directly violating: *"`all` requires one [a test]... The AST contains input, binder, and test directly."*
- **Impact**: Any parser generated directly from the proposed EBNF will accept invalid queries that have no valid lowering to the AST (e.g., an `all` AST node without `bind` or `predicate`), leading to runtime crashes or divergent parser-specific rejection behaviors.
- **Fix**: Stratify `collection`, `traversal`, and `quantified` in the EBNF:
  ```ebnf
  collection          = traversal | non_traversal_collection ;
  traversal           = walk, [ "as", name, [ "through", predicate ], [ "where", predicate ] ] ;
  non_traversal_coll  = navigation_non_walk, [ "as", name, "where", predicate ] ;
  quantified          = "any", navigation, [ "as", name, [ "through", predicate ], [ "where", predicate ] ]
                      | "all", navigation, "as", name, [ "through", predicate ], "where", predicate ;
  ```
  Explicitly mandate in the grammar that `clause` requires at least `through` or `where`.

---

#### 2. Lexical and Grammatical Ambiguity Between Resource Endpoints and Property Field Access
- **Severity**: High
- **File & Section**: `docs/cli-design/query-language.md` — Section "Complete grammar candidate"
- **Concrete Issue**: In the grammar:
  ```ebnf
  resource = name, { ".", endpoint } ;
  endpoint = "source" | "target" ;
  field    = resource, ( ".", key | bracket ), { ".", key | bracket } ;
  operand  = resource | value ;
  value    = JSON | field | ( "id" | "rev" ), "(", resource, ")" ;
  ```
  Because `key` matches any identifier `[A-Za-z_][A-Za-z0-9_-]*`, the tokens `"source"` and `"target"` match both `endpoint` and `key`. In an expression like `link.source = b`, the left-hand side can be parsed as a `resource` (endpoint Bead acquisition) or a `value -> field` (reading a property named `source`). While the prose notes that `.source` always acquires the Bead and `link.properties.source` must be used for a property named `source`, the EBNF grammar contains an unresolved reduce/reduce ambiguity.
- **Impact**: LR/LALR parser generators will flag grammar conflicts or nondeterministically reduce `link.source` to `field` instead of `resource`, causing valid endpoint navigation to fail semantic admission.
- **Fix**: Exclude `endpoint` keywords from the initial unquoted `key` following a Resource binding, or explicitly specify the lexical precedence in the grammar: a dot followed by `source` or `target` on a Resource binding always reduces to `endpoint`, while property access requires `properties.source` or bracket notation `link["source"]`.

---

#### 3. Overview Teaches Point Detail Output for Collection Query Results
- **Severity**: High
- **File & Section**: `docs/cli-design/overview/02-explore-graph.md` — Subsection "Ask about related content" (vs `docs/cli-design/read-output.md`)
- **Concrete Issue**: In `02-explore-graph.md`, the output of `bd query 'beads as b where ...'` is illustrated as:
  ```console
  > bd query 'beads as b where (any outgoing(b) as link through link is references where link.target.status = "ratified")'
  csv-plan [guide] CSV export plan
  …
  ```
  This is the single-Resource point `detail` layout. However, `docs/cli-design/read-output.md` explicitly specifies:
  - *"Default point format is detail and collections table; redirection does not pick another format."*
  - *"Resource results use `resource_collection`: its existing `data.items`/`next` receive the native result's items/next, with actual item kind in context."*
  - *"table is collection-only here."*
  Because `bd query` returns a collection (`resource_collection`), its default human format must be a table (identical to `bd list`), not point detail format.
- **Impact**: The overview teaches users and implementers an unsupported format convention that directly contradicts the schema-2 CLI read output framing contract.
- **Fix**: Update the example output in `02-explore-graph.md` to display standard collection table output:
  ```console
  ID        TYPE   TITLE
  csv-plan  guide  CSV export plan
  ```

---

#### 4. Flag Syntax Collision Between RFC 6901 Pointer Projection and `--omit envelope`
- **Severity**: High
- **File & Section**: `docs/cli-design/read-output.md` — Sections "Field masks are representation only" and "Finite/stream completion"
- **Concrete Issue**: `read-output.md` states:
  - *"`--include POINTER` unions explicit fields; `--omit POINTER` subtracts optional fields... Pointer syntax is RFC6901, not JSONPath/wildcards/dot paths/URI fragments."*
  - *"`envelope` is not a Resource pointer."*
  Yet the same document specifies:
  - *"`--omit envelope` removes framing, including projection/completion declarations."*
  `envelope` is an unescaped bare string, not an RFC 6901 pointer (which requires a leading `/`). Overloading `--omit` to take either an RFC 6901 pointer or a magic framing keyword violates RFC 6901 syntax validation and causes a collision if a Resource contains a top-level property `/envelope`.
- **Impact**: CLI argument parsers cannot strictly validate `--omit` against RFC 6901. A user attempting to omit a Resource property `/envelope` will inadvertently disable CLI framing.
- **Fix**: Remove framing manipulation from `--omit`. Introduce a dedicated framing control flag (e.g., `--no-envelope` or `--raw`) to separate framing suppression from data-level RFC 6901 projection masks.

---

#### 5. Contradiction in CLI Dispatch and Admission for `--request-file`
- **Severity**: High
- **File & Section**: `docs/cli-design/query-language.md` — Sections "List: small flags, one Boolean escape hatch" and "Query inputs and common controls"
- **Concrete Issue**: Section 2 states:
  *"`bd list --request-file FILE` accepts the same complete request shape as Query's JSON input. It requires `profile: list`, a Bead `scan` with at most its admitted filter, and a Resource or count result. `bd link list --request-file FILE` requires the Link scan instead."*
  However, Section 3 states:
  *"A complete request with `profile: list` dispatches through native List; profiles `query` and `graph` dispatch through native Query. The command name does not bypass profile admission."*
  These two statements conflict:
  - Under Section 2, running `bd list --request-file query.json` (where the file specifies `profile: query`) MUST fail CLI admission because `bd list` requires `profile: list`.
  - Under Section 3, running `bd list --request-file query.json` bypasses the command name and dispatches directly to native Query.
- **Impact**: Implementers cannot determine whether command names enforce profile boundaries or whether `--request-file` acts as a generic command-agnostic dispatch escape hatch.
- **Fix**: Enforce strict command-profile consistency: `bd list --request-file` must refuse files with `profile: query` or `profile: graph`. Mandate that non-list profiles use `bd query --request-file`.

---

#### 6. Wire Dispatch and Discovery Deadlock for Graph-Only Providers
- **Severity**: Critical
- **File & Section**: `specs/profiles/core/read-operations.md` — Section "Capability and safe dispatch" (vs `specs/profiles/core/query.md` and `docs/cli-design/query-language.md`)
- **Concrete Issue**: In `read-operations.md`:
  - A provider advertises capability `profiles`: a nonempty unique array containing `list` and optionally `graph` and/or `query`.
  - Allowed HTTP operations are strictly defined as:
    ```text
    POST DISCOVERED_OPERATION?readVersion=1&operation=list
    POST DISCOVERED_OPERATION?readVersion=1&operation=query
    ```
  - An unknown `operation` query parameter must refuse with an error.
  - The specification states: *"Whether the protocol gives Graph a distinct convenience operation remains deferred."*
  Now consider a service that supports `list` and `graph`, but does not implement general `query` (advertising `profiles: ["list", "graph"]`):
  1. The client wants to execute a graph query. Because there is no `operation=graph`, the client must send `operation=query`.
  2. The server receives `operation=query`. Under the capability rules, the server does not support the `query` profile.
  3. If the server rejects `operation=query`, the client cannot dispatch graph queries. If the server accepts `operation=query`, it violates the capability contract by handling an operation it advertised as unsupported.
- **Impact**: Providers cannot implement a Graph-only service without implementing or stubbing the `query` dispatch route, breaking the modular profile design.
- **Fix**: Formally define `operation=graph` on the wire for the `graph` profile, or explicitly define in `read-operations.md` that `operation=query` is the transport multiplexer for both `query` and `graph` profiles and that profile admission occurs via `body.query.profile`.

---

#### 7. Non-Implementable Sort Ordering Requirements for Storage/SQL Pushdown
- **Severity**: Critical
- **File & Section**: `specs/profiles/core/read-operations.md` — Section "One sort field"
- **Concrete Issue**: The sorting proposal specifies:
  1. Exact cross-type scalar ordering: `null`, booleans (false first), numbers, then strings.
  2. Missing paths sort last in both directions (`asc` and `desc`).
  3. *"Arrays/objects at the sort path refuse the request rather than using provider-specific serialization order."*
  These rules are an implementation blocker for providers delegating sorting to storage engines (e.g., PostgreSQL, SQLite, MySQL):
  - In standard SQL engines, `NULLS LAST` treats null and missing identically; separating present `null` (which reverses position in `desc`) from missing (which stays last in `desc`) requires complex generated columns or multi-branch `ORDER BY CASE` statements.
  - More critically, requiring that an array or object at the sort path *refuses the request* (HTTP 400 `invalid-parameter`) makes indexed query pushdown impossible. An engine cannot simply execute `ORDER BY ... LIMIT N`. To satisfy the refusal rule, it must scan every matching candidate row in the dataset to verify that no row contains an array or object at that path, defeating indexed pagination and work budgets.
- **Impact**: Any service with a non-trivial dataset cannot push sorting down to a standard relational database without risking full-table scan performance degradation or semantic non-compliance.
- **Fix**:
  1. Revise the refusal rule: non-scalar values (arrays and objects) at the sort path should sort consistently (e.g., sort after scalars or be treated as unindexable values) rather than aborting the entire request with an HTTP 400.
  2. Align the null/missing sort behavior with standard SQL `NULLS LAST` semantics, or define sorting only over declared scalar properties where the Type definition guarantees a scalar domain.

---

#### 8. Redundant Response Header Buffer Exhaustion via `BDP-Projection`
- **Severity**: High
- **File & Section**: `specs/profiles/core/read-operations.md` — Section "Point reads and field selection"
- **Concrete Issue**: `read-operations.md` mandates:
  *"Its outer HTTP field `BDP-Projection` contains the compact JSON mask object actually applied... Masks must also fit ordinary request-target and response-header bounds; refuse before output if their required metadata cannot be carried intact. Never truncate a mask header."*
  Meanwhile, for List and Query operations, the response body table defines:
  `resources`: `{form:"resources", resourceKind:"bead"|"link", items:[RESOURCE...], next:ABSOLUTE_URL_OR_NULL, projection?:MASK}`.
  Carrying the projection mask in the `BDP-Projection` HTTP response header for POST operations is completely redundant because the mask is already in `result.projection`. Furthermore, request limits admit bodies up to 262,144 bytes (`limits.requestBytes`). A complex projection mask with extensive include/omit paths can easily reach 10KB–30KB. Standard reverse proxies, ingress controllers, and HTTP servers (e.g., Nginx, Envoy, Cloudflare, Apache) enforce a strict 8KB or 16KB limit on response headers.
- **Impact**: Valid POST queries with large projection masks will be aborted by the server or dropped by intermediary proxies due to HTTP response header overflow, despite being within the body limits.
- **Fix**: Restrict the `BDP-Projection` HTTP header strictly to point GET/HEAD responses. For POST `list` and `query` operations, convey applied projection exclusively within the JSON response body (`result.projection`).

---

#### 9. Excessive Architectural Burden on List-Only Providers
- **Severity**: Medium
- **File & Section**: `specs/profiles/core/read-operations.md` and `specs/profiles/core/query.md`
- **Concrete Issue**: The specification advertises: *"A small service can implement List without implementing Query or Graph."* However, a provider implementing only List is still forced to implement:
  1. A complete JSON AST parser and schema validator supporting `ir: "bdp-query-design-1"`, limit counting (`requestBytes`, `nodes`, `nesting`), and JSON pointer diagnostic reporting (`at: "/query/selection"`).
  2. The `evaluation` response wrapper (`{"complete": true, "traversals": []}`), despite performing no traversals.
  3. Nominal Type hierarchy resolution: List includes `typeIs` family matching (`--type`), requiring integration with authoritative type-refinement registries and forbidding exact-only fallback.
  4. RFC 6901 include/omit mask processing, array compaction, and projected schema definitions.
  5. Multi-type scalar sorting and missing-last ordering.
  6. Exact distinct edition count before paging (`form: "count"`).
- **Impact**: The barrier to entry for a lightweight List provider is excessively high. Small embedded services or storage shims cannot easily provide a compliant endpoint without a large query engine runtime.
- **Fix**: Define a minimal "basic-list" profile or simplified transport binding (e.g., URL-encoded query parameters or a flattened JSON filter) that allows simple providers to serve inventory lists without implementing the full AST compiler, AST limits engine, and evaluation traversal envelope.

---

#### 10. Non-Deterministic Query Execution via Evaluator Fail-Fast Policy
- **Severity**: High
- **File & Section**: `specs/profiles/core/query.md` — Section "Quantifiers and completeness"
- **Concrete Issue**: The author-proposed execution policy states:
  *"an evaluator may fail fast on a required runtime acquisition error before it has established a definitive witness or counterexample. It need not continue searching for another branch that might prove the answer... Success versus uniform refusal may therefore depend on executed work; conflicting successful Booleans remain forbidden."*
  Suppose a query tests `any outgoing(b) as l where l.target.status = "ratified"`. Suppose Bead 1 has two outgoing links: Link A points to an authorized, ratified Bead (valid witness); Link B points to a non-existent or authorization-hidden Bead (triggering a 404/refusal on acquisition).
  - If the database evaluates Link A first, the query succeeds and returns `true`.
  - If the database evaluates Link B first, the query immediately fails with HTTP 404 `resource-not-found`.
- **Impact**: Query evaluation becomes non-deterministic and implementation-dependent. Minor differences in database index traversal order, storage layout, or physical query plans will cause identical queries against identical data to intermittently succeed or fail with an HTTP error.
- **Fix**: Reject the fail-fast before proof author proposal. Require evaluators to prioritize evaluating locally available or authorized candidates before declaring failure, or specify that a valid witness definitively satisfies `any` even if other branches encounter missing data.

---

#### 11. Continuation Parameter Naming Mismatch (`pageSize` vs `limit`)
- **Severity**: Medium
- **File & Section**: `specs/profiles/core/read-operations.md` — Section "Continuation and delivery are separate"
- **Concrete Issue**: In `read-operations.md`, the POST request body member for pagination is specified as:
  `{query: AST, sort?: SORT, pageSize?: POSITIVE_INTEGER}`.
  However, in the continuation specification:
  *"Resource `next` is an absolute GET continuation issued by the service... Only its per-page `limit` may be replaced/appended under ordinary read delivery. All other URL bytes/context remain intact."*
  The text switches between `pageSize` (in the POST body) and `limit` (in the GET continuation URL).
- **Impact**: Clients attempting to adjust page size on continuation by appending `pageSize=N` will be rejected by endpoints expecting `limit=N` (or vice-versa), breaking continuation resizing.
- **Fix**: Standardize on a single parameter name across both POST bodies and GET continuation URLs (preferably `pageSize` to remain consistent with the AST request wrapper).

---

#### 12. Link ID Omission in Graph Console Visualization for Parallel Edges
- **Severity**: Low
- **File & Section**: `docs/cli-design/overview/02-explore-graph.md` — Subsection "Follow a neighborhood" (vs `docs/cli-design/read-output.md`)
- **Concrete Issue**: The overview example depicts a graph with two parallel links between `csv-plan` and `csv-format`: `csv-plan-format` (references) and `csv-plan-format-alt` (explains).
  The CLI console tree output is shown as:
  ```console
  > bd graph csv-plan --direction out --depth 2 --link-type references
  csv-plan [guide] CSV export plan
  ├─ references → csv-format [note] CSV format
  │  └─ explains → csv-review [note] Spreadsheet review
  └─ explains → csv-format [already shown]
  ```
  `read-output.md` states: *"Graph uses the existing graph descriptor... retain actual Link IDs and selected edition mapping in structured data."*
  In the tree view, Link IDs are completely absent. When multiple parallel Links of the same Type exist between the same two Beads, the reader cannot determine which Link was traversed or why multiple identical edges appear.
- **Impact**: Human operators cannot inspect or disambiguate parallel relationships in graph output.
- **Fix**: Include the Link ID in the human graph edge rendering (matching the Mermaid diagram shown in the overview), for example:
  `├─ [csv-plan-format] references → csv-format [note] CSV format`.

---

#### 13. Undefined Problem Error Code for Missing Type-Family Authority
- **Severity**: Low
- **File & Section**: `specs/profiles/core/query.md` and `specs/profiles/core/read-operations.md` — Section "Refusals and security"
- **Concrete Issue**: `query.md` dictates: *"Family includes refinements under the authoritative recorded interpretation rules. Missing family authority refuses; there is no exact-only fallback."*
  However, the Problem code table in `read-operations.md` lists only:
  - `400 invalid-parameter`: malformed transport/AST, unbound name, kind/type mismatch, unsupported operator combination.
  - `422 capability-not-supported`: version/profile/sort/unbounded/required capability unavailable.
  It is ambiguous whether an unavailable external Type-family authority is an invalid query parameter (400) or an unsupported capability (422).
- **Impact**: Disparate implementations will return conflicting HTTP status codes (400 vs 422) when Type refinement authority cannot be resolved.
- **Fix**: Explicitly designate `422 capability-not-supported` with detail code `type-family-authority-unavailable` for missing Type authority.

---

#### 14. Unparenthesized Quantifier Greedy Conjunction Capture
- **Severity**: High
- **File & Section**: `docs/cli-design/query-language.md` — Sections "Ask any or all" and "Complete grammar candidate"
- **Concrete Issue**: The prose specifies:
  *"Unparenthesized `P and any ...` refuses with a suggestion to parenthesize the quantifier. This rule removes the ambiguous choice of whether an `and` belongs to a quantifier test or the surrounding expression."*
  However, in the EBNF:
  ```ebnf
  clause     = "as", name, [ "through", predicate ], [ "where", predicate ] ;
  quantified = ( "any" | "all" ), navigation, [ clause ] ;
  ```
  If a user inputs:
  `any outgoing(b) as link where link.target.status = "ratified" and b.status = "draft"`
  The parser will greedily parse `and b.status = "draft"` as part of the quantifier's `where predicate`. If the user intended `b.status = "draft"` to filter candidate Beads `b`, the query executes with an entirely different semantic meaning (testing `b.status` on each Link iteration). The grammar provides no delimiter or termination token for `where predicate` other than closing parentheses or EOF.
- **Impact**: Trailing conjunctions intended for outer selections are silently captured into inner quantifier tests, leading to subtle semantic query bugs.
- **Fix**: Require that all `quantified` expressions occurring within a `predicate` MUST be explicitly parenthesized in the EBNF grammar:
  ```ebnf
  test = "true" | "false" | "(", predicate, ")" | "(", quantified, ")" | ... ;
  ```
  Disallow bare unparenthesized `quantified` at the `predicate` root when followed by binary boolean operators.
