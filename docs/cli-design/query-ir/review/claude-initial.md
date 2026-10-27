# Claude initial review

Actual Claude Code stdout from the read-only October 26 review. Exit status 0.
The reviewer examined the live authoring draft and reports a 64-case snapshot;
this is not claimed as a review of every later edit or an executed test suite.
The substantive report is preserved below. Resolution is in [README](README.md).

I read all eight files under review plus the relevant retained Core/Read reference (`core.md`, `read-delivery.md`, `retained-core.md`, `affiliations.md`, `contract-binding.md`, `bdp-v0.1.schema.json`, `reads-and-paging.md`, `read-output.md`, `product-cli-lowering.md`, `specs/README.md`). I re-derived every authored expected result in `cases.json` against `fixtures.json` by hand; all 64 are consistent with the stated semantics, and the documents' internal lint invariants (fence parity, trailing whitespace, relative links, `markdown_json_blocks_parsed: 1`, 64/51/9/4 counts) hold. No files were written and nothing was executed.

Findings below are defects only.

---

## HIGH

**1. Projected representations cannot validate against the held v0.1 record/collection definitions, and that is not on any integration list.**
`specs/profiles/core/resource-projection.md:33-40`, vs `specs/profiles/core/bdp-v0.1.schema.json` `$defs.currentBeadRecord` / `currentLinkRecord` / `currentBeadCollection`.
The protected set is "canonical identity, actual Type, selected revision, and whole source/target References on Links." `properties` and `metadata` are **not** protected, and line 39-40 explicitly permits "An include set matching no optional fields returns protected context only." But `beadRecord` requires `["id","type","revision","properties"]` with `additionalProperties:false`; `currentBeadRecord` adds `required:["metadata"]`; `currentBeadCollection.items` must be `currentBeadRecord`. So `include=/metadata/owner` on a point GET, or any include on a List item, produces a body that fails the candidate schema.
*Impact:* the accepted projection target is unimplementable against the held artifact; a provider either refuses every mask or serves schema-invalid bodies. The status note ("does not change held schema bytes") disclaims the change without naming the dependency, and `query.md:252-253` names only "projection parameters and validator behavior," not record definitions.
*Fix:* add a bullet to §"Shared operations and existing views" stating that adoption requires projected-representation definitions (a `projectedBeadRecord`/`projectedLinkRecord` arm, or relaxing `required`/`additionalProperties` for masked responses), and add that to `query.md`'s integration list item 2. Separately decide whether `properties` and `metadata` join the protected set — core.md:1380 says "Successful reads always expose `metadata`."

**2. `refs` admits pinned (historical) entries with no stated semantics, capability gate, or traversal rule.**
`docs/cli-design/query-ir/query.schema.json:519-537` (pinned `{uri,revision}` arm); `specs/profiles/core/query.md:60,64-69,228`; `validate.py:135`.
`refs` reuses the shared Reference union, so `refs(beads,[{uri:…,revision:"r1"}])` selects a historical edition. The `graph` profile requires only `roots.op=="refs" && collection=="beads"`, so a pinned root is admitted. Nothing states (a) that this requires `historicalResolution` (`core.md:1694`, `retained-core.md:36`), (b) which incident Links a walk from a pinned root inspects — current ones, or those recorded in that edition (`core.md:1780` forbids loading "inline Links from today's graph" for exact reads), or (c) how `endpoint`/`endpoints` over a pinned *Link* edition satisfies the historical target-closure authorization in `core.md:1787-1790`. `query.md:161` mentions "pin resolution require explicit provider capability" only inside §Traversal, and no case or fixture exercises a pinned input.
*Impact:* three implementations will disagree on `bd graph foo@=r1`, and the auth closure for historical endpoints can be skipped silently.
*Fix:* state in §Collections and bindings that a pinned `refs` entry requires the advertised History capability and refuses otherwise; state that traversal roots are resolved to a **current** Bead identity and that a pinned root does not select a historical incident-Link population (or forbid pinned roots in `walk` outright, enforced in `admit()`); add one accept and one refusal case.

