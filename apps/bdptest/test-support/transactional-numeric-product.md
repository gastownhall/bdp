# Packaged Transactional numeric fixture

`src/transactional-numeric-product-installed.test.ts` is one bounded new HTTP
case on a fresh packed installation. It uses the existing installed process,
authentication binding and exact raw HTTP executor; it changes no runtime or
shared runner. Set all four `BDP_NUMERIC_PRODUCT_*` variables (`ENTRY`, `SOURCE`,
`BUILD`, `OUTPUT`) to run it. Without an explicit installed entry it is skipped.
`ENTRY` is the installed server's `transaction-installed-process.js`, `BUILD` is
the matching clean server `dist` directory, and `SOURCE` identifies that build.
The test compares every server JS body and the packaged schema before launch.

The raw request literals `1`, `1.0`, `1e0`, `-0`, and `0` check exact-decimal
no-op revision and position behavior. A complete initial nested document also
round-trips `0.1` and `1e300`. The forbidden integer `9007199254740993` is always
source text passed directly to `Buffer.from`; it never passes through a
JavaScript numeric value or `JSON.stringify`. Four failed-receipt cases cover
top-level properties, nested properties, nested metadata and an unapplied
Property Change value. Diagnostic oracles distinguish document-relative create
locations from patch input locations. Independent literal expected documents,
rather than the server's numeric helper, check stored values and revisions.

The fixture follows bounded emitted changefeed `next` links to completion;
two groups/Events before the final admissible `9007199254740992` control and
three afterward prove this case added no no-op/refusal group or Event. This is
not a claim about every numeric literal, every profile, content-derived token
schemes, concurrency, or full conformance.

The retained owner run used Node 24.16.0, pnpm 11.20.0, fresh offline tarballs,
an authentic private installed configuration and History=false. One case passed
on attempt 3 after two oracle-only failures: attempt 1 expected a request path
inside a create diagnostic message; attempt 2 assumed an unpaged changefeed.
Both failures, source snapshots, raw wire observations, logs and process receipts
remain under `bdp-write-product-reset-20261020/numeric-installed-product` in the
external integration logs. No old cohort or proof attempt was selected. The
20-second fixture watchdog and retained outer runner logs bound the new case;
cleanup attempts child close, evidence write and temporary-directory removal
independently, retaining all errors.
