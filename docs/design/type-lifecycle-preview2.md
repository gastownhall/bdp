# Type lifecycle for Beads Graph Preview 2 — design draft

Status: **proposal for review, not adopted BDP semantics**. Prepared October 3,
2026; updated October 4 by Trish for [BDP #59](https://github.com/gastownhall/bdp/issues/59).
Delivery PR: [#60](https://github.com/gastownhall/bdp/pull/60).
[Decision packet](type-preview2-decision-packet.md) summarizes the review and
Monday October 12 EOD Pacific candidate plan.

The Type document is mandatory for Preview 2; Type implementation is optional
and awaits product decisions. Existing BDP v0 remains authoritative until an
explicit specification amendment is approved. Examples below describe the
proposed abstract model and are not valid new wire formats or runnable commands.

## 1. Authority, requirements and decision status

BDP owns shared data meaning: identity, affiliation, Type versions if adopted,
conformance, validation, history and relationship invariants. Beads owns CLI
syntax, storage layouts, acquisition mechanisms and operator experience. The
[README](../../README.md#architecture-and-design-authority) records this
boundary. Implementation experience can motivate an upstream decision; it
does not silently change the shared model.

Users need to add Bead and Link Types, update their definitions, and remove
them from use. The design must preserve intelligible current and retained
data while making those operations practical. It must distinguish structural
validation from meaning, Type definition publication from instance adoption,
and administrative availability from destruction of historical evidence.

The October 1–3 design conversation establishes different levels of authority:

| Item | Status |
| --- | --- |
| BDP owns the abstract model and protocol; Beads owns implementation/product surfaces | Agreed direction; recorded in the README proposal |
| Authoring convenience is distinct from precision in stored state | Explicitly agreed |
| Every stored affiliation is pinned to a Type version | Explicit working assumption requested by Donna; representation and adoption rules remain open |
| A resource retains one stable Type identity while its affiliation pin may evolve | Working design Donna agreed to explore, not a finalized prohibition on all future retyping |
| Types become Beads with versions under a stable identity | Hypothesis under evaluation; no final choice or bootstrap rule |
| Compatibility is directional and includes semantics as well as structure | Direction explored; Donna specifically required same-structure/changed-meaning cases |
| Compatibility encoded through pinned conformance, author declarations, or version labels | Trish proposals only; no mechanism approved |
| Installation/removal/migration/package behavior | Unruled; recommendations and acceptance cases below are conditional |

## 2. Verified baseline and scope of inspection

GitHub heads were read on October 3, 2026; BDP main, PR60 and Beads integration
were reconfirmed unchanged on October 4 before publication. These are evidence
for this draft, not promises about subsequent branch state.

| Source | Exact head / state |
| --- | --- |
| [BDP main](https://github.com/gastownhall/bdp/tree/182f1fcf8a01d896976bff3c9e3fb87c596c6ca6) | `182f1fcf8a01d896976bff3c9e3fb87c596c6ca6` |
| BDP PR60 before this contribution | `9310bf45d1f53c12017f755df5f57c70b3a5df07`, open draft |
| [Beads integration](https://github.com/versioned-beads/beads/tree/ad54537e7cb38ec5c2cf2c8d00735099d024d0d1) | `ad54537e7cb38ec5c2cf2c8d00735099d024d0d1` |
| [CLI PR102](https://github.com/versioned-beads/beads/pull/102) | `6753ad7cea7af431ef22517ae3af2b4758f74514`, open |
| Historical graph CLI PR72 / Donna's source branch | `9a17ee9d1659aa88f247a9bd06c4284bf5ea30ba`, PR72 now merged; this is no longer the integration baseline |

Current [BDP Types](https://github.com/gastownhall/bdp/blob/182f1fcf8a01d896976bff3c9e3fb87c596c6ca6/docs/specs/bdp.md#types)
bind a Type ID to one immutable semantic contract. Resource `type` is immutable;
contract changes require a new Type ID. Validation installs and pins the full
closure before request admission and uses it offline. Human documentation can
change separately. The installation mechanism is outside v0, but evolution already has a binding
rule: changing Resource category, conformance, properties constraints or Link
endpoint constraints requires a new Type ID. The working stable-identity,
versioned-definition model contradicts that rule and requires an explicit
amendment; it is not merely filling an unspecified installation interface.

Existing v0 also retains exact artifacts while live or retained representations
refer to them, and at least Type ID plus fingerprint for the logical Scope's
lifetime. It forbids rebinding contract-bearing content at an existing ID.
Any proposal weakening these obligations must identify and amend them explicitly.
Type-definition erasure cannot be assumed to inherit Bead-version erasure without
mapping its replica/changefeed and dependent-resource consequences.

Existing install validation remains the baseline: JSON Schema 2020-12;
required vocabularies implemented or installation rejected; open root properties
schemas; closed descriptor objects; cross-member descriptor validation such as
explicit ownership bounds not exceeding a wildcard bound. Resolution is bounded
by descriptor count/size, closure depth, schema count/size, reference depth,
retrieval time and compiled-validator resources. The current mutation refusal
for unavailable closures is `type-not-installed`; whether deactivation or
post-erasure unavailability needs a different outcome remains D09/D12.

Current BDP reference pins record provenance; they do not automatically select
a historical endpoint for integrity validation. In-Scope Link endpoints identify
live Beads; external endpoints are opaque. The proposed Type pin cannot silently
change these separate Reference and Link rules.

Repository roles: `gastownhall/beads` is upstream and hosts the public release
tracker; `donnabox/beads` holds Donna's contribution branches;
`versioned-beads/beads:integration` is the Preview integration hub (issues disabled).

Current Beads source evidence:

- [Type readers](https://github.com/versioned-beads/beads/blob/ad54537e7cb38ec5c2cf2c8d00735099d024d0d1/internal/storage/graphstore/types_read.go)
  enumerate persisted descriptors, fix bindings at initialization, and reject
  unsupported custom Type lookup.
- [Installed-set checks](https://github.com/versioned-beads/beads/blob/ad54537e7cb38ec5c2cf2c8d00735099d024d0d1/internal/storage/graphstore/informational_types.go)
  accept the legacy four or current six descriptors; partial, unknown or
  replaced sets are invalid. Reads never install examples into an old workspace.
- [Technical reference](https://github.com/versioned-beads/beads/blob/ad54537e7cb38ec5c2cf2c8d00735099d024d0d1/docs/reference/graph-preview.md)
  documents discovery and fixed Type authoring, with arbitrary installation
  unavailable. `--type` is Issue classification; `--bead-type`/`--link-type`
  select graph Types. These concepts must remain distinct.

This inspection establishes source/documented behavior, not a new runtime test
result. The October 1 [vendor scan](bdp-vendor-sync-20261001.md) remains a dated
comparison of its stated heads; it is not recast as an October 3 full comparison.

## 3. Proposed abstract model

In the working design a resource's stable identity, its own version, its Type
identity, and the governing Type definition version are separate concepts:

```text
Invoice Type identity
  definition A: amount means dollars
  definition B: amount means cents

invoice-123, resource version 1 -> Invoice definition A
invoice-123, resource version 2 -> Invoice definition B
```

The second resource version is hypothetical adoption, not an automatic effect
of publishing B. Whether its value must be transformed is a migration decision.
Legacy current and retained records have no definition pin in today's model.
D02/D03 must define that absent-pin state, any mapping from the installed legacy
contract, and how new successor versions become pinned. This draft does not
backfill or rewrite retained records, guess a definition version, or treat
missing historical pins as corruption by default.
A schema accepting both `amount: 100` values proves no semantic equivalence.

Proposed invariants, subject to D01–D04 and D08:

1. Each Bead or Link version committed under the adopted new model identifies
   one stable Type and an exact definition version. The resource's Type identity stays fixed in this working
   model; its Type-version pin may change only through an explicit adoption rule.
2. Publishing a Type definition never rewrites existing affiliations or changes
   how a retained resource version is interpreted.
3. The chosen definition's semantic dependency closure is fixed: parent Types,
   endpoint requirements and referenced schemas cannot silently float. Pinning
   only a top-level descriptor is insufficient.
4. Ordinary property edits preserve the existing affiliation pin unless adoption
   is requested. This is a recommendation, not a decision already made by Donna.
5. An authoring surface may resolve an unpinned Type selection before commit;
   it records and reports the exact chosen definition. Default selection,
   concurrent publication and retry behavior require D07–D08; no "latest" value
   is stored as a substitute for an exact binding.

If Types become Beads, they can reuse resource history and authorship concepts.
They still need constrained publication, a bootstrap/metatype rule, and rules
for administrative availability. A Type describing Links remains a Bead whose
definition describes Links; this does not erase the Bead/Link category boundary.
Reusing the model does not authorize ordinary unrestricted edits to executable
validation policy. D01 must decide which generic operations apply to Type Beads.

The examples intentionally do not choose `revision` versus a retained-version
address. BDP currently distinguishes revision guards, version/history addressing,
and reference provenance. D03 must define a durable exact-definition lookup and
its unavailable/erased outcomes before a concrete discriminator schema is drafted.

## 4. Compatibility between definition versions

Two directional questions must be named separately:

- **Acceptance of existing data:** does each instance valid under A satisfy B's
  structural constraints? A per-instance check is weaker than this universal claim.
- **Substitution for a required contract:** does every B instance satisfy A's
  structural obligations AND preserve A's meaning and guarantees?

| Change from A to B, all other constraints unchanged | Every A value structurally valid under B? | Every B value structurally valid under A? | Semantic substitution of B for A? |
| --- | --- | --- | --- |
| Add `paused` to allowed `open`/`closed` status values | Yes | No | Not generally; old consumers may require two states |
| Remove `closed` from those allowed values | No | Yes | Requires a meaning/guarantee review; schema inclusion alone is insufficient |
| Make an existing optional field required | Not generally | Yes | Requires review of semantics and guarantees |
| Dollars become cents, unchanged numeric schema | Yes | Yes | No for unchanged values interpreted under the new units |
| Link meaning changes from reviewed-by to approved-by, same shape | Yes | Yes | No automatic claim; the relationship meaning changed |
| Documentation correction with no meaning or constraint change | Yes | Yes | Yes only if it truly changes no contract meaning |

Proposed D05 mechanism: explicit conformance to an exact required contract,
with intersection validation of applicable structural contracts. Nodes would
be `(Type identity, definition version)` so B can conform to A under one stable
identity without being an identity-level self-cycle. No member name or wire
encoding is selected here. Conformance across Bead/Link categories remains
disallowed in this proposal. Whether this relation also spans different stable
Type identities, its transitivity, and cycle handling must be decided explicitly.
D04/D05 must also decide how a diamond reaching two versions of the same Type
is treated: intersect both exact contracts or reject that combination. An
implicit "latest wins" rule would violate exact closure binding. A blanket
one-version-per-identity rule would also preclude the proposed B-conforms-to-A
relationship under one identity, so it cannot be adopted incidentally.

Intersection conformance would express substitution only. It cannot express
that all old A data is accepted by a wider B contract: forcing B to conform to
A would remove the very widening in question. D05 must decide whether and how
acceptance-of-existing-data claims are represented separately; a per-instance
validation result is not a universal or semantic acceptance claim.

Schema checks enforce only part of conformance. Semantic compatibility is an
authored assertion whose issuer, authority, provenance and treatment of false
or withdrawn claims require D05. A self-declared label is not proof. Version
numbers may be useful human labels; their ordering or a claimed semver range
does not itself establish either relation above. Opaque revision tokens are
not ordered version numbers.

## 5. Bead and Link consequences

A Link definition version governs its properties and endpoint requirements.
Publishing a new Link Type version leaves existing Link versions governed by
their previous definitions. Adoption of another definition is separately
validated, including both endpoints and applicable Scope constraints.

Example: `assigned-to@A` requires Person; B broadens that requirement to Actor.
Old Links may be accepted by B, while a B Link targeting an Organization does
not necessarily satisfy A. Broadening endpoint acceptance is not substitution
for the narrower contract. Bead Type evolution can cause the same issue while
the endpoint's stable Type identity remains unchanged.

D06 must decide both the state examined and how integrity is maintained:

| Question | Choices requiring a ruling |
| --- | --- |
| What state does an endpoint requirement examine? | Current Bead state; explicitly resolved historical state for an endpoint pin; or another specified rule. Current provenance-only pins do not supply the second behavior. |
| What if adopting a Type version breaks a live in-Scope Link requirement? | Reject the adoption; require one atomic graph repair; or admit explicitly invalid Links with defined query/read semantics. No choice is adopted here. |
| Are compatible versions accepted automatically? | Exact requirement only; accepted conformance evidence; or an explicitly defined compatibility policy. Stable identity alone is insufficient. |
| What about external endpoints? | Preserve current opacity or introduce a separate, expressly scoped validation contract. No cross-authority transaction guarantee is implied. |

Trish recommends preserving graph validity with explicit atomic repair for
affected local relationships. That recommendation includes checking relevant
incident Links when an endpoint adopts a new definition; validating only the
edited resource would be insufficient. Historical resource pins must retain
their meaning even if current graph rules change. Deleting old definitions or
revalidating all incident Links on read is not an implicit solution.

Owned Links add another dependency. Current BDP declares `ownsOutgoing` in
Bead Types, keyed by Link Type identity with explicit and wildcard bounds;
every owned-Link mutation versions its source. D06 must decide whether the
new ownership declarations match Link Type identity, exact definition, or
accepted conformance. Bead adoption that adds/removes ownership or lowers a
bound can change the source's aggregate state even if all endpoint constraints
still pass. Advancing an owned Link's Type pin likewise needs explicit source
guards, source-version effects and retained serialization rules. No implicit
ownership transfer or new source-version rule is adopted here.

## 6. Lifecycle decisions and ownership

Every row is open unless its status explicitly says otherwise. Donna supplies
product rulings; Trish records accepted/deferred/rejected dispositions in #59
and this draft. Recommending an option does not authorize implementation.

For D07–D11, the BDP column specifies shared observable meaning and admission
outcomes, including what a stored pin denotes after an administrative action.
Beads chooses acquisition transports, operator trust configuration, concrete
bundle/container format, signing tools, cache layout and transactional storage
mechanisms. A standardized cross-implementation interchange format would require
an explicit BDP scope decision; an offline Beads package proposal does not make
its file format or distribution channel normative BDP.

| ID / topic | BDP decision needed | Beads realization after that decision | Proposed review direction |
| --- | --- | --- | --- |
| D01 / Types as Beads | Adopt or reject first-class Type Beads; define metatype/bootstrap, publication rights and allowed generic operations | Catalog representation and operator permissions | Reuse the version model if bootstrap and policy can be stated without an infinite regress |
| D02 / identity | Define stable Type identity, category stability, URL/location rules and legacy `types/` identities/absent pins without rewriting retained records | Mapping of legacy descriptors without breaking references | Preserve existing identities; do not silently move them to `beads/` |
| D03 / version addressing | Exact discriminator and historical addressing; cross-authority version identity/minting authority and divergence detection; token meaning, absent pins, retention and unavailable outcomes | Persistence/indexing and lookup | Choose an exact durable binding; no invented revision-to-version conversion |
| D04 / closure | Pin parent definitions, endpoint contracts and schemas; distinguish conformance cycles, recursive schema references and metatype bootstrap; define bounded resolution/evaluation and integrity evidence | Offline validator and bounded acquisition | Complete closure installed before admission, with no validation-time network |
| D05 / compatibility | Define substitution and separate existing-data acceptance claims, same/different-identity conformance, semantic claims, issuer authority and withdrawal | Validation and explanatory diagnostics | Explicit contract evidence, never version-order inference; distinguish false semantic claims from schema failures |
| D06 / Link integrity | Choose current/historical endpoint validation, incompatible-adoption behavior, ownership matching and limits, source-version effects and external bounds | Transactional incident checks and repair UX | Preserve local integrity and make any graph repair explicit |
| D07 / installation | Define installed/admissible state, atomicity, idempotent reinstall, same-version conflict and concurrent admission | Operator interface, permissions, cache and catalog transaction | Same exact closure is idempotent; conflicting content under one definition version is rejected; partial installation grants no admission |
| D08 / updates | Publication/default selection versus instance adoption; ordinary edits; documentation-only changes; retry binding | Selection defaults, publication/update workflow | Publication leaves instances alone; resolve convenience selections once per admitted operation; retain resolved pins across replay |
| D09 / removal | Deactivation vs catalog visibility vs physical purge; existing reads/edits/deletion; reactivation; existing retention duties, erasure amendments and replica/changefeed effects; pinned-parent dependencies | Operator checks, inventory flags and collection | Withdraw future use separately; retain dependencies of live/retained data subject to explicit erasure policy. Decide whether pinned old instances remain editable/deletable and which closure-dependent checks still apply |
| D10 / migration | Definition adoption vs changing Type identity; transforms, validation, history/provenance, concurrent guards, coordinated parent/child adoption, atomicity and rollback | Plan/preview/execute/report UX and storage migration | Explicit guarded adoption; no rewriting retained states. Type-identity conversion remains outside the working model unless separately approved |
| D11 / packaging | Portable identity/meaning, exact closure agreement, dependency conflicts and accepted publication authority; decide whether shared interchange is in scope | Bundle/manifest serialization, import/export, distribution transports, trust configuration, signature mechanisms and limits | Consider an offline bundle of one or more definitions plus complete dependencies. Hashes establish integrity, not publisher authority |
| D12 / surfaces | Protocol discriminator forms, version discovery, identity/version matching in filters and Scope multiplicity policies, errors and old-client behavior | CLI names/flags, output, database schema and rollout | Specify shared outcomes first; do not assign new commands or overload Issue `--type` here |

For removal, treating deactivation as a switch that invalidates all old values
would defeat the proposed pinning model. If physical purge or erasure makes a
definition unavailable, its identity must not be reused or rebound to different
content; required disclosure and dependent-resource behavior remain D03/D09
decisions. The current live/retained-artifact and Scope-lifetime ID/fingerprint duties
remain binding. Purging artifacts still referenced, deleting the lifetime
fingerprint, or applying erasure to Type definitions would need an explicit
amendment and a replica/changefeed propagation contract; none is authorized by
this draft.

For packaging, an installable unit must resolve where every referenced artifact
comes from, how bytes are verified and who is trusted to publish them. Network
retrieval, executable migration code and signatures are not silently included.
Package trust, permission scope and resource bounds must be decided before
accepting third-party material. No package format or file extension is approved.

## 7. Acceptance cases to settle before implementation

These are proposed specification examples, **not executed tests**. Expected
outcomes depend on the named decisions. An approved draft must replace each
unresolved choice with one expected outcome or an explicit deferred boundary.

| Case | Given / action | Expected outcome to approve | Decisions |
| --- | --- | --- | --- |
| T01 | Install a new Bead definition with its complete closure | Becomes discoverable/admissible atomically; existing data unchanged | D01–D04, D07 |
| T02 | Install a Link definition referencing missing or wrong-kind endpoint contracts | Refuse admission without a partially installed usable Type | D04, D07 |
| T03 | Reinstall the same exact definition/closure; then try different content under the same version | First is idempotent; second refuses without replacing the original | D03, D07 |
| T04 | Create using an unpinned authoring selection while another definition is published | One exact pin recorded and reported; selection timing and retry outcome fixed | D03, D08, D12 |
| T05 | Publish definition B while current and retained instances use A | Those instances retain their exact meaning and A binding | D03, D04, D08 |
| T06 | Perform a property edit on an A instance after B publication | Recommended: A remains governing contract; no implicit adoption | D08 |
| T07 | A permits open/closed; B adds paused | Existing data acceptance distinguished from substitution for A; no automatic conformance | D05 |
| T08 | Amount changes dollars→cents with identical schema | Schema success cannot establish semantic compatibility or authorize unchanged adoption | D05, D10 |
| T09 | Link meaning changes reviewed-by→approved-by without shape changes | Semantic incompatibility remains visible; no inference from structural equality | D05 |
| T10 | Endpoint adopts a definition that no longer meets an incident Link requirement | Chosen reject/atomic-repair/invalid-Link policy applies with an explicit concurrency boundary | D06, D10 |
| T11 | Link has an endpoint pin to an old Bead state while current state has evolved | Validation uses exactly the chosen state; provenance-only pin is never silently treated as historical resolution | D03, D06 |
| T12 | Deactivate an in-use Type, then create, read, edit, delete and reactivate | Separate, explicit outcomes for all operations; no implicit artifact deletion | D07–D09 |
| T13 | Purge a definition referenced by live or retained data; exercise an erasure exception | Dependency/retention decision enforced; never rebound content; specified unavailable outcomes | D03, D09 |
| T14 | Explicitly adopt B with a stale resource guard or a transform that violates a Link contract | No unintended partial effects; history/provenance and chosen transaction scope preserved | D06, D10 |
| T15 | Import/export a multi-Type closure with schema dependencies, duplicate/conflicting versions and invalid hashes | Deterministic identity/content round trip for valid input; bounded refusal for conflicts, incomplete closure or bad integrity | D04, D07, D11 |
| T16 | Well-hashed package has an unauthorized publisher, a forbidden conformance cycle or exceeds limits | Refuse according to explicit trust and bound rules; digest success does not imply trust. Recursive schema references are not automatically forbidden | D04, D05, D11 |
| T17 | Open existing four/six-Type stores and inspect them with an old client | No read-time installation or silent identity rewrite; separately specified storage/client transition | D02, D03, D12 |
| T18 | Bootstrap a Type Bead and follow parent-definition pins, including a same-identity predecessor | Bootstrap terminates; closure identity and cycle rules distinguish definitions; no unpinned semantic dependency | D01, D03–D05 |
| T19 | Bead adopts a definition adding/removing explicit or wildcard ownership of existing outgoing Links | Chosen identity/version/conformance matching, aggregate membership and retained representation are explicit; no unrecorded ownership transition | D03, D06, D10 |
| T20 | Bead adopts a definition lowering an owned-Link bound below its current count | Chosen integrity policy applies; both explicit and wildcard limits evaluated | D06, D10 |
| T21 | Owned Link adopts a new Type definition while the source is concurrently edited | Required source guard, source/Link version effects and atomicity are explicit; old aggregate remains interpretable | D03, D06, D10 |
| T22 | A conformance diamond reaches two versions of one stable Type identity | Chosen intersection/conflict policy is deterministic; exact-pair deduplication and same-identity predecessor conformance remain coherent; no latest-wins selection | D04, D05 |
| T23 | Link with an external endpoint adopts a definition changing external policy from opaque to none/bead | Chosen admission/refusal outcome is explicit; no remote dereference or cross-authority atomicity is inferred | D06, D10 |
| T24 | Definition adoption encounters authored properties not mentioned by the new definition | Current open-root/preserve-untouched rules remain unless expressly amended; any transformation/removal is explicit, not schema-driven stripping | D08, D10 |
| T25 | Delete a resource whose Type is inactive or whose closure is unavailable after erasure | State which guards, liveness/ownership checks and unavailable outcomes apply; neither automatic cascade nor ID-only bypass is inferred | D03, D06, D09 |
| T26 | Withdraw or discover a false compatibility assertion after resources have relied on it | Specify future admissions, existing data, retained evidence and discovery/diagnostics separately; no silent rewriting of old definitions or automatic semantic proof | D05, D09 |
| T27 | Read legacy current/retained records without definition pins, then edit the current record into a successor | Defined absent-pin handling and mapping; retained record stays unchanged; new-model successor has a decided exact binding | D02, D03, D08 |
| T28 | Copy a pinned instance between authorities; receiver lacks its definition or has divergent bytes for the claimed version | Agreed version minting/identity and conflict detection; no silent rebinding or request-time fetch; defined missing-definition behavior | D03, D04, D07, D11 |
| T29 | Query type/conformsTo and apply maximumEndpointMultiplicity to instances using two versions of one Type | Identity-versus-version matching and aggregate counting are explicit, stable and consistent with conformance | D05, D06, D12 |
| T30 | Install an unsupported schema dialect/required vocabulary, closed-root schema, or invalid explicit/wildcard ownership bounds | Existing v0 validation refusals preserved unless specifically amended; partial installation grants no mutation admission | D04, D07, D12 |
| T31 | Parent and child definitions evolve together; an old pinned parent is then deactivated or purged | Explicit publication/adoption ordering and transaction boundary; fixed child closure cannot drift; dependency/retention policy applies | D04, D08–D10 |
| T32 | Proposed Type-definition erasure propagates to a replica that holds dependent instances | Explicitly amend/map current erasure records, changefeed, disclosure and dependent-data rules; no resurrection, silent rebinding or unannounced weakening of retention | D03, D09, D12 |

## 8. Ready / NYI / release gates

"Implemented in source" below means observed in the checked integration and
its reference documentation. It does not assert a new runtime qualification.
"Drafted" means text/cases exist; it does not mean Donna or the Review Team
approved them.

| Capability or artifact | Design readiness | Runtime status at checked Beads head | Preview 2 commitment |
| --- | --- | --- | --- |
| Authority boundary | Agreed direction, README draft | Documentation only | Required document |
| Fixed four/six-Type installation and discovery | Existing documented behavior | Implemented in source | Recommend preserving; qualification and any change decision owned by release lane |
| User-defined Bead/Link installation | Decisions/cases drafted; D01–D04/D07/D11 open | NYI | Specification coverage required; implementation optional |
| Stable Type versions and stored affiliation pins | Working assumption; D01–D04/D12 open | NYI | Specification coverage required |
| Compatibility and semantic-change rules | Directional cases drafted; D05/D06 open | NYI for proposed version relationships | Specification coverage required |
| Update/publication/default selection | D08 cases drafted | NYI | Specification coverage required |
| Deactivate/remove/retain | D09 choices drafted | NYI | Specification coverage required |
| Instance migration/adoption/rollback | D10 choices drafted | NYI | Specification coverage required; no engine promised |
| Package round trip, trust and distribution | D11 choices drafted; no format selected | NYI | Specification coverage required; importer optional |
| Protocol forms and CLI/storage mapping | D12 seam identified | NYI for proposed model | Reviewed mapping or explicit deferral required |
| Product decisions and Review Team acceptance | Pending | Not applicable | Required before claiming a settled specification |
| Exact candidate integration/runtime proof | Not run by this lane | Unqualified here | Required only for implementation claims; release owner governs combined gates |

## 9. Amendment and integration map

After product decisions, an actual BDP amendment must reconcile at least:
the Beads/Links immutable-member rules; Types and descriptor identity;
Reference pin semantics versus Type definition addressing; descriptor schema;
`conformsTo`, endpoint requirements and `ownsOutgoing`/`ownedLinks`; resource records, creation/update and
mutation results; collection Type filters/discovery; event/change/history and
snapshot representations; closure installation, retention and problem outcomes.
The current string-valued Type discriminator must not be silently widened in
only one artifact. Canonical schema, prose, fixtures and client handling move
together in a reviewed amendment with an explicit compatibility boundary.

Two completion criteria are deliberately separate:

- **Preview 2 design/specification draft (the requested candidate target):** all
  D01–D12 decisions carry recorded dispositions; each included behavior has one
  expected outcome in its cases; deferred behaviors are explicitly out of scope;
  source/evidence and ready/NYI tables are refreshed; review findings are disposed;
  CLI owner acknowledges the seam; release owner accepts this bounded document
  at a named commit. Until those records exist, this is review material only.
- **Adopted BDP specification amendment (not promised by this draft):** in addition,
  reconcile canonical prose and schema definitions, problem/discovery surfaces,
  examples/fixtures, conformance-matrix rows with honest unimplemented status,
  and old-client transition behavior; obtain Review Team and product acceptance.
  This is required before implementation may claim the new model as BDP law.

No normative file is changed by this draft. The chosen home is BDP's design
directory until adoption; the canonical specification remains `docs/specs/bdp.md`.
Moving or incorporating the draft later must leave one authority and clear links. The
subsequent amendment must also add or reconcile the canonical spec's open-question
ledger entry for Type evolution so the design decisions remain discoverable there.

[CLI PR102](https://github.com/versioned-beads/beads/pull/102) stays owned by
its release lane. Coordinate these seams through #59 and the agent bus:

- Its current "Type immutable" language means the existing whole binding;
  a future stable identity with a changeable pin needs deliberate wording.
- Its arbitrary installed-Bead authoring row is NYI and depends on installation
  and validation decisions here. Do not promote it because this draft exists.
- Its metadata and Type-specific lifecycle proposals need their own BDP product
  rulings; this document does not approve them by association.
- CLI defaults, listing/filtering of Type versions and operator messages must
  expose the decided semantics without claiming HTTP Type mutation support.

No changes to PR102, the manual playground, Jim's History work, shared databases,
or the existing graph CLI are authorized by this contribution. If implementation
is later selected, its bounded PR must cite #59 and coordinate tests and release
integration with Janet. Monday's document must remain deliverable if that slice
is cut. See the decision packet for dates and publication acceptance gates.
