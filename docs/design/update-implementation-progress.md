# Read+Update development receiver: aliases and ordered sequences

This slice extends PR68's loopback-only, non-attesting reference executable. It
uses the existing durable member evaluator, alias evaluator and Read/sequence
lifecycle unchanged. Ordinary `bdptest` and `bdpbd` admission remain Read-only.

## Implemented receiving surface

`POST /development/put-alias` and `delete-alias` now accept the existing singleton
request shapes and require exactly one `Idempotency-Key`. Alias writes preserve
Bead revisions; aliases can be retargeted or deleted. `GET /alias/...` resolves
through the same authorization/read owner and emits an uncached temporary
redirect to the current canonical Bead target.

`POST /development/sequence` accepts existing sequence JSON with one key per
member. A carrier-level `Idempotency-Key`, duplicate member keys, invalid local
references, malformed later members and more than 32 members are refused before
any execution or key claim. The existing 64 KiB body cap also applies. The
receiver delegates carrier parsing and every admission/commit/replay decision
to the existing lifecycle.

The lifecycle commits members individually in declaration order, provides
request-local creator bindings and continues independent members after failure.
There is no stop-on-error option or sequence-wide atomicity. This is not the
Transactional batch implementation. Each admitted sequence returns an ordered
200 envelope of member dispositions; its result is not a durable transaction
receipt. Member keys are shared between singleton and sequence carriers.

## Executable observations

The HTTP tests use real sockets and the SDK Fetch transport. They exercise:

- Alias create, retarget, delete and retained replay, path collision, current
  alias redirection, and unchanged Bead representations/revisions.
- Allocated creator identity reused by Link creation and alias creation through
  `@name`; guarded update and live reads from the same durable owner.
- Successful prefix retained when a stale guard fails; failed creator reported
  as `binding-unavailable` to its dependent; an independent final member commits.
- Whole-carrier rejection before any write or key claim, including the member
  cap and forbidden carrier key. A subsequent valid carrier can use the keys.
- Singleton-to-sequence and sequence-to-singleton retained-key replay, semantic
  conflict, exact response replay and live Resource/alias state after reopen.
- Response discarded after its headers, followed by exact-key recovery. This
  specifically establishes recovery after loss of a completed response; it does
  not establish mid-execution disconnect or power-loss behavior.

The built-executable smoke starts a separate process at a disposable store,
executes a sequence with aliases, local references, a failing guard and an
independent Link creation, then starts a new process at the same Scope. It checks
persisted state, exact sequence replay, cross-carrier alias replay and deletion.
All processes and stores belong to the smoke and are cleaned up.

## Remaining qualification boundaries

No Read+Update or Transactional profile is advertised. The root remains an
informational development document with `claimEligible: false`. The new routes
are explicit development URLs, not discovered qualified operation endpoints.

The HTTP follow-ups below implement receiving Problems, media handling,
validators and conditional reads, HEAD, and raw target/Host checks. The local
cross-origin policy remains disabled. Deterministic mid-execution
disconnect/recovery remains unproven. The fixed
Type installation is not the complete schema/Type installation engine, and the
single local operator is not production authorization qualification.

Catalog coverage must map executable assertions against all 81 current
Read+Update rows, including the metadata amendment's three rows. Fixture
validation and existing component tests alone do not establish full executable
profile conformance. The separate Transactional stream owns atomic batch
commit/rollback, transaction idempotency, receipt and change-group work.

## Validation for this slice

With Node 24.16.0 and pnpm 11.20.0: frozen installation, build, typecheck,
dependency boundaries and formatting passed. The focused six-file suite passed
326 tests: development HTTP, sequence executor, Read/sequence lifecycle, alias
evaluator, carrier preflight and SDK Fetch transport. The extended built-process
smoke passed. Lint retains the repository's pre-existing warnings. This slice's
focused run is not a fresh full-repository or profile conformance qualification.

## HTTP receiving and Read semantics follow-up

The development receiver now uses BDP Problems for authentication, authorization,
malformed requests, unsupported media and size refusals. JSON request media-type
parameters are ignored. Unsupported methods return bodyless 405 with Allow;
unexpected internal faults return bodyless 500 without diagnostic disclosure.
Mutation command conditionals do not replace payload revision guards.

Read GET/HEAD now reuse the existing Read HTTP semantics and Resource revision
ETag projection: Accept specificity/quality, bodyless 406/304/412, no ETag on
collections, and HEAD representation lengths. Ordinary read/auth refusals run
before negotiation or conditionals. Alias HEAD remains a bodyless redirect.
The fixed local credential and refusal of browser Origin remain unchanged;
CORS is disabled rather than incompletely advertised.

Raw request normalization validation is shared with the existing Node listener.
Hostile dot-segment, backslash, fragment and foreign-authority targets, wrong or
repeated Host, repeated credentials, malformed scalar JSON, invalid UTF-8 and
oversized chunked input are refused before mutation/key capture. A corrected
request can reuse the key. The bounded iterator preserves the connection long
enough to return the size Problem, then closes it.

The HTTP follow-up passes 148 focused tests across development HTTP, shared Read
HTTP, the existing HTTP handler and Node listener. Mutation response Accept
negotiation required a separate admission-boundary task: rejecting before comparing
retained keys would hide conflict, while rejecting after submit could commit an
unknown key. The next subsection describes the implemented refusal path; full profile
conformance still needs explicit executable evidence.


## Mutation response negotiation without admission

The existing lifecycle submit operation now accepts an optional `acceptsJson`
flag. Normal callers retain the prior default behavior. An unacceptable JSON
response selects a synchronous read-only branch under the same exclusive owner,
before `store.admit`. Carrier validation and the sequence-member cap still run
first. The branch cannot allocate Resources, claim unknown keys, renew retained
outcomes or schedule execution.

The member executor's existing retained/expired identity comparison and current
reauthorization logic is reused directly. An equal retained singleton success
returns bodyless 406; retained conflicts and failed outcomes preserve their
ordinary Problem. Pending Read+Update claims retain `idempotency-in-progress`:
they do not acquire Transactional pending identity semantics. Unknown singleton
keys return 406 without a claim. Sequence member problems remain entries in the
success envelope, so an unacceptable sequence response remains a direct bodyless
406 after comparison; it never converts a member problem into a carrier failure.
Creator witnesses are reused to compare dependent retained members without
executing unknown creators or independent tails.

HTTP tests prove unknown refusal leaves state and keys untouched, equal retained
retry is unchanged, conflict/failure precedence survives unacceptable media,
and a corrected acceptable sequence executes. Direct lifecycle tests establish
pending behavior with a deterministic scheduler, unchanged retention rows,
renamed creator-binding comparison and no unknown-tail capture. Mutation request
HTTP conditionals remain distinct from payload `expectedRevision` guards.

Final combined follow-up validation (Node 24.16.0, pnpm 11.20.0): all 109 test
files passed, with 7,604 tests passing and one skipped, using two workers. Build,
typecheck, dependency boundaries, formatting and the development process smoke
passed. Installed-package smoke initially detected the new private raw-target
helper missing from its exact artifact inventory; adding those four emitted
filenames made the smoke pass without widening exports. Lint retains only the
baseline three warnings and one informational finding. This is implementation
regression evidence, not executable certification of the full write profile.