**3. `refs` to a missing or unauthorized Reference has no defined outcome.**
`specs/profiles/core/query.md:60`; `cases.json:3093` (`empty-roots-empty-links` covers only an empty array).
`refs` is the one node that straddles the distinction `resource-projection.md:20` draws explicitly — "A failed point lookup and a successful empty List remain different outcomes." Nothing says whether `refs(beads,[X])` where X does not exist, or is outside the Authorization View, refuses like a point GET (uniform `resource-not-found`, `core.md:1498-1543`) or silently yields fewer members like a selection.
*Impact:* `bd graph missing-bead` is either a 404 or a successful empty graph, and the silent-drop reading is also a disclosure oracle when combined with partial root sets.
*Fix:* state that every `refs` entry must resolve within the request's Authorization View or the request refuses under the uniform unknown-Resource rule, with no partial-root success; add cases for a nonexistent Reference, an unauthorized Reference, and a kind-mismatched Reference (`refs(links,[<bead URI>])` — `read-delivery.md:53-55` requires the kind assertion and `specs/README.md:26-27` says path spelling does not establish kind).

**4. Authorization-hidden endpoint acquisition: the two stated rules give contradictory answers.**
`specs/profiles/core/query.md:109-110` and `186-187` ("required acquisition failures remain failures") vs `query.md:163-164` ("MUST NOT reveal hidden Resources through newly specific failure messages"); `cases.json:3227-3230` defers it as `hidden-endpoint-nondisclosure`.
`core.md:1794` permits a visible Link with a hidden target. For `compare(field(endpoint(l,"target"),…), literal)`, "refuse" leaks that a hidden target exists behind an authorized Link; "treat as absent" silently changes `any`/`all`/`count` answers. The execution obligation records the tension but does not resolve the language-level question, while the surrounding text asserts refusal firmly.
*Impact:* either a disclosure channel or divergent successful results across providers — this is a semantic decision the AST needs, not a transport policy.
*Fix:* pick one and say it in §Predicates and values: the recommended reading is that a Resource outside the Authorization View is **not in the view at all**, so the endpoint reference does not resolve and its fields are absent under the missing-field table, with the "required acquisition failure" rule reserved for *authorized but unavailable* content (opaque external, unresolvable pin, backend outage). Add a `constraints`-fixture variant with a hidden target and the expected result.

**5. Retained-Core sentences that forbid List projection are not named as requiring amendment.**
`specs/profiles/core/resource-projection.md:65-66` names only the exact-GET revision-only rule. It does not name `core.md:1684-1686` — "Collection responses do not accept Resource `view` or `include` parameters… Their `items` are always complete Resource records" — nor `core.md:1637-1640` (an unsupported collection query parameter MUST return `invalid-parameter`/400 and MUST NOT be ignored), nor `read-delivery.md:11-18` ("A display mask is not a native view"; inventories "return full records"). `INCORPORATION.md` item 2 points at CLI docs only.
*Impact:* a conformant v0.1 service is required to reject the projection parameter on List, so the accepted target is blocked by text the module does not list; `read-delivery.md` is a sibling normative module that would silently contradict it.
*Fix:* in §"Shared operations and existing views," name `core.md#collection-retrieval-and-selection` and `read-delivery.md` as the two rules requiring explicit amendment alongside the exact-GET rule, and link both (the module currently links only `query.md`, unlike every other v0.1 Core amendment, which also binds itself to `contract-binding.md`).

**6. `count` and universal quantification are not bound to the request's Authorization View.**
`specs/profiles/core/query.md:200-206`, `185-187`; `resource-projection.md:56`.
`core.md:1657-1658` is explicit: "The structural predicates and Selector decide the complete matching set before pagination, **but only within the request's Authorization View**." The new text says "exact distinct edition count before paging" and "An unbounded universal check needs complete relevant acquisition to establish true" with no view qualifier.
*Impact:* "exact count" read literally is a global count — a direct leak about Resources the caller cannot see; and "complete relevant acquisition" is ambiguous about whether unauthorized members block `all` (which would also leak).
*Fix:* add one sentence to §Results: "Count, graph closure, and quantifier completeness are all relative to the request's Authorization View; a Resource outside the view is not an unavailable acquisition." Add it to the `count-before-paging` note as well.

