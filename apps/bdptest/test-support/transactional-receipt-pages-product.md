# Packaged receipt page boundaries

The new `transactional-receipt-pages-product-installed.test.ts` case uses the
existing installed IPC launcher and exact raw HTTP transport. Explicit
`BDP_RECEIPT_PAGES_PRODUCT_ENTRY`, `SOURCE`, `BUILD` and `OUTPUT` variables bind
the packaged service, source commit, matching clean server dist and evidence
destination. Without the installed entry the case is skipped. No runtime,
shared runner, clock or page-limit control is added.

`transactional-receipt-pages-fixture.json` is the actual custom fixture source.
It contains the Type/schema artifacts given to the installed configuration, as
well as its version, ID, seed, capabilities and URL bindings. The genuine ready
metadata and the same fixture bytes form the conformance binding. Two separately
authenticated principals share the same installation and store across ordinary
`create:false` reopen.

The case creates 32 small Resources in one allowed batch. Updating the complete
32-member set produces a matched entry plus 32 ordered updated entries. The
ordinary default receipt boundary therefore contains 32 entries and its issued
next page contains one, without raising a limit. Independent literal expected
documents and IDs check every complete record, revision transition, ordering,
and the r30/r31 boundary. Parent/page GET and HEAD check private no-store,
validator omission, bodylessness and current Scope context. Authenticated
foreign-principal GET/HEAD return 404 for both parent and page. Reopen preserves
the original issued page and exact bodies. A subsequent normal mutation moves
serving context to `pos-3` while the original requiredPosition and full immutable
receipt bodies remain at their original values.

The owner run passed on its first attempt: one new case, 24 actual HTTP exchanges,
two process generations with EOF/reap, 451.969ms test time. Source snapshots,
configuration/package identities, full responses, logs and bounded process
receipts are retained in the external integration-log directory
`bdp-write-product-reset-20261020/receipt-pages-installed-product`. No prior
cohort or proof attempt was executed. The fixture has a 20-second watchdog;
the outer owner runner retains logs and applies its 90-second watchdog.

This does not exercise 24-hour detail expiry, policy rotation, erasure projection,
failover or History deployment. Those remain residual obligations. It is finite
installed evidence, not whole receipt/profile qualification or a map update.
