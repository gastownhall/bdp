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
cross-origin policy remains disabled. The deterministic disconnect/recovery follow-up below addresses the earlier
mid-execution transport gap. The fixed
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


## Deterministic disconnect, drain and process-crash observations

Three additional real-process tests park the existing lifecycle scheduler before
member 2 executes. An IPC barrier acknowledgment plus live HTTP reads establishes
that member 1 is durably committed and the independent final member is absent.
There are no timing sleeps or mocked mutation outcomes. The process uses the real
emitted HTTP receiver, authority, evaluator and SQLite store.

- A client aborts its HTTP request at that barrier. Releasing the parked callback
  allows the failed middle member, a creator-bound alias and independent final
  create to finish. Exact-key retries recover their ordered retained results.
- Graceful server close disconnects the response but waits for admitted work.
  Releasing the callback completes the tail and shutdown. The ordinary emitted
  executable then reopens the store and replays every terminal disposition.
- SIGKILL at the same barrier terminates the authority without cleanup. The
  ordinary executable reopens with the original prefix representation intact,
  no tail Resource and no alias. It executes the abandoned remainder only after
  explicit client resubmission. Subsequent retries match exactly.

The scheduling seam is private: the existing runtime implementation moved to
`development-runtime.ts`, while `@bdp/server/development` retains its existing
wrapper/signature. Only the private runtime accepts the existing scheduler
interface. Public configuration and package exports expose no barrier option.
Installed-package smoke inventories the helper and rejects its deep import.

These observations distinguish transport loss, graceful drain and abrupt process
failure between individually committed members. SIGKILL is not a power-loss or
mid-SQLite-commit fault injection. Nor does this establish Transactional batch
recovery. Full write-profile qualification still requires catalog mapping,
Type/schema installation evidence and a deliberate admission mechanism.


Validation for this follow-up: 131 focused HTTP, Read/sequence lifecycle and
sequence-owner tests passed, including the three new process tests. Build,
typecheck, boundaries, formatting, the normal development process smoke and
installed-package smoke passed on the pinned tools. Lint retains the baseline
three warnings and one informational finding. No full-suite rerun is claimed
for this follow-up; the preceding HTTP/negotiation slice's 7,604-test result is
recorded separately above.

## Development contract inventory and shared runner

The new `packages/conformance/development` artifacts inventory all 81 current
Read+Update normative rows. Nine separate diagnostic plans execute 57 actions
against the real development HTTP receiver through the SDK Fetch transport,
using the existing conformance runner's captures, assertions, artifact digests,
reporting and fixture cleanup. Thirty-six normative rows have explicit bounded
assertion bindings; forty-five have structured omissions. The manifest covers
singleton CRUD, document updates, aliases, ordered partial failure and local
bindings, revision guards and a competing guarded update, cross-carrier retained
keys, carrier rejection without key capture, and result headers.

This lane has distinct `development.read-update.*` diagnostic IDs and a
source-only test-support factory. Production artifact IDs, metadata-only catalog
guards and public admission are unchanged. Reports say development-only and
non-attesting and retain `claimEligible: false`. Each scenario gets an isolated
store. A negative-control run changes an authored property expectation and
requires that exact assertion to fail.

The coverage inventory is not a profile completion count. Bound rows may still
lack variants; unowned fixed Types cannot establish installed schema, owned-Link
or authorization contracts. Existing process tests are explicitly omitted until
their observations are bound to this runner. Next work is raw HTTP/process
bindings and remaining feasible receiver variants, followed by the controlled
schema, ownership, policy, retention and fault fixtures needed for qualification.

Validation: 270 focused tests passed across the development matrix/inventory,
production Read+Update metadata guard, artifact bundle and shared runner suites.
The saved diagnostic report records nine passing scenarios, 57 actions and 174
passing assertions. Build, typecheck, dependency boundaries, formatting,
development process smoke and installed-package smoke passed on Node 24.16.0
and pnpm 11.20.0. Lint retains only the baseline three warnings and one
informational finding. This slice did not rerun the full repository suite.

