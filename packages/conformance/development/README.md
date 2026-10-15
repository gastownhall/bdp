# Development Read+Update contract observations

This directory binds observations of the fixed local development receiver to
assertions in the existing conformance runner. It is **development-only and
non-attesting**. It does not make the normative Read+Update catalog executable,
admit a public write profile, or certify an implementation.

The manifest contains 29 diagnostic scenarios and 312 HTTP/lifecycle actions. The
receiver runs against a fresh disposable SQLite store for each scenario. The
executor uses the actual Read+Update SDK Fetch transport or the existing raw
HTTP executor and returns observed status, headers and body. The shared runner evaluates the assertions, captures
revision bindings, controls preparation and cleanup, and hashes the exact
catalog/manifest/fixture bytes into its report. A guard race dispatches two
real requests with the same observed revision and distinct keys.

`read-update-coverage-v1.json` inventories all 82 current normative catalog rows
in their original order. Fifty-eight rows have **bounded observations**, with
stable `scenario` and `action.assertion` references. These are partial behavioral
evidence, not passing normative rows. Per-binding `limits` record known missing
variants. Twenty-four rows are explicitly omitted with a category and reason.
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
Allocation returns an in-Scope Bead identity with one nonempty child segment
that differs from the live reserved alias segment in this single observation.
The identity is stable under URL serialization; the independent BDP canonical
segment grammar is not checked here. Read-back observes the submitted properties
and the existing alias remains usable. Explicit creation at that alias path fails.
This does **not** force the private allocator's next candidate to collide: deterministic collision
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

Eleven immediate alias reads establish the live target or absence after setup
mutations, before retained-replay assertions. The SDK resolves aliases with
redirects disabled: live observations require 307 with the canonical Location
and no body, while deleted aliases require resource-not-found. HTTP 200 from
the preceding mutation alone is not treated as proof of its resulting state.

Pinned endpoints preserve opaque revision strings while canonicalizing the local
alias reference. Equivalent canonical references replay; changed pin bytes,
removed pins and differently spelled external URIs conflict. Sequence-local
pinned references resolve creators and replay after their local names change.
Read-back verifies that conflicting retries did not change the original Link.
These observations do not establish historical revision resolution or external
fetch behavior. Authorization, retention and expiry variants remain omitted.

## Pending retries and interleaving

Two further process plans keep the same emitted runtime and dispatch-2 barrier.
While the original request is parked, real HTTP requests observe reserved creator,
dependent and independent-tail keys. Equal and statically different pending
presentations receive in-progress without running ahead. A second sequence with a
fresh dependent key receives a transient dependency failure while its independent
tail succeeds. After release, the original completes successfully and an exact-key
retry has the same parsed JSON body. The fresh dependent key then executes and
replays successfully, proving that its transient result was not retained.

An interleaving plan commits an unrelated update before release. The original
later update preserves that property and adds its own; a guard using the
intervening revision subsequently fails. Retrying the unrelated update returns
its original postimage, and the original sequence also replays identically.

Connected plans await the original bounded Fetch response after release: competing
requests change scheduler dispatch indices, so a fixed turn count cannot establish
which request completed. Existing disconnected plans keep their established
four-member completion barrier. Rejections are consumed immediately, and cleanup
aborts/awaits the original request and kills/awaits the owned child. The scheduler,
runtime, matrix test budget and public configuration remain unchanged.

These add bounded in-progress, reservation, transient-dependency, nonretention and
interleaving observations. They do not qualify admission-midpoint atomicity,
rate-limited or service-unavailable variants, multiple writers, expiry, policy
changes or internal storage faults. The HTTP authority's 24-hour retention and
real clock remain unchanged; no time-travel or manufactured outcomes were used.

## Next qualification slices

- Bind remaining raw Host/target tests to this runner. Credential/key/media/body
  admission, Accept, and process disconnect/drain/crash observations are bound.
- Extend remaining conditional/no-op and semantic idempotency variants. Add a
  controlled allocation fixture before claiming collision skipping; live-alias
  allocation sampling does not establish that behavior.
