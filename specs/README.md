# BDP working plan of record — curation candidate

> **CURATION CANDIDATE—DONNA BASELINE REVIEW PENDING**
>
> This front door is not yet baselined or open for business. Donna and Trish
> must personally review the candidate and Donna must explicitly ACK the exact
> baseline before an adoption announcement or owner-impact request. A draft PR,
> merge, source check or acknowledgment of the interim notice does not replace
> that ACK.

Start with the [stage-1 notice, October 22, 2026](https://github.com/gastownhall/bdp/issues/59#issuecomment-6347674001).
[BDP#59](https://github.com/gastownhall/bdp/issues/59) is the sole shared
consolidation plan; `codex/bdp-v0.1` is the sole consolidation branch. Trish
owns integration and communication, Sybil Core/Write/canonical CLI and Molly
decision recovery and consumer coverage. Donna decides semantic questions and
approves the baseline. Concrete BDP issues are the change pipeline, with links
to original human rulings.

## Read the four states separately

| State | What establishes it | What it does not establish |
| --- | --- | --- |
| Decision | An identified human ruling, with its source and scope | That prose, schemas or implementations already incorporate it |
| Specification propagation | The exact integrated amendment and its remaining composition gaps | Adoption of a coherent contract or runtime conformance |
| Communication | Stage-1 receipt now; explicit baseline adoption ACK and impact response later | Approval inferred from silence, a delivery receipt or a copied proposal |
| Implementation | An exact build and pinned contract, capability/delta statement and applicable evidence | Support for every accepted future direction or draft on this branch |

**Prefix removal is accepted.** The working target has Scope-defined Resource
paths: `beads/`, `links/` and `types/` are not mandatory, and Resource kind is
not inferred from path spelling. A Scope may choose those paths. Inherited Core
fixed-root text has not yet been amended; it must not reinstate that requirement
in the working target. [Issue280](https://github.com/gastownhall/bdp/issues/280)
owns discovery/reference/routing correspondence. Record discrepancies; this
front door does not choose replacement grammar or start a namespace migration.

`specs/` remains the only normative specification home. The
[decision/status register](../docs/design/bdp-v0.1-decision-register.md) is a
**non-normative index** to concrete issues and ruling sources, not another
specification or tracker. Accepted next-design directions and the contract
actually pinned by an implementation must both be stated truthfully. An old
contract can remain the implementation's comparison source without becoming
the next-design authority.

## Exact curation source and current amendment boundaries

This candidate is curated from remote `codex/bdp-v0.1` at
[`365f337fd161e0c888b0ab6dc3a632bfbcb28581`](https://github.com/gastownhall/bdp/commit/365f337fd161e0c888b0ab6dc3a632bfbcb28581),
following starting source
[`37d6622f95e71cac022478cfbcb3e8f2d6bdf444`](https://github.com/gastownhall/bdp/commit/37d6622f95e71cac022478cfbcb3e8f2d6bdf444).
These are source identities, **not Donna's reviewed POR baseline**. The eventual
announcement must name the exact reviewed candidate revision and the adopted
specification/capability scope. Consult the linked issues for live amendment
status; this is the bounded October22 curation snapshot.

| Surface | Read here | Disposition at the curation source |
| --- | --- | --- |
| Core and Read | [core.md](profiles/core/core.md) | Inherited current-v0 draft. Accepted mutable affiliations and prefix removal await coordinated propagation; do not infer kind from old paths. |
| Write | [write.md](profiles/write/write.md) | Ordinary empty-update rule integrated through [PR281](https://github.com/gastownhall/bdp/pull/281). Retained safe-write/Event/batch factoring still pending. Non-atomic sequence remains historical text, removed from the selected target. |
| Conformance index | [conformance.md](conformance.md) | Current-v0 accounting; not proof that proposed v0.1 semantics or product behavior are qualified. |
| Types and definitions | [types.md](profiles/types/types.md), [schema notes](profiles/types/README.md) | WIP source; accepted format, registration, final-graph and exact-read rulings tracked in [issue282](https://github.com/gastownhall/bdp/issues/282) and draft [PR283](https://github.com/gastownhall/bdp/pull/283). This file's inherited open markers are not permission to re-ask settled decisions. |
| Common affiliation grammar | [issue279](https://github.com/gastownhall/bdp/issues/279), draft [PR284](https://github.com/gastownhall/bdp/pull/284) | URI / `{uri, revision}` carrier is selected; schema slice is draft, not independently adoptable. Type-only Event/owned-effect representation and coordinated prose/results/retry/version work remain. |
| Namespace | [issue280](https://github.com/gastownhall/bdp/issues/280) | Accepted direction, amendment pending; alias/discovery/external-kind correspondence still needed. |
| Atomic batch and required Events | [issue152](https://github.com/gastownhall/bdp/issues/152), [issue153](https://github.com/gastownhall/bdp/issues/153) | Shared mutation meanings selected; capability/refusal/retry and Event payload/subscription details remain open. Required Events are not deferred with replica machinery. |
| Issue/Dependency library | [issue.md](types/issue/issue.md) | WIP domain design; preserve native behavior through minimal adapters, without a new purity rewrite or inferred full-profile claim. |
| Memory and assessment libraries | draft [PR277](https://github.com/gastownhall/bdp/pull/277) | Separate domain publication/cutline. Earlier PR143 landed on the Preview3 cohort, not this source branch. Do not infer catalog adoption from either publication or a product merge. |
| Experimental | [experimental/](../experimental/README.md), [disposition map](../docs/design/bdp-v0.1-core-write-disposition.md) | PR278 integrated non-normative staging. Replica bootstrap/catch-up/checkpoints, public retained receipts and set writes are excluded from the retained contract; no Core/Write/Types dependency on exploration files. |

The canonical [schema bundle](profiles/core/bdp-v0.schema.json) is shared by Core
and Write. Its [distribution copy](../packages/protocol/schemas/bdp-v0.schema.json)
has no independent authority; coordinated schema changes maintain correspondence.
The Types definition graph is illustrative, not a production bootstrap or an
installable package. Draft residence under `specs/` does not imply adoption.

## Interim operating procedure and later baseline

1. **Until Donna's explicit ACK:** continue only already-authorized independent
   work against its exact actual contract and existing holds. Vickie, `bd serve`
   and runtime adoption stay held. Do not start a routing migration, new
   implementation/validation/review campaign or v0.1 conformance claim.
2. **Curate and review:** Trish owns communication/integration; Molly owns this
   index and bounded affected-owner coverage; Sybil supplies read-only
   Core/Write/CLI review. Resolve concrete inconsistencies in existing issues.
   Accepted rulings need propagation; unresolved proposals need an explicit
   decision, not adoption by example. No second umbrella tracker.
3. **Donna and Trish baseline together:** record the exact reviewed revision,
   incorporated amendments, accepted-unincorporated changes, open questions and
   declared exclusions. Keep this candidate gate until Donna explicitly ACKs.
4. **Only then, Trish announces open for business:** include the exact reviewed
   POR revision and the changes-since-notice bulletin below. Obtain each affected
   owner's explicit baseline acknowledgment and implementation-impact response.
   Record received, pending, no-impact and held work separately. An interim ACK
   is not an adoption ACK; silence is not approval.
5. **After baseline, every change uses a concrete BDP issue:** capture the ruling
   source and scope, amendment/disposition, exact incorporated commit, affected
   owners and communication/implementation status. Trish coordinates the
   corresponding change bulletin and impact follow-up; no silent release pin,
   catalog, schema or runtime adoption. Do not declare this initial candidate an
   already-approved permanent procedure.

Experimental documents must retain their strong non-normative, non-POR,
non-product-commitment, non-conformance-obligation and no-promised-implementation
notices. Olivia's ownership/pinning sidebar is exploration, not an adopted
replacement or a hold on independent consolidation. Existing ownership/history
and Memory requirements remain recorded unless Donna explicitly revises them.

## Changes since the stage-1 notice — bulletin pending

**No baseline-adoption bulletin has been issued by this candidate.**
Stage1 is anchored at
[October22 18:01:59 UTC](https://github.com/gastownhall/bdp/issues/59#issuecomment-6347674001).
This candidate adds navigation, status/decision coverage and proposed owner
coverage only; it changes no protocol semantics or implementation.

Before stage3, Trish will fill this section with the exact reviewed POR revision
and changes from that notice: which decisions were newly made, which accepted
ones were incorporated or remain pending, affected implementation pins/work,
continuing holds and exclusions, and requested owner ACK/impact responses.
The [register's owner table](../docs/design/bdp-v0.1-decision-register.md#bounded-affected-owner-coverage)
is the proposed initial recipient set, not a completed impact audit.
