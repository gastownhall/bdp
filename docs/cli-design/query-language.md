# Canonical read CLI and query language

**Complete surface candidate, October 26, 2026.** This is a review draft, not an
installed command reference. The [query contract](../../specs/profiles/core/query.md)
records the selected meanings. The exact flag grammar, keywords, and lowering
rules below are author proposals that make those meanings implementable. They
need parser tests and adoption before a client can advertise them.

The [portable AST](query-ir.md) carries the request to the service. The
[native binding](../../specs/profiles/core/read-operations.md) defines the
discovered List/Query operation and response proposals. The CLI parses
friendly text; the service checks the AST independently and chooses an execution
plan. Neither party needs to put SQL or a physical execution plan on the wire.
This candidate consistently spells the executable `bd`; inherited `bdp` examples
in older shared helpers are naming history, not another Reference grammar. The
shared entry owner reconciles those spellings.

The older [read reference](reads-and-paging.md) retains its bounded JSONPath
Selector route until this extension is adopted. `--selector` never silently
changes meaning or becomes a second spelling for this language.

## Choose the smallest command

| Command | Candidates or roots | Result |
| --- | --- | --- |
| `bd show REF` | One Resource, either kind | Its current or explicitly selected edition |
| `bd link show REF` | One Resource, asserting Link | That Link edition |
| `bd list` | Current Beads in the selected Scope | Matching Beads, or exact count |
| `bd link list` | Current Links; optional existing incidence selection | Matching Links, or exact count |
| `bd graph REF...` | One or more Bead roots | Roots, traversed Links, and endpoint Beads |
| `bd query EXPRESSION` | The collection expression | Resources, direct-walk graph, or exact count |
| `bd link query EXPRESSION` | The collection expression, asserting Link result | Links, or exact count |

Canonical List has no implicit Issue, open-status, or other domain filter. List
conditions inspect the candidate itself. Type-family membership is the deliberate
exception: it uses the authoritative Type interpretation. Link List can inspect
stored endpoint References, but cannot test an endpoint Bead's body or properties.
Query is the place for those reads and for traversal.

The first standalone structured List binding selects whole inventories. Existing positional
incidence and `--incident-to` remain on their established native Link-view route;
they do not combine with the new structured filter/file/count/sort controls in
this first slice. Such a combination refuses with a Query alternative rather
than silently dropping the incidence assertion or scanning on the client. For
example, `connected("csv-plan")` selects its direct incident Links after asserting
the root exists. Bare `--from`/`--to`/`--endpoint` are stored-Reference predicates
and can lower to the structured inventory filter without acquiring endpoint
bodies. Revision-applicable incident convenience needs a later explicit binding
to the shared checked-current context; it is not implied by URI equality.

Root Query can return either Beads or Links. Each initial expression has one
selected Resource kind; mixed collections need a later composition form. `link query`
asserts that its selected collection is Link-valued, even if empty. The service
checks that assertion from the expression's declared collection kinds, rather
than accepting an empty wrong-kind result by accident. A graph is mixed content,
so `bd link query --graph-result` refuses. This rule concerns result kind, not
whether an intermediate operation reads Beads.

These canonical commands coexist with product compatibility commands. Existing
`bd query` expressions, `bd sql`, Issue defaults, search flags, and Memory wrappers
need an explicit product routing decision; this proposal does not reinterpret
old arguments in place. A rollout must select a version/profile or otherwise
separate legacy syntax before enabling this candidate on those command names.

## List: small flags, one Boolean escape hatch

The first examples select only current Beads. Single quotes protect each argument
from the shell; double quotes inside it denote a JSON string.

```sh
bd list --property 'status = "draft"'
bd list --property 'status = "draft"' --metadata-field 'team = "export"'
bd list --property 'title contains "CSV"' --has-property body
bd list --property 'status in ["draft", "ratified"]' --type note
bd link list --property 'status != "retired"' --from csv-plan
```

Every supplied flag condition is ANDed with every other one. Repetition never
introduces an implicit OR, and flag order never changes the selection. To express
OR or NOT, supply one explicitly bound filter:

