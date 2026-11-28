# Retiring the v0.1 TypeScript estate

**Status:** plan for review. Nothing in it has been executed.
**Measured against:** `gastownhall/bdp` main @ `1be4512e`.

## Why

The repository is to be the normative bundle plus the conformance suite. It currently also
holds a complete v0.1 TypeScript reference implementation and the suite that tests it, and
that suite validates a protocol we are no longer shipping.

**Zero TypeScript validates v0.2.3.** Searching the whole estate for reads of `specs/src` or
`specs/generated` returns exactly one file, `apps/bdp/src/canonical-input.test.ts`, and both
matches sit inside a comment block headed `RETIRED:` which states the assertion was removed
because the layout is "superseded by `specs/src/` and being retired to history", and that
porting the suite onto `specs/src/` "is tracked as its own v0.2-conformance effort". The sole
v0.2.3 reference in the estate is a note saying the code does not cover v0.2.3.

**Nothing published depends on it.** All seven packages are `private: true`.

**The v0.2.3 gate does not touch it.** `check-generated.py`'s fourth pass shells out to
`compile-generated-schemas.mjs`, which imports `ajv` directly; `ajv` is pinned in the *root*
`package.json`, so the gate keeps working after the estate leaves.

**And it blocks the `specs/` shape.** 80 files across `apps/` and `packages/` read
`specs/profiles/`, `specs/types/` and the v0.1 loose documents. Those paths cannot be retired
while their consumers exist.

## Size

| | files | lines |
|---|---|---|
| `apps/` (bdp, bdptest) | 86 | 51,616 |
| `packages/` (7, all private) | — | 512,971 |
| `fixtures/` | — | 53,224 |
| of which TypeScript (`.ts`/`.mts`) | — | 234,362 |
| `specs/profiles/` | 71 | 62,677 |
| `specs/types/` | 3 | 14,537 |
| `specs/openapi/` (generated artifact) | 4 | 15,366 |

## Target shape

`specs/` holds **`src/`, `generated/`, and `formats/`**. `formats/` stays by explicit
exception: it documents the projection of JSON Schema and OpenAPI from the markdown, which is
what makes the generated, non-human-readable artifacts reviewable.

## What stays

- `conformance/` — the Rust gate and subject.
- `specs/src`, `specs/generated`, `specs/formats`.
- The v0.2.3 tooling: `check-generated.py`, `compile-generated-schemas.mjs`,
  `generate-schema-bundles.py`, `lumen-to-{markdown,jsonschema,openapi,callables}.py`.
- `docs/`, including `docs/history/`.
- A minimal root `package.json` + lockfile, because `compile-generated-schemas.mjs` needs
  `ajv`. This is the only reason Node tooling survives at all.

## What goes

- `apps/bdp`, `apps/bdptest`.
- All seven packages: `adapter-in-memory`, `bd-domain`, `client`, `config`, `conformance`
  (the **TypeScript** one — not `conformance/`, the Rust suite), `protocol`, `server`.
- `fixtures/` (v0.1 OpenAPI and markdown-contract fixtures).
- The four `vitest.*.config.ts`, the three `tsconfig*.json`, and biome's TS configuration.
- Twenty v0.1-facing scripts, classified by whether they read the doomed spec directories:
  `canonical-spec-revision.mjs`, `check_type_examples.py`, `check_types_selected.py`,
  `ci-impact-selection.node-test.mjs`, `current-provider-kit{,-callables,.node-test}.mjs`,
  `generate-callable-catalog.mjs`, `generate-issue-callables.py`,
  `generate-markdown-contracts.mjs`, `generate-openapi.mjs`, `generate-read-cohort.mts`,
  `markdown-contracts.node-test.mjs`, `markdown-schema.node-test.mjs`,
  `openapi.node-test.mjs`, `read-cohort-evidence.mjs`, `spec-schema-fragments{,.node-test}.mjs`,
  `check-spec-editorial-test.py`.
- `specs/profiles/`, `specs/types/`, `specs/openapi/`.
- The v0.1 loose documents under `specs/`.
- In `ci.yml`: the `implementation` job, the `regression` job and its four `Full Vitest`
  groups, and the npm scripts that drive them.

## The one thing that must be ported, not deleted

`scripts/check-spec-editorial.py` is the `specification` CI job's gate and it **straddles both
worlds**. Its v0.2.3 footprint is one path (`specs/generated/core.md`); its document set
(lines ~158–167), its `EDITORIAL_PREFIXES`, and its `CORE_BUNDLES`/`FEATURE_BUNDLES` are all
v0.1. It currently reports "8 documents", and those eight are v0.1 profile documents.

