# Historical erasure in the private Transactional owner

This implements the historical retained-version portion of the agreed erasure
contract in `docs/specs/bdp.md` (Administrative erasure). It does not amend that
specification or advertise a public erasure operation.

The local store, service and runtime expose
`eraseHistoricalVersions([{ subject, revision }])`. The caller must possess the
local administrative owner; there is no HTTP route, mutation receipt or ordinary
client authorization shortcut. Mutations must be drained first. Any selected or
cascaded **current** version refuses the whole call before writes: this slice
does not manufacture successors or tombstones.

## Atomic operation

The owner plans the entire selection, including every historical source Bead
version that inlines a selected owned Link version. It computes SHA-256 over
JCS of each complete retained original Resource, excluding the derived `links`
aggregate. Numeric object names sort by UTF-16 rather than JavaScript's integer
property enumeration order. An inability to produce JCS does not prevent the
purge; a best-effort digest is recorded and the digest anomaly is returned only
to the local administrator, outside BDP records.

One SQLite transaction removes all selected postimages from retained versions,
change-group state changes, receipt details and Snapshot copies, records permanent
lineage and erasure records, and appends one erasure-only change group. That group
has its own Scope position and authority transaction identifier, empty changes
and Events, and no mutation receipt. A failure before commit rolls everything
back. An abrupt process exit after commit leaves the complete purge and ledger
durable. SQLite uses DELETE journaling, FULL synchronous writes and secure_delete;
this is not a claim about external backups, filesystem snapshots or forensic
recovery from storage hardware.

Events containing erased content are withheld whole; their immutable payloads
are never rewritten. An ordinary successor delta can expose its erased
predecessor through a remove/replace path even if the successor remains healthy.
Those predecessor-dependent Events are withheld too. The existing exact complete
root-replacement form and identity-only `ownedLink.deleted` form remain available.
Deleted facts remain available. Endpoint `linked`/`unlinked` facts disappear only
when no retained Link version carries the endpoints. Surviving ordinal values
are unchanged. One-way source commitments preserve the validity of issued
exclusive Event cursors without retaining endpoint plaintext in a cursor index.

## Visibility and publication

The existing initial development view sees the permanent ledger. The existing
empty replacement view sees no record, receives projection-only advancement and
cannot use private retained-version lookup as an existence oracle. This is not
a general authorization-policy implementation.

Finite changefeed reads and reconnects before an observable erasure floor return
`410 cursor-expired`. Issued pre-erasure Snapshot handles and continuations expire
before copied bytes can be served; their compact issued identities remain known.
Fresh Snapshots include the projected permanent ledger.

Ordinary Read collection and incident-Link pagination also holds immutable
copies. The owner synchronously invalidates that view's pagination snapshots
and cursor entries when erasure commits, without closing the Read plane or
resetting its clock. Ordinary non-erasure commits preserve continuations and
their original rows. The original snapshot context follows a cached page through
Promise delivery and private HTTP response shaping; the final transport check
uses that body context, while the public headers retain the current serving
observation. Cleanup attempts all composed cache invalidations; any failure
fences the owner with the complete collected causes before further delivery.

An already-admitted changefeed stream may cross erasure position P only if the
complete frame through P-1 has already been handed to its transport. Lagging or
backpressured streams with queued earlier groups are aborted in the same
synchronous owner turn as the purge. Publication checks surround the actual
sink write, not just the earlier read. `write(false)` means that this complete
frame was accepted into Node, not that a client applied it. Finite HTTP results
and Event stream writes also recheck current owner context before visibility.

## Request-storage migration

Store format `bdp-private-transaction-snapshot-12` explicitly introduces
`transaction-reference-leaves-sha256-1` request fingerprints and
`transaction-alias-witnesses-sha256-1` historical witnesses. Exact recognized
formats 10 and 11 are converted transactionally after unchanged installation and
contract admission. Unknown/missing current policies and malformed committed
witnesses refuse opening without rewriting retained dispositions. Old binaries
refuse format 12 rather than append recoverable normalized request bodies.

The `ru-semantic-value-1` encoder, equality, defaults, number handling and
normalization remain unchanged. Only the six existing normalized reference
fields receive domain-separated private leaf commitments before the complete
typed normalization is fingerprinted. Arbitrary property strings/objects cannot
forge the private tag. Alias locator/target commitments retain the original
resolution, including misses, across repointing, cross-carrier retry and reopen.
Comparison-only historical placeholders cannot reach execution; fresh evaluation
continues to use real canonical References. Completed/cancelled owner state drops
normalized request caches while opaque weak tombstones preserve fencing and
idempotent cancellation.

## Validation and remaining work

Focused tests cover atomic purge and rollback, abrupt before/after-commit crashes,
reopen, JCS, digest anomalies, live-version refusal, owned copies, erasure-only
publication, backpressure and consecutive erasures, Snapshot continuation expiry,
receipt expiry/page identity, ordinary predecessor-delta exposure, content-free
Events, alias repoint/conflict/forgery and legacy witness migration. A source
runtime HTTP/SSE test records raw responses, checks catch-up versus finite/reconnect
fences and reopens the same store. It is not an installed-package/admin-API test.
Affected transaction tests additionally exercise existing dependency, sequence,
receipt, Event, Snapshot and streaming behavior. Immutable raw run history lives
outside the source tree; failed fixture and pre-correction runs are retained.

Live/current-version correction, tombstones and live owned cascades remain a
separate cohesive tranche. Public optional History, arbitrary receiving views,
restore/new-epoch ledger re-emission, client replica persistence and deployment
backup erasure are not implemented by this slice. The complete twenty-row
baseline erasure obligation remains incomplete; optional History being absent
does not make baseline erasure inapplicable. No full-profile or runtime-fit
qualification is inferred from these focused results.
