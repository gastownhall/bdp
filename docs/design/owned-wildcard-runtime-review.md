# Owned-Link wildcard Read runtime draft

Prepared 2026-09-08 from #22 at
`c201cc28f74c6f71212aaf7f25966aabf55fb97e`. Separate implementation preparation;
no merge, readiness transition, conformance claim, or new protocol ruling.

The ruled wildcard descriptor was admitted by #22's schema but rejected by
the runtime URL-key parser. The reference adapter also treated `*` literally
and would emit a forbidden Resource key. This draft admits the wildcard in
the descriptor parser, expresses its no-label shape in TypeScript, and groups
owned outgoing Links under concrete Type URLs. Explicit declarations retain
empty groups; wildcard-only absent types do not invent groups. Explicit and
whole-set maxima are both enforced. Properties remain opaque authored data.

The adapter serves a preclosed reference-fixture view. It rejects missing
local endpoints at fixture admission; this change does not implement a dynamic
authorization projection engine. The test-only profile-admission seam is the
existing testing pattern and is never a production conformance claim. Public
Node HTTP and the fetch client tests compare singleton, collection and
first-class Link state, including sorted IDs, pins, attribution and explicit
empty groups. Negative cases exercise descriptor shape, bounds and closure.
No write endpoint, schema, sealed artifact, catalog, conformance manifest or production
reference-domain fixture changes.

Historical validation of the initial implementation (before the corrections
below): 76 focused tests passed, as did Node 24.16.0 typecheck, lint, format
and dependency-boundary checks. Build passed. All 1,291 tests in 47 files passed under the pinned Node
24.16.0, including packaged executable checks (35.22 seconds). An earlier
run under the shell default Node 24.19.0 also passed; the pinned run is the
reported historical gate. These 1,291-test counts do not describe the current
correction head. Independent council disposition remains pending. No
conformance evidence was generated.

Integration remains a separately reviewed step. #24's named projection and
coverage check must reconcile with #22's changed typeDescriptor and its new
ownedWildcardDeclaration definition. The current seal cannot be migrated by
rehashing old observations: changed projected schema bytes and this runtime
require actual new Read observations and a reseal. The choice of the new
sealed definition set remains with the operator, as does the separate RP1
coverage-walk ratification. The seven wildcard catalog rows are still
unclaimed; the HTTP tests here are not executable catalog plans.

The first council reviewed the original implementation head; the correction
head still requires independent review. Existing #22 remains a
separate specification draft; this branch prepares follow-on implementation.


## First council and client correction

At b02d2410f721a2a65245410d1e5703bcd85e9b45, the native Codex seat
reported 0 Critical, 0 High, 1 Medium and 0 Low. Gemini returned no findings.
Claude subsequently completed against that frozen head and reported
0 Critical, 1 High, 1 Medium and 4 Low. The driver prepared corrections in
a separate worktree; the completed reviews do not clear the correction head.

The Medium is a confirmed client failure boundary defect: a schema-valid
explicit ownership maximum above the wildcard maximum threw plain Error,
which the client intentionally does not translate into a protocol problem.
The parser now throws ProtocolArtifactValidationError like its other
validation checks. A client test receiving this descriptor failed before
the fix with the raw rejection; after the fix it receives the normal
temporarily-unavailable invalid-response problem. A subsequent valid
descriptor succeeds through the same client. No client catch-all was added.

The correction passed 273 client/parser/HTTP tests, typecheck, repository lint,
format, build and all 1,292 tests in 47 files under Node 24.16.0 (35.19 seconds).
An extra Biome check invocation also requested organizing pre-existing imports;
that assist is outside the repository's lint/format gates and was not applied.
The new test's formatting was corrected before the passing format gate.
Schema and evidence bytes remain unchanged. This commit requires independent
review; final results will be recorded by the driver at the reviewed head.


## Completed Claude findings and correction dispositions