So it is predominantly a v0.1 document checker with one v0.2.3 file bolted on, and the
`RETIRED` comment quoted above names porting it as part of this effort.

**Residual gap, which needs a decision rather than a default.** What that checker uniquely
provides is markdown **link and anchor resolution** plus JSON-example validation.
`check-generated.py` covers drift, `$ref` resolution and schema compilation — it does **not**
check that a link in `specs/src/bdp.md` or `specs/generated/core.md` resolves. Retiring the
editorial checker without porting that part loses link validation for the documents we are
shipping. Either port the link/anchor checker onto `specs/src` + `specs/generated`, or accept
the loss knowingly.

## Stages

Each stage is independently green and independently revertible.

**Stage 0 — port the editorial gate.** Repoint `check-spec-editorial.py`'s document set and
`EDITORIAL_PREFIXES` onto `specs/src` + `specs/generated`, and decide the link/anchor
question above. Nothing else can proceed safely until the `specification` job no longer
depends on the doomed directories. *Must come first.*

**Stage 1 — CI structure.** Retire the `implementation` and `regression` jobs and the four
`Full Vitest` groups. `verify` currently declares `needs: [changes, specification,
implementation, regression]` and asserts on each result, so it must be restructured in the
same commit or it breaks. Note that this also removes the editorial/non-editorial branch in
`verify`, since the lanes it switches between will no longer exist.

**Stage 2 — delete the estate.** `apps/`, `packages/`, `fixtures/`, the vitest and tsconfig
files, the twenty v0.1 scripts, and their npm scripts. One commit per coherent group so a
bisect stays useful.

**Stage 3 — retire the spec directories.** `specs/profiles/`, `specs/types/`,
`specs/openapi/` and the v0.1 loose documents. Per the standing bias toward eliminating
obsolete material, these are deleted rather than archived **except** where `docs/history/`
citations already point at them — those targets move rather than die, which is the same
constraint that governed #405 and #408.

**Stage 4 — sweep the references.** `README.md`, `STATUS.md`, `docs/design/*`,
`docs/plans/*`, `docs/spec-review/README.md` and `CONTEXT.md` all cite retired paths. Prose
only, but it is the difference between a clean tree and a tree full of dead links.

## Risks, stated rather than discovered later

1. **Verification thins to the Rust gate at 21/54.** This is the real cost. The mitigation is
   not to keep the TS suite — it verifies a protocol we do not ship — but to be deliberate
   that for a period the repo's only live verification is the Rust gate plus the Python
   generator gates. Thin verification of what we ship beats thorough verification of what we
   do not, but it should be a stated choice.
2. **Markdown link validation for v0.2.3 is lost unless Stage 0 ports it.** See above.
3. **Sealed cohort evidence.** `generate-read-cohort.mts` is a retired producer and
   `read-cohort-evidence.mjs` reads frozen fixtures. A sealed fixture pins the document paths
   it cites and there is no verify-only re-seal path, so frozen evidence can only be
   superseded, never edited. Deleting readers may orphan fixtures that history cites; check
   before deleting, as in #405.
4. **`docs/design/spec-path-map.json`** is consumed by `spec-layout.test.ts`, which dies in
   Stage 2. Decide whether the anchor map remains useful for `docs/history/` citations or
   becomes orphaned data.
5. **`experimental/`** (7 files) references `specs/formats/`, which survives — so it is
   unaffected, but it should be confirmed rather than assumed.

## "Replacing the estate" is the wrong test — and the right one exposes a real gap

The conformance lane raised the sharpest objection to this plan, and it refines rather than
breaks it. Paraphrased: *"credibly covering what that estate covered" is not the same quantity
as 54 rows. My denominator is the wire surface of core's 13 primitives. The estate covered
whatever it covered — profiles, types, events — which I have never measured. So "my gate can
replace that plumbing" is a claim I have no instrument to make, and 54/54 would not establish
it.*

That is correct, and the conclusion is that **replacement is the wrong test.** The estate
covered the *v0.1* surface. The test is relevance, not equivalence:

- `specs/profiles/` held `callables`, `core`, `events`, `transfer`, `types`, `write`.
  **`events`, `transfer` and `callables` have no v0.2.3 successor** — those are features
  dropped, not coverage lost.
- `core` and `write` became `core.lumen`, whose wire surface *is* the gate's 54 rows.
- `types` folded into `core.lumen`'s type system.

