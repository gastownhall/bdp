# Accepted S1 amendment: retained Snapshot minimum

Donna accepted the behavior below for implementation. This separate amendment is
the integration handoff for Trish; it does not rewrite the frozen agreed
`docs/specs/bdp.md` or imply cumulative conformance qualification.

For a recognized retained Snapshot manifest or issued continuation in the
matching Scope Epoch and Authorization View, the saved immutable Snapshot
position determines whether the request satisfies its minimum. The live Scope
position cannot make an older Snapshot eligible. The server must not wait,
reanchor, replace the Snapshot, or extend its original expiry to satisfy that
minimum. A lower or equal comparable minimum remains eligible.

For example, a still-valid Snapshot saved at position 10 with a minimum of
position 15 is refused immediately, even if the live store has reached 15.
The direct Transactional problem is:

| code | family | HTTP status | retry |
| --- | --- | ---: | --- |
| `snapshot-position-too-old` | `conflict` | 409 | `after-state-change` |

The family URI is
`https://github.com/gastownhall/bdp/problems/conflict`. This is not a Read,
Read+Update, validation, or mutation-receipt problem code. It does not prescribe
a timed retry or add `Retry-After` behavior.

The existing recognized-handle expiry refusal wins over the minimum comparison:
an expired Snapshot still returns 410 `cursor-expired`, rather than the new
409. Conditions and media negotiation cannot bypass either semantic refusal.
GET and HEAD make the same eligibility decision; HEAD retains the usual body
suppression and response metadata rules.

The implementation preserves the retained bytes, plan, issued identity,
checkpoint, saved position, and expiry. Existing response context headers remain
the owner's same-entry serving observation; they do not replace or alter the
saved anchor inside the Snapshot body.

This decision does not choose comparison semantics for opaque or otherwise
unproved position identities, foreign epochs/views, or invalid/unknown
continuations. Those cases must not acquire invented ordering, current-position
substitution, or a fresh waiting deadline. The combined
authorization/non-disclosure, foreign-view, expiry and minimum precedence remains
an explicit pending operator question; matching-context implementation evidence
does not answer it.

The initial implementation is deliberately partial. Minimum-bearing requests
with unknown handles/tokens, supplied foreign contexts, a retained foreign view,
or unproved position spellings remain behind the existing private unsupported
boundary. This is not a normative 500 classification for those combinations.
No-minimum behavior is unchanged. The draft can serve as a source dependency
without claiming that these remaining S1 cases or full conformance are settled.

The implementation adds this code to the Transactional-only and direct problem
schema branches, with its exact family/status/retry constraints. The frozen
specification table is checked separately from the accepted S1 extension, so the
test does not falsely claim the old table already contained this row.