- Pending-key and concurrent dependent retries are now observed with the existing
  process barrier. Add justified expiry/fault fixtures before binding retention,
  restoration, admission-midpoint atomicity and execution-fault variants.
- Supply installed schema/owned-Link contracts and configurable authorization
  fixtures before observing those obligations. The fixed unowned Types and
  single all-visible local principal cannot establish them.
- Keep discovery, Operation Directory and public profile claims gated on the
  complete required evidence and a deliberate admission decision.

## Contextual sequence validation observations

Two plans distinguish a wrong-kind local binding from a wrong-kind durable
subject. A named Bead used as an updateLink subject rejects the whole carrier;
a read proves the prefix absent, and correcting the operation under both
original keys creates and updates the Bead. The result indices, declared name
and final properties are asserted directly.

A live Link used as an updateBead subject fails that member with
resource-not-found while the independent tail commits. Reads establish the
unchanged Link and live tail. Exact-key retry retains the selected original
result fields; correcting the subject under the retained key conflicts, while a
fresh key updates the Bead. A guarded no-op using the Link's originally captured
revision establishes that the rejected operations did not advance its revision.

These are bounded contextual-validation observations, not closure of the
normative row. Owned results/sourceRevision, broader Scope containment,
forward/unknown labels, key/name uniqueness and other contextual combinations
remain unqualified by these plans. Replay assertions compare selected fields and
key behavior, not entire response bytes. Existing SDK request actions suffice;
no runtime, harness, schema, public profile or fixture policy changes are made.

## Controlled retention observations

One process plan supplies a private fixed retention clock to the real emitted
receiver and reopens the same disposable store and Scope at the initial time,
24 hours minus one millisecond, exactly 24 hours, and one millisecond later.
Normal startup expiry performs the changes. The public development options and
exports remain unchanged; no database fields or retained outcomes are fabricated,
no retention interval is shortened, and no global clock is patched.

A creation is replayed with its original postimage before expiry while its live
Resource has newer properties. The boundary then produces idempotency-expired
without a Resource body; changed semantics still conflict. A guard against the
previously captured live revision confirms that the expired retry did not mutate
the Resource. Before-boundary retries do not renew the expiry interval.

A failed delete remains resource-not-found before expiry even after its subject
is created. At the boundary, the store forgets that failure and the same key
successfully deletes the now-live subject. Reads and another retry establish the
new deletion, and a further reopen preserves both the success tombstone and the
newly retained deletion. Failure forgetting is this store's permitted behavior,
not a requirement that every authority forget failures at that time.

The clock control validates nondecreasing integer elapsed time within a seven-day
fixture window and only runs in its dedicated disposable process mode. Ordinary
process controls are refused there. Negative tests exercise malformed/backward
controls and cleanup after failed assertions or abort following reopen.

These observations cover creation-success expiry and one failed deletion only.
The 24-hour interval belongs to this fixture; retention-minimum remains omitted
because the endpoint advertises no retention limit. Live periodic maintenance,
other successful mutation categories, alias retry witnesses, expired creator
bindings, restore and full-profile qualification remain outside this slice.

## Expired creator binding observation

A named Bead creation allocates its own identity, which the plan captures from
its initial result. After reopening at the private fixture expiry boundary, the
same creator key with a renamed label reports idempotency-expired without its
Resource body. A fresh updateBead member using that label succeeds. A GET using
the originally captured identity verifies that the dependent updated that exact
Bead, rather than a replacement identity.

A fresh singleton then changes the Bead's live properties. Retrying the sequence
with another label returns the dependent's retained older postimage, while a
GET of the captured identity still returns the newer live state. A further
reopen repeats this expiry, binding and retained-result distinction.

This observes one allocated Bead creator and an updateBead dependent. It does
not qualify Link creators, aliases, pins, deleted creators, authorization
changes, internal tombstone fields, live periodic maintenance or the entire
normative row. The fixture boundary does not advertise a retention window;
retention-minimum remains omitted. Only the diagnostic artifacts change; the
existing request, capture, binding and retention-reopen actions are reused.
