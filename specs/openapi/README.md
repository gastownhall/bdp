# Current BDP OpenAPI catalog

The [generated OpenAPI 3.1.1 catalog](bdp-v0.1.openapi.json) is projected from the
visible OpenAPI appendices of [Core](../profiles/core/core.md#openapi),
[Write](../profiles/write/write.md#openapi), and
[Events](../profiles/events/events.md#openapi). The profile prose and schema
appendices define the contract. [Types](../profiles/types/types.md#openapi)
documents its composition; proposed Transfer has no selected native routes.

This replaces the obsolete source-pinned catalog. There is one current API
artifact. Paths are discovered URLs, so reusable signatures live in
`components.pathItems` and `paths` is empty. The reference service's standard
inventory layout does not grant clients permission to synthesize URLs.

[Wire coverage](coverage.md) and the [CLI command map](commands.md) are generated
indexes. The synthetic fixture under fixtures/openapi is test-only. Generation,
reference checks and fixture tests do not establish implementation conformance
or external OpenAPI meta-validation.

```sh
node scripts/spec-schema-fragments.mjs --check
node scripts/generate-openapi.mjs --check
node --test scripts/openapi.node-test.mjs
```

Edit profile appendices, regenerate, review the resulting semantic diff, then run
these checks. Input digests identify current authoring sources, not an approval or
runtime grant. Original failed runs and historical source receipts remain valid
historical evidence and do not qualify this replacement.
