# List and Query: proposed native binding

**Complete review proposal, October 26, 2026.** The selected meanings are in
[Query](query.md) and [Resource projection](resource-projection.md). This module
fills their transport, admission, sorting and result-carrier gaps. Its names,
capability identifier and initial restrictions are author proposals for review.
It does not change held schemas, advertise a service, or claim implementation.
The [CLI grammar](../../../docs/cli-design/query-language.md) lowers to this binding.

## Two operations, one logical model

**List** selects one current inventory using only each candidate's fields and
Type affiliation. **Query** composes collections, navigation, traversal and
quantifiers. Graph is initially a restricted Query request, not a third required
operation. A small service can implement List without implementing Query or Graph. It
needs only the admitted scan/filter nodes and local predicates, not a parser or
compiler for unsupported Query nodes. Ordinary JSON decoding plus direct shape
checks can implement admission; executing a general JSON Schema engine is not
mandatory. Sort can be advertised false, and Type-family tests retain their
separate authority prerequisite. The unextended Core inventories and bounded
Selector remain available to implementations that do not select this capability.

The request contains the logical AST, not SQL, a physical plan, executable source,
or trusted client annotations. A service validates it, establishes one authorized
read context, and chooses an equivalent execution plan. It may push operations to
storage, evaluate residual tests itself, or combine both. Delegating checks to a
storage engine is allowed only when the service still enforces this contract's
names, kinds, types, authorization, missing-value rules and supported subset.
Backend acceptance alone does not establish those properties.

All initial collection expressions have a statically determined Bead or Link
element kind, even when empty. A graph has separate Bead and Link components.
There is no mixed Resource union or computed-record result in this first AST.

This binding describes standalone reads. A future Batch selector reuses logical
selection nodes under a different transaction context and identity-set result;
it is not an invocation of this paged read transport. Donna selected prior typed
sets as transaction List candidates and scalar/set explicit Query roots. The
[input reconciliation](../../../docs/cli-design/query-ir/transaction-selection-inputs.md)
proposes that correspondence. The shared draft schema can describe its structural
Batch input, but this standalone operation refuses that operand. Transaction
List and Query support must each be advertised explicitly by the Batch contract;
these standalone capability details imply neither. Result/delivery, public
editions and continuation rules here are not imported into staged execution.

## Capability and safe dispatch

Proposed capability identity:
`https://github.com/gastownhall/bdp/capabilities/resource-selection`, version `"1"`.
Its detail is a closed object:

```json
{
  "operation": "https://work.example/acme/operations/read",
  "profiles": ["list", "graph", "query"],
  "sort": true,
  "count": true,
  "projection": true,
  "typeFamily": true,
  "pinnedReferences": true,
  "unboundedTraversal": true,
  "limits": {"requestBytes": 262144, "nodes": 4096, "nesting": 64}
}
```

The URL is discovered, absolute HTTP(S), without query/fragment, and served by the advertising Scope.
Clients never derive it from a Resource path. `profiles` is a nonempty unique
array containing `list` and optionally `graph` and/or `query`. Query includes the
nodes of List but does not force a separate Graph result capability. `sort`, `count`, `projection`, `typeFamily`, `pinnedReferences`, and
`unboundedTraversal` are required booleans. False means explicit refusal for that
requested feature, not omission of its clause. A List-only service can decline
sort, count, masks, family interpretation and exact-reference acquisition without
claiming them. Nominal exact Type tests and ordinary local predicates remain in
List. `pinnedReferences:true` is acquisition support, not a History advertisement:
exact application acquisition additionally requires the existing discovery
`historicalResolution` and its complete History contract in the relevant authority.
Family likewise requires both `typeFamily:true` and actual recorded authority.
`unboundedTraversal` must be false if neither
traversal profile is advertised. The positive integer limits count respectively
the complete UTF-8 request body, AST nodes, and AST nesting; whitespace counts
toward bytes, every tagged node and Boolean predicate counts as one node, and
the root selection is nesting one and each nested AST node increments it. Containers, literal JSON members and field
path segments are not AST nodes. Ordinary JSON/request limits still apply to
literal data. A walk trace pointer addresses its location in this complete body
(for example `/query/selection`), not a client source-text offset. These example numbers are not protocol defaults or performance
promises. Optional nonnegative `maximumDepth` bounds finite traversal requests;
it does not reinterpret an admitted `unbounded` request as that finite depth.
Operational work and result budgets may still cause an explicit refusal.