## Raw HTTP admission and negotiation bindings

Five more diagnostic plans extend the same development runner to 14 scenarios,
105 actions and 398 assertions. The inventory now has 41 bounded-observation
rows and 40 explicit omissions. Added bindings cover unauthenticated receiving,
media refusal, a bodyless method refusal, request-body limits and six observed
Problem codes. These remain partial rows, especially the method and complete
Problem-table obligations.

Raw actions reuse the existing conformance HTTP executor. Duplicate credentials
and chunked input reuse the prior development-server test helper in source-only
app test support. The exact executor's credential/Host/framing guards stay
unchanged; no runtime module changes. Requests are constrained to the disposable
loopback Scope, three development routes and fixed fixture credential variants.

Receiving tests include malformed and repeated keys, duplicated authorization,
missing/wrong/malformed local credentials, media parameters, malformed JSON and
duplicate JSON names, invalid UTF-8 and an unpaired surrogate, streamed and
declared body overflow, and success at the inclusive 64 KiB UTF-8 octet bound.
Read-back plus corrected requests under the same valid keys establish absence of
mutation and unknown-key capture after refusal.

Negotiation tests cover unknown, retained equal, conflicting and failed keys,
including JSON q=0 taking precedence over a wildcard. Retained failure replay is
observed after the subject becomes live, proving the failed request is not
executed again. Mixed sequences preserve the envelope rule under unacceptable
Accept and leave unknown tails unadmitted; acceptable retries return retained
entries and execute independent tails. Process/disconnect bindings, pending-key
scheduling and remaining raw target/Host cases remain future runner slices.

Validation: 120 focused tests passed across the development matrix, existing
HTTP receiver tests, diagnostic inventory, raw executor and unchanged normative
catalog guard. The saved diagnostic report has 14 passing plans, 105 actions
and 398 passing assertions. Build, typecheck, dependency boundaries, formatting,
development process smoke and installed-package smoke passed on the pinned
Node/pnpm versions. Lint retains the baseline three warnings and one
informational finding. No full-repository test run is claimed for this slice.

## Process lifecycle bindings in the diagnostic runner

Three lifecycle plans reuse the existing emitted-runtime IPC barrier and process
helpers. The matrix now records 17 scenarios, 132 actions and 515 passing
assertions. All 81 normative rows remain inventoried: 44 have bounded observations
and 37 have structured omissions. New mappings cover sequence disconnect,
durable-boundary observations and crash-mid-sequence, with explicit limits on
which durability variants were exercised.

The child parks dispatch 2 before execution. HTTP reads establish a committed
prefix and absent tail. Client abort followed by release allows completion;
graceful close waits for release and drains before clean exit; SIGKILL preserves
the prefix across ordinary executable recovery without executing the tail until
explicit resubmission. Retried responses preserve the ordered failure, creator
binding and independent tail. The runtime and public configuration are unchanged.

For full prefix and replay comparisons, lifecycle actions report observation
counts and distinct SHA-256 digests over the existing canonical JSON encoding.
Manifest assertions require two observations and one digest in each group.
This compares parsed JSON semantic values, not raw HTTP bytes or headers. A
negative control changes the prefix through a real HTTP update and confirms
that the runner's equality assertion fails. The existing standalone tests share
the extracted process helper and retain their direct full-object comparisons.

Per-scenario child/store cleanup is exercised with assertion failure and an
run abort at the observed barrier. The process helper bounds IPC and
exit waits; cleanup kills and awaits remaining children before deleting fixture
directories. Between-member SIGKILL remains distinct from power loss, failover,
or an injected crash within SQLite's commit boundary.

Validation: 256 focused tests passed across the matrix, original process tests,
diagnostic inventory, normative catalog guard and existing runner. Build and
typecheck passed. The process tests consume emitted modules and must run after
a completed build; concurrent cleaning is unsupported. No full-suite or complete
write-profile qualification is claimed.