---

## MEDIUM

**7. The schema and static checker admit `projection` on a graph result the design says is undefined.**
`query.schema.json:37-57` (top-level `projection`, no coupling to `result.form`); `validate.py:121-137` (`admit()` never inspects `projection`); vs `query.md:216-217` ("Graphs require separately targeted Bead/Link masks; that mixed-carrier grammar is still open") and `resource-projection.md:57-58`.
*Impact:* `{profile:"graph", result:{form:"graph"}, projection:{include:["/properties/title"]}}` passes both gates, so the "static admission checker" blesses exactly the shape the prose says has no defined meaning.
*Fix:* add `require("projection" not in request, "graph-projection-undefined")` under the existing `form == "graph"` branch in `admit()`, and add a `reject-semantic` case. (Keep `projection` + `count` admitted — `count-with-mask-unchanged` is deliberate.)

**8. The `list` profile admits predicates that have no bounded-Selector equivalent, while describing itself as the bounded subset.**
`validate.py:115-118` admits `contains` and `member` in `local_predicate`; `query.md:232-233` says List "admits the bounded Boolean/local predicate subset."
`core.md:891-894` says the retained Selector "does not support … nested filters, functions, regular expressions" — RFC 9535 has no substring operator without the `match`/`search` function extensions, and array membership needs a nested filter. So `contains`/`member` cannot lower to `selector=` or to any structural parameter in `core.md:1613-1622`.
*Impact:* "obvious structural subset" and "bounded … subset" read as *the Selector's* bounds; a service implementing the `list` profile by lowering to the existing native List surface cannot satisfy it, and the gap is invisible because `local_predicate` silently accepts.
*Fix:* either drop `contains`/`member` from `local_predicate` and say so in the profile table, or state explicitly in §Profiles that these two nodes exceed RFC 9535 bounded-Selector capability and require the new structured-predicate carrier from integration item 1.

**9. `member` is admitted in one direction only in the `list` profile, undocumented and unexercised.**
`validate.py:116-118` — for `member`, the **`value`** operand must be a literal. So `member(literal "memory", b.labels)` is admitted (`exact-array-membership`), but `member(b.status, literal ["open","blocked"])` — the ordinary IN-list — is refused as `outside-profile`.
`query.md:126-127` describes `member` neutrally ("Exact membership tests an array element") and says nothing about which side may be local.
*Impact:* the most common List predicate after equality is silently outside the profile; the asymmetry is an artifact of a shared code path, not a stated rule, and no case pins either behavior.
*Fix:* decide and state it. Admitting field-in-literal-array is the better call (it lowers to an `or` of equalities, well inside the Selector), which also resolves half of finding 8. Either way add one accept and one `reject-semantic` case.

**10. `typeIs match:"exact"` does not state that it ignores the definition pin, and no fixture can catch a wrong implementation.**
`query.md:130-132`; `query.schema.json:364-391`; all fixture `type` values are bare strings.
`affiliations.md:160-161` and `core.md:1615` are explicit: nominal matching "extract[s] `.uri` from an exact affiliation; it ignores definition pin," and "Exact nominal selection does not select an exact definition revision." The new text says only "resolves a nominal Type identity and requests exact or family matching" — a reader can reasonably implement `match:"exact"` as whole-affiliation equality, which fails on every pinned Resource. Relatedly, `field(b,["type"])` sees the Reference union per `affiliations.md:168-172`, but `query.md:115-116` states the union rule only for endpoints.
*Impact:* `list --exact-type T` silently returns nothing for Scopes that pin affiliations; nothing in the ledger detects it.
*Fix:* add to §Predicates: "`typeIs` compares the nominal Type URI, extracting `.uri` from an exact affiliation and ignoring the definition pin; the `type` operand is an unpinned absolute identity. A `field` path to `type` sees the stored Reference union, like `source`/`target`." Add a fixture Bead with `"type":{"uri":…,"revision":…}` and `typeIs` exact/family cases plus a `field(b,["type","uri"])` case.

