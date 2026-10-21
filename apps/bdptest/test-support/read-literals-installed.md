# Installed Read literal-boundary observations

The original two new cases use the exact packed `56f3407f5270558bce9d242dd753606f217462b5` server over public HTTP. A narrow production receiving correction was subsequently packed at `d967d01cb8845800213c3b103b4a119ccefad2e0` and only the failed/changed fragment cohort was revalidated. Neither run qualifies the profile or extends the cumulative manifest.

The test accepts only explicit `BDP_READ_LITERALS_ENTRY` and `BDP_READ_LITERALS_SOURCE`. `BDP_READ_LITERALS_BUILD` names the exact matching emitted server directory; every installed server JavaScript module is byte-compared to that build, and the packaged protocol schema is compared to the canonical source schema. `BDP_READ_LITERALS_EVIDENCE` selects a private evidence directory for full wire/configuration/process observations. Without the installed entry these private cohorts are skipped.

## Selector: PASS

The canonical spec at SHA256 `67772742d7d08f48c12196e9789f1859ad2d0e19f133ea65e197b049361f84f8`, lines1543–1550, distinguishes structural reference normalization from literal strings inside Selectors. One public batch creates two complete Resources. The absolute-ID Selector returns exactly the first full receipt Resource; a local-looking `beads/a` string returns an empty terminal page. A direct read proves the original Resource remains unchanged. All four responses have the same nonempty context at `pos-1`.

## Fragment-bearing alias: retained RED on the original candidate

The spec lines1434–1437 requires a fragment-bearing alias to return404 `resource-not-found`. The semantic audience URL remains the canonical alias URL, while the existing bounded conformance `rawRequestTarget` port sends the literal request-line target `/acme/alias/work#opaque`. Ordinary URL serialization is deliberately not used to carry a fragment. The test first creates Resources, writes an alias, observes its307 target, and captures an unknown alias404 body.

The new request actually returns400 `malformed-request`, retry `never`, with no context headers, Location or ETag. The exact source explains this: `node-http-target.ts:5` rejects any `#`; `transaction-runtime.ts:158–166` sends the generic pre-authentication malformed-request response. The conformance audience route and raw-target checks do permit this bounded ASCII target. This is a real installed receiving-boundary discrepancy, not an unsupported transport/N/A result.

On the original candidate the expected404 assertion fails. Later equality/absence and healthy-alias assertions in that branch were not reached; raw recorded bytes independently show the actual400 absence properties. This original failure remains preserved unchanged.

## Recorded run and bounds

The sole new two-case cohort records Selector PASS269ms and fragment RED220ms. No previously passed cohort was replayed. Full logs, Vitest JSON, exact test-source gzip, installed module/configuration binding and both observations are retained externally under `bdp-write-product-reset-20261020/read-literals/attempt1`. Both children exit0 with channels closed, no overflow/forced termination, and the outer process group is absent. The test-owned temporary databases are removed in `finally`.

Bounds are unchanged from the existing installed collection helper: child channels64KiB, ready/close10seconds, HTTP5seconds, response1MiB, request headers16KiB/body64KiB, cohort45seconds, test60seconds, outer command90seconds. Source-only typecheck and focused lint pass. No runtime, spec, matrix, manifest, release, pins or old stage inputs are changed.

The launch and byte-binding helpers are adapted from the separately reviewed collection-continuation test in PR192; the new cases do not rerun that test. The eleven local tarballs and offline installed tree are reused from its exact56 build, with all tarball hashes rechecked before this run. The test controller imports source transport helpers; only the child serving BDP is the packed installed runtime. Synthetic credentials/full wire evidence remain in private0600 artifacts, not this repository.

## Narrow receiving correction and changed-only installed validation

The existing `read-request.ts:929–951` classifier makes malformed alias queries/fragments uniform404 without resolving an alias; `transaction-http.ts:530–533` returns that Problem before invoking the Read facet. The runtime correction admits only a raw GET/HEAD fragment under that already-classified alias namespace. It checks the entire pre-fragment raw target with the unchanged normalization guard, preserves origin-form and exact Host checks, and returns the identical `resource-not-found` Problem without authenticating or consulting owner state. Empty raw fragments remain detectable even though WHATWG `URL.hash` is empty for them. No context headers, Location, ETag or Retry-After are minted on this nonobserving receiving refusal.

A fresh offline pack/install at source `d967d01cb8845800213c3b103b4a119ccefad2e0` was compared to the complete emitted modules and canonical schema. Only the changed fragment case ran: PASS225ms, twelve actual HTTP responses `[200,200,307,404,404,404,404,404,400,400,400,307]`. It covers literal opaque fragment, empty fragment, query+fragment, HEAD fragment, and continued ordinary307 health. Non-alias fragments, normalized-away dot paths, and POST fragments remain400; the old Selector PASS was not replayed. The full raw failed and corrected observations remain separate.

Corrected source typecheck/build, dependency boundaries and focused lint pass; lint has four inherited runtime warnings, not a warning-free claim. The new child exits0, channelsEOF/reaped, no overflow/force, and outer process group absent. No exact public installed profile guarantee, unknown receiving-class exception, manifest promotion, runtime cost/whole-fit or broader conformance is inferred from this test.