Dependency boundaries, formatting and both executable smoke suites passed. Lint
retains only the baseline three warnings and one informational finding.

## Alias and pinned-reference diagnostic variants

Six additional SDK plans extend the existing runner to 23 scenarios, 221 actions
and 705 passing assertions. The 81-row inventory now has 48 bounded-observation
rows and 33 explicit omissions. Prior 41-row and 44-row observations above remain
historical evidence, not normative completion counts. New mappings cover bounded
allocation, noncanonical alias targets, unknown alias subjects and reference
idempotency; existing Link and semantic-identity rows gain pin observations.

Recorded targets replay across alias repointing, deletion and reassignment,
including cross-slot reuse. Fresh locators are resolved again on each retry:
repoint/delete conflicts and restoring the original target succeeds. Recorded
misses remain misses after assignment, without affecting newly reachable Beads.
Admitted alias validation and not-found failures retain their result after the
subject changes; fresh keys and read-back establish the resulting state.

Pinned Link endpoints preserve opaque revision strings and canonicalize local
references. Changed pin bytes, removal of a pin and changed external URI spelling
conflict. Pinned sequence-local references retain their canonical creator across
local-name changes. After-state reads establish that rejected retries leave the
original Link intact; no historical lookup or external-fetch claim is made.

The test action gains captured target/reference inputs and identity observations;
manifest assertions remain responsible for evaluating observations. Runtime,
shared stores, normative catalogs, public admission and exports are unchanged.
Allocated identities are canonical, in-Scope and readable while a live alias
remains usable. The HTTP surface cannot force the private allocator's next
candidate to collide, so collision skipping stays explicitly unqualified. Hidden
subjects, policy changes, retention/expiry and internal metadata are not observed.

Validation: 269 focused tests passed across the development matrix, diagnostic
inventory, normative catalog guard, alias evaluator, member executor and member
identity. The saved report contains 23 passing plans, 221 actions and 705 passing
assertions with `claimEligible: false`. Build, typecheck, dependency boundaries,
formatting and both executable smoke suites passed on Node 24.16.0/pnpm 11.20.0.
Lint retains the baseline three warnings and one informational finding. No full
repository suite or complete profile qualification is claimed.

## Pending-key and interleaving process observations

Two diagnostic plans reuse the existing dispatch-2 barrier and real HTTP receiver.
Pending creator, dependent and tail retries cannot run ahead. A fresh dependent
key receives a transient failure while its independent tail commits; after the
original request completes, that key executes and then replays, establishing
transient nonretention. Original allocated creator endpoints resolve to the
creator's observed marker, and original response/replay bodies have equal
canonical JSON digests.

An unrelated update completes while the original request is parked. The later
original member preserves the intervening property, adds its own and advances
the revision. Retrying each request returns its own retained postimage. Connected
process plans now observe the original bounded Fetch response rather than a
fixed dispatch count; disconnected plans keep their known four-member barrier.
Immediate rejection consumption and existing abort/child cleanup remain active.

The runtime, scheduler, public configuration and matrix test budget are unchanged.
The inventory has 54 bounded rows and 27 omissions, with 25 plans, 253 actions and
797 assertions. The six additional bindings remain partial: no claim-atomicity
fault injection, distributed writer, rate-limit/service transient, expiry,
authorization-change or full-profile qualification is claimed. No store state
was backdated and the fixed 24-hour retention clock was not replaced.

Validation: 102 focused tests passed across the diagnostic matrix/inventory,
original HTTP/process suites, normative metadata guard and existing sequence
lifecycle. The saved non-attesting report records all 797 assertions passing.
Build, typecheck, dependency boundaries, formatting and both executable smokes
passed on Node 24.16.0/pnpm 11.20.0. Lint retains the baseline three warnings and
one informational finding. No full repository suite was run for this slice.

## Private installed-contract and trusted-principal composition (U2)

