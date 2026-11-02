> Historical source snapshot from main `692d801231c78e12b456d8c5213bdf137a6b534d`. This text is preserved for provenance; it is not the current specification.

# Resource selection and graph queries

**Status: JSON AST selected for implementation, October 28, 2026.** Donna chose
this representation as the immediate BDP and CLI format. Clients can send the
JSON AST directly while human expression syntax is deferred. The logical
encoding and List/Graph/Query subsets below are the implementation target.
This selection does not advertise an installed service, upgrade an existing
service's Core binding, or establish implementation qualification. Remaining
author-proposed policies are identified where they occur.

This is the semantic source for the companion [complete CLI surface](../../../docs/cli-design/query-language.md),
[proposed native binding](read-operations.md), [CLI and IR explanation](../../../docs/cli-design/query-ir.md),
[design schema](../../../docs/cli-design/query-ir/query.schema.json), and
[authored cases](../../../docs/cli-design/query-ir/cases.json). The schema covers
logical requests only; scope binding, transport, delivery, and response framing
reuse the applicable shared contracts once the integration points are selected.

## Selected representation and semantics

Donna selected a complete, small JSON AST as the starting representation. Clients
parse surface syntax and expand conveniences. Services independently admit the
request, establish the read context, optimize, and lower it to their provider.
Provider SQL, physical plans, and trusted client type annotations are not wire
requirements. A service can evaluate residual operations where its backend does
not support equivalent pushdown.

The selected semantics are:

- List selects Beads or Links using candidate-local conditions, with nominal Type
  affiliation explicitly available. Query can acquire related Resources.
- Incoming, outgoing, and connected traversal accept one or multiple Bead roots,
  default to depth one, and return distinct traversed Link editions. Explicit
  unbounded traversal requests the complete reachable closure.
- A traversal's `through` predicate restricts the Links it can follow and collect.
  An outer `where` filters its result without pruning traversal.
- Predicates visibly declare bindings. Named outer bindings are available in
  nested predicates. Lexical shadowing is allowed; there is no implicit `item`.
- Prefix `any` and `all` are quantifier special forms. `any` may omit its test;
  `all` requires one. Empty input makes `any` false and `all` true.
- Link endpoint navigation acquires the selected Bead. Collection navigation
  returns distinct endpoint Bead editions. An explicit `resolve()` is unnecessary.
- Resource equality is edition equality. `id()` returns canonical identity and
  `rev()` the concrete selected revision. Floating inputs select current content
  within the read context; no `current` selector sentinel replaces the actual
  revision token. An opaque exact token may itself have the literal spelling
  `current`, without becoming a floating instruction.
- Ordinary results are Resource collections or explicit graphs. Exact count is
  a service result mode shared by List and Query. Scalar top-level evaluation,
  computed records, and `select` are deferred.

The encoding uses tagged JSON nodes with an `op` member. This is an AST
discriminator, not a new Resource property or a replacement for Bead/Link Types.
Requests declare `ir: "bdp-query-design-1"`, a `profile`, a `selection`, and a
`result.form`. That design identifier MUST NOT be advertised as a released BDP
version. A service selecting this initial encoding binds its exact source and
supported capabilities; future representation changes require explicit version
selection rather than changing the meaning of existing requests.
Here `profile` denotes an admitted AST subset; it does not change the native
Core/Write discovery profile literal. Capability URI/version selection still
requires the explicit discovery integration listed below.

## Collections and bindings

Every collection expression denotes Resource editions. Initial proposed nodes:

| Node | Meaning |
| --- | --- |
| `scan` | Current Bead or Link inventory in the established Scope/read context |
| `refs` | Select explicit native References, asserting Bead or Link kind |
| `filter` | Return input members whose predicate is true under its declared binding |
| `walk` | Traverse eligible Links from Bead roots; return distinct Link editions |
| `endpoints` | Acquire source or target Beads from a Link collection; deduplicate editions |

