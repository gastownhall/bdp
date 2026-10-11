# Development Read+Update contract observations

This directory binds observations of the fixed local development receiver to
assertions in the existing conformance runner. It is **development-only and
non-attesting**. It does not make the normative Read+Update catalog executable,
admit a public write profile, or certify an implementation.

The manifest contains 23 diagnostic scenarios and 221 HTTP/lifecycle actions. The
receiver runs against a fresh disposable SQLite store for each scenario. The
executor uses the actual Read+Update SDK Fetch transport or the existing raw
HTTP executor and returns observed status, headers and body. The shared runner evaluates the assertions, captures
revision bindings, controls preparation and cleanup, and hashes the exact
catalog/manifest/fixture bytes into its report. A guard race dispatches two
real requests with the same observed revision and distinct keys.

`read-update-coverage-v1.json` inventories all 81 current normative catalog rows
in their original order. Forty-eight rows have **bounded observations**, with
stable `scenario` and `action.assertion` references. These are partial behavioral
evidence, not passing normative rows. Per-binding `limits` record known missing
variants. Thirty-three rows are explicitly omitted with a category and reason.
An empty limits array does not certify exhaustive coverage of a normative row.

The diagnostic catalog uses `development.read-update.*` IDs and `kind:
diagnostic`. Its source-only test-support bundle factory accepts only that lane.
The production bundle's `read-v1` guard, metadata-only write-catalog guard,
package exports and public profile admission remain unchanged. Every result has
`claimEligible: false` and a `development-only-non-attesting-bdptest` target label.
The report cannot establish missing inherited Read contracts either.

Run on the repository-pinned Node and pnpm versions:

```sh
pnpm build
pnpm exec vitest run apps/bdptest/src/development-matrix.test.ts packages/conformance/src/development-read-update.test.ts --maxWorkers=2 --reporter=verbose
```

Build must finish before these tests start: the process scenarios execute emitted
modules, and a concurrent clean build removes them.

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

## Deterministic process observations

Three lifecycle plans reuse the emitted-runtime IPC barrier from the existing
process tests. Dispatch 2 is parked before its callback; real HTTP reads confirm
that member 1 committed while the independent tail remains absent. The child
runs the actual receiver, evaluator, owner and SQLite store. Only its existing
scheduler is controlled; there is no mocked mutation or alternate execution path.

- Client abort disconnects the pending response, then release allows the failed
  middle member, creator-bound alias and independent tail to complete. Exact-key
  retries retrieve their ordered retained results.
- Graceful close disconnects the response but keeps the process alive while work
  is parked. Release drains the sequence before clean exit. The ordinary emitted
  executable reopens the store with the tail already present.
- SIGKILL terminates the process at the same barrier. After the ordinary emitted
  executable completes startup and serves reads, the original prefix is present
  and the alias/tail remain absent. Explicit resubmission executes the remainder;
  later retries return the same retained results.

Lifecycle actions return observations to the existing assertion engine. Full
prefix and replay bodies are hashed with SHA-256 over the existing `canonicalJson`
encoding; assertions require two observations and one distinct digest per group.
This establishes equality of parsed JSON semantic values, not raw response bytes
or HTTP headers. Static assertions also check status, operation indices, ordered
outcomes, the failed member and alias target. A negative control mutates the prefix
between observations and requires the runner's equality assertion to fail.

The original direct tests share the extracted process helper and keep their full
object comparisons. Child exit and IPC waits are bounded, every scenario owns a
disposable store, and cleanup kills/awaits remaining children before removing
fixture directories. Negative controls cover assertion failure and run abort while
the child is parked. Public server configuration and runtime modules are unchanged.

These are bounded process observations. Between-member SIGKILL does not establish
power-loss resilience, a crash inside a SQLite commit, replica failover or full
atomic state/disposition durability. Those variants remain explicit limits on
the associated inventory rows.

## Alias and pinned-reference observations

Six SDK plans extend allocation, alias validation and retained-reference cases.
Allocation returns an in-Scope canonical Bead identity with one nonempty child
segment, permits read-back of the submitted properties, and leaves an existing
alias usable. Explicit creation at that alias path fails. This does **not** force
the private allocator's next candidate to collide: deterministic collision
skipping remains an unqualified obligation on the allocation row.

Alias puts reject alias, Link and external targets with a diagnostic. Unknown
canonical targets, unknown deletes and wrong-root subjects are observed as
not-found. Retrying an admitted failure retains it after the target or alias
becomes live; a fresh key can succeed. Read-back and Link creation establish the
resulting state. The fixed all-visible principal cannot exercise hidden subjects.

Retained Link creation records an alias's canonical target across repointing,
deletion and reassignment, including reuse of the recorded locator in another
reference slot. A fresh locator resolves again on each retry: repointing or
deleting it conflicts, while restoring the original target succeeds. Recorded
misses remain misses after assignment without deleting newly reachable Beads;
unrecorded misses and canonical references conflict with the recorded miss.

Pinned endpoints preserve opaque revision strings while canonicalizing the local
alias reference. Equivalent canonical references replay; changed pin bytes,
removed pins and differently spelled external URIs conflict. Sequence-local
pinned references resolve creators and replay after their local names change.
Read-back verifies that conflicting retries did not change the original Link.
These observations do not establish historical revision resolution or external
fetch behavior. Authorization, retention and expiry variants remain omitted.

## Next qualification slices

- Bind remaining raw Host/target tests to this runner. Credential/key/media/body
  admission, Accept, and process disconnect/drain/crash observations are bound.
- Extend remaining conditional/no-op and semantic idempotency variants. Add a
  controlled allocation fixture before claiming collision skipping; live-alias
  allocation sampling does not establish that behavior.
- Add controlled owner scheduling, expiry and fault fixtures before binding
  pending keys, concurrent dependent retries, retention and restoration.
- Supply installed schema/owned-Link contracts and configurable authorization
  fixtures before observing those obligations. The fixed unowned Types and
  single all-visible local principal cannot establish them.
- Keep discovery, Operation Directory and public profile claims gated on the
  complete required evidence and a deliberate admission decision.