Point projection is separately advertised by
`https://github.com/gastownhall/bdp/capabilities/resource-projection`, exact version
`"1"`, with closed detail `{current:true, exact:BOOLEAN}`. It needs no List endpoint
or AST implementation. `exact:true` additionally requires actual complete
application History; it does not advertise or weaken History itself. List/Query
`projection:true` and this point capability use exactly the same mask semantics,
without requiring a provider to offer both operations. Base clients may ignore
these optional capabilities; their absence preserves the existing Core Selector,
full point reads and native views.

Initial requests use:

```text
POST DISCOVERED_OPERATION?readVersion=1&operation=list
POST DISCOVERED_OPERATION?readVersion=1&operation=query
```

Both are read-only: no Resource, revision, idempotency key, Event or persistent
registration is created. Temporary snapshot/cursor state is ordinary read state.
Use the selected v0.1 JSON media type in Content-Type and Accept. The complete
closed body is `{query: AST, sort?: SORT, limit?: POSITIVE_INTEGER}`. The AST's
`profile` is `list` for List; Query accepts `graph` or `query`. The `operation=query` route is the transport multiplexer for both advertised
Graph and general Query subsets. A service with only `profiles:["list","graph"]`
accepts that route with a Graph-profile body and refuses general Query bodies;
accepting the route does not advertise the general Query subset. A graph result
additionally requires the advertised `graph` profile, even when its AST says
`profile:"query"`. The AST's existing
`ir:"bdp-query-design-1"` is the draft encoding selected by capability version 1,
not another protocol version. Before adoption it needs an immutable released name.

Authenticate and apply ordinary nondisclosure/request bounds, then dispatch on the
once-only nonempty `readVersion`. Missing, repeated, empty or malformed selectors,
unknown `operation`, and extra query/body members refuse. A well-formed unsupported
version uses `capability-not-supported`; it is never interpreted as version 1.
Version 1's body must match the entire schema before execution, including branches
that could short-circuit. Unsupported shape/profile/required acquisition refuses;
the service does not delete clauses or silently fall back to client enumeration.

`limit` applies only to Resource results and is a positive per-page upper bound,
using ordinary advertised page bounds. Omission uses the service's bounded default.
It is not traversal depth, a work budget or a total delivery cap. Count and graph
requests reject it. A Resource page may be evaluated incrementally within a stable read context.
Before emitting it, the provider must establish every returned member's match,
its stable place in the selected order, and an exact boundary covering all
unexamined tail work in the issued continuation. It need not materialize every
future match first. Skipping an unresolved candidate, inventing a negative test,
or emitting traversal results before their final ordering is known is forbidden.
Count and graph require complete evaluation of their whole requested result.
Any/all conclusions require the proof/exhaustion described by Query.

A work cutoff without a valid resumable page boundary fails rather than yielding
false exhaustion or a guessed continuation. A valid intentionally bounded page
with an exact native continuation is ordinary paging, not a claim that the whole
selection has been exhausted. Later pages can fail explicitly under the shared
read contract; an earlier page does not promise future availability.

## Point reads and field selection

For the separately advertised point-projection capability/version, a Resource
GET/HEAD accepts once-only
`readVersion=1` and optional `fields=ENCODED_JSON_OBJECT`. `fields` contains the
existing nonempty `include` and/or `omit` arrays, with RFC 6901 pointers. Ordinary
form-query decoding occurs once, followed by JSON decoding. Duplicate JSON object
keys refuse; literal plus must be encoded `%2B`. The same object is the AST's
`projection` on List/Query. `readVersion` without `fields` is a full point read under that selected capability.
A current request needs `current:true`; an exact request also needs `exact:true`
and actual History. Unsupported selection uses the same feature-local refusal
with the point-projection capability identity.