All six findings below refer to Claude's read-only review of
`b02d2410f721a2a65245410d1e5703bcd85e9b45`. The additional correction starts
from `29e0811`, preserving its descriptor-error fix and client regression.
These are dispositions, not fresh council clearance.

1. **High — untyped protocol validation failures: accepted.** The descriptor
   cross-cap error was already corrected at `29e0811`. The three existing
   owned-Link coherence checks (entry Type, containing source, and strict ID
   order) also threw plain Error. They now throw
   `ProtocolArtifactValidationError`, preserving every predicate and message.
   Four new client regressions first failed with raw rejections, then passed
   for singleton and collection responses after the fix: mismatched Type,
   wrong source, descending IDs and duplicate IDs. No catch-all or ownership
   law was introduced.
2. **Medium — undeclared test dependency: accepted.** `@bdp/protocol` is now
   declared as a `bdptest` development dependency and allowed on that same
   development edge; the workspace lockfile was updated offline. Production
   dependencies and TypeScript project references are unchanged. General
   import-to-manifest checking remains a separate boundary-tooling improvement;
   this correction does not broaden the gate implementation.
3. **Low — closure tests do not isolate new wildcard logic: accepted as a
   description correction.** The endpoint and Link Type tests remain useful
   integration guards proving the existing admission checks still apply to
   fixtures carrying wildcard ownership. Their names and comment now say so.
   The same invalid fixture must also fail without wildcard ownership; no
   artificial different outcome or dynamic authorization engine was added.
4. **Low — weak shape assertions and missing static coverage: accepted.**
   Wildcard schema/canonical-key rejection assertions now require
   `ProtocolArtifactValidationError`. Valid static Bead Type declarations
   include a wildcard and an explicitly labeled Type; a checked
   `@ts-expect-error` proves a label on the wildcard is rejected by
   `BeadTypeDescriptor`. Assertions avoid coupling to Ajv's message wording.
5. **Low — throwing in the HTTP error callback: accepted.** Both server-handler
   and listener error callbacks collect errors in a test-owned array. The test
   asserts that array is empty after closing its client, listener and server.
6. **Low — missing design index entry: accepted.** The design index now links
   this review and integration record.

### Deferred executable conformance obligation

Before introducing wildcard descriptors into an executable Read catalog
fixture, update the owned-pair derivation in
`packages/conformance/src/artifact.test.ts` (currently `ownedPairs`, around
line 1832). It enumerates declared keys literally and would derive
`BeadType|*`, which cannot match a concrete Link Type. The future witness
selection must account for each actual outgoing Link and its source's
explicit-or-wildcard ownership, preserving pin and endpoint witness rules.
Add a meaningful wildcard fixture/probe when that cohort work is authorized.
No catalog, witness selection, denominator, schema, seal or evidence artifact
was changed here, and no wildcard conformance claim follows from these tests.
The operator's seal-set and RP1 coverage decisions remain open.

Verification of this additional fold under Node 24.16.0: 277 focused tests
passed in three files (227 client, 43 parser, 7 public HTTP/fixture tests).
The four new client cases were observed failing before the typed-error fix.
Typecheck, repository lint, format, dependency boundaries and `git diff --check`
also passed. The lockfile update used an offline install with no downloads.
The driver then completed a fresh build and all 1,296 tests in 47 files
under Node 24.16.0 (35.46 seconds), including packaged executable checks.
The prior 1,292-test result is historical. Independent review remains owed
on the completed correction head. Claude returned a session-limit response
on the subsequent History review, with reset at 21:30 Buenos Aires; no
unavailable seat counts as clean and no usage reset was consumed.


## Second Claude review and Scope-boundary correction

Claude reviewed the frozen `68fc8af` implementation delta from #22 and
reported 0 Critical, 1 High, 0 Medium and 4 Low without executing checks.
This correction was prepared in a separate worktree based on that head.
All preceding test counts describe the heads named in their paragraphs.

