Reviewed the revised snapshot (23 files) plus `changes.patch` against the prior review's findings. I did **not** run either validator (both write `VALIDATION.json`/`BINDING-VALIDATION.json`), so the checks below are static reading plus hand-recomputation of the authored fixtures/cases.

## Verification of the claimed corrections

All items on your list check out, and I found **no remaining implementation blocker**. Specifically re-derived by hand, not just read:

- **Reflexive family** — `query.md:162`, `read-delivery.md:20-23`; consistent with `affiliations.md:161` ("recorded closure") and with the retained `conformsTo`-alone lowering at `reads-and-paging.md:37`. `--exact-type any` now restated (`query-language.md:111`).
- **Endpoint identity** — `identity(E,U)` in `query-language.md:538` is byte-equivalent to the retained `reads-and-paging.md:93` definition; `--endpoint` four arms stated; `pinned-source-identity-union` + `overview-reference-links-from-plan` pin both arms, and `field.path` free-form (`query.schema.json`) makes the lowering admissible under `validate.py:155`.
- **Pins fixture** — I recomputed all 17 `pins` cases against the two new links. `resource-edition-equality` (now `pin-current-source`+`pin-old-source` via equal `pin-root@r1` target editions), `resource-identity-only` (all four), the three `current-edition-incidence-*` sets, and both stored-arm cases are all correct; `endpoint-pins-preserved`, `rev-returns-concrete` and `noncurrent-intermediate-needs-incidence` are correctly unaffected.
- **Overview** — recomputed `overview-bare-list` (4), `--type note` (3, reflexive), `overview-ratified-notes` (2), `overview-or-count` (4), `overview-reference-links-from-plan` (2 via `explains`⊂`references`), `list-generated-multi-flag-lowering` (only `csv-plan-format`). Every structured command in ch.02 is now pinned, and the link text points at `cases.json`.
- **Grammar** — `clause` requires `through`/`where`; `all` requires `as NAME where`; `through` takes `disjunction`, so the 8 `syntax-cases.json` sources all parse/refuse as labeled. Matches `query.schema.json` `$defs/all` (`bind`+`predicate` required) and `$defs/any` (`dependentRequired` pair). Alias charset now equals the AST binding pattern.
- **Schema arms** — `projectedBead`'s closed member set is compatible with the `fullBead` conjunction given `resource-projection.md:91` (full records require `properties`/`metadata`), so `no-mask-needs-full-record` legitimately became `reject-schema` and `complete-bead-page` still validates. `limit`/`sort` admission, `unboundedTraversal`, `evaluation.scope`, point-projection arm and 19-code Problem arm all present; `nodes()` in `validate-binding.py:47-54` correctly stops at `literal`.
- **Counts** — 129 AST cases, 54 binding cases, and exactly **52** `bd` shell examples across the ten documents in `validate.py`'s list (`scope-and-references.md`'s `bdp` lines are outside that list, so finding #27 is now a pure naming note as you intended). Fence parity and trailing-whitespace assertions hold on all 14 snapshot `.md` files.

## Remaining findings

**MEDIUM — `--from`/`--to`/`--endpoint` have no result-kind admission, so `bd list --from X` silently selects nothing**
*`query-language.md:102-103`, `:46-49`, `:550-551`, `:510-524`; `query.schema.json $defs/field`; `validate.py:155`*
The flags are now in the List table and the lowering table, but nothing restricts them to `bd link list`. On a Bead scan the lowering `or(field(x,["source"])==U, field(x,["source","uri"])==U)` is schema-valid and passes `local_predicate`, so it is an admitted List request whose predicate is missing-false for every candidate. Impact: an empty page instead of a refusal, in a draft that elsewhere forbids silently dropping a clause; two CLIs will differ (refuse vs. empty). Fix: add "Link List only" to the three table rows and one CLI admission bullet ("Bead List refuses endpoint flags with a Query/Link-List alternative"); optionally one authored refusal case, since the AST alone cannot carry the rule.

**LOW — two Problem rules live only in the schema arm, and `capabilityVersion` has no stated denotation**
*`read-operations.md:314-316`; `read-binding.schema.json:1341-1363`, `:1370-1382`; case `problem-unsupported`*
The schema *requires* `capability`+`capabilityVersion` for `capability-not-supported` and *forbids* `at` on `resource-not-found`, while the prose says only that feature Problems "may add" those three members. Nothing says whether `capabilityVersion` is the requested or the advertised version — the authored case carries `"2"` with `at:"/query/profile"` against a capability specified as version `"1"`. Impact: a provider following the prose emits a Problem its own published schema rejects; consumers cannot interpret the version. Fix: state both rules normatively in the refusal section and define the member as the selected/advertised version (then fix the case value).

**LOW — `typekey` is an undefined nonterminal**
*`query-language.md:496`, explained at `:499-503`*
`typename = typekey | string` is the only use of `typekey`; the prose defines `name`, `key`, `propertykey`, `string`, `uint` but never `typekey`. Fix: either add the production (same class as `propertykey`, keyword-excluded, hyphen-permitting) or spell it `key` and let the prose sentence cover it.

**LOW — the one case pinning generated flag lowering uses a non-canonical binder**
*`cases.json:5716` (`list-generated-multi-flag-lowering`) vs `query-language.md:138`*
The rule is "the explicit filter's alias when present, otherwise `_candidate`"; this case has no filter and binds `b`. Alias choice is semantically inert, but this case is the only artifact pinning the flag-only lowering, so a parser test derived from it contradicts the stated rule. Fix: rename the binder to `_candidate`.

**LOW — stale `pageSize` after the rename to `limit`**
*`read-delivery.md:90`* ("request `min(pageSize, remainingTotal)`"), against the normative `limit` at `:72`/`:80` and the renamed body member. Inherited sentence, unchanged by the patch, but the rename was the point of the fix. Fix: say `min(limit, remainingTotal)`.

**LOW (editorial) — `context.resource_kind` rule not widened to `aggregate`**
*`read-output.md:32-33` vs `:206`* The new matrix row relies on `context.resource_kind` naming the count unit, while the defining sentence still scopes that member to "Resource/collection/properties values". Fix: add `aggregate` to that enumeration.

## Not findings — new-feature/coverage requests

Continuation coverage is still one case (`continued-empty-bead-page`); `limit` replacement, frozen projection, and a cursor-bearing `cursor-expired`/`foreign-view` pairing remain uncovered. A Bead-List endpoint-flag refusal case would pin the MEDIUM above. Both are additions beyond the selected first slice, not contradictions.

## Limits of this pass

- Validators not executed (receipt-writing), so no execution evidence even for static checks.
- `specs/profiles/core/bdp-v0.1.schema.json` is absent from the snapshot and not present in `/Users/dbox/repos`, so the five native `$ref` targets the new arms depend on (`reference`, `retryDisposition`, `historyMissing`, `currentBeadRecord`/`historicalBeadRecord`) are unverified. My `fullBead`/`projectedBead` compatibility conclusion rests on `resource-projection.md:91` plus the authored accept cases, not on the native schema.
- `query-ir/EXAMPLES.md`, `INCORPORATION.md`, `examples/index.json`, `review/*` are still outside the snapshot, so `validate.py`'s example cross-checks and link assertions could not be reproduced here.