Only current full Resource reads and exact `revision=TOKEN` full Resource reads
admit these parameters initially. Properties view, incident view, included-Link
aggregate, Versions, Events and Type inventories retain their own parameters and
representations. This explicitly amends exact History's revision-only query rule
for these two projection parameters, not its authorization or retention rules.
An unsupported server rejects the new query members; it cannot mistake them for
successful full-content service projection. An unsupported projection is an error,
not a local display-only fallback.

A successful projected Resource retains identity, actual Type and revision, plus
whole endpoint References on a Link. Its outer HTTP field
`BDP-Projection` contains the compact JSON mask object actually applied. A full
response has no such field. The field is used only on these point GET/HEAD responses, never redundantly on
List/Query wrappers. It is representation metadata, not a Resource property or a grant to reconstruct omitted content. Expose it under ordinary CORS
rules. Masks must also fit ordinary request-target and response-header bounds;
refuse before output if their required metadata cannot be carried intact. Never
truncate a mask header. Representation validators cover the actual authorized representation;
neither the service nor client manufactures ETags from Resource revisions.
GET and same-edition List item use identical projection semantics. Unknown optional
fields are no-ops, with advisory diagnostics only where the common rules allow.

`properties`, `metadata`, provenance and owned-state may be absent because of a
mask. The binding therefore requires explicit projected record/item schema arms;
held full/stored-record schemas must not be globally loosened. The applied mask
is carried by this operation's response or the point response's HTTP metadata.
Full responses continue to satisfy their complete native record contract.

## One sort field

`sort` is `{path: RFC6901_POINTER, direction:"asc"|"desc"}`. Omission preserves
the authority's advertised inventory order; composed Query results use canonical
identity, then concrete revision token, as their total order. A service advertising
`sort:false` refuses an explicit sort. Sorting happens on original selected content
before projection, paging and delivery. No group-by, compound user sort or locale
collation is introduced. CLI shorthand is `--sort POINTER [--descending]`.

The proposed initial value order is scalar and exact: null, booleans (false first),
numbers, then strings. Numeric comparison uses the shared interoperable numeric
domain; strings compare Unicode scalar values without normalization/case folding.
Descending reverses those scalar values. Missing paths and nonscalar values
(arrays/objects) share a final unsortable bucket in both directions; members of
that bucket use the ordinary identity/revision tie-break. No object serialization
or array ordering is implied. Equal scalar keys likewise use canonical identity
then revision token ascending, independently of requested direction. An empty
pointer selects Resource objects, so all members enter that final bucket. This
proposed total rule avoids an all-candidate preflight merely to discover an
unexpected object in an optional field. Missing on every candidate is valid and
uses the tie-break. Field/path spelling is case-sensitive even on insensitive databases.

Count accepts a valid mask and sort from an otherwise identical request, validates
their supported syntax/capability, then ignores them for counting. It need not
acquire omitted or sort-only fields. Graph rejects sort and Resource masks: mixed
component mask syntax is deferred, and complete protected graph content is the
initial representation. These restrictions are explicit admission rules.

## Resource, count and graph results

All successful initial responses use HTTP 200 and selected v0.1 JSON, a closed
wrapper `{result: VALUE, evaluation: EVALUATION}`. The result is one of:

| Requested form | VALUE |
| --- | --- |
| resources | `{form:"resources", resourceKind:"bead"|"link", items:[RESOURCE...], next:ABSOLUTE_URL_OR_NULL, projection?:MASK}` |
| count | `{form:"count", resourceKind:"bead"|"link", count:NONNEGATIVE_INTEGER}` |
| graph | `{form:"graph", roots:[EDITION...], beads:[FULL_BEAD...], links:[FULL_LINK...], endpoints:[MAPPING...]}` |

An edition is `{id:CANONICAL_URI,revision:OPAQUE_TOKEN}`. A graph endpoint mapping
is `{link:EDITION,source:EDITION,target:EDITION}`. Supply exactly one mapping per
represented Link edition; both endpoint editions and every root must exist in
`beads`. Dedupe each component by edition, retain parallel Link identities, preserve
authored References, and never rewrite a floating Link endpoint into a stored pin.
The mapping tells a consumer which Bead editions the read selected. Its endpoint
identity must equal that Link's stored endpoint identity; a stored pin must also
equal the mapped revision. Strict acquisition rules apply; no phantom Bead stubs.
Components are ordered by identity/revision for deterministic transport; this is
not path order. Graph is atomic and unpaged initially. It either fits operational
bounds and returns the complete requested graph or refuses without graph data.

