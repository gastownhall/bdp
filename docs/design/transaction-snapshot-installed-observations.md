# Private installed Snapshot observations

`apps/bdptest/src/transactional-snapshot-installed.test.ts` observes the existing
private installed Transactional process through the unchanged inherited-IPC
launcher, installed metadata validator and exact raw HTTP executor. It adds no
runner scenario, coverage mapping, public export or profile admission.

The default entry is the emitted process. Setting `BDP_TRANSACTIONAL_INSTALLED_ENTRY`
to the actual installed tarball's private process path runs the identical tests
against packed bytes. This test file requires an explicit
`BDP_TRANSACTIONAL_SOURCE_COMMIT` with that override.
That commit is declared provenance, not derived from the target. Each ledger
also records the realpath entry's independently measured SHA-256 and a dirty
workspace diagnostic; ordinary emitted development tests may use dirty source.
An external packed-run supervisor must separately check clean source, build that
exact commit, pack/install it, and supply both environment values. This test file
does not enforce that external build procedure; the sibling Transactional matrix
retains its inherited source-label default. The process uses its default clock,
compiler, captured artifacts and runtime settings. No test clock, SQLite inspection or injected
success response is involved. Canonical URLs and Host remain
`https://reference.invalid/acme/`; the ready message's validated loopback address
selects only the physical socket. Credentials are local random tokens and never
written to observation logs.

## Observations and countercontrols

- Real commands create 34 Beads and 34 owned Links. Both captured streams have a
  continuation. Expected identities, complete counts, seeded type/properties/
  metadata and Link source/target fields are checked independently of pagination
  traversal before checking the owned Link copy. Exact properties and metadata comparisons reject changed, missing or added
  seeded members even if all server projections agree. Opaque revisions remain
  actual observations.
- Hosted Type descriptor JSON is read from the same listener and compared
  with the configured contents; Type serialization may reorder object members.
  Real metadata binds installed payload, compiled contract, policy,
  authentication, runtime configuration and declared source commit; restart
  requires the same binding.
- Captured manifest and page bodies remain byte-identical after a mutation and
  actual process restart. A different authorized reader receives the same
  retained representations with current response context. Initial continuation
  bodies are read as operator; all retained bodies replay as reader.
- A finite changefeed is read from the literal captured checkpoint. Applying its
  actual changes to the captured replica must equal all independently enumerated
  current point reads. Dropping that group or omitting an expected Link makes the
  comparison fail. The at-head group must contain exactly one change and have
  null continuation. Point-read `links` navigation is excluded because it is not
  a captured Snapshot Resource field. The initial safe creation uses a read-only
  principal; a real reader batch is refused and leaves its requested Resource
  absent and the initial Snapshot empty at genesis.
- UTF-8 manifest HEAD length matches actual GET octets and differs from JavaScript
  string length. A real continuation token borrowed across stream kinds is refused.
- A separate fresh fixture using the same measured payload, default settings and
  small Resource shape calibrates eight consecutive captures then a ninth 503.
  Seven live handles in the observation fixture then precede real HEAD, 304, 412, 406, authentication, method,
  Origin, malformed-query and unsupported-control observations. The next capture
  succeeds as the eighth unique handle; the ninth is a retryable 503. All eight
  retained manifests still work and capacity refusal survives process restart.
  This is a calibrated capacity inference, not direct observation of the private
  ledger or a universal capacity policy. Both fixtures use the same setup and
  compiled artifact inputs; fresh credentials intentionally change auth bindings.

Each observation requires a completed raw request write and framed HTTP response;
receiver activity alone cannot pass a test. Test cleanup closes/reaps each child,
with one 45-second aggregate deadline per service test and existing bounded
launcher shutdown. Calibration and the following nonallocation fixture share
that same controller; startup, exchanges and reopen never reset it. A fixture
cannot start after aggregate expiry. The existing 10-second launcher cleanup
allowance remains inside the unchanged 60-second outer test timeout. Single-
fixture tests still get the same 45-second budget. Each
request retains the executor's five-second bound. Observation/startup failures
and cleanup failures retain their individual causes in an AggregateError.
The deadline is checked after observation and after cleanup; the completed-wire
ledger explicitly says passed or failed and records abort state and safe route
URLs, including on cleanup failure. Missing body-octet observations fail instead
of becoming sentinel data. Responses must carry the nonattesting marker and JSON
or Problem media type as applicable; 406 must carry Vary: Accept. The raw executor enforces HTTP body framing before returning a response; no
separate framing check is claimed by the Snapshot assertions. Local lifecycle
countercontrols cover
primary+cleanup failures and aborts after the last wire or during cleanup; they
are helper tests, not synthetic successful target responses. Scaled deterministic
controls also expire the aggregate budget between fixtures (no later fixture
starts) and during the second observation (cleanup occurs and no late passed
ledger is emitted). A passed first-fixture ledger remains its own completed
observation, not a claim that the later aggregate test passed. No request bodies
or credential headers are serialized into the safe summary.

## Limits

The two service tests are transport observations, not complete installed Snapshot or
Transactional conformance. They do not populate matrix rows or change whole-row
flags. No public profile is activated and `claimEligible` remains false.

All supplied consistency controls remain the explicit Q1 unsupported branch.
The tests do not sleep for the five-minute retention lifetime or claim expiry,
clocked behavior, HTTP disconnect-to-AbortSignal propagation, crash recovery,
maximum response bytes, ledger capacity or capacity-shape heap qualification.
They use the existing all-visible fixed view. They do not claim JSON Schema
artifact hosting; the compiled artifact digest and Type descriptor reads are
separate observations. In-process clocked and fault tests
remain separate evidence. Test response decoding is bounded to 1 MiB for this
small fixture; that is not a server response ceiling or a complete page-byte test.

The independent entry SHA-256 covers only the entry module. The executing package
closure identity remains the target-reported installed payload digest; the external
supervisor separately records tarball hashes and source/build provenance. Startup
failures preserve their causes in test results but emit no completed-response
ledger. Failed transport attempts likewise are not completed responses. Logged
continuation URLs require authentication and refer to temporary stores removed by
cleanup; they are not reusable authentication credentials.
