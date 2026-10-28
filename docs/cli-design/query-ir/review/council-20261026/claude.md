Reviewed all 21 snapshot files directly (specs ×6, CLI docs ×5, overviews ×2 + fixture, schemas ×2, case corpora ×2, validators ×2). I read both validators but did **not** run them — each writes `VALIDATION.json` / `BINDING-VALIDATION.json`, which your no-write constraint forbids. Verified the live native schema's `$id` and all 12 `$defs` targets referenced by `read-binding.schema.json` resolve (read-only check).

---

# CRITICAL

**1. `--type` family reflexivity is undefined, and three documents disagree — the primary List idiom has no determined result set**
*query-language.md:95 table ("`--type TYPE` | Family affiliation, **including the named Type**"); query.md:162-163 ("Family **includes refinements**"); read-delivery.md:19-20 ("nominal identity and recorded exact family membership are **separate predicates**"); reads-and-paging.md:36-37 (`list --type T` → `conformsTo=<URI>` alone); affiliations.md:161-162*
Issue: `--type` lowers to `typeIs{match:"family"}`, which must lower again to the native `conformsTo` predicate. `query-language.md` asserts reflexive matching; `query.md` says only "refinements"; the native wire text explicitly separates `conformsTo` from nominal identity and says `conformsTo` is pin-sensitive while `type` is not. Nothing states whether a Bead whose actual Type *is* `T` matches `conformsTo=T`. Two authored cases silently require reflexivity (`list-type-family` expects `A` — itself exactly `constraint`; `overview-note-family` expects `csv-format`/`csv-review` — exactly `note`), and `reads-and-paging.md:37` emits `conformsTo` without an OR against `type`.
Impact: `bd list --type note` returns either 3 or 1 rows depending on an unstated closure property. The overview's headline output and two authored cases are unreproducible against the retained wire mapping. Providers will diverge on the most-used flag.
Fix: State reflexivity normatively in `query.md` (`typeIs{match:"family"}` holds when the nominal URI equals the operand **or** is a recorded refinement), and either require reflexive `conformsTo` in `read-delivery.md` or specify the lowering as `or(type=T, conformsTo=T)` in `reads-and-paging.md:37`. Add an authored case asserting the exactly-`T` member.

**2. "Acquisition must finish before the first page" blocks cursor-paged List and contradicts the retained delivery model**
*read-operations.md:92 ("Semantic result acquisition must finish successfully before a successful response page is issued"); read-delivery.md:67-92; read-operations.md:250 (`limit-exceeded` 413 "complete-result capacity exhausted")*
Issue: Unqualified, this requires the whole selected population to be established before page 1 — for a plain `filter(scan)` as much as for a quantifier. Retained ordinary delivery assumes the opposite: snapshot cursors, "MAY return fewer, including an empty page with a nonnull continuation," with no materialization duty. "Established" vs "materialized" is never distinguished, and the only authored minimal provider (`small-list-only-capability`) advertises `sort:true`, which forces materialization anyway.
Impact: Under the strict reading a List over a large inventory must buffer the full selection or refuse with `limit-exceeded`, defeating `next` and contradicting the delivery contract this module claims to reuse. Under the loose reading nothing constrains a partially-evaluated quantifier page. A List-only implementer cannot tell which contract to build.
Fix: Split the rule. Require that *answer-establishing* work (quantifiers, counts, closure, sort keys) complete before the first page; state explicitly that a snapshot-cursor scan with no such work needs no full materialization. Name which result forms and which AST nodes trigger the strict rule.

---

# HIGH

**3. `--from`/`--to`/`--endpoint` have no documented lowering; the obvious one silently under-selects pinned Links**
*query-language.md:42-46 and flag table :88-98; query.md:313-315; reads-and-paging.md:38 and :88-96; cases.json `list-reference-union-local`*
Issue: Three flags used in the examples (`query-language.md:71`, `02-explore-graph.md:116`) are described in prose but **absent from the List flag table**, and absent from the source-to-AST table. The only place the real lowering appears is `cases.json/list-reference-union-local`, which needs a two-arm `or(field["source"]==U, field["source","uri"]==U)` because `compare` uses structural JSON equality and the stored endpoint is a `string | {uri,revision}` union. A single-arm compare omits every pinned Link with no refusal and no warning. The retained route defines `identity(E,U) = (@.E == U || @.E.uri == U)` (`reads-and-paging.md:93`) and matches "regardless of pin" (`:77`), so the same flag means different populations on the two routes. `typeIs` got a dedicated union-aware node for exactly this problem; `source`/`target` did not.
Impact: Silent wrong answers on any Scope with pinned endpoints, and a behavior change when a command is re-routed from legacy to structured List. `--endpoint` additionally needs four arms (source/target × string/uri), unstated anywhere.
Fix: Add the flags to the List table with their exact arm expansion; add source-to-AST rows; add an authored case with a *pinned* source that the single-arm form would miss. Consider a union-aware `endpointIs{of,side,uri}` node mirroring `typeIs`.