Count is the exact distinct selected edition count before paging. It is not page
length, path count or a graph-component count. A JSON integer outside the shared
interoperable number range refuses rather than rounding. A count has no cursor,
projection or Resource body. No partial/estimated count is emitted as success.

`evaluation` is `{scope:"response", complete:true, traversals:[TRACE...]}`.
It describes semantic evaluation supporting this response: every represented
member and this page's selected-order boundary, or the entire atomic graph/count.
It does not claim that a Resource continuation's tail has already been evaluated,
that delivery is exhausted, unlimited depth, or exhaustive quantifier input. Each executed
walk AST location has one aggregate trace:
`{at:JSON_POINTER_TO_WALK,depth:INTEGER_OR_UNBOUNDED,completion:"exhausted"|"depth"|"proof",closure:"complete"|"not-complete"|"unknown"}`.
`depth` is the requested semantic bound (default one), not an observed maximum;
it is constant across invocations of that AST node. All invocations executed for
this response contribute to its one trace. `proof` means at
least one invocation stopped after a definitive quantifier answer; otherwise
`depth` means at least one stopped at the semantic depth, and `exhausted` means
all relevant invocations exhausted. `closure:"complete"` needs established full
closure for every executed invocation, `"not-complete"` needs a known reachable
eligible frontier on at least one, otherwise use `"unknown"`. No extra acquisition
is required just to distinguish known frontier from unknown. Empty traversal lists
are valid. Skipped nodes have no trace. Sort traces by their AST pointer.

This reporting is outside the expression language. A depth-bounded success is
complete for its requested depth. A cutoff before the response's required proofs
and boundary are established is a failure, not `complete:false` success. Early witness/counterexample proofs
follow Query's explicit fail-fast proposal. That policy still needs Donna's review.

The operation response carries owning `service-desc`, identifying the responding
Scope/read context. Resource results also carry actual `BDP-Collection-Kind`,
including empty pages. Count and graph do not carry a fake collection-kind or
point-kind header; their wrappers declare component kinds. They do not confer
mutation authority over foreign returned identities.

## Continuation and delivery are separate

Resource `next` is an absolute GET continuation issued by the service. Its closed
query contains once-only `readVersion=1`, a nonempty opaque `cursor`, and optional
positive `limit`. The issuer may omit limit initially; clients may append it.
The operation selector is retained in cursor state, not resent as `operation`.
Every successful continuation uses the same result/evaluation wrapper as page one;
its response-scoped traces describe work supporting that page, not a replay or a
merged trace for other pages. An already materialized page may have no new walks. It retains
the selection, result kind, authorization fence, read context, selected capability,
sort and projection. Do not resubmit/reparse the original expression, refresh Type
authority or current References, inspect cursor internals, or restart after expiry.
Only its per-page `limit` may be replaced/appended under ordinary read delivery.
The initial POST body and subsequent GET query use the same name for this one
per-fetch control; CLI `--page-size` lowers to it, while CLI total `--limit`
remains a client delivery budget.
All other URL bytes/context remain intact. The endpoint must reject query members outside that closed continuation grammar; GET without a valid issued cursor cannot execute a fresh POST query.

Projection is frozen for these native continuations. Human rendering can change,
but changing transferred fields requires a new initial request. This is a proposed
new-capability restriction: it does not pretend that the older CLI display-mask
continuation rule provided native projection changes. The CLI rejects new semantic
flags with `--continue`, including mask/sort/request/expression inputs.

Page boundaries and total CLI delivery limits reuse ordinary read delivery. Short
or empty pages with nonnull next are not exhaustion; a provider must make progress.
Never trim an overfetched tail and publish a cursor beyond undisplayed records.
Finite JSON/JSONL framing and handled delivery failures reuse the common schema-2
CLI contract. A failed later page may preserve earlier delivered data and the last
exact boundary; it is not a successful partial evaluator answer. Graph/count are
one finite value; JSONL may frame that single value, not invent component paging.