**11. No fixture can exercise the shorter-route re-expansion MUST, and it is absent from the execution obligations.**
`query.md:152-153` ("A later shorter route MUST permit the expansions a prematurely recorded longer route would hide"); `cases.json:3202-3231` (7 obligations, none about this).
In the `constraints` fixture no Bead is reachable from `A` at two different distances (d1 = {B,D}; d2 = {C,B-via-self}), so the classic visited-set/ordering bug — mark X visited at depth 2, then reach it at depth 1 and fail to expand — cannot be caught by any authored case. This is the single most commonly botched traversal rule in the document.
*Fix:* add a fixture shaped `R→X` (direct) plus `R→Y→X`, with `X→Z`, and a depth-2 case whose expected links include `X→Z`; add a matching `execution_obligations` entry. The cycle/parallel/self/boundary rules are already covered (`graph-requires-closure`, `count-before-paging`).

**12. Opaque external / foreign-Scope endpoints are undefined for graph formation and for `endpoints` navigation.**
`query.md:160-162`, `207-209`; `fixtures.json:192-214` (`external`) is used by exactly one case (`required-endpoint-unavailable`, a predicate).
`graph` must return "selected endpoint Bead editions," but `external-link`'s target is an opaque URI with no Bead. Nothing says whether graph formation omits it, carries the Reference alone, or refuses — nor whether a depth-2 walk must "expand through its opposite endpoint" (`query.md:143-144`) when that endpoint is opaque, which would make every multi-hop walk fail on any graph containing an external Link. `endpoints(…)` over such a collection has the same hole, with no "skip unresolvable" option.
*Impact:* `bd graph` is unspecified for the common case of external endpoints; the strict reading makes it unusable.
*Fix:* state that an opaque or foreign-Scope endpoint terminates expansion without failing the walk, and that `graph` carries the Link's Reference with no Bead node; state whether `endpoints` skips or refuses. Add three cases on the `external` fixture: depth-1 graph, depth-2 walk, and `endpoints`.

**13. Projection pointer pattern is far looser than RFC 6901 and silently admits the root pointer.**
`query.schema.json:44,51` — `"pattern": "^(/.*)?$"`.
This accepts `""` (whole document) and invalid escapes such as `/a~2b` or `/foo~`. `read-output.md:88,94` requires RFC 6901 syntax and "Root inclusion selects the whole unit; root omission refuses." `resource-projection.md:30-41` states no root-pointer rule at all, while line 43-44 says "Path syntax … remain errors."
*Impact:* `omit:[""]` passes the design schema and would strip protected context, which `resource-projection.md:34-35` forbids; `include:[""]` is an undeclared "full Resource" spelling distinct from omitting the member. Also `include:[]` (empty array) is admitted and, read against line 39-40, means "protected context only" — i.e. the opposite of "no mask," which `read-output.md:109` treats as an explicit mask. None of this is stated.
*Fix:* tighten the pattern to `^(/([^/~]|~[01])*)*$`, add `minItems:1` to both arrays or explicitly define the empty-array case, and add the root-pointer rule to `resource-projection.md` §Mask composition (root include = whole unit; root omit refuses). Add reject-schema cases for `/a~2b` and `omit:[""]`.

**14. Expected-result arrays have no declared shape or ordering, and two cases disagree with the rest.**
`cases.json:2516-2520` and `2711-2716` list graph links in traversal order (`csv-plan-format`, `csv-plan-format-alt`, `csv-format-review`) — `csv-format-review` sorts first lexicographically. `overview-graph-two-hops.beads` is likewise unsorted. Every other case (`graph-requires-closure`, `walk-connected`, `overview-note-family`, …) uses canonical-URI order. `expected` also carries five undeclared shapes: `ids`, `count`, `editions`, `{roots,links,beads}`, `error`.
*Impact:* a future executor cannot tell whether an order mismatch is a failure. For `resources` results, `core.md:1601-1608` mandates the advertised `order` (baseline `canonical-uri`), which the ledger satisfies only by accident; for `graph` components no order is specified anywhere.
*Fix:* add a `status`-adjacent note to `cases.json` declaring `expected` arrays as unordered sets (and normalize them to sorted order for readability), or declare canonical-URI order for `resources` and explicitly "unspecified" for graph components. Document the five `expected` variants.

