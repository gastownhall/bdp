# Read CLI/protocol and overview council — October 26

Donna requested a council on the complete specification and explanatory overview.
The same core prompt covered grammar/lowering, native capability/transport, local
values, projection/sort/count, graph editions, completeness/continuation, security,
implementation cost and tutorial accuracy. The original [source manifest](source.json)
identifies the frozen draft; later corrections are reviewed separately.

## Coverage and exact execution

- [Native Codex](codex.md): all primary targets plus captured schemas/cases.
- [Claude](claude.md): actual Claude CLI, configured model recorded as
  `claude-opus-5`, exit 0. Read the 21 captured files and checked native schema
  targets, without running receipt-writing validators.
- [Gemini via Antigravity](gemini.md): actual `agy` invocation, exit 0 with
  substantive findings. Seven primary document bodies were supplied directly in
  the prompt; supporting schemas/cases were outside that review's capture. Its
  narrower coverage is explicit in its report.

Antigravity's first attempt could not read source because a headless command
permission was unavailable. A stdin attempt then received no source payload.
Both attempts are preserved in the local execution evidence and are not counted
as reviews. Direct source-in-prompt delivery completed without changing permission
settings or enabling automatic approval. No provider substitution is claimed.

[Codex follow-up](codex-followup.md) checked the first fixes and found two stale
pin-fixture expectations; both were corrected. The [final bounded check](codex-final.md)
found native Problem extension closure and literal-data AST walking bugs; both
were corrected with positive/refusal cases; [correction confirmation](codex-corrections.md)
checks those fixes. The [focused Claude follow-up](claude-followup.md), actual
Claude CLI exit 0, verified the revised 23-file snapshot and found one remaining
medium admission gap plus five low consistency issues. All six are corrected
below. Its snapshot omitted native schema targets and review/helper files; those
limits remain explicit. These are source reviews, not parser/HTTP qualification.

## High-confidence findings and fixes

Multiple reviewers independently identified ambiguous clause boundaries, alias
charset mismatch, eager first-page wording, Graph/profile dispatch ambiguity,
small-provider feature bundling, and the Query example's incorrect output layout.
The draft now has explicit nested quantifier boundaries, schema-aligned aliases,
response-scoped incremental page proofs, a Graph/Query transport multiplexer,
declinable features plus separate point projection, and collection table output.
Sort's final missing/nonscalar partition avoids an all-row type-error preflight.

## Complete disposition ledger

`C` refers to Claude's numbered report, `G` to Gemini, and `N` to native Codex.
“Fixed” includes a clarifying source change; it does not claim runtime support.

