# Development Read+Update contract observations

This directory binds observations of the fixed local development receiver to
assertions in the existing conformance runner. It is **development-only and
non-attesting**. It does not make the normative Read+Update catalog executable,
admit a public write profile, or certify an implementation.

The manifest contains 14 diagnostic scenarios and 105 HTTP actions. The
receiver runs against a fresh disposable SQLite store for each scenario. The
executor uses the actual Read+Update SDK Fetch transport or the existing raw
HTTP executor and returns observed status, headers and body. The shared runner evaluates the assertions, captures
revision bindings, controls preparation and cleanup, and hashes the exact
catalog/manifest/fixture bytes into its report. A guard race dispatches two
real requests with the same observed revision and distinct keys.

`read-update-coverage-v1.json` inventories all 81 current normative catalog rows
in their original order. Forty-one rows have **bounded observations**, with
stable `scenario` and `action.assertion` references. These are partial behavioral
evidence, not passing normative rows. Per-binding `limits` record known missing
variants. Forty rows are explicitly omitted with a category and reason.
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

## Raw admission and negotiation observations

Five raw diagnostic plans cover missing/wrong/malformed fixed local credentials,
duplicate credential fields; duplicate, empty, malformed and overlong keys;
request media types and ignored media parameters; malformed, duplicate-member
and unpaired-surrogate JSON; invalid UTF-8; declared and streamed body overflow;
an inclusive 64 KiB UTF-8 body; and a bodyless method refusal. Corrected requests
under the same valid keys prove that receiving refusals left keys and state
untouched. The fixed bearer policy and its concrete challenge are fixture
behavior, not a proposed production authentication requirement.

Accept probes distinguish an unknown key, an equal retained success, a retained
conflict and a retained failure. They include the explicit JSON q=0 exclusion
over a wildcard. A failed delete is retried after its formerly absent subject is
created; its old failure is retained without deleting that subject. Sequences
with retained results and unknown independent tails receive bodyless 406 before
tail admission, then recover their retained entries and execute the tail when
Accept permits JSON. A retained member failure does not replace the successful
sequence envelope with a carrier-level Problem.

The portable exact executor retains its credential, Host and framing guards.
Duplicate Authorization and chunked-overflow probes reuse the existing
`development-server` node:http helper, extracted into source-only app test
support. These cases dial only the disposable current loopback Scope with fixed
fixture credentials. They return status, headers, body and observed body length
to the existing assertion runner. They do not produce portable exact-wire
attestation or enable arbitrary credential-bearing destinations. The normal
report excludes credentials and raw response bodies.

## Next qualification slices

- Bind existing process/disconnect and remaining raw Host/target tests to this
  runner. Credential/key/media/body admission and Accept observations are bound.
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