**4. Capability detail has no flags for Type-family, count, point projection, or pinned `refs` — undiscoverable and non-declinable**
*read-operations.md:31-43, :61-64, :98-102; query.md:81-82, :163; read-binding.schema.json:61-130*
Issue: `sort` and `unboundedTraversal` get required booleans. Four other hard dependencies do not: (a) `typeIs{match:"family"}` needs authoritative Type-family interpretation and "Missing family authority refuses; there is no exact-only fallback"; (b) exact `count` before paging is mandatory for both profiles; (c) the same capability "also admits shared Resource projection on current and otherwise supported exact point reads" — bundled, not optional; (d) a pinned `refs` entry "requires actual advertised exact application History support" from a capability named nowhere in the snapshot. Meanwhile the capability "neither grants History nor Type-family authority."
Impact: A client cannot discover before dispatch whether `bd list --type note`, `--count-only`, `bd show --include`, or a pinned `beads("x@=r1")` will work — the only signal is a runtime 422. A service that wants only server-side point projection must still advertise `profiles:["list"]` and an `operation` URL for a List endpoint it has not built. This is the main barrier to the "small service can implement List" goal (`read-operations.md:15`).
Fix: Add required booleans `typeFamily`, `count`, `pointProjection`, `listProjection`, `pinnedReferences` to the detail object (or split point projection into its own capability identity). Add authored capability cases with each at `false` and the matching refusals.

**5. `operation=query` is overloaded against `profiles`, so a List+Graph service must accept an operation it does not advertise**
*read-operations.md:66-71, :77-78, :46-48; read-binding.schema.json:69-83; validate-binding.py:40*
Issue: The transport selector takes `list|query`; the AST `profile` takes `list|graph|query`; `profiles` advertises AST subsets. `bd graph` emits `profile:"graph"` and therefore dispatches `operation=query` (confirmed by `validate-binding.py:40`: `(operation=='list') == (profile=='list')`). A service advertising `profiles:["list","graph"]` must accept `operation=query` while "unknown `operation` ... refuse" and no `query` profile is advertised.
Impact: Reasonable implementers reject graph requests; reasonable clients decline to send them. One word carries two different vocabularies.
Fix: Rename the transport selector (`operation=select`/`operation=compose`, or a single endpoint with the profile in the body only), or add `operation=graph` and bind it to `profile:"graph"`. Add a case for a graph request against a `profiles:["list","graph"]` capability.

**6. Strict endpoint acquisition plus "no stubs" makes `bd graph` fail wholesale on any pinned endpoint without History — with no assigned refusal code**
*query.md:196-211; read-operations.md:168-178; query-language.md:386-404 (author proposals)*
Issue: Graph formation "require[s] their selected Bead content"; "both endpoint editions and every root must exist in `beads`"; "no phantom Bead stubs"; opaque stubs are "a possible later extension." A current Link may legitimately pin a retained noncurrent endpoint. Acquiring it needs exact History. Without History, graph formation of the *whole* request fails — one pinned Link poisons an otherwise fully current neighborhood. The refusal table (`:245-254`) assigns no code for this: it is neither `resource-not-found` (the edition may exist and be authorized) nor cleanly `capability-not-supported` (the AST requested nothing historical).
Impact: `bd graph` is unusable on any realistic Scope mixing floating and pinned citations — exactly the pattern `05-revisions.md:188-209` teaches users to create. The "Graph-only support requires no arbitrary predicate parser" simplicity claim (`query.md:328`) does not hold: it requires History.
Fix: Pick one and state it — (a) emit an edition stub (`{id,revision}` + `partial:true`) in `beads` for unacquirable pinned endpoints, (b) exclude such Links from the graph with an explicit `evaluation` notice, or (c) keep whole-request refusal but assign a code and add a capability flag so clients can predict it. Add an authored graph case over the `pins` fixture.