```sh
bd list --filter 'as b where b.status = "draft" or b.status = "ratified"'
bd list --filter 'as b where id(b) = "https://work.example/acme/csv-plan" or b.title contains "CSV"'
bd list --type note --filter 'as n where not (n.status = "retired")'
```

The filter declares its own alias, such as `b`. There is no automatic `item`,
`this`, or hidden subject. Parentheses group Boolean tests. `not` binds more
strongly than `and`, which binds more strongly than `or`.

| Flag | Exact meaning |
| --- | --- |
| `--property 'PATH OP JSON'` | Test the candidate's `properties` field at PATH |
| `--metadata-field 'PATH OP JSON'` | Test the candidate's `metadata` field at PATH |
| `--has-property PATH` | Test physical presence in `properties` |
| `--has-metadata-field PATH` | Test physical presence in `metadata` |
| `--filter 'as NAME where PREDICATE'` | Add one local Boolean predicate under NAME |
| `--filter-file FILE` | Read that same filter text from a UTF-8 file |
| `--type TYPE` | Family affiliation, including the named Type |
| `--exact-type TYPE` | Exact nominal Type identity; definition pins do not narrow it |
| `--from REF` / `--to REF` | Link List only: match the stored source/target identity regardless of pin; unpinned URI operands only |
| `--endpoint REF` | Link List only: match either stored endpoint identity regardless of pin |
| `--count-only` | Return the exact selected edition count before paging |

Property, metadata, and presence flags repeat. `--filter` and `--filter-file` are
single-use alternatives; an empty filter is an error. Each Type flag is single-use
in this first candidate; repetition refuses rather than taking the last value or
inventing a multi-Type union. Type flags retain their shared AND behavior when
supplied together. Bare `--type any` omits that one
condition; it does not add a union or mean an actual Type named `any`. Bare `--exact-type any` refuses, as in the shared reference. Use the canonical
absolute Type URI to name a literal Type whose local name is `any`; the flag-level
configured-name escape remains the shared owner's decision. Type-name resolution
uses that shared contract, not a second namespace search invented here.

`PATH` starts with a property key and can continue through object keys or array
indexes. `status` is one key; `owner.team` is two; `["owner.team"]` is a single key
containing a dot. A key can always be JSON-quoted in brackets. Indexes are
nonnegative decimal integers. This field path is not a JSON Pointer, JSONPath,
wildcard, or executable expression. Include/omit and sort continue to use their
separate shared JSON Pointer grammar.

Operators are `=`, `!=`, `<`, `<=`, `>`, `>=`, `contains`, and `in`. The right side
is exactly one JSON value. `contains` requires a string literal and means a
case-sensitive literal substring; it does not interpret `%`, `_`, `*`, or regex
syntax. `in` requires an array literal here. `has-property` distinguishes absent
from present null; equality to null does not match an absent field.

Literal membership in a candidate array is available through the explicit filter:

```sh
bd list --filter 'as b where "important" in b.tags'
bd list --property '["owner.team"] = "export"'
bd list --metadata-field 'reviewers[0].name = "Donna"'
```

Generated flags and an explicit filter lower to a single `filter(scan, ...)` AST
node. Use the explicit filter's alias when present, otherwise `_candidate`.
Generated predicates refer to that same alias. List has no nested binding forms,
so no textual alias replacement or hidden second name is needed. A supplied
Type restriction joins the same `and` group. No conditions
means a plain `scan`. The AST profile is `list`, with `resources` or `count` result.

In a transaction selection, Donna also selected a prior typed set as List's
candidate source. The [Batch input proposal](query-ir/transaction-selection-inputs.md)
uses `--candidates batch-ref::NAME` in member-emission mode, retaining the same
local predicate rules. Generated filters wrap that source rather than `scan`.
The earlier capture's membership is fixed; this later List tests its members'
then-current staged content. This does not add standalone ID-list input, endpoint
body tests or traversal to List. The exact flag and structural encoding remain
author proposals; the ordinary read result/count/paging controls do not belong
to a transaction selector envelope.

