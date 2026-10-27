# Resource selection and graph queries: draft contract

**Status: focused design candidate, October 26, 2026.** This module records
Donna's selected read/query semantics and proposes a minimal complete JSON AST.
It does not amend a published contract, advertise a capability, assign a new
endpoint, replace the existing bounded JSONPath Selector, or claim installed
support. The exact node encoding and the initial profile rules are author
proposals. Requirements below specify this candidate when adopted.

This is the semantic source for the companion [CLI and IR explanation](../../../docs/cli-design/query-ir.md),
[design schema](../../../docs/cli-design/query-ir/query.schema.json), and
[authored cases](../../../docs/cli-design/query-ir/cases.json). The schema covers
logical requests only; scope binding, transport, delivery, and response framing
reuse the applicable shared contracts once the integration points are selected.

## Selected decisions and proposed encoding

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

The proposed encoding uses tagged JSON nodes with an `op` member. This is an AST
discriminator, not a new Resource property or a replacement for Bead/Link Types.
Requests declare `ir: "bdp-query-design-1"`, a `profile`, a `selection`, and a
`result.form`. That design identifier MUST NOT be advertised as a released BDP
version. Profile names and representation spellings remain reviewable.
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
Family includes refinements under the authoritative recorded interpretation
rules. Missing family authority refuses; there is no exact-only fallback.

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
whether a frontier remains. Exact carrier fields, partial Resource-delivery
policy, streaming failure framing, and work controls remain shared integration
work. This candidate does not silently adopt partial-answer success or an exit code.

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
Graphs require separately targeted Bead/Link masks; that mixed-carrier grammar is
still open. Sorting applies to full selected Resource data before projection and
delivery when the accepted one-pointer request-sort extension is bound. Retained
Core's authority-advertised `order` remains its baseline; per-request sorting needs
an explicit protocol/discovery/carrier amendment. This AST schema does not assign
that common control a wire member. Shared paging/continuation rules apply only through their declared
carrier; this draft assigns no private cursor, endpoint, or new result envelope.

## Profiles: obvious structural subsets

These initial admission profiles are author proposals over the same AST:

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

Before adoption, owners must reconcile:

1. Native request transport/discovery, contract/version identifiers, capability
   advertisement, profile bounds, and exact refusal codes.
2. Current collection and point-read projection parameters, projected record/item
   schema definitions, and validator behavior. Full-record/always-metadata/owned-
   state clauses and exact History's revision-only query need explicit amendments.
3. Result framing, graph component masks, ordering/value bounds, completeness and
   native continuation. Existing History/Events delivery is not replaced.
4. CLI command assertions for full expressions versus generated candidate filters,
   Type/field/reference lexical grammar, and complete source-to-AST lowering.
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