**15. "Sorting" is asserted as a rule for a capability that retained Core forbids and this design does not propose.**
`query.md:218` ("Sorting applies to full selected Resource data before projection and delivery"); `resource-projection.md:16,78`.
`core.md:1601-1604`: "The order is an authority property named by the `order` discovery member, not per-request behavior: a caller cannot request a different order in BDP v0." There is no `sort` member in `query.schema.json`, no `--sort` in the canonical CLI, and no `order` field in `result`.
*Impact:* reads as authorizing a request-level sort by implication; the rule has no carrier to attach to.
*Fix:* replace with "Ordering remains the authority's advertised `order` property; this draft adds no request-level sort. Where sorting is later selected, it applies to full selected Resource data before projection and delivery," and keep ordering in integration item 3.

**16. Schema-refusal coverage exercises three mechanisms and leaves the schema's distinctive constraints untested.**
`cases.json` has 4 `reject-schema` cases (`all-without-test`, `negative-depth`, `boolean-top-level`, `raw-source-string`) covering missing-required, `minimum`, and type/`oneOf`. Unexercised: the `bind`/`binding.name` pattern (`query.schema.json:75,404,427,561,604`), `and`/`or` `minItems:1` (229,249 — asserted at `query.md:87-89`), `walk.dependentRequired.through→bind` (616-620), `field.path` `minItems:1` (141), `refs.uniqueItems` (540), `additionalProperties:false` on every node, and the projection pattern. Separately, `validate.py:191-195` never compares `case["expected"]["error"]` for `reject-schema` cases, so `"invalid-ast"` is decorative there.
*Fix:* add one case per constraint above, and either assert `expected.error == "invalid-ast"` in the schema branch or drop the key.

**17. `format: "uri"` is unenforced under the documented install.**
`query.schema.json:374-376,513-528`; `validate.py:3-4,183`.
`jsonschema` registers the `uri` format checker only when `rfc3987` or `rfc3986-validator` is importable; the documented command installs `jsonschema==4.23.0` alone, so `FormatChecker()` silently skips it (and `format` is annotation-only by default in 2020-12 regardless).
*Impact:* `"type": "requires"` (relative), `"references": ["release-spec"]`, or arbitrary garbage pass the gate while `VALIDATION.json:2` reports "schema-and-static-admission-checks-passed" — the precise failure mode `query.md:66-69` warns about ("MUST NOT manufacture a revision from a string suffix").
*Fix:* add `"pattern": "^https?://"` alongside `format`, or pin `jsonschema[format-nongpl]==4.23.0` in the docstring and assert the checker is live (`assert "uri" in FormatChecker().checkers`). Add a reject-schema case for a relative Reference.