`refs` is a draft AST convenience, not a general native multi-GET endpoint. Wire
References use the shared URI/string-or-pinned-object shape. The CLI resolves its
quoted relative Reference literals against the selected Scope and uses the
shared ordinal/token rules where those are actually supported. It MUST NOT
manufacture a revision from a string suffix or introduce an ordinal wire token.
Every supplied Reference must resolve to an authorized Resource of the asserted
kind. Missing and authorization-hidden identities use the same inherited uniform
unknown-Resource outcome; do not drop failed roots and return partial success.
An empty supplied array is a genuinely empty selection. A pinned `refs` entry
requires actual advertised exact application History support and its retention,
body, authorization and Reference-closure checks. No capability is inferred from
the AST shape or the existence of a stored token.

A binding names one member, not its whole input collection. A `filter` binding is
visible only in its predicate. A `walk` binding is visible only in `through`.
Quantifier bindings are visible only in their test. An inner binding of the same
name shadows the outer binding in that region. Inputs and roots are evaluated in
the enclosing environment, before the new member binding is introduced. Unknown
or forward names refuse. The surface parser rejects duplicate declarations in
one scope; each AST node declares at most one name, so that case is not separately
expressible in this encoding.

CLI syntax can introduce a single alias used by both a traversal restriction and
its outer selection. Lowering may repeat that name in the separate `walk` and
`filter` binder fields. Those occurrences denote the corresponding prospective
and collected Link editions; neither creates a second alias visible alongside
the first. Alpha-renaming a bound variable preserves the answer.

### Transaction selection from prior bindings

Donna selected a later Batch List filtering a previously captured typed set,
and Query using prior scalar identities or typed sets as explicit inputs. Those
selections see earlier staged writes under the Batch's serializable logical
execution rule. A capture fixes identity membership, not a snapshot of its bodies;
later selections inspect then-current staged content. Read-only batches are
allowed. Transaction List/Query capabilities are independently advertised.

The [selection-input reconciliation](../../../docs/cli-design/query-ir/transaction-selection-inputs.md)
proposes `refs.references:{binding:NAME}` for those prior inputs. It keeps the
asserted Bead/Link kind and ordinary lexical query aliases separate from Batch
names. Transaction List admits a prior typed set as its source with local-only
conditions; standalone List remains inventory-based. Query accepts a prior scalar
or set, and `walk` still requires Bead roots. Exact grammar, the structural union
and conservative admission restrictions are author proposals, not adopted wire.

This first transaction slice is current-staged only: no historical acquisition,
unpublished-revision tests or cross-Scope acquisition/mutation. A Link can retain
an opaque external endpoint under ordinary Type rules without acquiring it.
Batch owns identity capture, lifecycle outcomes, revision publication and replay;
it does not manufacture public editions for intermediate staged states.
The companion standalone read binding does not accept Batch operands or
turn its resource-edition result into a transaction identity capture.

## Predicates and values

The initial predicate nodes are JSON booleans, `and`, `or`, `not`, `compare`,
`present`, `contains`, `member`, `typeIs`, `any`, and `all`. Boolean groups use
nonempty operand lists in this encoding; clients simplify an empty group to its
Boolean identity before emission. Admission checks the entire AST, including
branches a particular execution might short-circuit.

Value expressions are `literal`, `field`, `id`, and `rev`. Resource expressions
are `binding` and `endpoint`. A field path uses literal string object keys and
nonnegative integer array indexes; no executable path or wildcard syntax is
implied. `literal` can carry JSON comparison data. It does not construct a new
computed result record. Number/string coercion is absent.

| Test on an absent field against a literal | Result |
| --- | --- |
| Equality, including equality to null | false |
| Inequality, including inequality to null | true |
| Ordering | false |
| Literal contains or exact membership | false |
| Physical presence | false |

Present null, false, and empty values are physically present. Two absent singular
paths compare equal, following the selected JSONPath-compatible comparison rule;
List's literal right operands avoid that case. These are value semantics, not a
third Boolean or a successful answer to an unavailable read. Malformed operations,
unsupported capabilities, and required acquisition failures remain failures.

Inventory scans enumerate only the request's Authorization View. An authorized
Link may still carry a Reference whose target the caller cannot read. A required
endpoint acquisition then uses the same uniform unknown-Resource outcome as a
missing target, without disclosing whether the identity exists or is hidden.
It does not become an absent `status` field or a successful negative finding.
The selected unavailable-content rule applies whenever that content is needed
to determine the answer. This is distinct from a hidden Link never entering the
input collection in the first place.

