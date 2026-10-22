# BDP working plan of record

> **WORKING-POR BASELINE REVIEWED—ENGAGEMENT APPROVED**
>
> On October22, Donna reviewed this front door and decision register at
> [`2265a640ec594235334752244d8a799f93f12ece`](https://github.com/gastownhall/bdp/commit/2265a640ec594235334752244d8a799f93f12ece)
> and [approved engagement through Trish](https://github.com/gastownhall/bdp/pull/285#issuecomment-6349188134).
> Her two inline editorial comments are
> resolved in the editorial successor. This records approval of the working POR
> and process, **not adoption of the remaining semantic drafts or implementation
> support**. No editorial pass on every linked draft is a prerequisite to the
> already-authorized work; existing implementation holds remain.

The [stage-1 notice, October 22, 2026](https://github.com/gastownhall/bdp/issues/59#issuecomment-6347674001)
records the interim state before Donna's baseline review.
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
| Communication | Donna's reviewed POR baseline; Trish-owned rollout and explicit owner acknowledgment/impact records | Owner adoption inferred from silence, a stage-1 receipt or a copied proposal |
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

The reviewed front door was curated from remote `codex/bdp-v0.1` at
[`365f337fd161e0c888b0ab6dc3a632bfbcb28581`](https://github.com/gastownhall/bdp/commit/365f337fd161e0c888b0ab6dc3a632bfbcb28581),
following starting source
[`37d6622f95e71cac022478cfbcb3e8f2d6bdf444`](https://github.com/gastownhall/bdp/commit/37d6622f95e71cac022478cfbcb3e8f2d6bdf444).
These are source identities, **not the reviewed POR revision**. Donna reviewed
the front door/register at
`2265a640`; this editorial successor records that approval and clarifies her
comments. Trish's rollout must identify both the reviewed baseline and the
editorial successor and state the still-unadopted specification/capability scope.
Consult the linked issues for live amendment status; this is the bounded October22 curation snapshot.

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

## Unmerged candidate sources after the reviewed snapshot

This additive pointer update starts from published POR
[`050cb3b1e5550ba25d8ee51429a3f675b01e86d4`](https://github.com/gastownhall/bdp/commit/050cb3b1e5550ba25d8ee51429a3f675b01e86d4).
The curation table above and original 29 register rows retain their reviewed
snapshot. The following drafts have bounded parent source reviews; they remain
**unmerged, incomplete and unadopted**. Their author choices are not new human
rulings or incorporated protocol changes.

| Candidate | Exact source pointers | Current boundary |
| --- | --- | --- |
| [PR286](https://github.com/gastownhall/bdp/pull/286), namespace pair | At `453a37ac8031c77e76dc1a6ef16d3d05850de82a`: [CLI Scope/reference subset](https://github.com/gastownhall/bdp/blob/453a37ac8031c77e76dc1a6ef16d3d05850de82a/docs/cli-design/scope-and-references.md), [Core](https://github.com/gastownhall/bdp/blob/453a37ac8031c77e76dc1a6ef16d3d05850de82a/specs/profiles/core/core.md), [Write](https://github.com/gastownhall/bdp/blob/453a37ac8031c77e76dc1a6ef16d3d05850de82a/specs/profiles/write/write.md), [correspondence](https://github.com/gastownhall/bdp/blob/453a37ac8031c77e76dc1a6ef16d3d05850de82a/docs/design/bdp-v0.1-scope-namespace-correspondence.md) | Draft propagation of accepted Scope-defined paths: actual kind metadata, owning-Scope discovery and alias/reference correspondence. A paired CLI subset, not the complete CLI or a product namespace migration. |
| [PR287](https://github.com/gastownhall/bdp/pull/287), contract-binding pair | At `5c3f9090cc53470c62a55d6675e31b72175f015f`: [CLI binding](https://github.com/gastownhall/bdp/blob/5c3f9090cc53470c62a55d6675e31b72175f015f/docs/cli-design/contract-binding.md), [protocol binding](https://github.com/gastownhall/bdp/blob/5c3f9090cc53470c62a55d6675e31b72175f015f/specs/profiles/core/contract-binding.md), [candidate canonical schema](https://github.com/gastownhall/bdp/blob/5c3f9090cc53470c62a55d6675e31b72175f015f/specs/profiles/core/bdp-v0.1.schema.json), [distribution copy](https://github.com/gastownhall/bdp/blob/5c3f9090cc53470c62a55d6675e31b72175f015f/packages/protocol/schemas/bdp-v0.1.schema.json), [correspondence](https://github.com/gastownhall/bdp/blob/5c3f9090cc53470c62a55d6675e31b72175f015f/docs/design/bdp-v0.1-contract-binding-correspondence.md) | Includes unmerged PR286 ancestry. Proposes discovery `0.1`, version-specific JSON media, CLI contract identity and optional capability-version maps. Separately named artifacts and a JSON export do not upgrade v0 runtime/parser/provider support. |
| [PR289](https://github.com/gastownhall/bdp/pull/289), affiliation and owned-state pair | At `253bda933a55902eefdc68bbcd9e3154dfecd87b`: [CLI affiliations/owned state](https://github.com/gastownhall/bdp/blob/253bda933a55902eefdc68bbcd9e3154dfecd87b/docs/cli-design/affiliations-and-owned-state.md), [common protocol](https://github.com/gastownhall/bdp/blob/253bda933a55902eefdc68bbcd9e3154dfecd87b/specs/profiles/core/affiliations.md), [candidate schema](https://github.com/gastownhall/bdp/blob/253bda933a55902eefdc68bbcd9e3154dfecd87b/specs/profiles/core/bdp-v0.1.schema.json), [distribution copy](https://github.com/gastownhall/bdp/blob/253bda933a55902eefdc68bbcd9e3154dfecd87b/packages/protocol/schemas/bdp-v0.1.schema.json), [correspondence](https://github.com/gastownhall/bdp/blob/253bda933a55902eefdc68bbcd9e3154dfecd87b/docs/design/bdp-v0.1-affiliation-port.md) | Ports selected carrier/retyping into the new artifact, with exact affiliation/default/retry intent, whole-state no-op and nominal owned capture/result rules. Semantic repairs reviewed at `3540595d177c149105d59d607c46473e23add04c`; this head adds reviewed documentary snapshot labels only. Required Type-only/ownership Event encoding and actual Types/profile composition remain gaps. |
| [PR290](https://github.com/gastownhall/bdp/pull/290), object-edit pair | At `dc331c53147a6e4eb7fb4ed426e2697768298c9a`: [CLI object modes](https://github.com/gastownhall/bdp/blob/dc331c53147a6e4eb7fb4ed426e2697768298c9a/docs/cli-design/object-edits.md), [Write inputs](https://github.com/gastownhall/bdp/blob/dc331c53147a6e4eb7fb4ed426e2697768298c9a/specs/profiles/write/object-edits.md), [candidate schema](https://github.com/gastownhall/bdp/blob/dc331c53147a6e4eb7fb4ed426e2697768298c9a/specs/profiles/core/bdp-v0.1.schema.json), [distribution copy](https://github.com/gastownhall/bdp/blob/dc331c53147a6e4eb7fb4ed426e2697768298c9a/packages/protocol/schemas/bdp-v0.1.schema.json), [correspondence](https://github.com/gastownhall/bdp/blob/dc331c53147a6e4eb7fb4ed426e2697768298c9a/docs/design/bdp-v0.1-object-edit-correspondence.md) | Distinct ordinary replacement/patch/omission inputs, independent object modes and protected-input/completed-result correspondence. Bounded nine-file source review found no blocking issue; this does not establish provider enforcement, batch support/refusal/results or adoption. |

PR289 includes unmerged PR286/287 ancestry; PR290 builds on PR289. Each pinned
artifact describes that candidate stage; later schema amendments do not rewrite
earlier source or qualification. Bounded repair/source acceptance is separate
from incorporation and the remaining Event/Types/profile composition. The
selected six-CRUD atomic batch support/refusal/result slice remains separate
[issue152](https://github.com/gastownhall/bdp/issues/152) authoring.

The new schema's inherited profile, Type, Event and advanced grammar remains
**staging input**, not a retained-surface or implementation promise. The
candidate specification/schema URI is an identifier; no deployed endpoint or
dereference obligation is claimed. Retained profile/Type/affiliation/Event
composition, including the pending Event D1/D2 choices, still gates adoption.
The existing v0 schema/distribution links above and each implementation's actual
runtime/artifact/evidence pins remain in force; no old result becomes a v0.1 PASS.
Bounded source/artifact checks and parent review do not establish provider
qualification or hosted green. Existing implementation/serve/budget/release/pin
and Experimental holds remain. Trish owns integration and status through #59 and
the concrete issues; this section changes no decision disposition.

## Operating procedure after the front-door baseline

1. **Engage against the working POR:** continue already-authorized work using
   this front door and the named resolution drivers in the register. State each
   implementation's exact actual contract and discrepancies. Vickie, `bd serve`
   and runtime adoption stay held; no routing migration, new implementation or
   validation/review campaign, or v0.1 conformance claim follows from engagement.
2. **Resolve the assigned source work:** Trish owns integration/communication;
   Molly owns curation/status/consumer coverage; Sybil owns Core/Write/CLI;
   Trish owns Types; Olivia owns proposal exploration only. Accepted rulings need
   propagation; open proposals need a scoped decision rather than adoption by
   example. Closed and deferred rows create no new assignment or restart.
3. **Hand completed changes to Trish:** each resolution driver links the concrete
   BDP issue, ruling or unresolved question, exact amendment revision, relevant
   evidence and remaining implementation delta. Trish composes/lands the source
   on `codex/bdp-v0.1` under its existing gates and records the resulting status.
   This source handoff is separate from product qualification or runtime adoption.
4. **Trish owns phase3 rollout:** report the exact reviewed POR baseline and
   editorial successor, the changes-since-notice bulletin below, and continuing
   holds. Obtain each affected owner's explicit acknowledgment and implementation
   impact. Track received, pending, no-impact and held work separately. A
   stage-1 receipt is not an owner adoption ACK; silence is not approval.
5. **Subsequent changes use concrete BDP issues:** capture the human ruling and
   scope, resolution driver, source disposition, incorporated commit, affected
   owners and communication/implementation status. Trish coordinates the change
   bulletin and impact follow-up. No second umbrella tracker, silent pin/catalog/
   schema/runtime adoption or fresh blanket approval queue is introduced.

Experimental documents must retain their strong non-normative, non-POR,
non-product-commitment, non-conformance-obligation and no-promised-implementation
notices. Olivia's ownership/pinning sidebar is exploration, not an adopted
replacement or a hold on independent consolidation. Existing ownership/history
and Memory requirements remain recorded unless Donna explicitly revises them.

## Changes since the stage-1 notice

Stage1 is anchored at
[October22 18:01:59 UTC](https://github.com/gastownhall/bdp/issues/59#issuecomment-6347674001).
The changes since that notice are:

- **Curation/process:** the existing front door now links the29 recovered
  decision groups, accepted-unincorporated changes, existing amendment issues,
  exact source identities and separate decision/specification/communication/
  implementation states. Experimental and implementation holds remain explicit.
- **Review/engagement:** Donna reviewed baseline `2265a640` and approved use of
  the working POR; Trish owns the phase3 acknowledgment/impact rollout. Linked
  semantic drafts still require their own resolution and coherent propagation.
- **Editorial clarity:** retyping is explained as changing a Bead's or Link's
  Type without changing its ID, while earlier revisions retain the former Type.
  Each register row names the existing resolution driver and handoff to Trish;
  closed/deferred rows do not silently assign new work.

**No new protocol semantics, namespace migration, product change or hold release
is introduced by this curation/editorial update.** Prefix removal and mutable
Types were already accepted; the carrier and empty-array decisions remain as
recorded. This bulletin is content for Trish's rollout, not a claim that every
owner has acknowledged or that an impact audit is complete. The
[owner table](../docs/design/bdp-v0.1-decision-register.md#bounded-affected-owner-coverage)
retains known-work pointers and separates the later owner responses.
