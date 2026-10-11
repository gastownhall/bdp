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

The next receiver slice must implement and test the full BDP HTTP contract:
receiving errors as the correct BDP Problems/statuses, Accept/Content-Type
negotiation, validators and conditional reads, HEAD, and an explicit cross-origin
policy. Hostile raw request targets, raw Host handling and deterministic
mid-execution disconnect/recovery remain useful adversarial tests. The fixed
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
