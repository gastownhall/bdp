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

Validation: 76 focused tests passed, as did Node 24.16.0 typecheck, lint, format
and dependency-boundary checks. Build passed. All 1,291 tests in 47 files passed under the pinned Node
24.16.0, including packaged executable checks (35.22 seconds). An earlier
run under the shell default Node 24.19.0 also passed; the pinned run is the
reported gate. Independent council disposition remains pending. No
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