**7. The published response schema accepts a non-full Resource item with no projection — the exact loosening both specs forbid**
*read-binding.schema.json:324-330, :377-392, :150-194; read-operations.md:126-130; resource-projection.md:85-89*
Issue: `beadResources.items`/`linkResources.items` always `$ref` `projectedBead`/`projectedLink`, which require only `id`/`type`/`revision`(+endpoints). There is no `anyOf[fullRecord, projectedRecord]` and no conditional on `result.projection`. So a page with `projection` absent and items lacking `properties`/`metadata` **validates**. Both specs forbid this: "Full responses continue to satisfy their complete native record contract"; "Do not globally make required stored/full-record fields optional." The rule exists only in review-only Python (`validate-binding.py:54-55`) — and `read-binding-cases.json/no-mask-needs-full-record` is classified `reject-semantic`, not `reject-schema`, confirming the schema cannot catch it.
Impact: Anyone validating the wire with the published schema ships the prohibited loosening; the stated "explicit projected record/item schema arms" requirement is unmet in the artifact that is supposed to carry it.
Fix: Make `items` conditional — `if: {required:[projection]} then: {items: projected} else: {items: full}` (or `oneOf` at the result level). The fix is already encoded in the Python; move it into the schema.

**8. 400 `invalid-parameter` / "never retry" is assigned to data-dependent runtime conditions**
*read-operations.md:144-146, :247; query.md:174-177; read-operations.md:250*
Issue: Two documented refusals depend on selected *data*, not on the request: "Arrays/objects at the sort path refuse the request," and a computed walk root that "selects noncurrent content likewise refuses before expansion." Both are mapped to `invalid-parameter`, 400, retry "never." But the identical request succeeds once the offending record changes, and fails later when a new record acquires an array at the sort path.
Impact: Clients and CLIs that honor "never retry" permanently blacklist valid requests. Worse, the same request flips between success and 400 as data changes, with a code that tells the caller the request was malformed. Caching keyed on the normalized logical request (`:267-268`) will cache a 400 for a transient data condition.
Fix: Split the codes. Keep `invalid-parameter`/400/never for request-shape errors; add a distinct data-dependent code (e.g. `unsortable-value`, `historical-root-selected`) with retry "after-state-change," and say explicitly that admission cannot be decided statically for these two cases.

**9. The source-to-AST correspondence table omits every List flag — the main lowering a parser must implement**
*query-language.md:498-521*
Issue: The table is declared "a parser contract to implement and test," but covers only friendly-expression constructs plus `--count-only`. There are no rows for `--property`, `--metadata-field`, `--has-property`, `--has-metadata-field`, `--type`, `--exact-type`, `--from`, `--to`, `--endpoint`, or `--filter`'s merge into the generated `and` group. Supporting details are scattered across `:99-151`: the generated capture-free alias, alpha-renaming the user alias, dotted-vs-bracket `fieldpath` semantics, and the two-arm endpoint union (only in `cases.json`).
Impact: The documented lowering is the friendly grammar, which is the *less* used input path; the flag path — the one in every overview example — has no normative mapping. Two implementers will produce different ASTs for the same `bd list` invocation.
Fix: Add one row per flag with its exact node shape, the AND-group merge rule, and the alias-generation/renaming rule. Add authored cases for a multi-flag List (property + metadata + presence + type + endpoint) to pin the generated predicate.

**10. The overview teaches that projection avoids acquisition; the projection contract says the opposite**
*02-explore-graph.md:82-83 ("Request the title property **without acquiring the body's content** in the response"); resource-projection.md:16-17 ("Projection then changes the represented fields, never identity, revision, authorization, membership, ordering, count, or **acquisition**"); resource-projection.md:18-19*
Issue: Direct contradiction between the tutorial and the accepted projection semantics. Projection is a representation filter applied *after* selection and acquisition; "Required filtering/sorting uses full selected data even if a field is omitted."
Impact: Teaches an unsupported performance claim as the stated purpose of the feature's first example. Users will adopt `--include` expecting server-side read reduction and providers will be blamed for not delivering it.
Fix: Rewrite the comment to "Transfer only the title property," and add one sentence in the overview stating that projection reduces what is *represented*, not what the service reads.

