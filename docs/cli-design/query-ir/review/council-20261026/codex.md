1. **High — `docs/cli-design/query-language.md`, “Ask any or all” and complete grammar: nested quantifiers leave a dangling `where`.** This admitted spelling has two meaningful parses:

   ```text
   outgoing("A", depth: 2) as l
     through any outgoing(l.target) as x through x is references
     where l.status = "draft"
   ```

   The final `where` can be the inner `any` test, making draft status prune the outer traversal, or the outer collection filter, allowing traversal across active Links before selecting draft Links. Both bindings are valid because inner predicates can read `l`. The prose requires quantifier parentheses when combining Boolean operands, but does not clearly require them here; the EBNF permits both attachment structures. **Impact:** independent parsers can produce different graph reachability from the same source. **Fix:** require parentheses around a quantifier used as a `through` predicate, or otherwise introduce an explicit clause boundary. Add parser cases demonstrating both intended ASTs and rejecting the ambiguous spelling.

2. **High — `specs/profiles/core/query.md:171–210`, “Traversal”: current-root incidence does not define how the matched endpoint’s pin affects eligibility.** The current-root restriction and noncurrent-intermediate refusal do not settle this example: P is currently P@r2, and a current Link L targets P@r1. Does `incoming("P")` include L? The shared `reads-and-paging.md` distinguishes bare-identity incidence from checked-current applicability, whereas Query materializes roots as Resource editions and simply says to inspect incident Links. The captured pin cases test outgoing traversal toward pinned targets, but do not test incoming traversal starting at that same identity’s current edition. **Impact:** implementations can disagree about membership, depth, and whether the root edition is actually incident to the returned graph. **Fix:** explicitly select identity-based or edition-applicable incidence for the initial walk proposal. Cover pinned source and target endpoints, incoming/outgoing/connected, self-Links, and depth-two expansion. Preserve the distinction between a current Link population and historical incidence.

3. **Medium — `docs/cli-design/query-language.md:410` versus `docs/cli-design/query-ir/query.schema.json`, binding-name definitions: alias grammars disagree.** The friendly grammar admits `[A-Za-z_][A-Za-z0-9_-]*`, including `draft-note`, but all captured AST binding-name patterns admit only `[A-Za-z_][A-Za-z0-9_]*`. Thus:

   ```text
   beads as draft-note where draft-note.status = "draft"
   ```

   is valid friendly syntax whose straightforward documented lowering fails the AST schema. General alias normalization is not specified; capture-free renaming is discussed specifically for generated List filters. **Impact:** a conforming parser can emit a rejected request, and source-to-AST tests cannot share one identifier contract. **Fix:** either remove hyphens from variable aliases, admit them consistently in AST bindings, or specify deterministic capture-safe normalization for every friendly expression. Keep Type-name and property-key grammars independently clear.

4. **Medium — `docs/cli-design/query-ir/validate.py`, `local_predicate()` and `check_predicate()`: static List admission does not enforce the documented substring operand restriction.** List requires a literal **string** substring, but the checker accepts any `literal` node on the right, including:

   ```json
   {"op":"contains","text":{"op":"field","of":{"op":"binding","name":"b"},"path":["properties","title"]},"substring":{"op":"literal","value":5}}
   ```

   The general AST schema also admits this value. Query’s nonstring-contains-is-false semantics do not establish that this expression belongs in the narrower List profile. **Impact:** JSON request input and friendly List flags have different admission behavior, and the static admission reference is insufficient to implement the stated subset faithfully. **Fix:** enforce a string-valued literal for List `contains`, and add negative cases for number, null, array, and object substrings. These should remain static admission tests, not be presented as evaluator evidence.

5. **Medium — `specs/profiles/core/read-operations.md:92–93`, “Capability and safe dispatch”: mandatory whole-selection acquisition before the first page adds a substantial List implementation cost.** The proposal requires semantic result acquisition to finish before any successful Resource page. Taken literally, even a simple indexed List with a page size of 50 must finish establishing the complete matching selection before delivering those 50 rows. Freezing a snapshot and stable ordering does not inherently require materializing or fully evaluating every future row. **Impact:** a small List-only provider loses an ordinary streaming/indexed paging path, and the benchmark may measure this extra architectural requirement rather than unavoidable predicate or traversal cost. **Fix:** explicitly distinguish eager whole-result evaluation from snapshot-stable paged Resource delivery. Require completed evaluation for exact count, atomic graph, and definitive quantifier conclusions; decide whether ordinary Resource pages can evaluate their members incrementally and report later delivery/evaluation failures under the shared failure contract. If eager evaluation is intentional, call out and benchmark that cost as a deliberate first-slice restriction.

6. **Low — `docs/cli-design/overview/02-explore-graph.md:196–199`, related-content Query example: default output conflicts with the common collection presentation.** The command returns a Resource collection, but its illustrated output begins with the point/detail form:

   ```text
   csv-plan [guide] CSV export plan
   …
   ```

   `read-output.md` specifies table as the collection default, and the same overview uses that table layout for List. The qualifying result set itself is correct for the captured seed: only `csv-plan` has an eligible outgoing Link to a ratified target. **Impact:** readers may infer that Query changes layout according to result cardinality or has a different default renderer. **Fix:** show the normal collection table, or explicitly request `--output-format detail` and use that admitted collection detail layout.