The source-only canonical HTTP fixture can now supply an internal deployment
configuration to the existing mutable owner. Ordinary installed startup and the
public development facade keep their original fixed contract, credential and
admission behavior. Neither accepts the new configuration, advertises another
profile, nor acquires new package exports.

`development-contracts.ts` captures exact offline descriptor/schema bytes with
the existing artifact ingester and compiles them with the existing guarded
schema evaluator. Every schema reference must resolve from that captured bundle
or the evaluator's immutable built-ins. The registry matches exact installed
Type bytes. The installation identity binds the captured closure and fixed
aggregate policies; reopening under different bytes or aggregate configuration
is refused. This supplies no network fetch or Type installation lifecycle API.

The adapter emits confirmed property diagnostics and stops when the receiver's
own diagnostic bound is reached. If the compiler truncated its prefix before
the receiver stopped, the adapter refuses to claim completeness. Local evaluation
refusal also fails closed; neither case becomes successful validation or invented
complete diagnostics. Final Resource evaluation attaches the effective Type
and applies its own advertised diagnostic count/byte budget. This fixture does
not qualify every schema dialect keyword, every compiler budget refusal, or
production compiler resource consumption.

The private deployment captures a bounded token-to-principal map. The actual
Authorization credential selects the stable principal; writer-supplied actor
attribution has no authority. Administrative policy snapshots independently
control creation, writes, hidden Resources and read-only Resources. A private
operator handle can replace a principal's snapshot between owner turns, and
pagination authorization views change with that snapshot. Policies are supplied
again on startup; this slice adds neither a policy persistence subsystem nor a
remote administration endpoint. Fixed aggregate policy changes require a new
installation, rather than silently tightening a live graph.

Eight focused observations cover inherited schema failure and retained replay;
immutable captured schema bytes; owned-Link source revisions, provenance and
no-op preservation; aggregate refusal without effects; source write permission;
principal-separated keys and actor non-authority; hidden versus forbidden
responses and current-policy retained disclosure; whole owned-Resource
withholding and pagination view invalidation; exact-config durable reopen;
administrative accessor/credential rejection; and refusal to claim completeness for truncated
compiler diagnostics when the receiver has not stopped. Seven run real HTTP against the same disposable mutable
owner; the eighth directly tests the compiler-to-diagnostic adapter's refusal
boundary. The schema fixture uses an open object with an inherited integer
property constraint and an external schema reference supplied as pinned bytes.

These are bounded source-only observations, not installed profile qualification.
The later served profile still needs an installed mutable payload, applicable
cumulative Read receiving/CORS behavior and profile-specific executable evidence.
No conformance row, profile guard or existing evidence artifact is relabeled.

## Installed mutable candidate factory (P1a)

The server package now contains a private installed reference factory and an IPC
qualification process entry. They are neither package exports nor executable
bins or ordinary `bdptest` switches. The packed-package smoke starts the actual
installed entry outside the workspace. It supplies configuration through an
inherited IPC channel, never argv, and observes the same factory intended for
later evidence-gated startup. IPC possession is process control, not admission.
Readiness explicitly reports `claimEligible: false`.

The closed configuration captures a canonical Scope, separate loopback listener,
explicit create/reopen choice and store directory, trusted credential/principal
mapping, administrative policy snapshots, fixed aggregate policy and exact
Type/schema artifact bytes. Empty descriptor input selects the full current
reference Type family instantiated at Scope-local identities. All conformance,
endpoint and ownership references are remapped together; these identities do
not claim to host the original work.example URLs. Actual Type reads use the
installed registry. Optional local schema routes serve exact captured bytes
from a closed manifest, with no network fetch or arbitrary routing callback.

