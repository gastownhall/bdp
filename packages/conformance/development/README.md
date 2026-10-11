# Development Read+Update contract observations

This directory binds observations of the fixed local development receiver to
assertions in the existing conformance runner. It is **development-only and
non-attesting**. It does not make the normative Read+Update catalog executable,
admit a public write profile, or certify an implementation.

The manifest contains nine diagnostic scenarios and 57 HTTP actions. The
receiver runs against a fresh disposable SQLite store for each scenario. The
executor uses the actual Read+Update SDK Fetch transport and returns observed
status, headers and body. The shared runner evaluates the assertions, captures
revision bindings, controls preparation and cleanup, and hashes the exact
catalog/manifest/fixture bytes into its report. A guard race dispatches two
real requests with the same observed revision and distinct keys.

`read-update-coverage-v1.json` inventories all 81 current normative catalog rows
in their original order. Thirty-six rows have **bounded observations**, with
stable `scenario` and `action.assertion` references. These are partial behavioral
evidence, not passing normative rows. Per-binding `limits` record known missing
variants. Forty-five rows are explicitly omitted with a category and reason.
An empty limits array does not certify exhaustive coverage of a normative row.

The diagnostic catalog uses `development.read-update.*` IDs and `kind:
diagnostic`. Its source-only test-support bundle factory accepts only that lane.
The production bundle's `read-v1` guard, metadata-only write-catalog guard,
package exports and public profile admission remain unchanged. Every result has
`claimEligible: false` and a `development-only-non-attesting-bdptest` target label.
The report cannot establish missing inherited Read contracts either.

Run on the repository-pinned Node and pnpm versions:

```sh
pnpm exec vitest run apps/bdptest/src/development-matrix.test.ts packages/conformance/src/development-read-update.test.ts --maxWorkers=2 --reporter=verbose
```

Optionally set `BDP_DEVELOPMENT_REPORT_PATH` to an external file path to save the
successful diagnostic run. This is separate from production cohort emission.
The report identifies assertion outcomes without recording credentials or raw
response bodies. The integrity tests enforce the complete 81-row inventory and
real assertion bindings; the HTTP test also changes an expected property value
and checks that the runner reports that exact assertion as failed.

## Next qualification slices

- Bind existing process/disconnect and HTTP admission tests to this runner,
  including malformed raw fields, media negotiation, authentication and body
  limits. The current SDK lane cannot author malformed duplicate HTTP fields.
- Extend feasible alias, pin, allocated-ID, conditional/no-op and semantic
  idempotency variants without claiming missing variants already pass.
- Add controlled owner scheduling, expiry and fault fixtures before binding
  pending keys, concurrent dependent retries, retention and restoration.
- Supply installed schema/owned-Link contracts and configurable authorization
  fixtures before observing those obligations. The fixed unowned Types and
  single all-visible local principal cannot establish them.
- Keep discovery, Operation Directory and public profile claims gated on the
  complete required evidence and a deliberate admission decision.

The preceding standalone process tests distinguish transport disconnect, graceful
drain and SIGKILL between committed members. This manifest does not yet carry
those observations and does not turn them into crash or durability certification.