POST itself does not admit HEAD or conditional GET controls in this first binding.
Issued GET continuation validators describe that one page representation. Normal
point GET/HEAD retain their native HTTP behavior. No operation-wrapper validator
is treated as a Resource revision or a global multi-page validator.

## Refusals and security

Failures use the inherited Problem media type/fields plus these proposed feature
codes. They contain no successful result or guessed partial count. Authentication,
authorized visibility, retention and unknown-Resource nondisclosure retain priority.

| HTTP | Code | Retry / meaning |
| --- | --- | --- |
| 400 | invalid-parameter | never; malformed transport/AST, unbound name, incompatible operand category/kind, unsupported operator combination |
| 413 | request-too-large | never; encoded request exceeds admitted bytes |
| 422 | capability-not-supported | after-state-change; selected version/profile/feature or required History/family/incidence support unavailable |
| 413 | limit-exceeded | never for unchanged request; work/result capacity or required point projection-header capacity exhausted |
| 404 | resource-not-found | after-state-change; uniform required missing/hidden explicit Resource or endpoint |
| 409 | foreign-view | after-state-change; cursor belongs to another authorization context |
| 410 | cursor-expired | after-state-change; retained continuation is unavailable |
| 503 | temporarily-unavailable | after-delay; temporary provider/I/O failure |

A `capability-not-supported` Problem MUST include `capability` and
`capabilityVersion`: the capability URI and selected advertised version whose
admission rule refused the request. For this resource-selection proposal the
version is `"1"`; the member does not name a requested unsupported version. It MAY
include `at`, a JSON Pointer into the request body, for a nonsensitive input
diagnosis. The code uses its feature-local 422 schema arm. Other code, status and
retry mappings above reuse the held Read Problem meanings. A
`resource-not-found` Problem MUST NOT include `at`. Unknown/hidden data failures
must not identify which undisclosed endpoint, field or branch exists. Malformed JSON and
duplicate keys use the inherited malformed-request diagnosis. HTTP 401/403,
negotiation and rate-limit rules remain inherited; 406 is bodyless as before.

A heterogeneous optional value that fails a defined typed test is not a malformed
query. For example, comparing a string field to a numeric literal uses the shared
value rules; an endpoint operation on a statically Bead-valued binding is a kind
error. Do not let a provider's coercion or exception behavior pick this boundary.

A syntactically valid historical root or noncurrent intermediate that needs
unsupported incidence uses `capability-not-supported`, including when discovered
only during execution. A pinned endpoint whose body is required uses the same
code when exact acquisition/History support is absent. Known missing/erased or
hidden state under otherwise supported acquisition follows the inherited uniform
read/History diagnosis, never a substituted current body. An unavailable family
mechanism uses `capability-not-supported`; temporary failure of an otherwise
supported authority uses `temporarily-unavailable`. Exact History and its actual
retention diagnoses are unchanged.

Compile identifiers and field paths through trusted schema/identifier handling.
Bind literal values as provider parameters. Never interpolate CLI/AST strings as
SQL, permit arbitrary functions, or infer authorization from a cursor. Cache keys
include the contract/capability, normalized logical request, Type interpretation
authority and authorization/read context; an AST hash alone is insufficient.

## Adoption and verification

The paired [design schema and examples](../../../docs/cli-design/query-ir/EXAMPLES.md)
cover AST structure. Native request/result candidates are separate from held
full/stored record schemas. Adoption needs capability/detail/Problem/response
schema incorporation, projected record arms, native JSON media binding, browser
header exposure and renderer descriptor registration. Keep the old bounded
Selector available; structured List and Query do not reinterpret it.

Required tests include empty kinds, exact count before paging, include/omit on
current/exact GET and List, sort/missing/type errors, through versus where, cycles,
parallel identities, shorter-route expansion, nested correlation, current/pinned
endpoint mappings, unknown/hidden failures, unsupported feature admission,
native continuation resizing/frozen projection, expiry, and work-budget refusal.
Static schema tests, an SQL spike and product command benchmarks provide different
evidence. None alone proves a complete CLI/HTTP/provider implementation.
