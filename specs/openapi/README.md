# Historical OpenAPI catalog

The catalogs, command map and coverage table in this directory are historical for the November 1, 2026 specification baseline. Donna selected this disposition during the baseline review. They do not define the current Core, Write, Types or CLI contract.

The [original catalog documentation](../history/pre-canonical-20261101/openapi/README.md) is preserved. Its paired source, schemas, generator and artifacts remain available in [commit 692d801231c78e12b456d8c5213bdf137a6b534d](https://github.com/gastownhall/bdp/tree/692d801231c78e12b456d8c5213bdf137a6b534d). Historical validation requires that complete subject, including its source fingerprints, relative schema references and pinned tools. The current canonical files have changed; the old generator deliberately refuses their drift. No digest, coordinate, schema reference or generated artifact has been automatically repinned.

The specification CI lane checks canonical document structure, JSON examples, visible Core schema extraction and distribution parity, extractor regressions and the change-classification boundary. Its success is a specification check, not implementation or OpenAPI qualification. Changes to product code, dependencies, other-profile schemas or unrelated tooling continue to require the existing implementation job. Its checks remain intact, including the historical generator's refusal until the implementation alignment pass addresses it.

**Deferred 2026-11-01; owner Trish:** derive the current OpenAPI operation/source mapping from the accepted canonical baseline and embedded Core schemas, preserve conditional Events and other capability boundaries, regenerate both catalogs and tables through normal tooling, and requalify the corresponding checks. Complete historical citation-source and catalog controls from [PR #336](https://github.com/gastownhall/bdp/pull/336) remain part of that alignment duty; their old passing evidence is not inherited by the new subject.

Read the [current specification](../README.md) and [baseline review checklist](../../docs/spec-review/README.md#baseline-merge-checklist) for the selected contract and remaining review.