1. **High — inline Links bypass client Scope validation: accepted,
   pre-existing.** The client checked inline record shape and coherence but
   did not apply the Scope rules used for first-class Links. Two new client
   cases demonstrated acceptance of a foreign Link ID and a noncanonical
   Scope-claiming target before the fix. Bead validation now calls the existing
   Link validator for every owned record; no duplicate URI logic was added.
   Singleton and collection Bead responses and the equivalent Link collection
   now reject both cases as the structured invalid-response Problem.
2. **Low — wildcard key order depends on fixture Link input order: accepted
   as a deterministic implementation improvement, not a protocol defect.**
   Object key order is not normative. Wildcard owners now emit concrete keys
   in code-unit order; explicit-only owners retain their historical declaration
   order. A fixture with two wildcard-discovered Types produces identical
   serialized Bead records when its Link array is reversed. The production
   reference cohort has no wildcard declarations and its ordering is unchanged.
3. **Low — declared ownership keys may name non-Link Types: accepted,
   pre-existing fixture validation gap.** The spec defines ownership per
   (Bead Type, Link Type) pair and entries keyed by Link Type URL. The portable
   fixture already requires all record Types to be declared in its inventory.
   It now checks explicit ownership keys against that same closed inventory,
   skipping only the wildcard. Tests reject both a Bead Type key and a missing
   Type key. This is fixture admission, not a new global Type-fetch policy.
4. **Low — error-array assertion in finally can mask a primary failure:
   accepted.** The assertion now runs after the cleanup try/finally succeeds.
   A primary test failure propagates without being replaced by that assertion;
   a successful request/cleanup path still checks recorded server errors.
5. **Low — stale headline counts: accepted.** The initial 76/1,291 counts are
   explicitly historical. The 277/1,296 counts describe `68fc8af`; the current
   correction's focused result is stated below, with no transferred full-suite
   or council clearance.

The additional correction passed 308 focused tests in four files (229 client,
43 parser, 26 existing adapter, 10 public HTTP/fixture). Typecheck, lint,
format, dependency boundaries and diff checks also passed under Node 24.16.0.
The two Scope-boundary
cases were observed failing before the client correction. No schema, production
fixture, catalog, evidence, sealed definition, runtime write path, or pending
protocol decision changed. Full gates and independent review remain required
on the completed correction head. The deferred executable ownership-pair
selection and reseal obligations above remain outstanding.


### Server counterpart (same correction worktree)

The driver authorized a bounded check of the analogous ScopePort seam.
`validateServerBead` also omitted its existing first-class Link validator for
inline owned records. This is a pre-existing Read boundary defect, independent
of wildcard declaration. Two server regressions first demonstrated that a
foreign Link ID and a noncanonical local target passed through unchanged.
Bead validation now invokes `validateServerLink` for every inline record,
using the existing Scope/endpoint rules and typed validation error. The tests
exercise singleton and collection Bead reads and the equivalent Link collection;
invalid adapter data remains a local ScopePort contract failure, not a new
protocol problem or authorization policy. No other server behavior was added.

The combined correction passed 422 tests in seven files under Node 24.16.0:
229 client, 43 parser, 26 adapter, 10 public wildcard HTTP/fixture, 68 server
contract, 31 HTTP handler, and 15 Node listener tests. Typecheck, lint, format,
dependency boundaries and diff checks also passed. Both server regressions
were observed failing before the fix. The earlier 308 count predates this
server addition; full-suite/build and independent review remain the driver's
next gates on the eventual committed head.


Root full validation: 1,302 tests passed across 47 files (one skipped,
35.36 seconds), and build plus the historical 74-row Read evidence verifier
passed. The first full run had one failure in the unchanged adapter-bd
process-cleanup test: its 500 ms child deadline elapsed without a PID file.
That test passed in isolation, then the full suite passed without source
changes. This transient failure remains recorded rather than erased by the
rerun. No new conformance observations or successor reseal are claimed.
A fresh independent council on this correction remains pending.
