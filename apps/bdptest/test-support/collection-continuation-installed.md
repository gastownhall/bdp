# Installed filtered collection continuation

Build the selected source, pack the workspace packages and install those tarballs
offline into an isolated directory. Set `BDP_COLLECTION_INSTALLED_ENTRY` to the
installed server's absolute `dist/transaction-installed-process.js` and
`BDP_COLLECTION_SOURCE_COMMIT` to its exact source commit. Optionally set
`BDP_COLLECTION_EVIDENCE` to an existing private evidence directory. Run only
`transactional-collection-continuation-installed.test.ts` with Node24.16.0. The
installed case is explicitly skipped without a selected entry; the independent
negative-oracle case needs no server.

The installed case compares every emitted server JS module with its installed
copy and checks packaged/canonical schema equality. It reuses the ordinary
installed Transactional configuration, exact HTTP transport and binding helper,
with the existing closed title-property schema and unowned Task/Relationship
Type contracts. Setup and subsequent changes use actual public batch requests.

An excluded row sorts before the three matching rows, so `limit=1` must apply
after selection. The expected complete records and generated revisions come from
the authored setup plus its actual mutation receipt, independently of the
collection being asserted. After the first page, one later matching row changes
and a new matching row is created in a real commit. The client follows the
captured complete `next` strings without inspecting or rebuilding opaque tokens.
The original set/order/revisions must survive to terminal `next: null`; a fresh
collection and resource read must show the committed state. A separate oracle
rejects fresh, revised, duplicated, reordered and omitted populations.

This is the core Read collection contract (agreed specification lines1511–1592;
`read.collections.selector` and `read.collections.pagination-snapshot`), not the
retained Snapshot endpoint or optional History. TX response headers describe the
current serving entry while rows preserve the earlier selected data, as pinned
by `transaction-read.ts` and `transaction-http.ts`. No minimum, foreign-view or
expiry precedence is selected here.

The private evidence contains exact synthetic credentials/configuration and raw
HTTP wire bytes and is written0600 outside Git. Child channels retain a64KiB
bound, ready/close deadlines10s, HTTP5s and cohort watchdog45s. Temporary stores
and owned children are cleaned up. This standalone companion does not modify the
large portable manifest, establish whole-contract linkage, certify a profile or
replace the remaining251-obligation qualification work.