**11. `bd query` Resource output is rendered in point/detail layout, contradicting the collections-default-table rule**
*02-explore-graph.md:195-201; read-output.md:15-16 ("Default point format is detail and collections table"), :156-158 (query Resource results use `resource_collection`)*
Issue: The overview's only `bd query` example prints `csv-plan [guide] CSV export plan` + `…` — the point layout used at `:20-30`. But query Resource results decode into `resource_collection`, whose default format is table. `bd list` in the same chapter correctly shows the table. `read-output.md:21` also says "table is collection-only here," so the detail layout shown is not a legal default for this descriptor.
Impact: The first `bd query` a reader sees shows output the rendering contract cannot produce by default; renderer implementers get conflicting targets from the two documents.
Fix: Render the example as the ID/TYPE/TITLE table (one row), or show `--output-format detail` explicitly in the command.

---

# MEDIUM

**12. Overview 02 misstates where its expected results live, and 5 of its structured commands have no authored case**
*02-explore-graph.md:251-252; fixtures.json; cases.json*
Issue: "The exact Scope fixtures **and expected selection sets** are captured in [the authored seed](../query-ir/fixtures.json)." `fixtures.json` contains fixture records only — zero expected sets. The expected sets are in `cases.json`, which has 6 `overview`-fixture cases. Of those, 5 match chapter commands (`--type note`, `--exact-type note`, graph depth 2, graph depth 3, the `any` query) and `overview-list-draft-notes` matches no command in the chapter. Unverified chapter commands: bare `bd list` (4 rows), `bd link list --from csv-plan --type references` (2 rows), `bd list --type note --include /properties/title`, `bd list --type note --property 'status = "ratified"'` (2 rows), `bd list --filter '... or ...' --count-only` (`4`). I checked all five by hand against `fixtures.json/overview` — the printed results are arithmetically correct — but nothing in the corpus pins them.
Impact: The chapter overclaims its own verification, and the five unpinned outputs (including the `--from` example that depends on finding #3) can drift silently.
Fix: Correct the link text to point at `cases.json`, and add overview cases for the five commands — particularly the `--from` lowering and the `--count-only` value.

**13. AST binding-name charset is narrower than the published identifier grammar**
*query.schema.json:79, :408, :439, :572, :615; query-language.md:410 (`[A-Za-z_][A-Za-z0-9_-]*`); cases.json `invalid-binding-name`*
Issue: The grammar admits hyphens in identifiers, hence in aliases; every AST `bind`/`binding.name` pattern is `^[A-Za-z_][A-Za-z0-9_]*$`. `bd list --filter 'as my-b where my-b.status = "draft"'` parses but cannot be emitted, and the corpus classifies a hyphenated binder as `invalid-ast`. The CLI's alpha-renaming provision (`:131-133`) is scoped to capture avoidance, not charset repair.
Impact: `--request-file` users hit a hard refusal with no documented reason. If the CLI silently alpha-renames, every diagnostic and the Problem `at` pointer refer to a name the user never wrote.
Fix: Align the two patterns (simplest: drop `-` from the alias production, keeping it for Type names), or state the renaming obligation and require diagnostics to map back to the source alias.

**14. Duplicate references: the schema refuses, the Graph facade promises tolerance**
*query.schema.json:551 (`uniqueItems: true`); cases.json `duplicate-root-literals-refuse`; query-language.md:398 ("Duplicate roots have no effect")*
Issue: `bd graph csv-plan csv-plan` must therefore be deduped by the compiler before emission, which no document states. `beads("A","A")` in a friendly expression is grammatical and its handling is unspecified — the AST rejects it.
Impact: Inconsistent behavior across the two input paths for the same user error.
Fix: State one rule: either the compiler dedupes References on both paths (and say so), or duplicates refuse on both (and drop "Duplicate roots have no effect").

**15. `trace.depth` has no defined meaning, and cross-invocation aggregation is unspecified**
*read-operations.md:186-197; read-binding.schema.json:253-294*
Issue: `{at, depth, completion, closure}` — `depth` is never defined as requested semantic depth or maximum depth reached. "All invocations of that AST node contribute to its one trace," but no aggregation rule is given for `depth` (max? min? requested?). If it is the requested depth it duplicates the AST; if observed, a walk invoked once per candidate Bead has no stated reduction.
Impact: Two services emit different `depth` for identical work; consumers cannot interpret it. `completion:"depth"` ("at least one stopped at the semantic depth") becomes unreadable without knowing which depth is reported.
Fix: Define `depth` explicitly (recommend: the requested semantic depth, with observed frontier conveyed by `closure`), and state the aggregation for each field.

**16. `evaluation` on continuation pages is undefined though the schema requires it**
*read-binding.schema.json:503-534 (`response.required:[result,evaluation]`); read-operations.md:210-237; read-output.md:170-177*
Issue: Issued `next` is "an absolute GET continuation." Nothing says whether the page-2 response uses the same `{result, evaluation}` wrapper, whether `traversals` must be replayed verbatim, or whether `complete:true` on page 2 restates page 1's establishment. There are zero authored continuation cases of any kind.
Impact: Pages 1 and N can validate differently; a CLI reusing `context.evaluation` per page has no defined source. Combined with finding #2, it is unclear whether evaluation is per-request or per-page.
Fix: State that the continuation response repeats the originating `evaluation` unchanged (it describes the established selection, not the page), and add continuation cases covering the wrapper, `limit` replacement, frozen projection, `cursor-expired`, and `foreign-view`.

**17. One per-page control, two names and two locations, with no defined mutable-member set**
*read-operations.md:89-90 (`pageSize` in the POST body), :216-218 (`limit` on the issued cursor URL); read-delivery.md:69-85; reads-and-paging.md:176-181*
Issue: The initial request carries body member `pageSize`; the continuation carries query member `limit`, which "may be replaced/appended" while "The endpoint must reject extra query members." The exempt set is never enumerated — is it exactly `limit`? Does the cursor URL carry `readVersion`? Is appending `limit` to a cursor that lacked it an "extra query member"?
Impact: A conforming client that appends `limit` can be refused by a conforming service. Two spellings for one concept across one feature's two legs.
Fix: Use `limit` in the POST body too (or `pageSize` on the cursor), and enumerate the exact mutable query members on an issued continuation.

**18. The refusal table misuses HTTP status and retry classes in four places**
*read-operations.md:245-254*
Issue: (a) `request-too-large` and `limit-exceeded` both map to 413, so status alone cannot distinguish "your body is too big" from "the work budget blew out" — the two have opposite remediations. (b) 413 is defined for request payload size; using it for result/work capacity is a misuse (507 or 503 fits). (c) `capability-not-supported` → retry "after-state-change," but capability support is server configuration, not caller state. (d) `resource-not-found` → 404 on a POST to the operation endpoint, which proxies, SDKs, and the CLI will read as "the operation endpoint does not exist" — indistinguishable from an undeployed capability.
Impact: Client retry logic is driven off these mappings; three of the four will misroute. The 404 ambiguity is the worst: it makes "capability not deployed" and "a Reference in my AST is hidden" the same observable.
Fix: Give `limit-exceeded` its own status (507/503) and retry class; change `capability-not-supported` retry to "never (configuration)"; move body-referenced missing/hidden Resources to 422 with the uniform nondisclosure code, reserving 404 for the endpoint itself.

**19. `read-output.md`'s point layout omits the `Properties` section every example uses, and its column rules do not cover the overview's tables**
*read-output.md:60-66, :67-73; 02-explore-graph.md:20-30, :114-131, :36-43*
Issue: The declared layout is "`ID [declared concrete Type]`, optional title, selected revision/context, exact stored body, then metadata." Every overview point example prints a `Properties` section between body and metadata — a section the contract never defines. Which property becomes the "body" (and that `title` is lifted into the header) is also unspecified, though `resource-projection.md:46` calls `title` an ordinary optional property. For collections, the contract authorizes "ID then [Type]" plus "native Issue status/priority ... product columns" and "Link rows add exact endpoints" — but the overview's Bead table has a `TITLE` column and its Link table a `STATUS` column on `references`/`explains` Types that are not Issues.
Impact: A renderer implementer cannot reproduce the overview from the output contract; the overview shows columns the contract only sanctions for the Issue product type, blurring the generic/product line that `query-language.md:149-151` draws for inputs.
Fix: Add `Properties` to the declared layout; name the title/body property conventions explicitly; state the generic collection column rule (ID, Type, title) and mark STATUS as a product column in the examples.

**20. `aggregate` and `graph` descriptors are missing from the format-admission matrix, and the kind-context member is unnamed**
*read-output.md:17-21, :28-37, :159-169, :184-186*
Issue: "unsupported format/descriptor combinations refuse before dispatch" — but the admission matrix covers only collections, points, and metadata. `aggregate` (count) and `graph` appear in no row. `context.resource_kind` is declared "for Resource/collection/properties values"; count is specified to carry "explicit Bead/Link unit in context" with no field name, and graph (two component kinds) has no context rule at all.
Impact: `bd graph --output-format table` and `bd query --count-only --output-format detail` have no defined admission answer; the count unit has no wire-level name to emit.
Fix: Add `aggregate` and `graph` rows to the matrix, name the count unit member (reuse `resource_kind`), and state what graph context carries.

**21. A projected point GET can become a refusal because of response-header size, with no assigned code**
*read-operations.md:115-120, :245-254*
Issue: "Masks must also fit ordinary request-target and response-header bounds; refuse before output if their required metadata cannot be carried intact. Never truncate a mask header." `BDP-Projection` carries the applied mask in a response header, but deployments commonly cap response headers well below request-line limits. No code in the table covers it — `request-too-large` is explicitly "encoded request exceeds admitted bytes."
Impact: A GET that passed request-size admission fails at output, data- and proxy-config-dependent, with an unassigned code. The sentence also conflates the point GET (header-carried mask) with List (body-carried `result.projection`), which has no header bound.
Fix: Assign a code, scope the header-bound sentence to point reads, and consider carrying the applied mask in the point response body or a bounded digest.

**22. `maximumDepth` and the `unboundedTraversal` consistency rule are not enforced by the schema**
*read-operations.md:57-58, :48-49; read-binding.schema.json:116-120, :87-89; validate-binding.py:45*
Issue: Prose says "Optional **positive** `maximumDepth`"; the schema allows `minimum: 0`. Prose says `unboundedTraversal` "must be false if neither traversal profile is advertised"; the schema has no `if/then` (the rule lives only in review-only Python, which also does not check `maximumDepth`).
Impact: `maximumDepth: 0` advertises a capability that admits no traversal while claiming finite traversal support, and validates.
Fix: Set `minimum: 1`; add `if: {properties:{profiles:{not:{contains:{enum:["graph","query"]}}}}} then: {properties:{unboundedTraversal:{const:false}}}`. Add capability cases for both.

**23. `pageSize`/`sort` admission rules required by prose are absent from the request schema**
*read-binding.schema.json:41-60; read-operations.md:89-94, :150-155; validate-binding.py:41-42*
Issue: "Count and graph requests reject [`pageSize`]" and "Graph rejects sort" are mandatory admission rules; the request schema has no conditionals, so both validate. Enforcement lives only in the review-only Python.
Impact: Same class as #7 — an implementer validating against the published schema does not get the stated admission.
Fix: Add `if/then` conditionals on `query.result.form` for both members.

**24. No Problem schema arm exists for any of the eight proposed feature codes**
*read-operations.md:239-262 ("The exact code `capability-not-supported` needs its feature-local 422 schema arm"); read-binding.schema.json (`oneOf: [request, response, capability]`)*
Issue: The binding schema has no Problem definition, and `read-binding-cases.json` (25 cases) contains zero refusal cases. The optional `capability`/`capabilityVersion`/`at` members are unschematized and untested.
Impact: Every refusal path — the half of the contract that carries the nondisclosure guarantees — is prose-only. The `at` member is also hard to produce correctly: `query.schema.json` discriminates every node family with nested `oneOf`, so standard validators report all failed branches rather than one anchor pointer.
Fix: Add a `problem` arm with the eight codes and the optional members; add reject cases for each. Convert the AST's node `oneOf`s to `if/then` on `op` so a single `at` pointer is derivable.

**25. Missing-sorts-last makes `desc` not the reverse of `asc`, which the sort text otherwise implies**
*read-operations.md:140-149 (author proposal)*
Issue: "Descending reverses those present values. **Missing paths sort last in both directions.**" That is the SQL NULLS-LAST convention and is defensible, but the surrounding text frames the proposal as a single reversible total order, and the CLI exposes only `--descending` with no missing-position control. Determinism is fine (missing-group ties break by identity ascending); reversibility is not.
Impact: Users paging `desc` to reach "the end" never see the missing group move, and cannot express "missing first."
Fix: Say explicitly that missing is a terminal partition independent of direction (NULLS LAST), and note that a missing-position control is deferred.

**26. `--exact-type any` behavior differs between the retained reference and the new candidate**
*reads-and-paging.md:48 ("Bare filter `--type any` omits that predicate; `--exact-type any` **refuses**"); query-language.md:103-107 (describes only `--type any`)*
Issue: The new candidate specifies the `--type any` escape and is silent on `--exact-type any`, while providing a quoted escape only *inside expressions* (`:421-423`). So via flags there is no stated way to select a Type literally named `any` exactly, and the two documents disagree on whether it refuses.
Impact: An implementer following `query-language.md` alone will treat `--exact-type any` as a Type name; one following the retained reference will refuse.
Fix: Restate both rules in `query-language.md` and give a flag-level escape (e.g. the absolute URI, or a JSON-string operand).

---

# LOW

**27. `bd` vs `bdp` binary name split across the canonical CLI set**
*scope-and-references.md (10 `bdp` invocations, 0 `bd`); query-language.md / reads-and-paging.md / both overviews (76 `bd`, 0 `bdp`)*
`query-language.md:233` defers Reference and revision-selector parsing to "the shared CLI Reference parser," which is specified in the one document using the other binary name. Fix: normalize to one spelling, or state the rename explicitly.

**28. EBNF alternation precedence is ambiguous as written**
*query-language.md:460-462*
`field = resource, ( ".", key | bracket ), { ".", key | bracket } ;` — with `|` at lowest precedence the parenthesized group reads `(".", key) | bracket`, which is the intended meaning given `b["a.b"]` at `:302-304`, but the repetition `{ ".", key | bracket }` admits the wrong reading too. Fix: introduce a named `step = ( ".", key ) | bracket` production and use it in `field` and `fieldpath`.

**29. 05-revisions renders a stored pin as `@=guide-h` although an ordinal mapping exists**
*05-revisions.md:200-203; read-output.md:77-80*
The output contract says a stable local ordinal "**may** abbreviate the selected revision/pin in human output when the adapter supplies its mapping" — and this example's adapter maps 8→`guide-h`. Permissive, so not a violation, but the chapter shows the exact-token form immediately after teaching ordinals. Fix: show `@8` with the token in `--long`, or note that pins always display as exact tokens.

**30. `bd versions` and `bd link versions` print different header sets, and local ordinal 9 is used without being established**
*05-revisions.md:52-61 vs :163-169; :118-120 vs :243-248*
The Bead listing carries `Window: complete`; the Link listing omits `Window:` with no explanation, and `read-output.md:142-143` explicitly adopts no History view format, so neither layout is specified anywhere. Separately, the product-branch example uses `--if-revision 9` for `guide-i` while the stated mapping covers only 1, 7, 8 — and the CLI "cannot derive a number by counting a versions page." Fix: either specify the versions layout or mark both outputs as unspecified product rendering; extend the stated ordinal mapping to 9.

**31. The exact-historical read example drops non-empty metadata that its own point about retention depends on**
*05-revisions.md:81-95; 05-revisions.fixture.json:26-29*
`bd show csv-draft@=guide-a` prints ID/Type/revision/body and stops. The fixture records `metadata: {area: export, scratch: true}` for `guide-a`, and the declared layout puts metadata after the body. The chapter then asserts "The historical read retains the original Type and content" — while omitting the one field that visibly differs from current state (`scratch: true`, dropped by `guide-c`). Fix: show the metadata block, or add the elision marker after the body.

---

## Overengineering that blocks a simple List-only provider

Ranked by cost, all traceable to findings above:

1. **Bundled capability** (#4) — one capability forces List dispatch + exact count + point-GET projection + List-item projection + Type-family authority, with opt-outs for only `sort` and `unboundedTraversal`.
2. **Mandatory full acquisition before page 1** (#2) — turns a cursor passthrough into a materializing evaluator.
3. **Projected-record schema arms** (#7, resource-projection.md:85-89) — adoption requires new projected Bead/Link definitions and collection-item arms *before* the simplest List can return a masked page.
4. **Exact distinct count before paging** with no declinable flag and "No partial/estimated count is emitted as success."
5. **Continuation obligations** — issuer-side frozen projection, retained authorization fence, `foreign-view`/`cursor-expired` distinction, and `limit`-only mutability (#16, #17), none of which a stateless List provider gets for free.
6. **Sort total order** (#25, #8) — cross-type ordering, missing-last, identity+revision tie-break, and a data-dependent refusal, for a feature a minimal provider would rather answer `sort:false`.

The AST itself is not the problem: `profile:"list"` is `scan` plus one local `filter`, and `validate.py:152-157` enforces exactly that. The cost is entirely in the proposed binding.

---

## Missing context — stated honestly

- **I did not run either validator.** Both write receipts (`validate.py:286`, `validate-binding.py:91`), which your constraints forbid. So I have no execution evidence for even the static checks. Note that `validate.py:195-197` asserts every relative Markdown link resolves, and this snapshot has **30 broken relative links** (all to files outside the subset), so `validate.py` would fail here regardless.
- **Files the docs treat as authoritative are absent from the snapshot:** `query-ir/EXAMPLES.md`, `query-ir/INCORPORATION.md`, `query-ir/examples/index.json` + example files, `query-ir/review/*`, `read-framing.schema.json`, `fixtures/read-delivery/candidate.json`, `specs/profiles/core/core.md`, `bdp-v0.1.schema.json` (local copy). `validate.py:166-223` requires most of them. I could not verify the six-descriptor framing schema, the examples index/case cross-checks, or the Core clauses that `resource-projection.md` and `read-delivery.md` say must be amended. Findings #19, #20 and #24 would narrow or resolve if `read-framing.schema.json` and `EXAMPLES.md` contradict me.
- **Overview chapters 01, 03, 04 are absent.** Chapter 05 depends on 03/04 for the `csv-draft` state trace and the deletion of `csv-context`/`csv-checks`; I verified 05 only against `05-revisions.fixture.json`, which is internally consistent with it (9 ordinals, 9 distinct tokens, `guide-h` reviewed, `guide-i` approved, metadata unchanged across the approval — matching `validate.py:226-231`).
- **No evaluator, parser, HTTP, or provider evidence exists.** `cases.json` is 115 authored cases (79 accept / 18 reject-semantic / 18 reject-schema) labeled `authored-design-obligations-not-executed-evaluator-tests`; `read-binding-cases.json` is 25 cases labeled `authored-structural-and-admission-cases-not-http-tests`. Every expected result set, including the five overview outputs I checked by hand, is authored. Nothing in the snapshot establishes CLI, HTTP, or backend behavior, and I make no implementation or adoption claim.
- **Author proposals I challenged as proposals, not as adopted rulings:** transport/flag/schema names (#5, #17), scalar sort total order (#8, #25), current-root-only / historical-incidence refusal (#6), strict endpoint acquisition with no graph stubs (#6), fail-fast before proof (untouched — I found no contradiction in it), initial no-Graph mask (untouched), frozen projection continuation (#16), and the List incidence-vs-new-filter boundary (#3). The preserved human decisions — minimal complete JSON AST, two canonical operations, candidate-local List with Type affiliation as the exception, graph as a focused Query subset, explicit aliases with lexical shadowing, traversed-Link-edition results, `through`-prunes/`where`-selects, depth default 1 / explicit unbounded, prefix `any`/`all` with empty false/true, no implicit coercion, JSONPath-compatible missing semantics, id+revision equality, outer exact distinct count before paging, no computed records/`select`/scalar top-level, protected mask context, one scalar pointer sort, GET/exact-GET/List projection consistency, and unchanged legacy `bd query`/`bd sql` behavior — are not contested anywhere above. Finding #4 contests the *lack of a discovery flag* for count, not count's semantics.
- **One asymmetry I noted but did not score:** the AST can express raw stored-endpoint and `id`/`revision` field reads (`field{path:["source"]}`, `field{path:["id"]}`) that the friendly grammar deliberately reserves (`query-language.md:298-310`). That is intentional given `--request-file`, but it means the surface and the wire have different expressive power, which the documents do not acknowledge.