For a generated filter that is awkward to spell in flags, `bd list --request-file
FILE` accepts the same complete request shape as Query's JSON input. It requires
`profile: list`, a Bead `scan` with at most its admitted filter, and a Resource or
count result. `bd link list --request-file FILE` requires the Link scan instead.
The file cannot be combined with selection, incidence, result, or projection
flags: those semantics are already in the request. Ordinary Scope/delivery/output
controls remain separate. This reuses one schema instead of inventing a second
JSON predicate envelope. Graph's focused facade takes flags only; generated graph
AST requests can use root `bd query --request-file`.

Bead List refuses `--from`, `--to`, and `--endpoint`; use Link List to filter
stored endpoint References, or Query to select Beads through relationships.
List refuses endpoint navigation, nested quantifiers, traversals, and field-to-
field comparisons. For example, `b.owner = b.reviewer` belongs in Query even
though it could be tested without a Link. A filter file does not bypass this
admission rule. The generic flags intentionally omit domain-specific shortcuts
such as `--title` and `--ready`; a compatibility layer may lower those separately.

## Query inputs and common controls

Choose exactly one source:

```sh
bd query 'beads as b where b.status = "draft"'
bd query --expression-file draft-notes.query
bd query --request-file draft-notes.request.json
```

The positional argument is one complete collection expression. A second expression
or an extra positional Scope refuses; use `--scope` or the configured Scope. A
file is read once before dispatch as UTF-8. `-` means stdin. A command can have
only one stdin consumer, including other shared file-valued arguments.
`--expression-file` contains friendly text, without a command line or JSON string
wrapper. `--request-file` contains one complete AST request, including `ir`,
`profile`, `selection`, and `result`, validated against the selected design schema.
There is no automatic syntax detection or JSONPath fallback.

| Query option | Meaning and conflict rule |
| --- | --- |
| `--count-only` | Set outer result to `count`; conflicts with `--graph-result` |
| `--graph-result` | Form a graph from a direct walk; no outer selection filter |
| `--include POINTER`, `--omit POINTER` | Shared Resource projection; repeatable |
| `--sort POINTER`, `--descending` | One scalar sort field; descending requires sort |
| Shared paging, output, Scope controls | Their common meaning, subject to the selected result form |

Without a result option, friendly expressions return Resources. `--request-file`
sets semantic controls itself: it conflicts with `--count-only`, `--graph-result`,
Resource include/omit, and selection flags, even if values agree. Framing-only
`--omit envelope` remains a presentation control. Scope, authentication,
delivery, and presentation controls still use their common contracts; an AST is
not a way to inject another authority or private cursor. The outer request carrier
owns sort and delivery when those are not members of the AST. A complete request
with `profile: list` dispatches through native List; profiles `query` and `graph`
dispatch through native Query. A command's profile/kind assertions are checked first: List refuses a non-List
file. Only an admitted request is routed by profile. The command name does not
bypass profile admission.

The CLI rejects superfluous count controls: explicit Resource include/omit (excluding framing-only `--omit envelope`), sort/descending,
paged/unpaged, page-size, continuation, or item delivery limit with count refuses.
This is CLI admission, not a wire restriction: the native count request can retain
a valid mask and sort from an otherwise identical request, check their admitted
syntax/capability, and ignore them when counting. Counts do not inherit a
page's length. Graph count is not defined; `bd graph --count-only` refuses rather
than guessing whether to count roots, Beads, or Links. Graph component masks are
not defined in this first candidate, so graph plus include/omit refuses.

Continuation resumes the service-issued selection and read context. Query input
cannot accompany a continuation: it could silently create a new request. Semantic
filter, mask, and sort changes likewise refuse. This new operation freezes the
transferred projection; that explicitly supersedes an older display-only rule
that allowed masks to change when resuming. Use the shared continuation binding
with the matching command kind. No expression or file
is required when resuming. This candidate adds no private cursor grammar.