`compare` with two Resources admits equality/inequality and compares canonical
identity plus concrete selected revision. It does not compare their JSON bodies.
Resource-to-string and Resource-to-raw-Reference comparison refuse rather than
coerce. Callers compare explicit identities or revisions when needed. Stored
Reference tests retain the shared Reference-union/pin rules; `endpoint` means
selected Resource acquisition, not inspection of how a Reference was authored.

Other comparisons preserve the shared JSONPath-compatible value rules. Arrays
and objects use structural JSON equality; ordering is admitted for comparable
numbers or strings. No implicit timestamp parser is added: temporal comparison
requires a separately declared normalization/contract. Unicode strings receive
no implicit normalization or case folding. Literal `contains` is case-sensitive
and has no SQL wildcard or regular-expression interpretation. Missing/null/non-
string operands do not satisfy contains. Exact membership tests an array element;
missing/null/non-array collections do not satisfy it. JSON null and booleans are
not numbers. Exact numeric/interoperability limits remain governed by the shared
JSON admission rules rather than host-language coercion.
`id` and `rev` both return strings, so comparing their returned values is ordinary
string comparison; they do not introduce extra implicit nominal scalar domains.

`typeIs` resolves a nominal Type identity and requests exact or family matching.
The operand is an unpinned absolute nominal Type identity. Exact matching compares
that URI to the declared affiliation URI, extracting `.uri` from a pinned Type
Reference and ignoring its definition revision. It does not select an exact
definition version. A raw `field` path to `type`, like `source` or `target`, sees
the stored Reference union rather than a flattened or dereferenced value.
Family is reflexive: it includes the named nominal Type itself and its recorded
refinements under the authoritative interpretation rules. Required family
authority is still checked; reflexivity is not an exact-only fallback. Missing family authority refuses; there is no exact-only fallback.

## Traversal

`walk` has Bead roots, a direction (`incoming`, `outgoing`, or `connected`), and
an optional depth. Absence means one. A nonnegative integer bounds Link hops;
`"unbounded"` removes that semantic bound. It does not remove work budgets.
Depth zero returns no Links. Graph result formation still retains explicit roots.
The initial walk candidate admits only current Bead roots. Known pinned root
operands refuse pending an edition-aware incidence capability; a computed root
that selects noncurrent content likewise refuses before expansion. This is an
explicit author-proposed first-slice restriction, not a ban on later historical
traversal. Exact `refs` reads and pinned endpoint navigation still use their
qualified History contract. Neither pin spelling nor a successful historical
body read invents a historical Link population.

**Author-proposed incidence rule:** a walk starts from selected Bead editions,
not bare identity strings. The matched endpoint must be applicable to that edition:
a pinned endpoint matches the same identity and exact selected revision; a
floating endpoint matches the checked current edition for that identity in the
read context. Thus incoming traversal from current P@r2 excludes a Link targeting
P@r1, while a floating target P matches. The same rule applies to source matching
for outgoing and either matched side for connected. A self-Link is eligible if
an endpoint on the requested side matches; collect its edition once.

A quoted bare root such as `"P"` selects current content through `refs`, so it
uses current-edition applicability. This deliberately differs from the existing
Link List bare-ID identity filter. Use stored-Reference identity predicates for
that inventory question; a current walk does not erase endpoint pins. This choice
needs Donna's review alongside the current-only incidence restriction.

At each reached Bead, inspect incident Links in the requested direction. Evaluate
`through`, if supplied, on the actual prospective Link edition. False excludes
that Link from both collection and traversal. True admits the Link and permits
expansion through its opposite endpoint, subject to depth and read rules. The
authored source/target orientation never changes. For connected traversal, the
Link's source/target fields retain their ordinary meanings; this draft invents
no context-dependent `neighbor` field.

Depth is measured from the nearest admitted root along eligible steps. Expand
Beads reached at fewer than the requested maximum hops. Collect admitted Links
encountered by those expansions, including back Links, self-Links, and parallel
Links. Do not add every Link between reached boundary Beads. A later shorter
route MUST permit the expansions a prematurely recorded longer route would hide.
Records deduplicate by canonical identity plus selected revision. Distinct Link
identities remain distinct for the same endpoint pair. Enumeration order is not
a path count or a statement of ownership.

