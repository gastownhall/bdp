# Private Snapshot serving slice

The existing fixed all-visible Transactional owner now serves finite Snapshot
creation, retained manifests and typed continuation pages through its private
HTTP listener. Public discovery/profile admission remains closed. No SSE,
mutable view/epoch administration, erasure policy or full-profile qualification
is introduced.

Creation is `GET <scope>snapshot`; retained URLs are the exact URLs issued by the
owner. The local parser accepts only the empty query, `snapshot=<id>`, or the
three-member `snapshot`, `stream=beads|links`, `page` shape, with no duplicate or
extension fields. Bad shapes are `invalid-parameter`; well-shaped unknown
identities are looked up and return `resource-not-found`. These are local route
conventions, not new normative precedence laws.

Creation preflight and capture share the same resource validation, bounded
record/index construction and page packing. Preflight uses fixed-width,
nonissued layout witnesses and writes no identity, captured body or page. It
checks the actual projected page/manifest sizes. A pure successful-JSON header
candidate selects direct capture only for GETs that would return200. Capture
still performs authoritative capacity/integrity checks and supplies actual
same-entry context. HEAD and possible304/412/406 run full preflight before
applying the existing HTTP decision; no owner-free predicted response is served.
This is a decision, not a reservation or a constant-time operation. Legitimate
expiry maintenance can run before it.
Retained capture inserts its sealed parent last inside one non-reentrant atomic
transaction, after all ranges exist; the intermediate orphan detail is never
committed or exposed to an integrity reentry.

Recognized domain failures return their context from the same owner entry,
after any required atomic rollback. Unexpected integrity, SQLite, uncertain
commit and delivery failures propagate to native bodyless500. Postcommit delivery
failure never compensates by deleting an undisclosed committed handle. Temporary
capacity response Retry-After uses the actual owner guidance. Fixed-view handles
are readable by another authenticated principal, including a read-only one.
Read-only principals can also create a Snapshot through safe GET. Empty-live
retry arithmetic returns finite zero if a future capacity tuple admits that
branch; the current32MiB-per-capture/64MiB-live tuple cannot reach it.

Every supplied Scope epoch, authorization view or minimum-position field remains
an explicit unsupported branch, before retained lookup/allocation and before
conditional shortcuts. It returns bodyless500 with the inherited development
limit marker `minimum-position`, whose wording also covers epoch/view-only
requests. No Q1 retained-anchor interpretation, satisfied context, timeout or
expiry is invented. Public admission and complete Snapshot/minimum qualification
remain blocked on the separately owned work.

Actual HTTP tests cover empty genesis, nonzero capture/changefeed rendezvous,
independent expected Bead/Link inventories and owned-Link agreement, literal
retained bodies through mutation/restart, and applying the following change group
to the captured replica. Other controls cover no issuance on HEAD/304/412/406,
UTF-8 HEAD lengths, expiry versus unknown/bound continuations, malformed queries,
corrupt promised data, actual eight-handle503, and HTTP413 after valid offline
4,097-record preparation. The latter is explicitly not mutation-admission
qualification. Whole byte/65,536-handle HTTP stress remains untested; those are
core owner witnesses. Capacity-at-ceiling with owned topology likewise remains
unqualified, and ledger/detail scans have nonconstant cost under the owner lock.
Repeated nonallocating decisions cost one full bounded pass each under the
exclusive owner entry, consume no live handle, and are not metered by the
eight-handle capacity refusal. No rate or connection policy is introduced. A
pinned Node24 test records eight such HTTP decisions over a disclosed offline
4,000-Bead fixture with1,024 padding bytes per record and independently checks
that retained state is unchanged. This is a measured unowned shape, not mutation
admission, ceiling-owned heap qualification or a throughput guarantee. External
Node26 timings and its inherited RangeError expectation failure remain separate
from pinned evidence. Continuations on both streams are schema-validated; the
9→10 and99→100 page-boundary witnesses also run nonallocating preflight.

Default compiled configuration metadata is tested separately from clocked
nonattesting route fixtures. The owner-observed Snapshot tuple/settings identity
and existing package inventory are reused unchanged. No new runtime setting,
limit override, helper export, installer or public configuration is added.

Finite service work uses the existing tracked drain lifecycle. Actual HTTP tests
finish concurrent finite requests and shut down the listener; a separate service
test closes while an admitted Snapshot observation is awaiting delivery. The
runtime Request signal remains synthetic. These observations do not prove
socket-disconnect cancellation or interruption of synchronous owner work.
