# Preview 3 Link References and lifecycle

Planning draft, October 15, 2026. Owner: Trish. Shared Type plan of record:
[BDP #59](https://github.com/gastownhall/bdp/issues/59). Release requirements:
[Preview 3 tracker PR110 at 166e3035](https://github.com/donnabox/beads/blob/166e30351200b7c36c509acedbda6ab0b6870e27/engdocs/drafts/preview3-integration-status.md#selected-preview-3-memory-requirements).
This document partitions work and proposes acceptance cases. It changes no
normative contract, schema, implementation, release qualification or owner.

## 1. Sources and scope

Inspected on October 15 Pacific:

- BDP main `aed21767e1ade54bef6dad108c4f24b8e9cd844b`, including the current
  [protocol](https://github.com/gastownhall/bdp/blob/aed21767e1ade54bef6dad108c4f24b8e9cd844b/docs/specs/bdp.md)
  and WIP [Types design](https://github.com/gastownhall/bdp/blob/aed21767e1ade54bef6dad108c4f24b8e9cd844b/specs/types.md).
- PR110's actual head matches the supplied `166e30351200b7c36c509acedbda6ab0b6870e27`.
  Its selected slice #3, rather than the entire Memory proposal, sets this lane's
  release scope. A pre-installed Type catalog is sufficient; general user Type
  authoring is not a prerequisite.
- [Chris's Memory proposal #5877](https://github.com/gastownhall/beads/issues/5877),
  body Revision 4, September 22; issue updated October 9. R17–R23 and scenarios
  S5/S8/S9/S10 give the detailed Link outcomes. This pass read the current body,
  not a fresh audit of all comments. Newer selected Type vocabulary in PR110 takes
  precedence over the proposal's older baseline vocabulary.
- Beads implementation baseline remains final `graph-preview2`, peeled
  `703bb13e91aa2cab2092443319139006d74242c8`. Prior source audits establish gaps;
  this planning pass does not rerun or qualify the product.

Trish owns shared Link Reference/constraint/lifecycle design and its implementation
partition. Melinda and Donna own Memory Type meanings and record semantics. Polly
owns shared History/Provenance, coordinated with Jim. Vickie owns active BDP
protocol/reference implementation work. Janet owns integration, builds, Dolt and
installed embedded/shared-server qualification. Do not create another History
system, Memory-only version addresses, or a second release tracker.

## 2. Contract conflicts that need explicit adoption

| Selected outcome | Current BDP contract | Required reconciliation |
| --- | --- | --- |
| A local pinned endpoint names an exact retained state | References and write admission treat pins as opaque provenance; no semantic pin validation, and local endpoints must name live Beads | Use shared historical resolution for local pins. Define admission, authorization and retention races; never fall back to current state. This is a semantic amendment. |
| Delete latest-following Links and preserve pinned Links | Bead deletion fails while any live incident Link remains; History explicitly preserves this refusal and defers surviving citations | Amend deletion safety, current-plane visibility/closure and historical relationship authorization together. Ordinary deletion and history erasure remain distinct. |
| Update a Link's version selector and metadata without changing its ID | Link identity, Type, endpoints and pins are immutable; re-pinning is delete-and-create | R23 makes in-place selector change a real conflict. Specify an explicit guarded update; do not infer permission to change the endpoint identity or source ownership. |
| Expected versus observed kind and typed unavailable/gone/invalid outcomes | References carry no endpoint Type. External endpoints are opaque; successful resolution and stored relationship data are separate concerns | Decide whether “kind” means Resource kind, domain Type, or both. Define observations separately from immutable Link state; reuse shared History problems and authorization rules. |
| A Task structured record includes informational Memory Links | Current records/views have owned and incident Link mechanisms, but no automatic ownership of all informational Links | Melinda/Donna select the representation and ownership contract. A computed incident view cannot silently become revision-covered state. |
| Changing Memory outgoing Links versions the Memory | Common metadata is already revision-covered; owned-Link mutations version the source and retain its owned state | This is compatible when the Memory Type owns the relevant Link family. Select that ownership explicitly; do not introduce a second relationship metadata/version mechanism. |
| Invalid/self-referential/ambiguous Memory Links fail before mutation | Generic endpoint rules and Type constraints do not imply a universal ban on self-links | Specify the Memory-family rule with Melinda; do not impose it on unrelated Link Types or use whole-family acyclicity as an accidental substitute. |

Source sections: [References](https://github.com/gastownhall/bdp/blob/aed21767e1ade54bef6dad108c4f24b8e9cd844b/docs/specs/bdp.md#references),
[exact historical reads](https://github.com/gastownhall/bdp/blob/aed21767e1ade54bef6dad108c4f24b8e9cd844b/docs/specs/bdp.md#exact-historical-reads),
[sequence-local references](https://github.com/gastownhall/bdp/blob/aed21767e1ade54bef6dad108c4f24b8e9cd844b/docs/specs/bdp.md#batch-local-resource-references),
and the ownership, common metadata and deletion-safety rules in that same snapshot.
The optional Types draft does not adopt these changes for current BDP clients.
They must not enter the proposed editorial Core/Write extraction as “cleanup.”

## 3. Dependency and PR partition

The labels below describe proposed PR boundaries, not existing PRs or assigned
implementation work. Each Beads branch starts at final `graph-preview2`; later
merge Janet's qualified Preview 3 base and recheck. BDP branches start from current
BDP main. An accepted design may span two repositories without pretending their
protocol and product qualification are the same event.

| Unit | Deliverable and boundary | Dependencies / done when |
| --- | --- | --- |
| L0 — shared contract amendment | BDP Reference/lifecycle/observation wording, schemas and conformance cases; preserve the existing editorial split separately | Donna resolves the decisions below; Melinda supplies nominal Types/ownership, Polly supplies retained-state diagnoses and deletion boundary, Vickie reconciles active protocol edits. Done when one reviewed contract gives each included case one outcome. |
| L1 — local Reference resolution | Exact/local latest resolution and truthful typed outcomes through the existing shared resolver and History interfaces; external references remain carried, without admission fetches | L0 plus Polly's retained-version lookup/authorization contract. Done when A01–A08 pass without guessed latest/history fallback. No new Type installer required. |
| L2 — Link mutation and record projection | Stable-ID selector/metadata update and ID removal; body-free Task projection and owned source snapshots where selected | L0/L1 and Melinda's Type/ownership contract. Done when A09–A15 and A20–A22 pass. Separate source-record schema changes from CLI affordances where useful, but land an internally consistent API. |
| L3 — deletion and retention integration | Atomic local cascade of latest-following Links, surviving pinned Links, source revisions and complete results | L1/L2 plus Polly's disappearance/restore/retention interface. Done when A16–A19 and A23–A26 pass, including failure atomicity. Do not split deletion storage from its required historical/authorization guarantees. |
| L4 — installed qualification | CLI, structured API and BDP outcomes on the exact integrated candidate in embedded and ordinary shared-server modes | Janet integrates qualified source PRs and owns build/Dolt qualification. Done when the selected whole scenarios pass or Donna explicitly defers them; a local unit test is not release acceptance. |

L1 and the non-deletion portions of L2 can progress after their contract gates;
L3 cannot be made safe by merely relaxing an incident-Link refusal or removing a
foreign key. Tests must distinguish Type-definition revisions, endpoint revisions,
the Link's own revision and the owning source's revision.

## 4. Decisions needed before dependent implementation

1. **Observation vocabulary and ownership.** Separate expected Resource kind from
   expected nominal/conforming Type, and both from an observed value. Decide where
   expectations originate: Type constraints, caller declarations, or a combination.
   Recommend a read observation outside stored Link state. Observing a change or
   an outage must not silently mint a Link/source revision. No field names selected.
2. **Local pinned admission.** Confirm which retained state and current permissions
   make a pin admissible, including an already-deleted identity. Coordinate with
   Polly: nonexistent revision, pruned/erased revision, lost lineage, temporary
   outage and nondisclosure are not interchangeable. Never report “invalid” merely
   because the service cannot substantiate a stronger answer.
3. **Extent of in-place update.** R23 requires selector/version and metadata changes
   with a stable Link ID. Does this preview also permit changing the endpoint's
   canonical identity, its source, or its Type? Leave those additional changes out
   unless Donna selects them. Updating an owned Link needs one atomic resulting
   Link/source state and existing concurrency semantics, not an implicit retype.
4. **Pinned source endpoints and ownership.** Apply the endpoint model to both
   sides. A pinned source can name an old source state; editing its Link cannot
   rewrite that historical owned set. Decide whether such a Link is an independent
   historical assertion, disallowed for ownership, or has another explicit contract.
   Deletion of a source is not the same case as deletion of a target.
5. **Deletion population and source-version reporting.** R20 covers local Links
   with a Memory endpoint, not automatically every Dependency. A Link with a latest
   reference to a deleted Bead is removed even if its other endpoint is pinned.
   A surviving pinned Link needs compatible retained-state/authorization treatment.
   Resolve the case where its source is itself being deleted: do not invent a fresh
   live source or terminal revision. Specify reporting/order with Polly; do not
   assume one source revision per transaction, since current owned transitions can
   mint several. Large results need a complete accounting or an explicit bounded
   continuation, never an unexplained truncation.
6. **Constraint interaction.** A latest target can change Type; a pinned target's
   contract is evaluated against the selected historical state. Decide when an
   incompatible latest-Type change rejects a commit versus changes an observation.
   Deletion/cascade can also violate source minimums. No implicit waiver: choose
   atomic repair, refusal, or an explicitly selected lifecycle rule. Per-identity
   arity must not acquire extra capacity by mixing pins and latest references.
7. **Relationship ownership and Task embedding.** Memory outgoing metadata must be
   revision-covered under R22; existing common metadata and owned-Link revision
   mechanics already support that boundary. Select the Memory-owned Link family.
   For Task→Memory, select durable ownership versus a computed
   structured view, and the corresponding source-version effect. The source target
   body must not be fetched just to show the relationship.

The proposal already says restore does not recreate removed Links; preserve that
target outcome, while Polly defines restore mechanics. Unreachable cross-Scope
targets never become “gone” merely due to a failed fetch. This slice does not add a
remote observer, remote cascade, general federation or arbitrary web-resource
validation. External local-table constraints and Type-profile adoption still need
their own explicitly scoped contract.

## 5. Concrete acceptance cases

Fixtures: local Task `T`, Memory `M` at exact retained revisions `m1` and `m2`,
Memory `N`, informational Link Type `I` selected by Melinda, and external Bead URI
`U`. References in these cases are conceptual; `latest` does not choose a new wire
sentinel. Existing URI / `{uri, revision}` representation is the starting point.
All cases require a source/result binding to the exact installed candidate. Cases
whose decisions remain open are specification obligations, not executable claims.

| ID | Arrange / action | Required observable result or named gate |
| --- | --- | --- |
| A01 | Create `T → M` without an endpoint revision; update M from m1 to m2 | Stored endpoint remains latest-following; resolution yields m2. It does not silently acquire a pin. No target body is returned by Link inspection. |
| A02 | Create `T → M@m1`; update M to m2 | Inspection preserves exact m1; explicit resolution returns m1 or a truthful typed refusal, never m2. |
| A03 | Supply a malformed/ambiguous selector or a local Link ID as a Bead endpoint | Refuse before changing Link or source state. Distinguish selector error from a target known to be gone, subject to nondisclosure. |
| A04 | Pin a known local Bead to a revision proved never to have existed | Typed invalid-version outcome; no mutation. Requires Polly's authoritative distinction, not a failed fetch heuristic. |
| A05 | Pin a version with substantiated pruning/erasure evidence | Shared retention/erasure reason, not invalid-selector or substitution. No admission success without the selected retained-state contract. |
| A06 | Address a hidden local target/history | Preserve uniform nondisclosure; expected/observed fields do not leak hidden kind, existence or retention evidence. |
| A07 | Create a Link carrying U while the remote Scope is offline | Preserve URI and optional pin exactly without a network dependency for admission. Any resolution observation is unavailable/unresolved, not gone or a fabricated observed kind. |
| A08 | Expected and actual local kinds/Types conflict | Report/refuse under the adopted L0 rule with expected versus observed values distinct. A current Type cannot stand in for a pinned revision's Type. |
| A09 | Change one Link's pin from m1 to m2 explicitly | Same Link ID, new observable state and required source revision; historical source retains the old Link state. Stale guard applies neither change. Endpoint identity/source changes remain D3-gated. |
| A10 | Update relationship metadata | Existing common metadata and owned-Link mechanics create the changed Link revision and required Memory-source version, leaving target unchanged. Verify the selected D7 ownership contract and historical metadata round trip. |
| A11 | Repeat an identical update | No new durable version; idempotent retry returns the retained outcome without repeating source changes. |
| A12 | Two Links share endpoints; remove one by Link ID | Only the named Link is removed. Required source revision identifies its new owned set; no target revision. |
| A13 | Create/update/remove an informational Task→Memory Link | Task readiness/dependencies retain their prior meaning and result. The selected Memory Link does not become a blocker. |
| A14 | Read T's structured record with informational Links | Return Link identity, Type, direction, endpoint selector and selected relationship fields. No recursive target bodies, no target-body fetch required. Ownership/revision coverage is explicit under D7. |
| A15 | Read a prior exact Memory source revision after Link update/removal | Return that revision's complete historical outgoing set, including the former pin/metadata; never rebuild it from current adjacency. |
| A16 | M is targeted by one latest Link and one `@m1` Link; delete M | Latest Link removed, pinned Link survives; ordinary current M read fails, retained m1 remains resolvable under permission. Report the removed Link and resulting source revisions; no readiness effect. |
| A17 | Remove retained m1 after A16 under explicit retention/erasure policy | Surviving reference never resolves elsewhere. Report the substantiated reason under shared History permissions; Link retention/erasure interaction is agreed with Polly. |
| A18 | Restore M under the same canonical identity | Previously removed latest Links remain absent. Pinned references still name their original exact version. |
| A19 | Another Scope deletes U without local notification | No fabricated local cascade or source revision. Stored external reference remains; observations only state evidence actually available. |
| A20 | Inspect an incoming Link view that exceeds its bound | Report incompleteness/continuation honestly; do not imply the page is the full set or use it as deletion's authoritative population. |
| A21 | Create a Memory self-Link, ambiguous alias, or workflow Link with a Memory endpoint | Fail before state change under R19/R17 and selected Types. Scope the self-Link rule to this family; do not redefine generic acyclicity. |
| A22 | Represent several pins/latest references to the same endpoint under a maximum | Count by endpoint identity over the applicable local family; pins do not create new arity capacity. Adopted legacy/profile boundary must be explicit. |
| A23 | Race deletion with Link creation or selector change | Observe a serializable/atomic valid outcome under the selected write contract; no orphan latest Link, partial cascade, lost update or unreported source transition. Test both orderings. |
| A24 | Inject a failure after cascade planning but before commit | Original Bead, Links and source versions remain unchanged; retry cannot duplicate the cascade or attribution. |
| A25 | Delete a source with outgoing latest/pinned endpoints, including a Link with a pinned source | Outcome defined by D4/D5 and Polly's deletion semantics. Cover latest-source/pinned-target and pinned-source/latest-target independently; never edit an old source version or synthesize a live source after deletion. |
| A26 | Cascade would break a source minimum or encounter a disallowed/hidden mutation | Enforce the agreed D6 atomic repair/refusal/lifecycle rule and nondisclosure; no silently waived constraint or partial authorized subset. |

Scenario composition: S5 uses A01/A02/A14; S8 uses A09–A14/A21; S9 uses
A16–A19/A23–A26; S10 uses A02–A08/A15/A20. These are constituent cases, not claims
that the whole journeys pass. S1–S3, S7 and S15–S16 additionally depend on Melinda's
record/identity work and Polly's history/feed/attribution. In particular, an
unchanged timestamp alone is not evidence of source-version or feed correctness.
Janet's final scenario matrix must cover all selected journeys in both deployment
modes; exclusions need Donna's explicit deferral.

## 6. Readiness and next checkpoint

| Item | State |
| --- | --- |
| Release scope and ownership | Recorded in PR110; this plan does not enlarge it |
| Current-protocol conflict inventory and proposed PR partition | Drafted here; source inspection only |
| Exact acceptance outcomes | A01–A26 drafted; D1–D7 block affected details |
| Memory Type vocabulary/ownership | Melinda + Donna decision dependency |
| Retained-state/deletion/restore interface | Polly + Jim dependency; no new History design selected here |
| Protocol amendment, code and conformance tests | NYI for this slice |
| Embedded/shared-server installed qualification | NYI; Janet owns it |

Next checkpoint: settle D1–D3 against one Task→Memory example with Donna, obtain
Melinda's ownership choice and Polly's retained-version/deletion boundary,
then turn L0 into a reviewed normative amendment. Work on the current Type
foundation and an editorial profile extraction can continue independently. Do not
reroute Vickie's implementation to this planning draft.