All modes reuse the shared output/framing contract; graph/count descriptor
registration remains an adoption requirement, not an installed claim. Graph/count
are finite single values, not component pages. Graph refuses item paging,
continuation, sort, and masks in this initial binding. Initial List/Query POSTs
refuse HEAD and conditional-GET flags; point reads retain their separate HTTP
controls. This document does not assign a new JSON schema version, add arbitrary
fields to Resources, or turn an incomplete result into a successful exact answer.

## Write a collection expression

Start with `beads` or `links` to scan current inventory. Add `as` to name one member
and `where` to keep members that pass a test:

```text
beads as b where b.status = "draft"
links as link where link is references
```

Explicit selection uses quoted References:

```text
beads("csv-plan", "csv-review")
links("csv-plan-format")
```

These call forms assert each supplied Resource's kind. They do not reinterpret
arbitrary string properties as References. Relative names, exact selectors, and
ordinal resolution use the shared CLI Reference parser. The compiler emits native
absolute References; it never sends a local ordinal as a portable revision token.
The compiler deduplicates equivalent canonical References after shared resolution,
preserving first occurrence, on both explicit selections and Graph roots. A floating
Reference and a pinned Reference remain different inputs even when current content
happens to match that pin; deduplication cannot remove a required History check. Exact
JSON Reference duplicates therefore never reach the wire's unique array. Distinct
selected revisions remain distinct. An empty `beads()` or `links()` denotes an
empty selection, not inventory. Missing
or unauthorized explicit entries fail uniformly rather than disappearing.

For emitted transaction Query only, the [input proposal](query-ir/transaction-selection-inputs.md)
recognizes a sole `"batch-ref::NAME"` in these explicit Reference positions,
including quoted-root shorthand. A prior scalar identity or typed set becomes
the proposed structural `refs` binding source; Bead/Link assertions still apply.
A scalar external argument resolves to an ordinary Reference during assembly.
Query aliases remain lexical, and property/literal strings are never substituted.
Standalone execution refuses Batch references. Current-staged/history/scope
restrictions come from the transaction selector contract, not the ordinary
standalone exact-read rules.

The functions below return existing Resources, never new computed records:

| Form | What it returns |
| --- | --- |
| `beads`, `links` | Current inventory members |
| `beads(REF, ...)`, `links(REF, ...)` | Explicitly selected Resources |
| `outgoing(ROOTS, depth: D)` | Distinct Links followed in their authored direction |
| `incoming(ROOTS, depth: D)` | Distinct Links followed against their authored direction |
| `connected(ROOTS, depth: D)` | Distinct Links followed in either direction |
| `COLLECTION.source`, `COLLECTION.target` | Distinct endpoint Bead editions |
| `COLLECTION as NAME where P` | The members that pass P |

A root argument can be a quoted Reference, a Bead binding, or a Bead collection.
A quoted root is shorthand for singleton `beads(REF)`. Parentheses group a composed
collection before navigation or use as a root. Depth defaults to one, accepts a
nonnegative integer, or accepts `unbounded`. The initial candidate refuses
historical traversal roots; reading an exact edition alone does not establish a
historical incidence graph.

## Separate the route from the answer

`through` determines which Links a walk can follow. `where` chooses among its
results. Both clauses use the same declared alias:

```sh
bd query 'outgoing("csv-plan", depth: 2) as link through link is references where link.status = "draft"'
```

The walk can cross an active Reference Link and later return a draft Link. Putting
the status test in `through` would prevent crossing the active Link at all. A
query planner can optimize these operations only while preserving that meaning.
`through` is available only directly on a traversal, comes before `where`, and
requires `as NAME`. A filter on any other collection uses `as NAME where P`.
A bare `as NAME` with no clause is rejected because it has no scope in which the
name could be used.

A walk returns Links. Navigate to their targets when those are the desired result:

```sh
bd query '(outgoing("csv-plan", depth: 2) as link through link is references).target as note where note.status = "ratified"'
```