**But the gap the objection points at is real, and it exists today.** v0.2.3 has four packs —
`issue`, `memory`, `ops`, `stdlib` — and a type system. Their only verification is
**structural**: `check-generated.py` regenerates the callable catalogs and asserts the JSON is
well-formed with every `$ref` resolving. Nothing checks their *behaviour*. The Rust gate is
core-only by construction; its own test is named
`denominator_has_13_ops_and_matches_core_primitives`.

**Sized.** The storage lane measured its own suite against this: 34 behavioural cases — 15
`core`, 10 `errors`, 6 `query`, 3 `revision` — and **not one** references `issue`, `memory`,
`ops`, `stdlib` or the type system. There is no pack family in its `src/cases/` at all. Set
against the normative-line counts (re-derived here at `c511f88c`, core-only vs all-source as
established):

| | normative lines | behavioural cases |
|---|---|---|
| `core` | 67 + 14 store-wide guarantees = 81 | 34 |
| **packs** | **39** (issue 8, memory 6, ops 6, stdlib 19), no store-wide list in any | **zero** |

So the number for this hole is **39 normative lines with nothing behind them**. A grid reading
321 pass / 0 fail / 66 skip across nine columns is evidence about core's primitives on three
backends and says nothing whatever about those 39 — they are not under-reported by that grid,
they are outside its denominator.

### The pack fault surface cannot be expressed in the gate's unit at all

Seven Problem codes are declared in prose only — six in `stdlib`'s declared block, one in `ops`
— and reach no generated artifact. Two further names in that block are core codes deliberately
reused (`limit-exceeded` is called out as "core's existing 422 static-bound code, NOT a new
`batch-*` code").

I first concluded from that reuse that a pack-inclusive denominator would have to **deduplicate**
against core's 54. **That was wrong, and the real answer is stronger.** The gate's denominator
counts `(op, status)` pairs; Problem *codes* live in the Problem body and in prose, so they are
not rows — and that holds for core's own codes too:

```
core.openapi.json occurrences:
  not-found 0 · revision-mismatch 0 · capability-not-supported 0 · identity-taken 0
  limit-exceeded 1   (inside a description)
```

There was never anything to deduplicate against. And the structural fact that settles it: `call`
declares exactly `[200, 201, 409, 202]`, so one row at `>=400` — the domain-failure arm. Its
*fault* status is open-ended **by design**, stated verbatim in the spec:

> The HTTP status aligns (200 success · 409 the domain failure · **the Problem's own status for
> a fault** · 202 for an async `AsyncResult`)

So every pack fault, whatever its code, arrives through `op/call` carrying a status the catalog
does not enumerate and **cannot**, because the spec deliberately leaves it open. The surface
tripwire would never notice, since it compares declared rows against declared rows.

**Consequence: two denominators, not one.** A pack-level suite needs its own instrument in its
own unit — callables × declared domain arms × declared Problem codes — and it is not an
extension of the wire surface. Annotating the seven codes is *necessary* for a code-level
denominator and *insufficient* to fold the packs into the gate's, because a code is not an
`(op, status)` pair.

**Which is the honest answer to "can this gate replace the estate", and it is better than any
number.** Not "54 is not enough rows", not "the packs are unmeasured", but: **the gate measures
one surface in one unit; the packs are a different surface in a different unit; and no amount of
progress on the first produces coverage of the second.** That is defensible at a tag in a way a
fraction never is, and it is falsifiable — if someone derives a single denominator over both,
this is wrong and should be shown so.

The honest figure, with its conditions attached: *42 callables / 9 domain arms at `c511f88c`,
plus 7 prose-declared Problem codes of which 2 are core reuses, pack total not derivable.*
Unwieldy, and the unwieldiness is the finding.

So the packs and the type system have no behavioural conformance **before or after this
retirement**. Retiring the estate does not create that gap — it makes it visible, by removing
the large suite whose presence implied the repository was broadly verified. That is worth
saying plainly, because "we retired the TS estate and coverage looks thin" and "the packs were
never verified" are different problems and only one of them is caused here.

**And it puts #418 in the critical path rather than beside it.** If retiring the estate rests
on the Rust gate's credibility, then a conformance denominator asserting store-wide guarantees
that a conformant store may legitimately break is not an adjacent tidy-up.

## What this does not decide

Whether the repo keeps a Node toolchain at all. After this, the only Node left is
`compile-generated-schemas.mjs` and its `ajv` dependency. Replacing that pass with a Python
validator would remove `package.json`, the lockfile and `node_modules` entirely. Worth
considering, out of scope here.