A Link-only one-hop result can retain an opaque endpoint Reference without
acquiring its body, if neither `through` nor result selection needs it. Expanding
that endpoint at a deeper hop requires supported, authorized acquisition; if that
cannot be established, the initial candidate refuses rather than treating it as
an exhausted branch. Explicit `endpoint`/`endpoints` and graph formation require
their selected Bead content and likewise refuse when it is unavailable. An opaque
stub/frontier graph representation is a possible later extension, not implicit
partial success in this first slice.

The same historical-incidence boundary applies at an intermediate endpoint.
A current Link may target a retained noncurrent Bead edition. A one-hop result
can retain that Link and, where supported, acquire the pinned endpoint content.
Expanding from that noncurrent edition requires edition-aware incidence, which
the initial candidate does not advertise. If another hop is required, refuse;
do not silently substitute that identity's current adjacency. A stored pin is
not a license to invent a historical Link population.

Operational algorithms may use visited tables, recursive SQL, provider graph
operations, or another equivalent implementation. A finite authorized graph with
cycles does not imply infinite enumeration. Foreign-scope expansion, opaque
external endpoints, and pin resolution require explicit provider capability;
unsupported required content refuses without silently becoming an empty result.
Acquisition obeys the shared disclosure policy and MUST NOT reveal hidden
Resources through newly specific failure messages.

An outer filter applies after the logical walk. For example, traversing Requires
and returning only Links to draft Beads can pass through non-draft intermediate
Beads. A planner may push tests down only when doing so preserves that answer.

## Quantifiers and completeness

`any` returns true if at least one member passes its test; an omitted test is
true and declares no unused quantifier binding. A supplied `any` test and its
binding occur together. A traversal's separate `through` binding remains local
to that restriction. `all` returns true if every member passes its required test. The AST
contains input, binder, and test directly. It does not first filter the input and
then universally quantify the surviving Resources.

| Finding | Definitive Boolean |
| --- | --- |
| A valid witness for `any` | true |
| A valid counterexample for `all` | false |
| Exhausted input, no `any` witness | false |
| Exhausted input, no `all` counterexample | true |

A bounded traversal defines a bounded collection. `all` of that collection makes
no claim about deeper connectivity. An unbounded universal check needs complete
relevant acquisition to establish true. An execution cutoff cannot become false
for `any` or true for `all`. Required unavailable data remains a failure whenever
it prevents the answer from being established. Valid definitive short-circuit
answers do not require unrelated enumeration to finish. Services MUST NOT make
arbitrary Boolean branch-order differences into conflicting successful answers.

**Author-proposed execution policy:** an evaluator may fail fast on a required
runtime acquisition error before it has established a definitive witness or
counterexample. It need not continue searching for another branch that might
prove the answer. If a valid witness/counterexample is established first, it is
definitive and unrelated unfinished acquisitions need not occur. Success versus
uniform refusal may therefore depend on executed work; conflicting successful
Booleans remain forbidden. This is an explicit policy proposal for review, not a
new selected ruling. Pre-execution syntax/type/capability admission and explicit
root assertions remain mandatory and are never bypassed by a later proof.

Completeness and termination reasons belong to evaluator/response reporting.
There is no language-level `unknown` Boolean, `complete()` predicate, or implicit
partial-count success. Being complete at depth two does not prove full closure;
the service reports deeper connectivity as unknown unless it has established
whether a frontier remains. The [native binding proposal](read-operations.md) supplies concrete carrier fields
and initially refuses evaluator cutoffs rather than returning successful partial
answers. Delivery of an already established selection can still stop at an exact
page boundary. These transport choices are review proposals, not new selected
human rulings or an installed exit-code contract.

## Results and projection

`resources` returns the selected Resource collection. `count` returns its exact
distinct edition count before paging; zero is the empty answer. Both List and
Query use this result mode. The evaluator can lower it directly to storage and
need not fetch Resource bodies. Projection does not change the count. An
unfinished count MUST NOT be reported as exact.
Count, graph closure, and quantifier completeness are relative to the request's
Authorization View and admitted read context, never a count of hidden inventory
members. Failure to acquire content required by a visible member's predicate
still follows the uniform unavailable-endpoint rule above.