Cycles stop repeated expansion without discarding their actual Links. Different
Link IDs between the same endpoints stay different. Reaching the same Bead by
several routes does not duplicate its selected edition. These are Resource sets,
not paths or counts of how many ways a Resource can be reached.

## Bind fields explicitly

A binding names one Resource. `b.status` abbreviates
`b.properties["status"]`. The following names have structural meanings instead:

| Access | Meaning |
| --- | --- |
| `b.properties` | The properties object; continue with ordinary keys/indexes |
| `b.metadata` | The metadata object; continue with ordinary keys/indexes |
| `b.type` | The actual stored Type Reference, not an acquired Type definition |
| `b.revisionProvenance`, `b.ownedLinks`, `b.links` | The corresponding represented native plane, if present |
| `link.source`, `link.target` | Acquire that endpoint Bead; its properties are then accessible |
| `id(b)`, `rev(b)` | Canonical identity and concrete selected revision strings |

`b.id` and `b.revision` are reserved diagnostics: write `id(b)`/`rev(b)` for
Resource context or `b.properties.id`/`b.properties.revision` for ordinary data.
Property names that collide with another structural name use explicit
`properties`, for example `b.properties.type` or `b.properties["source"]`.
Bracket access immediately after a Resource binding is property access:
`b["a.b"]` means the property key `a.b`, not two keys. After `properties` or
`metadata`, brackets are ordinary literal object/array steps.

Use `link.properties.source` to inspect a Link property named source. The AST can express raw native field reads that the friendly grammar omits;
`--request-file` is the explicit escape for those forms. There is
no raw stored-endpoint access form in this first friendly grammar; `.source`
always acquires the Bead. Link List's endpoint flags have their own exact native
Reference-union lowering and do not use acquisition. Inspecting stored pin origin
is deferred. Acquiring an unavailable endpoint needed by a predicate fails; it
does not become an absent property or a false match.

Within a nested test, outer names remain visible. An inner declaration with the
same name shadows the outer one. There is no second implicit alias. Unknown,
forward, or duplicate declarations in one scope are errors. A source/root is
resolved before its new member alias is introduced.

## Test Types and values

`b is note` means the note Type family. `b is exactly note` means only its nominal
identity. A Type operand is a simple unreserved identifier or one JSON string,
resolved with the command's shared Type naming rules. Quote paths, URIs, reserved
words, or names outside the identifier grammar:

```text
b is note
b is "encoding-note"
b is exactly "https://work.example/acme/note"
```

The bare Type spelling is a name, not a variable or a property. An authoritative
family check cannot silently fall back to exact matching. Definition pins on a
stored affiliation do not change a nominal exact comparison.

