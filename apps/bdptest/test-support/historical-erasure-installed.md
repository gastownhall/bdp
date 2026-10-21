# Packed historical erasure observation

This one new private installed case is based exactly on `e7bcde980801ba6d06238b76d1d72db2e75a71d9`. It demonstrates a historical Bead-version erasure after a real public mutation, not live-version erasure or the entire erasure profile. All serving runtime/store/protocol implementations come from the fresh offline installed packages. The controller uses the existing bounded raw HTTP executor and raw SSE recorder.

## Private administrative boundary

`historical-erasure-installed-child.ts` is a test-only sidecar. It directly imports the selected installed `captureInstalledTransactionConfiguration`, `installedPayloadIdentity`, `startTransactionRuntime`, and `transactionRuntimeAdministration`. It passes normal captured configuration and uses the existing companion on the SAME authentic runtime facade. No runtime algorithm is copied or substituted. The normal `startInstalledTransactionCandidate` spread-copy facade deliberately does not receive that companion; the fixture does not repair or bypass its identity check.

The sidecar has exactly one bounded, test-only administration command for the historical revision of `beads/b` selected from its actual mutation receipt. No public BDP HTTP route, CLI/config flag, package export, ordinary bootstrap control, clock seam or live-version behavior is added. Readiness explicitly says `ordinaryDeployment:false`, `administrationPublic:false`, and identifies the fixture. Existing runtime configuration and payload digests are retained. This is installed code with private administrative access, not evidence that an ordinary deployed CLI exposes administrative erasure.

## Exact case

1. Public batch creates safe `a` and secret-bearing `b`; capture complete Resources/revisions and context at `pos-1`.
2. Read ordinary collection with `limit=1`; retain its actual opaque `next`, with later `b` already cached. Capture a Snapshot and the change checkpoint, then admit a raw public SSE stream.
3. Public update changes `b` to a real successor at `pos-2`; wait until that exact group is on the SSE wire.
4. Invoke the existing local companion for only `b`'s original revision. The public caught-up SSE stream carries the complete `pos-3` erasure group. A separately authored canonical serialization of this known Resource yields the expected `sha-256-jcs` digest.
5. Old ordinary continuation and saved Snapshot return410. Fresh direct/collection reads retain the complete successor. Receipt retrieval and exact same-key public replay preserve receipt identity while changing only the erased postimage result to its content-free marker. Fresh Snapshot includes the erasure ledger and healthy Resources. Event responses do not disclose the erased secret. All eight post-erasure finite responses retain the same epoch/view and current `pos-3` context.

The first and only NEW cohort PASS460ms: thirteen completed finite HTTP responses plus the SSE connection, no earlier cohort replay. Child exit0, channels EOF/reaped, no force/overflow, test-owned SSE socket explicitly destroyed and closed, outer process group absent. No source/runtime tests were rerun merely to own their earlier evidence.

## Bindings and limits

The serving packages were built and packed from a clean exact `e7bcde9` checkout BEFORE new test files were authored. Eleven local tarballs install seventeen packages offline, zero downloads. Before launching the fixture, the case compares all71 installed server JavaScript modules with emitted build bytes, and the packaged schema with the canonical schema. Source snapshots, exact tarball/module/configuration identities, command/result/lifecycle records and full raw response bytes are retained externally under `bdp-write-product-reset-20261020/erasure-installed/attempt1`. The parent and child source artifacts are pinned separately from serving package identity. Full protocol JavaScript equality is additionally recorded by the post-run metadata verifier; no repeated HTTP run is inferred.

Bounds remain finite: child channels64KiB; ready/close10seconds; each finite HTTP5seconds, response1MiB, request headers16KiB/body64KiB; at most20 finite requests; SSE recorder existing2MiB cap and15second deadline; cohort45seconds, test60seconds, outer90seconds. The fixture itself does not weaken any product cap or timing contract. Full raw configuration/credentials are private0600; publish only the redacted completion.

Typecheck, format and dependency boundaries pass. Focused lint exits0 with five non-null-assertion warnings, not warning-free. No tests or production files are changed beyond the three new standalone test/support files. No all20 baseline, optional History, general view, restore/new-epoch, abrupt crash, installed ordinary administrative CLI, whole profile/fit or stage24 qualification is claimed. Those remain separate work rather than being inferred from this case.
