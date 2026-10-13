# Private installed Snapshot observations

`apps/bdptest/src/transactional-snapshot-installed.test.ts` observes the existing
private installed Transactional process through the unchanged inherited-IPC
launcher, installed metadata validator and exact raw HTTP executor. It adds no
runner scenario, coverage mapping, public export or profile admission.

The default entry is the emitted process. Setting `BDP_TRANSACTIONAL_INSTALLED_ENTRY`
to the actual installed tarball's private process path runs the identical tests
against packed bytes. The process uses its default clock, compiler, captured
artifacts and runtime settings. No test clock, SQLite inspection or injected
success response is involved. Canonical URLs and Host remain
`https://reference.invalid/acme/`; the ready message's validated loopback address
selects only the physical socket. Credentials are local random tokens and never
written to observation logs.

## Observations and countercontrols

- Real commands create 34 Beads and 34 owned Links. Both captured streams have a
  continuation. Expected identities, complete counts, and each owned Link
  postimage are checked independently of pagination traversal.
- Hosted Type descriptor JSON is read from the same listener and compared
  with the configured contents; Type serialization may reorder object members.
  Real metadata binds installed payload, compiled contract, policy,
  authentication, runtime configuration and declared source commit; restart
  requires the same binding.
- Captured manifest and page bodies remain byte-identical after a mutation and
  actual process restart. A different authorized reader receives the same
  retained representations with current response context.
- A finite changefeed is read from the literal captured checkpoint. Applying its
  actual changes to the captured replica must equal all independently enumerated
  current point reads. Dropping that group or omitting an expected Link makes the
  comparison fail.
- UTF-8 manifest HEAD length matches actual GET octets and differs from JavaScript
  string length. A real continuation token borrowed across stream kinds is refused.
- Seven live handles precede real HEAD, 304, 412, 406, authentication, method,
  Origin, malformed-query and unsupported-control observations. The next capture
  succeeds as the eighth unique handle; the ninth is a retryable 503. All eight
  retained manifests still work and capacity refusal survives process restart.
  This is a capacity inference, not direct observation of the private ledger.

Each observation requires a completed raw request write and framed HTTP response;
receiver activity alone cannot pass a test. Test cleanup closes/reaps each child,
with a 45-second fixture deadline and existing bounded launcher shutdown. Each
request retains the executor's five-second bound. No request bodies or credential
headers are serialized into the safe summary.

## Limits

These two tests are transport observations, not complete installed Snapshot or
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
