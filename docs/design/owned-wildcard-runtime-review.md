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
No write endpoint, schema, sealed artifact, catalog, manifest or production
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

Council review pending on the resulting commit. Existing #22 remains a
separate specification draft; this branch prepares follow-on implementation.