The factory reports three distinct identities: the captured contract artifact
identity, the configuration identity including principal/policy/credential
mapping and actual fixed limits, and a hash of the actual installed server and
protocol JavaScript payload. Store invariants bind Scope, contracts and aggregate
configuration; changing live credential/policy configuration on a later reopen
changes qualification identity without changing the contract installation.
Listener port and provisioning choice are separate from persistent Scope
identity. Factory hashes are observation metadata, not signed or independently
verified conformance evidence. The eventual evidence artifact still needs its
own target/configuration/source binding and verification.

The installed transport normalizes raw targets before classifying every route,
including singleton and sequence targets. Valid absolute-form requests retain
only their validated path/query; configured Scope remains the identity authority.
Host and forwarding headers cannot rebind it. Disabled CORS processes Origin
normally without grant headers and retains endpoint-specific OPTIONS refusal.
Ordinary development transport restrictions remain unchanged. Both transports
share the actual receiver, mutable owner, Read projection and HTTP semantics.

Startup and shutdown now close the durable owner even when listener cleanup
fails; startup preserves the original and cleanup failures together. The private
entry accepts one startup, handles SIGTERM/parent disconnect, drains accepted
work through the existing owner and closes unadmitted partial bodies. No clock,
scheduler, synthetic outcome, fault, database mutation or policy-replacement
control is exposed through IPC.

Packed and emitted process observations cover all nine targets, actual afterstate,
Type closure navigation, stable Scope across different listener ports, exact-key
reopen, negotiation/conditional/HEAD/method behavior, disabled CORS, raw targets,
pre-admission rejection and corrected-key reuse. Additional tests cover exact
schema bytes and real validation, detached captured credentials/policy, second
owner/installation mismatch, one-start/bind failure, partial-body disconnect and
an injected listener-cleanup failure followed by a successful real-store reopen.

P1a does not activate public Write profiles or refresh/relabel existing Read
evidence. The packed smoke still proves ordinary Read startup and write-profile
refusal. No deterministic installed between-member interruption or power-loss
durability claim follows from this slice; existing separate owner/process tests
retain their original scope. Full cumulative executable requirements, broader
schema applicability, independent profile-specific evidence and its public
admission gate remain prerequisites for activation. The listener is an explicit
loopback candidate; deployment TLS and optional CORS-enabled/History behavior
are not newly provided here.


### Configuration and diagnostic boundary corrections

A compiler-produced diagnostic prefix can be longer than the receiver permits.
The adapter now emits that confirmed prefix until the receiver stops and returns
invalid/incomplete at that point. A real 1025-branch schema produces a retained
422 with 32 diagnostics and `diagnosticsTruncated`, rather than a local error.
If the receiver accepts the entire truncated compiler prefix, the adapter still
throws instead of inventing completeness. An actual evaluator work-budget
refusal remains a local 500 with no effects or retained key; a corrected request
can use the same key successfully.

Aggregate constraints require positive maxima and are captured as sorted,
exact-deduplicated semantic entries before hashing or provisioning. Credential
principals must already have policy snapshots before store creation. Contract
identity now also covers captured artifact/compiler limits and the fixed graph
and evaluator bounds. This changes private custom-installation identities;
previous U2 custom stores are not silently adopted. The ordinary default
installation remains unchanged.

Captured Scope configuration is frozen. Its policy digest describes all
administrative policy snapshots; a separate per-principal snapshot identity
controls pagination authorization. Configured authorities expose only explicit
principal facets; duplicate credentials for one principal share one route.
Hidden/read-only policies accept the protocol's actual canonical local IDs,
including nested and encoded IDs, and use private Sets for membership checks.
Read remains an explicit bounded deny-list fixture rather than a general
whole-Scope deny-read policy. No broader IAM capability is claimed.

### Whole-startup readiness and fixed owner-limit identity

The listener now refuses all requests until every configured principal's Read
view and discovery routes have initialized. A deterministic second-principal
barrier observes real GET and mutation refusals, then tests both successful
startup and later startup failure. In both cases the Resource remains absent and
the original mutation key can be used after readiness or durable reopen.

