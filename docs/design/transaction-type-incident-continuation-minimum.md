# Retained Type and incident-Link continuation minima

This increment extends the existing retained-collection minimum path to Type-inventory and Bead incident-Link continuations. It changes the shared operation classifier; the native pager, wait helper, HTTP context handling and publication checks remain unchanged.

## Native source and supported boundary

Both families already store their initial result and native source context in the pagination snapshot. A continuation validates its captured authorization view, epoch and query projection, then returns the saved page and its original source context. It also observes the current authority context. Initial Type visibility and incident subject visibility checks remain in the ordinary native read path.

A first **valid** continuation whose minimum has the same known epoch and authorization view now uses that real saved position. A satisfied minimum returns the saved page with current observation headers. A higher minimum waits under the existing fixed per-operation budget. A later commit cannot relabel the saved page as a newer prefix, even if immutable Type summaries happen to be identical. The wait does not renew expiry, allocate a replacement snapshot, reanchor the query or extend its deadline.

Native expiry during a bound wait returns the existing 410 `cursor-expired` outcome. Publication invalidation is checked against the saved source context. Unknown, foreign and first-invalid continuation/minimum combinations remain outside this increment; it does not select their precedence or introduce Snapshot endpoint behavior.

The existing protocol clauses apply: Type inventory shares the collection rules (specification lines 1094–1103); incident collections preserve one logical snapshot (1490–1502); pagination preserves the selected set, revisions and projection (1569–1588); Transactional minimum/context and conditional/HEAD rules remain unchanged (5770–5898). The agreed specification file is unchanged.

## Focused validation

The genuine SQLite owner/service fixture covers both families with twelve new cases: saved-page success, higher-minimum timeout, native expiry during the wait, erasure/publication invalidation, unsupported initial combinations and HTTP GET/HEAD conditional ordering. Ten passed in the first run. Two HTTP content-length assertions used the wrong handler-layer oracle; only those two failed cases were corrected and rerun. Two existing Type/incident tests that expected the old unsupported boundary were migrated and passed separately. There was no combined fourteen-case rerun.

One new packed installed cohort ran against implementation commit `496212e9a24c799243e20c3f935c166ef273781c`, on candidate `dff071f3ef773272a08552f91770c8fe10fd5e16`. Eleven packages were freshly packed and installed offline. All 75 installed server JavaScript modules matched the fresh build, and the installed protocol schema matched the canonical schema. The ordinary installed launcher used a new explicit configuration and the public HTTP transport. Its private development qualification binding remains non-attesting.

The fifteen HTTP observations create three Beads and three Links, issue Type and outbound incident continuations at position 1, update a later Link and add a Link at position 2, then exercise satisfied GET/HEAD minima on the actual issued URLs. Saved incident records retain their old revisions and finish without the newly added Link; fresh reads show the changed revision and new Link. Type summaries remain unchanged but their saved position still controls minimum admission.

For higher minima, the actual installed pager's existing one-second expiry occurs before the fixed minimum deadline. Both observed higher requests therefore return 410 after approximately 992 ms, including a HEAD response with the matching GET problem length. This cohort does **not** claim installed 503 evidence for these families; the focused owner/HTTP tests cover that branch with the existing trusted fixture clock. No production clock, TTL, cap or deadline was changed.

The installed child exited normally with both streams at EOF; the outer 90-second watchdog did not fire, the process group was absent and the owned temporary store was removed. Raw failed attempts, source snapshots, commands, package/module/config bindings and results are retained under `bdp-integration-logs/bdp-write-product-reset-20261020/type-incident-continuation-minimum`.

## Limits

This is a matching-context continuation increment, not whole-profile qualification. General view/epoch comparisons, unknown or first-invalid continuation precedence, optional History, restore behavior and whole-configuration conformance remain outside its demonstrated scope. The installed configuration differs from earlier cohorts and is not pooled with their results.
