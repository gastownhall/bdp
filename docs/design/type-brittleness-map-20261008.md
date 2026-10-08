# Type evolution — brittleness map

October 8, 2026. Discussion evidence for [BDP #59](https://github.com/gastownhall/bdp/issues/59)
and [PR60](https://github.com/gastownhall/bdp/pull/60).
This is a cross-cutting design review, not new product rulings, a feature plan,
or a claim of implementation. Read with the [Type draft](type-lifecycle-preview2.md).

## Basis and what is already settled

The latest discussion is the baseline: exact Type versions fix structure and
semantics; stored instances use exact pins; writes accept pinned or floating
selection and store the resolved pin; omitted selection preserves affiliation;
nominal floating filters span versions and pinned filters select identity plus
version. Donna accepted validating combined properties and explicit Type selection
as one resulting state and committing both or neither. That does not decide
whether arbitrary connected-graph repairs are available in one transaction.

Types-as-Beads is favored, not finally adopted. The intrinsic Type field remains
on Beads and Links. Intrinsic metatype bootstrap is acceptable, including the
possibility of metatype versions. Nominal Type identity is stable in the working
model; no automatic semantic compatibility across its versions is assumed.
Generic readers need not interpret a descriptor to traverse a graph or compare
nominal identity. Global definition identity/coherence is required with or
without Types-as-Beads.

The documents reviewed start from PR60 `82bbf31bc019fb96e93470be6a837622630365b7`.
Canonical BDP main was rechecked as
`182f1fcf8a01d896976bff3c9e3fb87c596c6ca6`. It still has the old immutable Type-ID
contract; this map evaluates a proposed successor, not current implementation.
Current spec citations below refer to that baseline.

## Subsequent October 8 compatibility ruling

After this review, Donna confirmed both existing-data acceptance and preservation
of earlier consumers' structural and semantic guarantees within the proposed
major-version family. See the [current ruling](type-lifecycle-preview2.md#october-8-ruling--both-compatibility-guarantees-within-a-major-family).
The map and external review below remain historical analysis of the preceding
unconstrained-version proposal. B02/B04/B06 are now constrained within a family;
cross-family behavior and reference matching remain open. Version labels alone
are not proof of compliance, and no SemVer wire representation is selected.

## The whole map

Priority means leverage on the rest of the design, not an implementation schedule.
"Tradeoff" means desirable guarantees compete; "gap" means behavior needs a
precise definition. A documented open decision is not itself a defect.

| ID / priority | Brittle spot and concrete trigger | What goes wrong | Smallest decision that addresses it |
| --- | --- | --- | --- |
| B01 / foundational | A pinned definition references a floating parent, schema or metatype contract | The instance keeps its pin but its governing meaning changes | Identify every contract-bearing dependency and freeze it; distinguish fixed identity predicates from resolving current contracts. Gap. |
| B02 / foundational | Invoice A means dollars, B means cents; a nominal Invoice query returns both | Identity comparison works, but a consumer totals incompatible amounts | State what, if anything, identity guarantees across versions; identity-only filtering must not promise a homogeneous contract. Tradeoff. |
| B03 / foundational | An endpoint constraint, conformsTo entry, ownership declaration or aggregate-count policy names only a Type identity | Exact-version equality, nominal identity, current-definition lookup and conformance give different answers | Decide reference/matching semantics separately for each location. Neither authoring nor filtering semantics automatically determines constraints. Gap. |
| B04 / foundational | A valid Bead update adopts B, but an incoming Link still requires A | An otherwise valid local change is blocked by unchanged neighbors; changing the Link first may also fail | Choose the allowed repair/transaction boundary (including protocol profiles) and refusal policy; don't promise independent evolution, unchanged neighbors and preserved validity simultaneously. Tradeoff. |
| B05 / foundational | A Memory adopts a definition changing owned-Link membership/bounds, or an owned Link advances its Type pin | Source aggregate/history changes even when source properties are identical | Define source guards/version effects and aggregate membership before treating Type adoption as an ordinary single-record edit. Gap with graph-wide consequences. |
| B06 / high | B widens A's enum and declares conformance to A; a diamond reaches two parent versions | Intersection removes the widening, or incompatible contracts admit no instances | Keep substitution distinct from old-data acceptance; rule exact-version composition/diamonds without latest-wins or implied predecessor conformance. Tradeoff. |
| B07 / high | A previously trusted semantic compatibility assertion proves false | Keeping it trusted admits bad substitutions; withdrawing it changes future decisions without changing stored definitions | Separate immutable assertions and history from current trust/admission policy; define consequences for existing data and future operations. Tradeoff. |
| B08 / high | Scopes claim the same Type identity/version but install different content; or disagree on what current means | Pins fail to establish portable meaning, or floating writes surprise users | Define publication/version authority and divergence detection; distinguish publisher head from local installed/default selection. Different installed versions alone are not incoherence. Gap. |
| B09 / high | A floating write is retried after publication of a new version; a pin-only update has unchanged properties | A replay changes the contract or a meaningful update is discarded as a no-op | Bind selection at a defined admission point and preserve it for replay; distinguish a singleton, sequence member and bulk carrier; include affiliation in update/no-op/event semantics. Gap. |
| B10 / high | An installed Type Bead is hidden, deactivated, deleted or erased while instances or child Types still use it | A harmless property edit, deletion or historical interpretation can become impossible | Separate publication visibility, validation availability, future admission and retained dependencies. Distinguished Type references must count as dependencies even though they are not Links. Tradeoff. |
| B11 / medium | An ordinary Type Bead edit affects validation policy; documentation changes create new pins; a metatype version adds a validation construct | Benign edits cause gratuitous migration, or a server mistakes having a definition for understanding it | Define publication authority/placement; distinguish different versions from incompatible contracts and readable data from supported validation semantics. No automatic adoption or engine capability follows from versioning. Gap. |
| B12 / foundational | A Type pin changes but the update event carries only a property delta; old records have no pin | A cache/replay misses a semantic change or old history is rewritten to fit the new shape | Include affiliation in revision-determining state and records/history/events; audit guards, digests and saved queries; define legacy absent-pin matching without inventing old pins. Gap. |
| B13 / extension pressure | Future minimum/count/cycle/property-to-Link constraints require coordinated changes; a transition rule spans old/new Type versions | Neither first singleton is valid; validation reaches beyond the edited resource | Name the validation/atomicity boundary and which contract governs a cross-version transition before adding richer constraints. Defer those features explicitly rather than assuming all constraints fit local schema validation. Tradeoff and scope-growth risk. |

## Why the first five interact

```text
exact immutable definition + fixed dependencies (B01)
            |
meaning of nominal identity and constraint matching (B02/B03)
            |
which relationships remain valid after explicit adoption (B04)
            |
what changes together, including owned source aggregates (B05)
            |
compatibility evidence / repair size / historical observability (B06/B07/B12)
```

A Bead pinned to Invoice@A has an incoming approval Link whose definition requires
A. Invoice@B changes amount units. The user submits a new amount and explicit B
selection together. The new Bead is valid in isolation. The approval Link may no
longer be valid. Updating that Link first may be invalid against the still-A
Bead. Atomic properties-plus-Type update fixes the intermediate *Bead* state,
but not this multi-resource dependency. If the Link is owned, its source is also
part of the mutation/version accounting. A Type pin and a historical endpoint
pin are separate references; adding one does not resolve the other's semantics.

We cannot generally promise all of: arbitrary incompatible adoption, unchanged
live Links, continuous validity, and only single-resource transactions. One of
those requirements must be bounded. Rejecting an operation is safe but can still
leave the product brittle if there is no practical path to the desired state.
This is the most important combined scenario to work through next.

## Distinctions that prevent accidental solutions

- **Nominal identity versus contract:** a floating identity filter intentionally
  groups all versions. It does not imply that consumers can interpret them under
  one schema or meaning. Immutable nominal affiliation also has a cost if a Bead
  was originally classified under the wrong Type identity; version evolution is
  not automatically an appropriate cure for reclassification.
- **Exact affiliation versus satisfying a requirement:** a Link requiring A may
  accept a Bead declared as B if an approved conformance rule says B satisfies A.
  Requiring the exact declared pin is stronger. Identity-only ownership can be a
  fixed predicate over future versions; it need not dereference a floating
  validation contract or change the owner's meaning.
- **Fixed rule versus fixed truth:** a pinned Link Type fixes the endpoint predicate;
  a floating endpoint can still change whether it satisfies that predicate. State
  whether validity means at creation, after each related write, or at a selected
  historical graph state. A historical resource version is not automatically a
  snapshot of every Resource needed to evaluate the old graph.
- **Immutability versus availability:** pins preserve the identity of the meaning
  they name; they cannot promise continued access after deletion, access changes
  or erasure. Local validation artifacts and externally readable Type Beads may
  have different visibility, but their relationship must be explicit.
- **Publication versus adoption:** publishing a Type, installing it, choosing it
  as a default, adopting it on an instance, and trusting a compatibility assertion
  are distinct actions. Treating them as one update creates hidden fan-out.
- **Assertions versus proofs:** schema validity, version labels and publisher
  signatures cannot establish arbitrary semantic compatibility. Declared lifecycle
  categories could support particular guarantees, not all semantic substitution.
- **New version versus new contract meaning:** a documentation edit can create a
  distinct Type Bead version without invalidating an older one. Exact-pin filters
  intentionally distinguish those versions; forcing adoption is unnecessary.

## Current-spec crosschecks

The existing spec provides evidence of affected surfaces, not a reason to reject
an intentional amendment:

- [Beads and Links](https://github.com/gastownhall/bdp/blob/182f1fcf8a01d896976bff3c9e3fb87c596c6ca6/docs/specs/bdp.md#beads-and-links)
  makes Type and endpoint fields immutable; Type adoption must deliberately
  change the appropriate invariant, while endpoint repinning remains separate.
- [Owned Links](https://github.com/gastownhall/bdp/blob/182f1fcf8a01d896976bff3c9e3fb87c596c6ca6/docs/specs/bdp.md#owned-links)
  versions the source on owned-Link mutation and keys ownership by Type URL.
- [Types](https://github.com/gastownhall/bdp/blob/182f1fcf8a01d896976bff3c9e3fb87c596c6ca6/docs/specs/bdp.md#types)
  uses intersected contracts and a fixed installed closure, with retained-artifact
  obligations. New Type versions must not silently defeat those purposes.
- Existing event subjects assume immutable Type, and property-no-op rules assume
  Type cannot change. A Type-only adoption is a new semantic change even when
  properties are identical; the exact event representation is still a decision.

## Stakeholder requests as stress cases, not adopted requirements

[Memory graph-constraint request](https://github.com/gastownhall/bdp/pull/60#issuecomment-5999514690)
asks about minimum counts, no cycles, uniqueness and property-requires-Link rules.
These illustrate B04/B13. They do not authorize new constraint fields, minimum
rules or an implementation. Ordinary bidirectional visibility of a single Link
must not be confused with a policy requiring two distinct reciprocal Links.

[Declared lifecycle request](https://github.com/gastownhall/bdp/pull/60#issuecomment-6001118825)
asks for phases/categories/transitions. It illustrates B02/B06/B11. The compatibility
of a consumer that reads categories is narrower than compatibility of every old
consumer. Reserving a descriptor member or adopting a universal category vocabulary
is a separate product decision; neither is done here.

## Suggested decision order

1. Define what a Type identity promises across versions and the matching semantics
   at conformsTo, endpoint constraints and ownsOutgoing (B01–B03/B06). Keep the
   already-agreed filter and instance-write semantics intact.
2. Work the approval/Invoice example through the smallest practical complete update,
   including incoming Links and owned sources (B04/B05). Choose a workable atomicity
   and validation boundary before designing migration tooling.
3. Define exact global version identity, local selection and lifecycle availability
   (B07–B10), then ensure history/events and generic Type Bead operations faithfully
   expose those decisions (B11/B12). B13 tests extensibility without expanding scope.

## Triangulation and disposition

Independent primary analysis was written before reading Claude's results. The
external Claude review completed successfully on October 8 against the draft and
focused current-spec sections. Its [full findings](type-brittleness-claude-20261008.md)
are retained as reviewer opinion, including recommendations disputed below. This
is two-perspective design review, not product or release acceptance. No new
product decision is inferred from either analysis. Claude C-numbers below denote
its numbered B-findings; this document's B-IDs remain stable.

| Claude finding | Disposition in this map |
| --- | --- |
| C1 nominal identity guarantees | Converges with B02. Identity-only filtering is useful even without a shared schema; a frozen identity core is an option, not a forced choice. |
| C2 affiliation-only observability | Converges with B09/B12; elevated B12 to foundational. The successor must include affiliation in revision-determining state. Current rules require deliberate amendment, not a claim that an implemented adoption is already losing data. The affected surfaces exceed three clauses. |
| C3 version tokens/authority | Converges with B08/B11. Reject the exhaustive three-way dilemma: opaque revisions can participate in authority-qualified global identity; content hashes do not establish publication authority; non-contract presentation can live separately. No token scheme is selected. |
| C4 Type Bead placement/governance | Adds emphasis to B11. A dedicated Scope is an option. Reject the claim that uniform operations imply unrestricted write permission: ordinary authorization can gate edits, and editing a definition need not install/admit it for use. |
| C5 intrinsic dependency/deletion safety | Converges with B10. An intrinsic reference needs explicit lifecycle treatment; generic incident-Link checks do not suffice. Local enforceability and cross-authority availability must be stated separately. |
| C6 undeletable owned subtree | Strengthens B05/B10: missing source closure can prevent owned-Link removal and hence source deletion. Retention guarantees or explicitly bounded removal semantics are choices; skipping validation is not adopted. |
| C7 floating input/bulk carrier | Keep the bulk/carrier warning in B09/B13. Reject the recommendation to turn floating update input into an identity assertion: it contradicts Donna's agreed explicit-selection semantics. Restating a floating selection is deliberate selection, while omission preserves the pin. |
| C8 resolution/replay timing | Converges with B09; adds sequence/member and bulk resolution granularity. One command does not automatically imply a single transaction or one shared selection. |
| C9 reference taxonomy | Converges with B01/B08/B10. Type dependencies need an explicit reference contract. Reject the forced local-versus-global choice: a globally named exact definition may be satisfied by verified local installed content. Link endpoint opacity is not automatically Type-reference law. |
| C10 conformance reads/queries | Strengthens B03/B07/B12: distinguish effective conformance facts from current trusted admissions, retained evidence and read capabilities. Reject the claim that a single identity argument cannot denote any-version matching without repeated query parameters; grammar does not force that impossibility. Saved Selector expressions and record shape do need an audit. |
| C11 Scope aggregate counts | Adds aggregate-count matching to B03. Adoption/create checks must evaluate applicable policies. Publication alone does not change any existing pinned instance or its fixed closure, so the claimed publication-only validity bypass does not follow. |
| C12 ownership keys/closure | Converges with B03/B05. Reject the alleged impossibility of identity-keyed ownership plus fixed meaning: ownership can be an immutable nominal predicate; each owned Link separately carries its exact contract. Exact matching may change explicit/wildcard membership and bounds. |
| C13 Link terminology/profiles | Strengthens B04/B05: Type adoption and endpoint repinning differ; repair capability may depend on profile. Reject the claim that reject-only is already authorized product policy, or that a particular discriminator representation is logically required. |
| C14 legacy populations | Converges with B12. Retained absent-pin records require explicit matching/interpretation; no backfill or guessed pin. Permanence depends on retention, not an automatic promise that every record lives forever. |
| C15 history-spanning constraints | Adds old/new-definition transition governance to B13. Neither lifecycle categories nor additional aggregate constraints are adopted; do not infer a blanket prohibition from the review. |

Two additional corrections apply across the review. Machine-checkable schema
relationships are not limited universally to narrowing; decidability and proof
strength depend on the language and the relation being tested. Arbitrary semantic
substitution remains a separate claim. Also, a new Type Bead revision can have
identical contract meaning: version equality, contract equality and compatibility
must not be collapsed.

**Combined conclusion:** the highest-leverage decisions are the meaning of Type
identity and exact version binding, the reference/matching contract at every use,
and the validity/atomicity boundary. Affiliation must be observable as state.
Then use one connected adoption/removal example to test whether the chosen rules
leave a practical path between valid states. Types-as-Beads adds lifecycle and
authority surfaces, but avoiding the Bead wrapper does not remove most risks.

