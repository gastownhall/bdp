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
budget boundary. The accumulator remains private; this low-severity evidence gap
does not justify exposing a production hook or copying its implementation into a
test. No new capacity or worst-case heap claim follows from the serialized bound.

The metadata-only incident projection still returns the documented private gap;
Scope and Link Event sources remain available. No semantics for that unresolved
membership case are inferred here.