| Finding | Disposition |
| --- | --- |
| C1 family reflexivity | Fixed: Query and paired read delivery explicitly include the named nominal Type and refinements; authority remains required. |
| C2 / N5 eager paging | Fixed: stable Resource pages may evaluate incrementally; whole graph/count and definitive quantifier proofs remain required. |
| C3 endpoint union | Fixed: every endpoint flag and both native Reference arms have exact AST lowerings; pinned-source and multi-flag cases added. |
| C4 / G9 provider burden | Fixed proposal: count/projection/family/exact-reference features can be declined, point projection is independent, and a List-only implementation handles only its structural subset. |
| C5 / G6 Graph dispatch | Fixed: `operation=query` explicitly multiplexes Graph and Query profiles; Graph-only body admission is covered. No third required operation added. |
| C6 strict pinned endpoints | Kept as explicit first-slice proposal; required unsupported History/incidence is assigned 422, hidden/missing content keeps inherited diagnoses. No invented stubs or silent exclusions. |
| C7 full/projected schema | Fixed: presence of result.projection selects projected item arms; no-mask responses require the native full-record family, with actual current/History context still required. |
| C8 data-dependent errors | Fixed: nonscalar sort values enter the final partition; unsupported historical incidence is capability refusal, including dynamic discovery. |
| C9 List flag mapping | Fixed: complete per-flag AST table, one explicit/generated alias, AND composition, and multi-flag fixture. |
| C10 acquisition wording | Fixed: overview promises transferred fields, not avoided internal reads. |
| C11 / G3 / N6 Query output | Fixed: collection table, independent of one-row cardinality. |
| C12 overview coverage | Fixed: correct fixture/case links and five missing selection/count obligations. |
| C13 / N3 alias charset | Fixed: aliases match AST; property/Type identifiers have a separate hyphen-friendly grammar. |
| C14 duplicates | Fixed: canonical Reference values dedupe before emission; floating and pinned inputs remain distinct when capability checks differ. |
| C15 trace.depth | Fixed: requested semantic depth, constant per node; aggregate completion/closure rules explicit. |
| C16 continuation evaluation | Fixed: every page uses the same wrapper, response-scoped evaluation, and only that page's supporting traces. |
| C17 / G11 page-size naming | Fixed: native `limit` in POST and GET; CLI page size and total delivery budget remain distinct. Closed continuation query declared. |
| C18 inherited HTTP mappings | Not adopted: preserve shared Read/History status/code/retry semantics. BDP Problem code distinguishes diagnoses sharing a status; after-state-change includes service configuration. |
| C19 human fields | Fixed: title/body conventions, remaining Properties, Metadata, generic columns and optional status stated. |
| C20 descriptor formats | Fixed proposal: graph/aggregate matrix, count unit `context.resource_kind`, mixed graph context, table/detail distinction. |
| C21 / G8 header capacity | Fixed: point-only projection header, body masks on List/Query, explicit limit diagnosis before output. |
| C22 capability constraints | Fixed schema unbounded/profile constraint. Maximum finite depth is explicitly nonnegative, including an intentional root-only zero bound. |
| C23 request conditions | Fixed schema: no page limit on count/graph and no sort on graph. |
| C24 Problem schema | Fixed: feature code and inherited Read/History arms, positive/refusal cases; inherited conditional missing/archive fields preserved. No requirement to replace all AST oneOf diagnostics. |
| C25 / G7 sort partition | Fixed proposal: direction applies to scalar values; final missing/nonscalar partition and identity/revision ties remain ascending. Missing-first deferred. |
| C26 exact-type any | Fixed: restated rejection and shared absolute nominal URI route for literal any. |
| C27 executable spelling | Clarified locally; shared helper normalization remains Sybil's assembly task. No competing Reference parser. |
| C28 grammar step grouping | Fixed with fieldhead/datastep productions and structural-key parse precedence. |
| C29 exact pin display | No change required: exact tokens are permitted by the shared “may abbreviate” rule and demonstrate portable stored pins. |
| C30 versions layout/ordinal9 | Fixed: Window consistently shown, summary layout stated, ordinal9 explicitly supplied after creation. |
| C31 historical metadata | Fixed: original saved metadata displayed; excerpts explicitly marked. |
| G1 clause/all grammar | Tightened mandatory clauses/all tests; direct-walk restriction remains explicit semantic admission, as ordinary typed grammars require. |
| G2 endpoint/field parse | Fixed: initial structural names excluded from propertykey, endpoint prefix wins, explicit properties/brackets access collisions. |
| G4 omit envelope | Not adopted: bare envelope and pointer /envelope are distinct, deliberate common CLI controls. No collision or new flag needed. |
| G5 request-file dispatch | Clarified: command profile/kind assertions occur before routing; List cannot admit Query/Graph files. |
| G10 fail-fast | Retained as visible author proposal. Gemini recommends removing it; Claude found no contradiction. Donna still reviews success-versus-refusal nondeterminism before adoption. |
| G12 tree Link IDs | Structured output and table retain IDs; detail keeps parallel edges, with --long IDs. Avoid forcing long IDs into every compact tree. |
| G13 missing family authority | Fixed: 422 for unsupported authority; temporary outage of supported authority is inherited 503. |
| G14 trailing conjunction | Deliberate whole-quantifier predicate rule, with explicit parentheses for outside Boolean operands; ambiguous nested through form additionally refused. |
| N1 dangling where | Fixed: nested quantified through predicate requires parentheses; both intended AST groupings have authored syntax obligations. |
| N2 incidence/pins | Explicit edition-applicable author proposal plus incoming/outgoing/connected cases; current-only historical-incidence restriction preserved. |
| N4 List contains | Fixed: literal substring must be string; number/null/array/object refusals added. |
| N follow-up fixture drift | Fixed older edition/identity equality expected sets after adding source-pin Links. |
| N final Problem closure | Fixed: inherited extension/conditional-member admission preserved; unretained missing/archive examples added. |
| N final literal-data walker | Fixed: stop at literal.value; op-shaped ordinary JSON does not request a feature or crash admission. |

| Claude follow-up: endpoint flags | Fixed: `--from`, `--to`, `--endpoint` are Link List only; Bead List refuses them with a Link List/Query alternative. |
| Claude follow-up: feature Problem members | Fixed: capability URI/version required for unsupported capability, version denotes selected advertised version (`1` here); resource-not-found forbids at. |
| Claude follow-up: typekey | Fixed: reuse the defined key token in typename. |
| Claude follow-up: generated alias | Fixed: flag-only authored lowering uses _candidate consistently. |
| Claude follow-up: pageSize | Fixed: stale native continuation wording now uses limit. |
| Claude follow-up: aggregate context | Fixed: primary resource_kind definition includes aggregate count units. |

## Remaining review choices

Current-edition incidence, no-stub graph acquisition, fail-fast before proof,
atomic graph delivery, response-scoped evaluation, frozen projection on native
continuation, exact capability/grammar spellings and the first structured
List/incidence boundary remain author proposals. They are ready for Donna's review,
not automatically adopted by council disposition. Runtime implementation and
provider qualification remain separate.
