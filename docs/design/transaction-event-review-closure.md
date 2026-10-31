# Finite Event review closure

This follow-up adds evidence to the private finite Event implementation after the
combined changefeed integration. It does not admit a public profile, implement
SSE, or decide metadata-only incident Link membership.

The actual HTTP fixture now places escaped text and a non-ASCII character in a
Bead's created Event. HEAD must report the corresponding GET body's UTF-8 byte
length, and that value must differ from JavaScript string length. This makes a
byte-count-to-code-unit-count regression observable.

Retained integrity controls now include a non-string body at the owner read seam
and an actual missing middle group in a disposable SQLite store. The latter
resumes from a previously matched cursor, encounters the positional hole, and
refuses rather than skipping ahead. Restoring the saved group restores the exact
original pages. Existing tests separately cover a missing final row, context and
ordinal corruption. This is bounded corruption evidence, not an exhaustive audit
of endpoint witness consistency or arbitrary database damage.

The earlier route correction makes malformed or query-bearing aliases return the
existing uniform 404 before minimum-control handling; previously those combinations
could reach the private unsupported-minimum gap. Tests now include malformed aliases,
query aliases, the receipt namespace root and a query-bearing receipt-page path,
on GET and HEAD. Well-formed query-free aliases retain their existing minimum
behavior. The HTTP handler reuses its earlier alias classification when checking
that behavior; no second parsing pass is necessary.

The incremental byte calculation has an algebraic justification: serialize the
empty source/events/next envelope, remove the four bytes occupied by null, add
serialized Event bytes and array commas, then add the serialized continuation
string. The observed tests establish one envelope serialization, one serialization
per Event, escaping/non-ASCII handling, bounded emitted pages and first-Event
feasibility. They do **not** observe an accumulator-to-wire equality at a one-byte
budget boundary. A black-box byte-driven split could strengthen this evidence without a production
hook. That targeted boundary observation is deferred as a cost/priority decision,
not because exposing the accumulator is necessary. No new capacity or worst-case heap claim follows from the serialized bound.

The metadata-only incident projection still returns the documented private gap;
Scope and Link Event sources remain available. No semantics for that unresolved
membership case are inferred here.

## Integrated changefeed review

The external review of `d907a1e` found no correctness defect in merge resolution, per-observation group-reader preparation, checkpoint tamper controls, retry-from-cursor behavior or the current served bound. The stale sibling group bound is corrected in the materialization follow-up. The old external `transaction-changefeed-bound.mjs` probe and its output belong to source `8569b85` and the superseded M64 tuple; they are retained historical artifacts, not an executable proof of the current M32 tuple. The current derivation of record is the source-driven `TRANSACTION_CHANGEFEED_BYTES` formula and the in-suite exact `186334744` assertion. Two now-single-iteration seed loops are flattened without changing the workload.

Informational observations remain bounded: corruption controls assert fail-closed rather than every individual error string; prototype spy restoration follows existing test conventions; changefeed cursor lookup precedes the minimum check but reads no body. None was identified as a correctness defect or claimed as a new observation.
