# Canonical specification editing

This is Donna's current Core/Write/Types/Events/Transfer/CLI review corpus,
assembled from main commit `692d801231c78e12b456d8c5213bdf137a6b534d`.

## Open these files

1. [Core](../../specs/profiles/core/core.md)
2. [Write](../../specs/profiles/write/write.md)
3. [Types](../../specs/profiles/types/types.md)
4. [Events](../../specs/profiles/events/events.md)
5. [Transfer — proposed](../../specs/profiles/transfer/transfer.md)
6. [CLI](../cli-design/bdp-cli.md)

Each rule belongs directly in its canonical document. Core owns Resources,
References, discovery, authorization, reads and HTTP; Write owns mutations and
atomic effects; Types owns optional definition interpretation and constraints;
Events owns optional observation. Transfer remains proposed, with its
[unresolved mappings](transfer-review.md) explicit. The [CLI mismatch audit](cli-mismatches.md)
records Donna's rulings; client examples cannot add protocol capabilities.

## Donna's edit loop and landing sequence

Donna edits in VS Code and leaves comments; `<!-- Donna: ... -->` is an optional
searchable form. One writer owns a file at a time. Trish reads and processes the
comments, checks the source, and pushes. Semantic decisions return to Donna;
mechanical corrections do not need a separate approval cycle.

Donna explicitly authorized Trish to finish and merge this structural round of
PR337 as the current working draft, then align and merge the BDP reference client,
service and tests against that exact specification commit. Required checks and
independent review still apply. The full human editorial review continues through
small subsequent PRs. A working-draft merge is not final specification approval,
a release, consumer-pin promotion or implementation qualification.

All other fleet work, Beads work and queued handoffs remain paused. The earlier
baseline brief's Donna-only merger and wait-for-the-complete-review sequencing
are superseded by this explicit direction. Its original source and failed-run
receipts remain historical evidence, not current execution authority.

## Schema and OpenAPI authoring

Read the prose with its JSON exemplars first. Each profile ends with **Schemas**
then **OpenAPI**. Full schema DSL is outside the linear narrative. Matching
`bdp-schema:start NAME` / `bdp-schema:end NAME` HTML comments delimit visible
markdown-json-schema/0.6 definitions. Feature resources add an explicit
`bundle=id-root` or `bundle=types` qualifier; their identical local names do not
merge with the shared schema resource.

Core, Write and Events jointly own the shared bundle's named definitions; the
ownership/source inventories account for every fragment. Types and id-root keep
separate IDs and reference contexts. Initial ownership migration preserves all
previous definitions; removal, rename or silent cross-profile duplication fails.
Ownership moves and new definitions require the explicit `--migrate-ownership`
command. Make that mechanical addition or move while all existing definitions
retain their values; apply ordinary value edits afterward with `--write`. This
two-step procedure never requires hand-editing the JSON distributions.
Unused inherited helpers do not add operations. JSON Schema cannot express every
semantic obligation in the prose.

The visible OpenAPI tables are the current operation authoring source. The
[notation](../../specs/formats/markdown-openapi.md) projects discovered-URL families
and shared Core HTTP rules into [one current catalog](../../specs/openapi/README.md).
Synthetic fixture routes live under fixtures, not as a second API specification.
Types composes existing operations; Transfer has no selected native wire binding.
The obsolete catalog and historical OpenAPI document are removed from live source;
Git history preserves their original content and failed-run evidence.

```sh
node scripts/spec-schema-fragments.mjs --write
node scripts/spec-schema-fragments.mjs --check
node scripts/generate-openapi.mjs
node scripts/generate-openapi.mjs --check
node scripts/generate-markdown-contracts.mjs --check
```

## CI and implementation alignment

CI stays enabled. The specification job checks document links/fences/JSON examples,
all profile schema extraction and distribution parity, source-ownership controls,
current OpenAPI regeneration/HTTP fixtures, and generated Markdown projections.
It uses the frozen workspace dependencies and repository-pinned hosted runtime.
These checks qualify source consistency, not provider conformance or external
OpenAPI meta-validation.

The change classifier examines complete Git deltas and file modes. Authored Core
and Events schema edits may change the intended specification while this lane
continues to report implementation as unqualified; that separation is deliberate. Its regression
cases reject mixed product/dependency/unrelated-schema edits, missing owned
schemas, negative-zero drift, mirror drift and symlinks. Newly authored Write and
feature schemas must preserve their existing meaning; the prior reviewed removal
of mandatory Events remains the narrow Write exception. Named generated artifacts
must reproduce from the source in the required specification job.

Product changes run the existing implementation job with its normal build, lint,
typecheck, test, smoke and evidence checks. A skipped implementation job is reported
as unqualified, not green conformance. Reference alignment gets its own exact source,
coverage/gap inventory, targeted repairs, actual incoming CI and final-main check.
No existing failure is rewritten as a pass by this sequencing change.

## Preserved baseline accounting

CLI rulings remain resolved at `2aceaa942a14f8918d282e3736acb8cd7eacbbad`, with
HTTP flags and full Type/packaging lifecycle deferred. DNS-neutral identity remains
the next design decision; native Query, richer batch and Transfer binding are
unadopted. [#336 was archived without merge](https://github.com/gastownhall/bdp/pull/336#issuecomment-6569514085)
with branch, exact source and citation/test residuals preserved under Trish's
alignment duties. No wholesale cherry-pick or inherited qualification follows.
Historical v0 schemas remain evidence inputs, not the current specification.

The legacy Python `scripts/check_type_examples.py` consumes pinned historical
fixtures and retired source text. It is not a current canonical acceptance gate;
its source re-key remains an explicit Trish-owned alignment duty, with original
assertions and pins preserved. Current profile/source checks are the Node and
document commands above.