The private installed process module is inert when imported, including by a
process with inherited IPC. Only direct execution installs the IPC lifecycle;
direct execution without IPC refuses with the fixed redacted diagnostic.

One frozen private tuple supplies the actual owner, member, receiver and
pagination limits and the installed configuration identity. This includes patch
and representation bounds, retention and maintenance, pagination capacity and
token limits. Existing values and advertised limits are unchanged; there are no
new configuration overrides. Hash-sensitivity tests vary captured limit groups
in the test import only. This changes qualification configuration identities,
not persisted installation identities, and does not relabel historical evidence.

### Shared private composition and installed observation bindings

The installed factory and source fixture now call one emitted private Read and
Operation Directory composition. Neither implementation imports test support.
Actual HTTP refusal tests exercise the owner gate before both the static
Operation Directory and captured schema route; restoring the owner observation
restores their responses. Hosted schema responses carry the non-attesting marker.

Shutdown retries a failed listener cleanup while retaining the owner's single
terminal completion. A successful owner close is not invoked again, and an owner
failure cannot be erased by a later listener retry. Concurrent callers share an
attempt; successful completion remains idempotent. A real-owner regression keeps
the first listener open through an injected failure, reopens the durable owner at
a second listener under the same Scope, and then completes the first cleanup.

The default reference closure now recursively checks output keys and values for
foreign absolute URIs, including future fields outside the remapper's current
positions. This guard applies to the shipped local reference fixture; it does
not introduce a new Type lifecycle or generic custom-schema policy.

Payload identity includes the resolved declared runtime package closure:
server/protocol emitted files and schema assets, package manifests and runtime
dependency code/data. It includes fast-uri and the protocol's Ajv dependencies.
Dependency resolution is from each installed package, not a caller-provided list;
Node itself and deployment/TLS are outside this identity. An isolated copied
fast-uri file change alters the observed payload identity without changing the
configuration or artifact identity. Historical payload hashes are not relabeled.

Private configuration capture, factory results and IPC readiness now also carry
`policyIdentity`, `authenticationIdentity`, `profile: "read-update"` and
`history: false`. The configuration identity binds these actual captured values.
Authentication identity hashes the captured ordered principal/token-digest
mapping; no token is emitted. Policy-only and credential-only changes have
distinct identity witnesses, and callers cannot supply these metadata fields.
Source commit remains launcher metadata rather than a claim by the target.
This remains a non-attesting private candidate with public admission unchanged.


### Qualification limits for the current installed fixture

Bodyless method refusals from the shared receiver now carry the same
non-attesting marker; emitted and packed HTTP observations assert it for the
service description, Operation Directory and operation target. IPC smoke checks
require an opaque 64-hex policy identity, as for the sibling digest fields.

Payload binding is qualified against the fixed current declared dependency
closure. Optional/peer edges, ESM-only dependency resolution and traversal work
bounds for larger dependency graphs are not generalized by this candidate.
The reference-output guard covers absolute URI strings in the current reference
closure; it is not a semantic classifier for future URI-reference or prose
fields. Authentication identity deliberately captures credential array order.
Listener retry tests inject a failure that leaves the listener open; this does
not establish that ordinary Node close produces that state. The actual owner
close, released store lock and preserved terminal result remain observed.


Across the ordinary and installed configurations of the shared receiver,
the explicit response paths carrying the marker are JSON/Problem
responses, shared empty responses, ordinary Read responses, captured installed schemas,
composed Read responses (including installed alias redirects), the ordinary
development alias redirect, and the installed raw CONNECT refusal. Direct
ordinary alias and installed packed alias observations assert the marker. A
bounded raw-socket observation asserts CONNECT405, Allow, marker and empty body
in both emitted and packed runs. These statements cover responses written by
the candidate receiver; Node-generated transport errors are outside this list.
Readiness additionally requires the actual prefixed artifact digest shape
`development-schema5-<64 lowercase hex digits>`.

