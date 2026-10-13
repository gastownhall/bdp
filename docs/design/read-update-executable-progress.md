# First cumulative Read+Update executable slice

This source-private slice executes real HTTP against the installed reference factory. It does not enable public Read+Update startup, generate profile evidence, or qualify the profile. The unfiltered run includes every applicable cumulative catalog row; missing plans are reported as `harness-error` / `not-implemented`. Inherited Read and companion rows remain unobserved against this configuration.

The manifest `packages/conformance/matrices/read-update-v1.json` is version 2 and uses the cumulative catalog selected by the existing canonical loader. The fixture is `packages/conformance/fixtures/read-update-reference-v1.json`. The machine-checked inventory `packages/conformance/test-support/read-update-coverage-v1.json` lists every required ID once, exact assertion bindings, and remaining limits.

| Executed row | Observations | Whole contract in this slice |
| --- | --- | --- |
| `read-update.discovery.document` | Cold service-desc navigation, RU closed schema, operation directory, actual canonical collection order | Incomplete: target advertises order; omitted-order fallback not observed |
| `read-update.singleton.create-bead` | Honored and authority-allocated identities, independent GET of each returned postimage | Yes |
| `read-update.singleton.update-bead` | Guarded properties patch, direct no-op response equality and independent GET of retained complete postimage | Incomplete: metadata-patch object and effective-Type-schema rejection clauses remain unobserved |
| `read-update.singleton.delete-bead` | Live incident-Link refusal, unchanged GET, remove Link, final identity without minting, ordinary/properties/links 404s | Yes |
| `read-update.singleton.expected-revision` | Matching guard, stale update/delete refusal with unchanged independent GET, unguarded update, guarded deletion | Yes |
| `read-update.singleton.idempotent-retry` | Retained retry preserves allocated identity and complete disposition, independent GET | Incomplete: in-flight/expired and sequence comparison remain |
| `read-update.singleton.idempotency-conflict` | Changed semantic input refused, unchanged independent GET, original disposition still retained | Yes |

A passing authored probe is not a completed required row when the inventory names an unobserved branch. The four whole-contract rows are a bounded implementation observation, not an admission decision. Of 129 required IDs, 125 remain uncovered; seven rows have bounded observations.

## Artifact and observation identity

The private cumulative factory requires a factory-branded canonical selection. It accepts no caller catalog or requirement subset. The cumulative `catalogDigest` commits canonical JSON of the exact per-file digest map, reproduced from source bytes and preserved in the progress record. Its merged catalog order matches the canonical loader. Existing public Read and diagnostic-only development factories, package exports, sealed artifacts and evidence schema remain unchanged.

The private progress record links actual IPC receipts and factory-bound configuration to the report's manifest/fixture/catalog digests and exact HTTP configuration digest. The installed factory supplies payload, complete tagged contract, access-policy and authentication identities plus Scope/profile/History. The complete `development-schema5-<digest>` contract identity is preserved and compared; only its strictly validated digest component enters the existing digest field. Unknown tags/versions are refused. Source commit and dirty status are verified launcher Git metadata, not target assertions. Every prepared scenario must match the baseline observed configuration before requests begin.

The reference process is launched with configuration over inherited IPC. Tokens remain in its configuration and the transport credential resolver, never in manifests or reports. Dynamic client actions use the real exact serializer, record its write metadata and actual response, and independently GET afterstate. They substitute only captured string fields into request bodies; missing capture fails before HTTP. A captured allocated Bead URL receives a single canonical, same-Scope exact route tied to the same frozen listener and credentials. No wildcard routing or lifecycle outcome injection is used.

The shared JSON-pointer assertion now supports exclusive `equalsBinding` against an earlier capture. Missing, late or self capture is rejected; runtime equality compares JSON types without coercion and never treats two absent values as equal. It is unavailable with normalization or another expected-value source. Native HTTP capture behavior remains unchanged; the relative Operation Directory members are captured by a real client GET and resolved against the observed directory URL.

## Reproducing the observations

Build first, then run `apps/bdptest/src/read-update-matrix.test.ts` with pinned Node24.16.0 and pnpm11.20.0. By default it runs emitted reference factory bytes. To run packed/installed bytes, pack the server/protocol packages, install their tarballs into an isolated prefix with scripts disabled, then set `BDP_CUMULATIVE_INSTALLED_ENTRY` to that installation's `@bdp/server/dist/installed-reference-process.js`. Optional `BDP_CUMULATIVE_REPORT_PATH` saves the private progress record. Tests verify that the record contains no fixture credential bytes.

Next, add actual inherited Read and companion bindings and the remaining RU contracts against this same configured factory. Preserve the closed Read schema in its own Read matrix; any inherited RU discovery prerequisite must bind the RU replacement and satisfy execution ordering. Remaining ownership, aliases, sequence admission/concurrency, authorization-view/retention and error contracts are not inferred from these singleton observations. Transactional execution remains separate.