Values are JSON literals, field reads, Resource bindings, endpoint navigation,
and `id()`/`rev()`. Comparisons are typed; there is no implicit number/string
conversion. `present(b.status)` tests physical presence. Arrays and objects may
be literal comparison data; there is no expression that builds an output record.
The [semantic contract](../../specs/profiles/core/query.md#predicates-and-values)
defines missing/null comparison and ordering. In particular, an absent field is
not an empty string and does not equal null. Resource equality compares identity
and selected revision; use `id(a) = id(b)` to ignore revision deliberately.

## Ask any or all

`any` asks whether a collection has a witness. `all` asks whether every member
passes its test. They are special forms, not normal functions:

```sh
bd query 'beads as b where (any outgoing(b) as link through link is references where link.target.status = "ratified")'
bd query 'beads as b where (all outgoing(b) as link through link is references where link.target.status = "ratified")'
```

Inside these forms, `where` is the quantifier's test. It does not discard failing
members before `all` sees them. Empty input makes `any` false and `all` true.
`any outgoing(b)` asks only whether the collection is nonempty. `all` must have
`as NAME where TEST`. `any` with a test likewise needs its alias; `any` without a
test has no unused quantifier alias. A traversal restriction can still declare
its own alias: `any outgoing(b) as link through link is references`.

A quantifier occupies a whole predicate. Parenthesize it to make it one operand
of an outside Boolean combination:

```text
beads as b where
  (any outgoing(b) as link through link is references where link.target.status = "ratified")
  and b.status = "draft"
```

By contrast, moving the final `and b.status = "draft"` inside those parentheses
makes it part of each Link's test. Unparenthesized `P and any ...` refuses with a
suggestion to parenthesize the quantifier. This rule removes the ambiguous choice
of whether an `and` belongs to a quantifier test or the surrounding expression.
A quantifier used inside `through` must also be parenthesized. This prevents a
later `where` from ambiguously belonging to that inner quantifier or the outer
walk. Write `through (any outgoing(link.target) as inner through inner is references)`; the parentheses
close that entire test before an outer `where`. The grammar uses a Boolean
`disjunction` after `through`, so a nested quantifier enters through a parenthesized
test. An unparenthesized `through any ... where ...` refuses.

A valid witness proves `any`; a counterexample disproves `all`. A cutoff alone
cannot supply the opposite answers. Bounded depth limits the question itself;
`all` at depth one does not assert anything about the full closure. Execution
limits and completeness are reported outside this language. The draft contract's
explicit fail-fast acquisition policy remains an author proposal for review.

## Focused Graph facade

```sh
bd graph csv-plan --direction out --depth 2 --link-type references
bd graph csv-plan csv-review --direction both --depth unbounded
bd graph csv-plan --exact-link-type references
```

The proposed initial flags are roots, `--direction in|out|both`, `--depth N|unbounded`,
`--link-type TYPE`, and `--exact-link-type TYPE`, plus admitted shared delivery and
presentation controls. Direction defaults to out and depth to one. Type tests
include refinements unless exact is requested. The two Link Type flags are
mutually exclusive in this first focused facade; the general expression can
represent a conjunction if a later use case needs it. At least one root is
required. Duplicate roots have no effect; depth zero retains them without Links.

The compiler emits `profile: graph`, a `walk` over Bead `refs`, and `result.form:
graph`. In/out/both map to incoming/outgoing/connected. Type filters become a
`through` `typeIs` predicate. No outer property filter is added. A server may
implement that structural subset without admitting arbitrary Query. Whether the
protocol gives Graph a distinct convenience operation remains deferred.

## Complete grammar candidate

Whitespace separates tokens; newlines have no special meaning. Comments are not
part of the expression format. Keywords are lower-case and case-sensitive.
Variable aliases match ASCII `[A-Za-z_][A-Za-z0-9_]*`, matching AST binding names.
Unquoted property keys and simple Type names additionally allow hyphens after
the first character: `[A-Za-z_][A-Za-z0-9_-]*`. All names are case-sensitive.
Unsigned indexes/depth use `0` or a nonzero digit followed by decimal digits.
JSON strings use RFC 8259 escapes and may contain Unicode; single-quoted strings
are shell notation only. Shared interoperable-JSON admission still applies:
malformed UTF-8, unsupported numbers, and duplicate object keys refuse; a source
literal is not a way around the wire's JSON restrictions. Numbers use JSON syntax with the shared interoperable
number limits. A sign belongs only to a numeric literal; arithmetic is absent.

Reserved words are `beads links incoming outgoing connected as through where
any all depth unbounded and or not is exactly contains in present id rev true
false null`. Structural field names are contextual after a dot; quoted bracket
keys can name any property. Keywords cannot be variable aliases or bare Type
names. `any` as a Type name can be quoted inside an expression, independently of
the special Type-filter flag spelling.

The EBNF uses `[]` for optional, `{}` for repetition, and `|` for alternatives.
`JSON` is one complete RFC 8259 value; lexical longest-match chooses `!=`, `<=`,
and `>=` before their shorter operators. A bracket step contains a JSON string
or nonnegative decimal integer, never a predicate or wildcard.

```ebnf
query           = collection ;
collection      = navigation, [ clause ] ;
navigation      = source, { ".", endpoint } ;
source          = "beads", [ "(", [ references ], ")" ]
                | "links", [ "(", [ references ], ")" ]
                | walk | "(", collection, ")" ;
references      = string, { ",", string } ;
walk            = direction, "(", roots, [ ",", "depth", ":", depth ], ")" ;
direction       = "incoming" | "outgoing" | "connected" ;
roots           = string | resource | collection ;
depth           = uint | "unbounded" ;
endpoint        = "source" | "target" ;
clause          = "as", name,
                  ( "through", disjunction, [ "where", predicate ]
                  | "where", predicate ) ;
quantified      = "any", navigation, [ clause ]
                | "all", navigation, "as", name,
                  [ "through", disjunction ], "where", predicate ;

predicate       = quantified | disjunction ;
disjunction     = conjunction, { "or", conjunction } ;
conjunction     = negation, { "and", negation } ;
negation        = [ "not" ], test ;
test            = "true" | "false" | "(", predicate, ")"
                | "present", "(", field, ")"
                | resource, "is", [ "exactly" ], typename
                | operand, comparison, operand
                | value, "contains", value
                | value, "in", value ;
comparison      = "=" | "!=" | "<" | "<=" | ">" | ">=" ;
operand         = resource | value ;
resource        = name, { ".", endpoint } ;
value           = JSON | field | ( "id" | "rev" ), "(", resource, ")" ;
field           = resource, fieldhead, { datastep } ;
fieldhead       = ".", plane | ".", propertykey | bracket ;
datastep        = ".", key | bracket ;
plane           = "properties" | "metadata" | "type" | "revisionProvenance"
                | "ownedLinks" | "links" ;
bracket         = "[", ( string | uint ), "]" ;
fieldpath       = ( key | "[", string, "]" ), { datastep } ;
flagcondition   = fieldpath, ( comparison | "contains" | "in" ), JSON ;
listfilter      = "as", name, "where", predicate ;
typename        = key | string ;
```

`name` is an alias identifier; unquoted `key` and bare `typename` use the
property/Type identifier grammar, with keyword exceptions described above; `string` is a JSON string and `uint` a nonnegative integer. Name lookup and
Resource/field typing disambiguate a dot path. `propertykey` excludes the
structural names in `plane` and `source`, `target`, `id`, `revision` at the first
step from a Resource. Endpoint prefixes are consumed as Resource navigation;
structural roots choose native planes; other keys read properties. This is an
explicit parse precedence rule, not a storage-dependent Type-name guess.
For example, `link.target.status` is a field read on the acquired target; it is not
an arbitrary property chain on the Link. Once a property/native data plane has
been entered, later keys remain data even if spelled `source` or `target`.

The following admission constraints supplement the grammar:

- A clause needs `through` or `where`; `through` requires a direct walk source
  without endpoint navigation, and always precedes `where`.
- A quantifier's clause attaches to that quantifier. Its `where` is the test;
  its `through`, if any, restricts a direct walk input. `all` requires a test.
- `not` can repeat only with parentheses in this candidate: `not (not P)`.
- Resource comparisons permit only equality/inequality with another Resource.
  Other comparisons use values; bare Resource truthiness and mixed coercion refuse.
- `present` requires a field. List's `contains` has a literal string right operand;
  List's `in` has one literal side and the other local array/scalar as appropriate.
- Predicates contain no assignments, computed records, arithmetic, aggregates,
  function definitions, or general function-call extension point.
- Free names, endpoint navigation on a Bead, non-Bead roots, or wrong-kind
  collection navigation refuse before execution when statically knowable.

A parser must preserve grouping rather than infer it from indentation. For
`through A where B`, A ends at `where`; B consumes the rest of that clause's
enclosing boundary. A quantified predicate must be parenthesized when used as an
operand of another Boolean expression. Diagnostic guidance should show the needed
parentheses rather than choose between two possible parses.

## Source-to-AST correspondence

For the table, `x` is the one selected List alias, `F(plane,PATH)` is a `field`
node on `binding(x)` with the parsed plane/path segments, and `J(v)` is a literal
node. The uppercase helpers are compiler notation, not wire operators. Resolve
an unpinned endpoint flag to canonical URI U, then expand
`identity(E,U) = or(compare(eq,field(x,[E]),J(U)), compare(eq,field(x,[E,"uri"]),J(U)))`.
This tests both native Reference arms without acquiring a Bead. `--endpoint`
ORs the source and target identity predicates; it therefore has four arms.

| List input | Exact AST predicate/control |
| --- | --- |
| `--property 'PATH OP JSON'` | `compare(OP,F(properties,PATH),J(JSON))`; contains maps to `contains`, in maps to `member` |
| `--metadata-field 'PATH OP JSON'` | The same test with `F(metadata,PATH)` |
| `--has-property PATH` | `present(F(properties,PATH))` |
| `--has-metadata-field PATH` | `present(F(metadata,PATH))` |
| `--type T` | `typeIs(binding(x), nominalURI(T), family)`; reflexive family |
| `--exact-type T` | `typeIs(binding(x), nominalURI(T), exact)` |
| `--from U` / `--to U` | `identity(source,U)` / `identity(target,U)` |
| `--endpoint U` | `or(identity(source,U), identity(target,U))` |
| `--filter 'as x where P'` | P under the declared x, merged with generated conditions |
| Several conditions | One `and` operand array in flag declaration order; order has no semantic effect |
| Zero / one condition | Plain scan / filter with that predicate; do not emit an empty `and` |
| include/omit | AST `projection`, separate from selection |
| sort/page size | Native wrapper `sort`/`limit`, outside the AST |

The value operators map `=`/`!=`/`<`/`<=`/`>`/`>=` to eq/ne/lt/le/gt/ge.
A compiler may preserve a different Boolean operand order or simplify equivalent
predicates, but must preserve typed/missing behavior and required admission.
Neither the `--from` string arm alone nor a bare `.source` acquisition is an
adequate endpoint-identity lowering.

| Friendly construct | AST |
| --- | --- |
| `beads` / `links` | `scan` with that collection kind |
| `beads(REF...)` / `links(REF...)` | `refs` with canonical native References |
| `C as x where P` | `filter {input:C, bind:x, predicate:P}` |
| `outgoing(R, depth:D)` | `walk {roots:R, direction:outgoing, depth:D}` |
| `W as x through P` | The walk gains `bind:x, through:P` |
| `W as x through P where Q` | `filter` around the restricted walk; each binder is x |
| `C.target` / `C.source` | `endpoints {input:C, side:...}` |
| `x.target` / `x.source` | `endpoint {of:binding(x), side:...}` |
| `x.status` | `field {of:binding(x), path:[properties,status]}` |
| `x.metadata.team` | `field {of:binding(x), path:[metadata,team]}` |
| `id(x)` / `rev(x)` | `id` / `rev` Resource value |
| `x is T` / `x is exactly T` | `typeIs`, match family/exact, absolute unpinned Type URI |
| `not P`, `P and Q`, `P or Q` | `not`, `and`, `or` predicate nodes |
| `L = R` and the other comparisons | `compare` with eq/ne/lt/le/gt/ge |
| `present(F)` | `present` over a field node |
| `L contains R` / `L in R` | `contains` / `member` |
| `any C` | `any {input:C}` with no unused quantifier binder |
| `any C as x where P` / `all C as x where P` | `any` / `all` with explicit input, bind, predicate |
| `--count-only` | Outer `result.form:count`; no expression node |

For quantified traversal with `through`, its alias lowers to the walk restriction
binder and, when a test exists, the quantifier binder. An ordinary result filter
instead uses `filter`; do not lower universal quantification to `all(filter(...))`
unless the source explicitly parenthesizes that already-filtered collection.

This mapping is a parser contract to implement and test. The current
[static validator](query-ir/validate.py) checks authored AST/schema obligations;
it does not parse these strings or prove that a backend executes them. The [authored syntax obligations](query-ir/syntax-cases.json) capture clause
boundary and alias examples; no parser has executed them. Required
parser coverage includes nesting, lexical shadowing, quoted names, literal dots,
reserved collisions, greedy quantifier boundaries, and every refusal listed here.