Detached CONNECT sockets observe write errors and are destroyed after the refusal
finishes. Bounded reset-peer probes check continued service in emitted and packed
runs; they do not claim every possible kernel write-error timing was injected.

### Exact installation artifact retention

The development authority now supplies its bounded serialized compiled capture and
complete frozen canonical Type inventory to recovery-store startup. Capture lives in
one immutable metadata row, separately from compact installation/lineage identity;
member policy writes cannot reach it. It contains original descriptor/schema bytes
and artifact, graph and evaluator limit witnesses, never access/authentication state.
The existing compiler identity, registry and schema-hosting path are unchanged.
Retaining the shared capture also retains an additional in-memory base64 copy; this
slice does not remove the existing hosting copy or optimize installation memory.

Recovery format4 intentionally refuses format3 stores, including stores behind the
public nonattesting development facade. No migration or reseed is performed. Direct
store callers default to explicit uncaptured metadata (`null`) and no inventory
expectation; captured stores cannot reopen through that default. Both configured and
built-in authorities always opt into the complete inventory gate. Literal built-in
Types carry no whole exact-artifact conformance claim.

Within locked open, stored capture UTF8 byte length is checked before materializing
text, then exact capture and inventory equality are checked before claimed-key
recovery or maintenance. Capture JSON is not parsed by storage. Writable SQLite hot-
journal recovery remains allowed first. Refused ordinary files remain byte-identical;
a recovered journal can restore physical bytes before refusing BDP startup. Refused
opens leave claimed keys present; subsequent valid open counts their removal in
runtime.recoveredClaims. Later Resource-Type and runtime-limit compatibility scans
remain post-open checks; this is not a universal startup-refusal ordering repair.

Full capture stays for installation lifetime, including deletion and receipt expiry.
Administrative input remains required on reopen; saved bytes can reconstruct the
same compiler offline. Compiler-limit changes deliberately refuse existing stores.
Existing policy/authentication changes remain allowed and hosted schema bytes are
unchanged. Tests cover built-in and compiled corruption, original-byte retention,
offline reconstruction, replay/lifetime, and actual hot-journal refusal/recovery.
No public profile activation or new Type lifecycle follows from these observations.


### Retention review follow-ups

A missing required capture row is an integrity failure; a present but unequal
capture remains an installation mismatch. Corruption tests identify the exact gate
and reason, and a permanent format3-shaped fixture (no capture row) proves format
refusal precedes the new capture gate while preserving bytes and pending claims.

Deferred maintenance: consolidate the twin serialized-capture ceiling in
`development-authority.ts` (`maximumCaptureBytes`) and `transaction-store.ts`
(`captureMaximumBytes`) when both lanes can be changed together. Both currently use
8 times artifact bytes plus 1024 per submitted artifact plus 4096 overhead; the RU
site explicitly cross-references its TX twin. Their stored-length checks intentionally
differ: RU compares the supplied bounded expectation's exact byte length; TX checks
the shared ceiling before exact equality. The one production RU authority bounds
serialization; a direct recovery-store caller remains responsible for bounding its
expectation. No shared accessor or TX refactor is included in this follow-up.

## Private installed guarded-overlap witness (draft; not executed)

The proposed ordinary Read+Update witness uses one installed owner, two distinct
keys and one current revision. It checks two outstanding client calls, one
updated Resource and one exact revision-mismatch Problem, key-specific replay
response equality and complete final state. The winning replay checks retained
non-re-execution; the losing Problem equality alone cannot distinguish a replay
from reevaluation. No simultaneous server admission, fairness or schedule
diversity is claimed.

The planned fresh-consumer positive has ten requests; one isolated emitted
expectedRevision-guard removal must fail the same named oracle after six
requests with two schema-valid successes. Source metadata, actual package bytes,
response fingerprints and cleanup need separately bound execution records.
This preview has not run. It does not change the omitted cumulative race row,
public admission, or whole-contract qualification. Existing historical results
remain attributed to their original sources.