`graph` forms a graph from an explicit walk: preserve roots, traversed Link
editions, and selected endpoint Bead editions. Isolated roots survive. Link
References, actual Types, identities, and selected revisions retain their shared
meaning. When multiple editions of one identity occur, graph context MUST identify
the selected endpoint editions for its Links without rewriting authored floating
References into stored pins. Exact mapping/carrier fields remain response work.
The initial candidate admits graph result only for a direct `walk`
selection; filtered graph/path/row results require a separately defined scope.
No graph count unit is silently selected.

Shared [Resource projection](resource-projection.md) applies to Resource results.
The initial native binding refuses masks on graphs; separately targeted Bead/Link
masks remain deferred. Sorting applies to full selected Resource data before projection
and delivery under the proposed one-pointer request-sort binding. Retained
Core's authority-advertised `order` remains its baseline; per-request sorting needs
an explicit protocol/discovery/carrier amendment. The AST schema does not assign
that common control a node: the native request wrapper carries it separately.
Shared paging/continuation rules apply through that binding, with issued native
continuations rather than client-invented cursors.

## Profiles: obvious structural subsets

These initial admission profiles are subsets of the same selected AST:

| Profile | Admitted shape |
| --- | --- |
| `list` | `scan`, optionally one local `filter`; Resource or count result |
| `graph` | `refs` Bead roots, one `walk`, optional single exact/family Link Type test, graph result |
| `query` | Composition of the admitted collection/predicate nodes; Resource, direct-walk graph, or count result |

List's filter has no endpoint acquisition, related-resource quantifiers, or
field-to-field comparisons. It admits the bounded Boolean/local predicate subset,
Type tests, local identity/revision extraction, and literal comparison operands.
Link endpoint URI flags can lower to comparisons over the stored Reference union
without acquiring Beads. List's collection remains current even if a predicate
compares its revision fields. Query reuses these exact nodes and meanings.
Exact membership admits both a literal element in a local array and a local
scalar in a literal array; field-to-field membership is outside this initial List
subset. The structured List profile is not the retained bounded Selector grammar.
Literal contains, array membership, and structured comparison literals may exceed
what that old carrier can express. They require the explicitly new predicate
carrier, not unadvertised functions/nested filters in `selector=`.
List `contains` requires a literal substring operand. A literal text searched for
a candidate-derived substring is outside this initial List subset; Query may
admit that richer local test. This asymmetry keeps ordinary field-search lowering
simple and does not change existing compatibility matching.

Graph-only support requires no arbitrary predicate parser or full Query support.
List and Graph are independently admitted subsets. A declared profile is checked
structurally before execution; it is not a hint allowing unsupported work to be
approximated. Negotiation and whether Graph gets a focused operation or carrier
remain open. The retained Core minimum still includes its bounded Selector;
this design does not remove that obligation or reinterpret existing Selector text.

## Integration and validation still required

The paired CLI/native proposals now specify the following incorporation work;
they do not change held front-door schemas automatically. Before adoption, owners
must reconcile:

1. Native request transport/discovery, contract/version identifiers, capability
   advertisement, profile bounds, and exact refusal codes.
2. Current collection and point-read projection parameters, projected record/item
   schema definitions, and validator behavior. Full-record/always-metadata/owned-
   state clauses and exact History's revision-only query need explicit amendments.
3. Result framing, graph component masks, ordering/value bounds, completeness and
   native continuation. Existing History/Events delivery is not replaced.
4. The proposed CLI command assertions, complete lexical grammar and lowering in
   [query-language.md](../../../docs/cli-design/query-language.md), with actual
   parser and compatibility-routing evidence.
5. Provider/reference implementation and positive/refusal conformance against the
   schema and authored cases. Schema checks and source snapshots do not establish
   CLI, HTTP, evaluator, or backend equivalence.

Edition-aware incidence against historical roots must be reconciled with the
shared endpoint-applicability rules before that capability is claimed. A current
Link inventory is not a historical Link population. Unsupported pin/context
combinations refuse; neither root spelling nor a broad current inventory scan
licenses a fabricated historical relationship graph.

JSONPath remains a useful semantic reference and a possible later predicate
encoding. A future version may add reviewed function extensions or another
representation. No executable strings, JSONPath callbacks, SQL, `select`, or
general record constructors are hidden inside this initial complete AST.
Collection-level union/intersection/difference and path results are also deferred.