**18. `resource-projection.md`'s plane enumeration omits `ownedLinks` and `links`.**
`resource-projection.md:37-38` covers properties/metadata nesting and revision provenance (whole-plane) but not the other two optional planes. `read-output.md:93` already treats `revisionProvenance`/`ownedLinks`/`links` uniformly as whole-plane masks, and `core.md:1363-1366` requires `ownedLinks` "on every record read" for owning Beads.
*Impact:* unstated whether an include set can drop an owning Bead's recorded owned state, which is exactly the state `affiliations.md:118-156` makes revision-covered.
*Fix:* extend line 37-38 to name `ownedLinks` and `links` as whole-plane-only, and state whether they are droppable by an include set (they must be, to be consistent with `read-output.md`, which makes finding 1's schema note mandatory).

---

## LOW

**19. `--count-only` is presented as settled while every sibling document keeps flag spellings open, and the affected product commands are not named.**
`docs/cli-design/overview/02-explore-graph.md:219` ("The canonical CLI uses `--count-only` on List and Query, including Link variants") vs `query-ir.md:207-208,220-221` ("author proposals for grammar review, not additional human rulings"; "final command argument/file spellings need a parser/grammar pass") and `query.md:44-45` (count is a *result mode*, not a flag). `bdp-cli.md` contains no `--count-only`. The "Product conveniences" note at `02:224-230` names `--title`, `bd query`, `bd sql` but omits `bd count` and `bd link count`, which `product-cli-lowering.md:100,167` route to exactly this design.
*Fix:* mark the spelling as proposed (or move it to `query-ir.md`'s proposal list) and add `bd count` / `bd link count` to the product-conveniences note.

**20. `--link-type` family semantics are never stated although the authored output depends on them, and `match:"exact"` has no CLI spelling.**
`02-explore-graph.md:145-150` — the depth-2 tree includes `explains → csv-format`, which only holds if `--link-type references` means family. The file states family semantics for `bd link list --type` (line 134-135) and for `bd list --type` (line 51) but never for `--link-type`. The `graph` profile admits `match:"exact"` (`query.md:228`, case `graph-exact-requires`) with no corresponding flag anywhere.
*Fix:* add one sentence at line 139-141 ("`--link-type` includes refinements, like `--type`") and name the exact variant (`--exact-link-type`) or record its absence as an open item.

**21. `walk.bind` without `through` is a dead binder.**
`query.schema.json:602-620` has `dependentRequired: {"through":["bind"]}` but not the converse; `validate.py:84` tolerates it via `expr.get("bind","__unused")`. `query.md:72` says a walk binding "is visible only in `through`," so a `bind` with no `through` declares a name in no region.
*Fix:* add `"bind": ["through"]` to `dependentRequired` and a reject-schema case.

**22. `required-endpoint-unavailable` encodes a runtime refusal with the same keys as a static refusal.**
`cases.json:2294,2343-2346` — `admission:"accept"` plus `expected:{"error":…}`. `validate.py:202-204` counts it as a static-admission accept and never reads the error. A consumer treating `admission:"accept"` as "returns Resources" mis-handles it.
*Fix:* add an explicit `outcome: "runtime-refusal"` (or a distinct `expected.runtime_error` key) and document the three outcome classes in the ledger header.

**23. The document's only AST example has no fixture or authored expected result.**
`query-ir.md:62-101` uses `release-spec`, which exists in no fixture; `validate.py:157-161` schema-validates and admits it but binds it to nothing. The underlying semantics are covered on `constraints` (`walk-through-before-filter` / `walk-filter-after-traversal`), so this is presentation, not a semantic gap.
*Fix:* retarget the block to the `constraints` or `overview` fixture and reference the matching case id, as `EXAMPLES.md` does.

**24. The pinned arm of the Reference-union test is never matched by any fixture.**
`cases.json:298-316` (`list-reference-union-local`) tests `l.source` and `l.source.uri`, but every `source` in the `constraints` fixture is a bare string, so the `.uri` disjunct is dead. The `pins` fixture has a pinned `target` (`pin-fixed`) that could exercise it.
*Fix:* add a `pins`-fixture case asserting `field(l,["target","uri"]) == <URI>` matches `pin-fixed` and not `pin-floating`, plus the converse for `field(l,["target"])`. This is the `identity(E,U)` notation in `reads-and-paging.md:86`, which the AST reproduces correctly but only half-tests.

**25. Two residual text issues.**
(a) `query.md:76` "Duplicate names in one declaration scope refuse" is vestigial — no node in the proposed encoding declares more than one name, so the rule is unreachable; either tie it to the surface grammar or drop it. (b) `query.md:44-45` lists the deferrals as scalar top-level evaluation, computed records, and `select`, but collection-level union/difference is also absent and undeclared; add it so a reader does not read the omission as an oversight in the "complete AST" claim. (c) `validate.py:67-70` lets `compare` pair `id(x)` with `rev(y)` (both classify as `"value"`); harmless but worth a stated rule or a domain tag.
