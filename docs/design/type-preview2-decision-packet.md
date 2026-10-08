# Preview 2 Type design — decision packet

Prepared October 3; updated October 8, 2026. Owner: Trish. Product decisions: Donna.
Plan of record: [BDP #59](https://github.com/gastownhall/bdp/issues/59).
Draft: [PR #60](https://github.com/gastownhall/bdp/pull/60),
[Type design](type-lifecycle-preview2.md).
Initial [review disposition](type-preview2-review.md) records corrections and remaining gates.
Release coordination: [Preview 2 #7170](https://github.com/gastownhall/beads/issues/7170).

**Required contribution:** a reviewed, publishable Type specification/design
draft for the Monday October 12 EOD Pacific candidate. Type implementation
is optional and waits on product decisions. The release's separate mandatory
CLI implementation gate belongs to its CLI owner.

## Sunday October 4 review — requested as tomorrow on October 3

The draft is available now for review of:

1. BDP authority over the abstract model versus Beads authority over CLI,
   persistence, acquisition, and operator workflows.
2. Stable Type identity, versioned definitions, and exact affiliation in
   stored resource versions; these are a working design, not current BDP law.
3. Directional compatibility, including changes of meaning with identical
   structure; conformance claims do not become true merely by passing a schema.
4. Installation, update, removal, migration, and packaging decision tables;
   35 acceptance cases (including confirmed family-rule outcomes); current implementation versus NYI.
5. Integration with CLI PR102 without changing its command specification or
   implementing Type commands there.

## October 8 decision update

Donna confirmed that updates to existing Beads and Links never implicitly move
their stored Type pin. An explicit Type selection is required. Pinned input
selects an exact definition; floating input resolves to a stored pin. Nominal
filters match exact identity/version when pinned and all versions of the identity
when floating. Donna also accepted one combined property-and-Type update with
resulting-state validation and all-or-nothing commit. CLI flag spellings and
broader graph-repair/ownership/compatibility consequences remain open.
The [dated ruling in the draft](type-lifecycle-preview2.md#october-8-ruling--explicit-affiliation-updates)
separates these decisions from the remaining questions.

Donna also confirmed **both** guarantees for the proposed major-version family:
old valid data remains valid without transformation or semantic reinterpretation,
and new instances preserve earlier consumers' structural and semantic guarantees.
See [the compatibility ruling](type-lifecycle-preview2.md#october-8-ruling--both-compatibility-guarantees-within-a-major-family).
SemVer encoding, family membership/evidence, enforcement and cross-major behavior
remain open. An optional field addition is not automatically compatible if old
valid extension data already occupies that name.

Review the [brittleness map](type-brittleness-map-20261008.md) before selecting
isolated mechanisms: constraint matching, graph validity and owned-source
versioning have coupled consequences.

## Decisions to take in order

| Review batch | Decisions | Recommendation to consider, not an adopted rule |
| --- | --- | --- |
| Identity and meaning | D01–D04: Types as Beads/metatype; stable addresses; exact version addressing; complete dependency closure | Preserve stable affiliation; bind each stored resource version to an exact definition and fixed dependencies. Decide bootstrap and legacy identity treatment before specifying wire encoding. |
| Compatibility and graph integrity | D05–D06: conformance declarations and trust; current versus historical endpoint validation | Keep structural acceptance and semantic substitution separate. Never infer compatibility from revision order or version labels. Decide endpoint validation independently of Type pins. |
| Installation and update | D07–D08: admission, publication authority, idempotence, defaults and documentation refresh | Explicit, bounded installation; no request-time fetch; publication leaves existing instance meaning unchanged; property edits preserve affiliation pins unless adoption is requested. |
| Removal and migration | D09–D10: deactivation, discovery, existing edits, retention/erasure, atomicity and rollback | Separate withdrawing future use from destroying retained definitions. Require explicit adoption and graph validation; do not design an automatic migration engine before these rules are decided. |
| Packaging and product surface | D11–D12: portable unit, provenance/trust, distribution, authoring and discovery | Review an offline complete-closure bundle as a candidate. Hash integrity alone supplies no publisher trust. Keep CLI syntax and storage layout in Beads. |

Donna owns all product rulings. Trish records their exact disposition in #59;
Janet and the CLI owner reconcile the resulting interface boundary. No row
is implementation authorization. Discussion assent to pinned storage is
recorded; the detailed compatibility mechanism remains a proposal.

## What can make Monday October 12's candidate

**Planned mandatory artifact:** the reconciled BDP design document, disposition
for every decision, exact examples and acceptance cases, an honest capability
table, and links from the release/CLI documentation to its one authoritative
home. Include the README authority statement and a review disposition.

Completion is checkable: all D01–D12 dispositions are recorded; included cases
have one chosen outcome; deferred features are explicitly excluded; review
findings have dispositions; CLI and release owners acknowledge the exact document
commit. The target is the requested design/specification draft. An adopted BDP
amendment additionally requires aligned canonical prose/schema, problem and
conformance surfaces, fixtures and compatibility handling; it is not claimed here.

Proposed checkpoints: October 4 model/compatibility review; October 5–8 product
rulings and revised cases; October 9 review of the decided draft and CLI seam;
October 12 final source refresh, review disposition, documentation freeze and
release-owner acceptance. These are proposed work checkpoints, not confirmed
reviewer bookings.

**Optional:** implementation only if a separately approved bounded slice can
pass its own review, exact-source tests and combined release qualification.
No Type implementation is currently committed to the candidate. Cutting it
must not cut the mandatory Type document.

**Current readiness:** ready for design discussion; not yet an adopted
specification or an implementation-ready contract. Publication as an explicitly
labeled design draft can retain deferred questions if Donna and the release
owner accept that scope. If foundational identity, version addressing, or
compatibility decisions remain unresolved, do not claim a settled Type spec:
escalate the release disposition through #59 and the bus. A document existing
is not by itself proof that the mandatory Type gate has passed.

## Verification and boundaries

On October 3, checked BDP main `182f1fcf`, PR60 `9310bf45`, Beads integration
`ad54537e`, and CLI PR102 `6753ad7c` against GitHub. PR72 is now merged.
BDP main, PR60 and Beads integration were reconfirmed unchanged October 4.
The full SHAs and source links are in the design draft. This work changes only
BDP documentation. It does not modify PR102, Beads runtime, any database, or
the manual playground. Source inspection is not runtime qualification.
