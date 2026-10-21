# Installed receipt detail erasure and expiry fixture

This new case uses offline-packed local packages built from candidate
`e2bcb59a3b4ec97a6125d24e693a07e7ebbf16bf`. It byte-compares every installed
server JavaScript module with that clean build and checks the installed protocol
schema before starting a genuine installed runtime. The custom fixture pins its
Type/schema artifacts and two principals. It changes no production source,
public configuration, operation, retention bound, or transport.

This is explicitly a **nonordinary trusted fixture**. Its new child supplies the
existing private clock seam, obtains the authentic same-facade administration
capability, and invokes the existing empty-authorization-policy transition.
Those seams are not BDP HTTP operations. Supplying a clock seam intentionally
disables ordinary `configurationMetadata`; the evidence records that absence,
exact installed module/payload identities, actual configuration, fixture bytes,
and ready/control messages rather than fabricating an ordinary deployment
identity or claiming History-profile permission.

The one new case performs 26 HTTP exchanges. A batch of 32 Resources followed
by UpdateWhere produces 33 receipt entries with issued 32+1 page boundaries.
After a healthy successor update, historical erasure of the first and last old
postimages removes their content from the original receipt/page and exact-key
replay while healthy current Resources stay unchanged. The all-visible path's
choice of erased identity versus withholding remains permission-unqualified:
current receipt and sequence projection disagree about retained-history
eligibility. This case preserves the actual observation and checks content
absence and conditional record shape; it does not settle that policy question.

An actual empty-policy transition checks exact withholding with unchanged
original receipt identity, positions, expiry and page boundaries, alongside the
new serving authorization view. GET/HEAD pairs check private, no-store,
validator absence and body length. At the exact 24-hour `expiresAt` instant,
detail remains available. One millisecond later the parent is compact/expired
and the issued page refuses with 410 `cursor-expired`; a foreign principal still
receives 404. No real 24-hour wait or ordinary-deployment timing claim is made.

Attempt 1 failed before HTTP because the fixture incorrectly requested ordinary
installed metadata despite its clock seam. It closed cleanly and is retained.
Only that failed new case was rerun after correcting fixture metadata handling:
attempt 2 passed (273 ms, outer 0.614 s), with both streams at EOF, direct child
reaped, owned process group absent and no forced termination. No old tests were
replayed. Raw responses, both source snapshots and all failure logs are retained
under the separate redacted implementation-validation evidence. This is finite
installed observation, not complete receipt/profile or retained-history
qualification.
