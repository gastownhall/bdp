# Ordinary retained collection minima: satisfied-prefix slice

This changes only source-private Transactional Read/HTTP composition for **Bead and Link collection continuations**. It admits a known minimum in the matching epoch/view when it is no higher than the saved query prefix. It does not change store format, cache policy, query selection, clocks, runtime limits, the agreed specification or any public operation. Type, incident-Link, History and replication Snapshot continuations remain separate.

## Requirement and actual path

The agreed specification's collection section says the authoritative `next` walks one projected snapshot: same selected set, projection and Resource revisions. HTTP consistency says pagination preserves its stable result; Transactional minimum reads cannot return an older representation as eligible. The retained Snapshot amendment separately gives the same saved-anchor comparison for recognized replication Snapshot manifests/streams, but its new `snapshot-position-too-old` code is expressly scoped to that capability. This slice needs no extension of that code: a matched known minimum <= saved query prefix already satisfies the existing general minimum law.

Before this change, `transaction-http.ts` rejected every minimum-bearing collection continuation at `minimum-position-route` before the normal Read route. The actual owner path already had all necessary trusted information:

1. `requestFromUrl`/`continuationDetails` preserve the server-issued URL, token and projection.
2. `AuthorityRead.observe` opens the real current owner entry and captures actual authorization/context. It materializes a continuation intent without rebuilding the query against current rows.
3. `finish` calls existing pagination `continuePage`, which checks original absolute expiry, epoch, view and projection, then returns the retained page. The page may lazily produce its normal next token using capacity already reserved at first-page admission; no second query snapshot is created.
4. `pageObservation` carries the retained `snapshotSourceContext` separately from the current owner `sourceContext`. `transactionReadContexts` validates both, including saved <= current and shared epoch/view.
5. The existing Read `checked` publication assertion fences the saved context; owner erasure notifications discard affected view caches. HTTP's private response-source WeakMap and the runtime's final finite publication guard still use that saved context. These mechanisms are unchanged.

The new wrapper runs these ordinary checks, then compares the captured tuple with the actual saved context. It returns the SAME retained page object for satisfied known tuples. The serving context headers remain the existing same-entry current observation; they do not relabel the old rows as new. Eligibility uses the saved context, never the live head. No waiting, reanchor, replacement, traversal restart or absolute-expiry renewal is added. The existing initial/current minimum logic remains separate.

## Precise selected and unselected branches

| Request / native result | This slice |
| --- | --- |
| Valid Bead/Link collection continuation; known minimum and matched epoch/view; minimum <= saved prefix | Serve exact cached page; current serving headers and saved publication provenance both retained |
| Same branch with ordinary GET/HEAD or HTTP conditions | Same semantic eligibility before body suppression/304/412; original query bytes remain |
| Minimum > saved prefix, even when current head >= minimum | Existing private unsupported500 remains; not a normative public classification |
| Opaque/unproved minimum, foreign supplied context, unknown/unavailable/expired cursor with minimum | Unselected private boundary remains; no invented ordering or foreign/expiry precedence |
| No minimum | Existing behavior unchanged, including actual expiry410 and erasure invalidation |
| Type/incident/History/replication Snapshot continuations | No new admission |

## Retained evidence

Two NEW owner tests for Beads and Links first failed on unchanged source with `minimum-read route outside supported subset`. After the narrow fix, five NEW owner checks passed: both collections' exact page identity and rows after head advance, higher/opaque/foreign/unissued exclusions, unchanged absolute expiry, and actual erasure/publication fences. One materially affected old Type/incident test migrated only its Bead/Link continuation expectation and passed; its Type continuation exclusion remains. No old passing cohort was replayed merely for ownership.

The identical NEW installed test first ran against the existing offline packed b686 runtime and failed500 at its first satisfied continuation. It then passed against a fresh offline packed build of exact source `fe49e1e8ba3d0563be34664710be5e9d28460cae`, with20raw HTTP exchanges. Both collections were saved at position1, their b rows changed at position2, and known minima0/1 GET/HEAD still returned the exact original b records/next identity. Current response headers stayed2. Conditional304/412 were bodyless and current-context preserving. Higher minimum2 retained the explicit private gap instead of stale success. The same original ordinary1s TTL then returned410 on no-minimum continuation reads. No clock or TTL seam was used in that installed case.

Owner RED and installed RED sources/logs/results remain intact. GREEN is the first run on changed code, not a retry of a passed test. The installed child closed normally with EOF and zero status; outer receipts record no force and absent owned group. Five-file source formatting/typecheck/build pass; formatting diagnostics and all warnings are retained separately from semantic test results. Existing store/runtime/cache engines and all their erasure/publication hooks have no source changes.

## Higher-minimum follow-up under existing law

Concrete request: issue `GET beads/?limit=1` at query prefix1, retain its absolute `next`, advance the live store to2, then GET that exact next with the actual epoch/view and `BDP-Minimum-Scope-Position: pos-2`. The live head cannot make the fixed prefix1 page eligible. That is now explicitly tested without selecting a new public refusal.

**Recommendation for the next source slice:** use the existing fixed bounded minimum wait, retaining the original query/token/deadline, with ordinary cursor validity and publication checks on every attempt. If the bound expires while the cursor remains valid but ineligible, return existing503 `catch-up-timeout`, family unavailable, retry `after-delay`, with the existing Retry-After policy and actual current error-observation context. If the original cursor actually expires or becomes unavailable under its existing rules first, preserve its native410 `cursor-expired` / `after-state-change`; never manufacture an early expiry, extend retention, or restart the query. Actual erasure/authorization/publication fences remain decisive and cannot become a stale success or generic timeout.

This is a technical mapping to existing laws, **not implemented here**. The general catch-up-timeout wording does not exclude an ineligible retained query, so this trace does NOT establish a need for a new public code or a new Donna decision. Immediate foreign-view is false for the matched request; immediate cursor-expired is false while the cursor is still valid; the Snapshot-only409 must not be borrowed. A genuine bounded timeout can cover the inability without those inventions.

The future implementation must preserve both saved and current contexts across attempts. In particular, a saved-prefix comparison's `behind` error cannot simply be reused as the timeout's response context: the error response must report the current attempted observation, not claim the saved rows were current. It must also preserve the first genuinely validated cursor/source binding across later attempts so expiry, erasure purge, view change and unknown identity are not conflated. Default ordinary cursor TTL and wait budget are both1s; in real timings the original cursor may expire before the minimum deadline. That is not permission to hold it longer or force a503 outcome. Initially unknown/foreign combinations remain a separate unselected boundary; this follow-up does not answer the pending replication Snapshot foreign-view/expiry question.

Evidence is under `bdp-integration-logs/bdp-write-product-reset-20261020/continuation-minimum-product/`: full raw logs, gzip sources, RED/GREEN receipts/observations and `implementation-validation.json`. The unchanged existing installed launcher/raw transport are used. No first23/proof/exhausted DATA rerun, whole-profile qualification, release/pins/main change or stage24 activation is claimed.
