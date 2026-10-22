# BDPv0.1 decision/status register

**NON-NORMATIVE INDEX — WORKING-POR BASELINE REVIEWED; ENGAGEMENT APPROVED.**
This register links existing concrete issues and human-ruling receipts. It is
not a specification, competing tracker, runtime support matrix or adoption ACK.
Start at [the specs front door](../../specs/README.md) and
[stage-1 notice](https://github.com/gastownhall/bdp/issues/59#issuecomment-6347674001).
Donna reviewed the front door/register at
[`2265a640ec594235334752244d8a799f93f12ece`](https://github.com/gastownhall/bdp/commit/2265a640ec594235334752244d8a799f93f12ece)
and [approved engagement through Trish on October22](https://github.com/gastownhall/bdp/pull/285#issuecomment-6349188134).
This editorial successor
resolves her inline comments and records that approval. Trish owns phase3
communication and owner-impact requests. The linked semantic drafts remain
unadopted; engagement does not lift implementation holds.

## Source, authority and coverage boundary

Source branch is `codex/bdp-v0.1`, curation base
[`365f337fd161e0c888b0ab6dc3a632bfbcb28581`](https://github.com/gastownhall/bdp/commit/365f337fd161e0c888b0ab6dc3a632bfbcb28581).
The original bounded recovery is preserved at
[coordination commit e480d568](https://github.com/donnabox/agent-coordination/tree/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/):
29 grouped findings,41 directly read human turns, existing issue/PR/source
snapshots and explicit omissions. Reuse those receipts; no new exhaustive
historical audit was performed. Older Type rulings1–24 use Trish's recorded
human quotes/ACKs; Molly did not independently reopen each original chat turn.
Assistant repetition, author login, draft publication and review success are
not substitutes for adoption.

Donna decides semantic choices. Trish owns integration/Types and communication;
Sybil owns Core/Write/canonical CLI/Experimental; Molly curates evidence and
affected-owner coverage. [Issue59](https://github.com/gastownhall/bdp/issues/59)
is the sole shared plan. A proposal can be coherent and checked yet unaccepted.
Conversely an accepted rule can remain unincorporated. Preserve the contract
actually pinned by a consumer and record discrepancies against the selected
target instead of inferring implementation support.

## Decision, specification, communication and implementation coverage

The29 original recovery IDs below remain stable for comparison. **A** means an
accepted direction with the stated propagation status; **O** an open decision;
**P** an unaccepted proposal; **D** deferred/rejected/superseded; **C** a closed
or historical control. These are source dispositions, not new authority.

Every row's **communication** state distinguishes Donna's approved working-POR
baseline from Trish's phase3 owner ACK/impact follow-through. This register does
not itself send an impact request or claim an owner has adopted the POR.
Every row's **implementation** state is **not assessed by this curation**,
except where an exact historical product delivery is explicitly named below;
none establishes v0.1 conformance. Live issue state outranks this dated index
for progress; original human authority remains linked from the owning issue.

| ID | Decision disposition | Specification propagation / owning record | Communication and implementation boundary | Resolution driver |
| --- | --- | --- | --- | --- |
| R01 | A: change a Bead's or Link's Type without changing its ID or Resource kind; earlier revisions preserve the former Type | [279](https://github.com/gastownhall/bdp/issues/279): Core/Types/Write/schema composition pending;283/284 are draft slices | Working-POR engagement approved; selected Memory product delivery is not generic BDP wire support | Sybil, with Trish on Types |
| R02 | A: no mandatory beads/links/types roots; Scope-defined paths, no kind inference | [280](https://github.com/gastownhall/bdp/issues/280), [direct human receipt](https://github.com/donnabox/agent-coordination/blob/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/human-source-excerpts.md#01a161d7-2a1e-7df3-93f4-552ecc1cc480): inherited Core fixed-root text unamended | Preserve known prefix-dependent pointers; no migration/impact audit yet | Sybil |
| R03 | A: configured default Scope, Bead verbs/Link verbs, common Type flags and Cleo output; O: exact Scope grammar | [59](https://github.com/gastownhall/bdp/issues/59), [same human feedback](https://github.com/donnabox/agent-coordination/blob/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/human-source-excerpts.md#01a161d7-2a1e-7df3-93f4-552ecc1cc480); canonical CLI correspondence pending | Do not adopt a Scope flag/operand grammar from illustrative examples | Sybil |
| R04 | A: create/update --type sets; filter --type includes refinements, --exact-type nominal-only | [human direction](https://github.com/donnabox/agent-coordination/blob/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/human-source-excerpts.md#01a161ef-52f6-7d10-9bf4-efbbdf8f2ca4),279/282 correspondence pending | Earlier handoff's negative about an exact flag is superseded; graph edge masks/query syntax not mechanically renamed | Sybil |
| R05 | A: --revision and ID@REV; both supplied refuse; --if-revision is a guard | [direct acceptance](https://github.com/donnabox/agent-coordination/blob/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/human-source-excerpts.md#01a16203-432c-7432-ac13-a4fdde35bbe8); canonical selector correspondence remains | Existing product precedent does not qualify a future generic parser | Sybil |
| R06 | A: singular set-property/unset-property; Type CLI placeholder is bd type list; D: full Type CLI | [human naming](https://github.com/donnabox/agent-coordination/blob/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/human-source-excerpts.md#01a161ed-1599-7280-8f74-5ac62cfd886e), [placeholder](https://github.com/donnabox/agent-coordination/blob/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/human-source-excerpts.md#01a161f2-1582-73d0-ac5b-7495d104207b); edit combination/value grammar incomplete | No new product command/flag adoption | Sybil |
| R07 | A: remove non-atomic sequence from target | [human direction](https://github.com/donnabox/agent-coordination/blob/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/human-source-excerpts.md#01a161d7-2a1e-7df3-93f4-552ecc1cc480), [disposition map](bdp-v0.1-core-write-disposition.md); inherited source still contains sequence | Historical comparison only; no atomic-to-sequence fallback | Sybil |
| R08 | A: coherent specification first, Experimental outside specs, implementation holds, exact pin plus honest deltas | [stage1](https://github.com/gastownhall/bdp/issues/59#issuecomment-6347674001), [59](https://github.com/gastownhall/bdp/issues/59);278 staging integrated | Donna reviewed2265 and approved engagement; Trish owns phase3; no implementation thaw | Trish; Molly curates status |
| T01 | A, recorded rulings1–4/21: abstract categories, exact-target Refines uniqueness, different parent revisions allowed | [282](https://github.com/gastownhall/bdp/issues/282), draft283 ports accepted correspondence; original [decision receipts](https://github.com/donnabox/agent-coordination/blob/f48a14d9ebb1b3cec1170f565731640fd0d6fcff/context/trish/type-design-decisions-20261020.md) | Draft/profile adoption distinct from finite artifact checks | Trish |
| T02 | A, recorded5–6: offline exact schema closure, supplied meta-schema, explicit relative-reference base | 282/283 schema-environment correspondence; [recorded receipts](https://github.com/donnabox/agent-coordination/blob/f48a14d9ebb1b3cec1170f565731640fd0d6fcff/context/trish/type-design-decisions-20261020.md) | No network acquisition or installation policy inferred | Trish |
| T03 | A, recorded7–9/14–19: propertyAccess, init-only transition, service-managed refusal, inherited restrictions | 282/283 Type-local propagation;279 ordinary update/replacement composition remains | No lifetime init-only invariant or ban on ordinary array patches | Trish |
| T04 | A: exact explicit registration/closure, retirement boundary, repeatable labels, initial import pre-registration; D: broad lifecycle | 282/283; [direct definition-presence distinction](https://github.com/donnabox/agent-coordination/blob/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/human-source-excerpts.md#01a15f75-04cc-72a1-bb2d-35e52885f812) | No registration CRUD/import acquisition restart | Trish |
| T05 | D: executable qualifier language; A, recorded22–23: enforce required semantics and preserve native adapter boundary | 282/283; native Issue/Dependency purity rewrite excluded | No solver/platform or broad native conformance claim | Trish—boundary maintenance only |
| T06 | A, recorded24: endpoint Type eligibility on final atomic graph | 282/283 propagate;279/Write composition remains | Syntax/auth/guards/property-policy checks not broadly deferred; temporary endpoint-pair violations may be repaired within an atomic batch; invalid final graph refuses, with no implicit repair | Trish |
| T07 | A, recorded25–27: complete operationally bounded exact-definition reads, narrow retained access, no extra legacy HTTP descriptor obligation | 282/283; [direct return answer](https://github.com/donnabox/agent-coordination/blob/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/human-source-excerpts.md#01a15e72-aa42-7951-b5c0-3b42c62d0faf); exact budgets/read binding pending | Item3 human “ACL” recorded as Trish's ACK interpretation; no fabricated semantic Memory/Refines maxima | Trish |
| E01 | A: Events non-optional | [153](https://github.com/gastownhall/bdp/issues/153), [direct ruling](https://github.com/donnabox/agent-coordination/blob/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/human-source-excerpts.md#01a161fa-afa5-7e30-a5a4-a1c852b32276); retained baseline/read-only duties still need composition | Required Events not moved into optional replication | Sybil |
| E02 | A: lifecycle symmetry/incident projection; D: exclusive delta-only target; O: payload mode | 153 updated;164 remains proposal; [newer payload deferral](https://github.com/donnabox/agent-coordination/blob/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/human-source-excerpts.md#01a16217-75a1-7d13-8162-f72e4b5cbc02) | No retained Event rewrite or selected postimage implementation; import-head work deferred | Sybil |
| E03 | A direction: delta/batch shared mutation vocabulary; O: exact committed-effect schema | 153/279/284; [human framing](https://github.com/donnabox/agent-coordination/blob/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/human-source-excerpts.md#01a1621e-cc92-7cb1-acca-e428b4df967e); Type-only Event/owned-delta encoding gap remains | Request guards/bindings are not Event replay commands | Sybil |
| E04 | P/O: subscription negotiation, optional provenance suppression; D: predicate/property-path projection | 153; [bounded human discussion](https://github.com/donnabox/agent-coordination/blob/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/human-source-excerpts.md#01a1621c-bbc3-74f2-82ec-3e6d2f291a73) | No handshake, flag or ignorable-required-fact policy adopted | Sybil |
| B01 | A, recovered Iris acceptance: common JSON batch/CLI meanings, one Scope, identity bindings, six CRUD product cut | [152](https://github.com/gastownhall/bdp/issues/152), draft163; shared capability/schema adoption pending | Six-member subset not full old Transactional conformance; sets deferred | Sybil |
| B02 | A direction: CRUD authoring/emission lowers to JSON; O: grammar and ID capture; D: parameterization | 152 updated; [direct “Specifics TBD but yes”](https://github.com/donnabox/agent-coordination/blob/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/human-source-excerpts.md#01a161e8-5d6f-7c60-8f60-eaa593c736e1) | Emission not live validation; no literal CLI-string wire format adopted | Sybil |
| B03 | A requested direction: whole-request unsupported-member refusal; O: discovery/status/admission/retry details | 152/163 proposed wire choices, not adopted error fields | No supported-prefix execution, chunking or sequence fallback | Sybil |
| B04 | A, incorporated365f: ordinary update inputs may supply empty arrays; applicable checks still run; only a genuine complete no-op retains revision/emits no effects | [approved ruling](https://github.com/gastownhall/bdp/issues/59#issuecomment-6279758605),172 Preview3 source,281 port integrated | Both ordinary change arrays absent still refuses; Type-only admission is separate draft284 work; output/updateWhere constraints not globally relaxed; no mandatory guard or runtime credit from port | Sybil—incorporated; no new assignment |
| P01 | P: floating owned source and explicit pin-adoption tactical model | [proposal/review](https://github.com/donnabox/agent-coordination/tree/f14072108f0e53819b6a1fea6f608fe1a5aa732b/context/trish/owned-link-rules-council-20261021/), Olivia's [sidebar13](https://github.com/donnabox/agent-coordination/issues/13) | No source-pin policy adoption, ownership removal or changed Chris/Memory requirement | Olivia—exploration only |
| P02 | D: per-Link-Type pin-policy feature rejected/deferred | [direct rejection](https://github.com/donnabox/agent-coordination/blob/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/human-source-excerpts.md#01a16222-b6fc-7723-a1e6-1a4b0985a3d0) | No pin-policy field silently added as an integrity prerequisite | None—rejected/deferred; Molly records status |
| P03 | O/P: portable identity/locator/equality and relocation; accepted old subrulings retain scope | [2](https://github.com/gastownhall/bdp/issues/2), [6](https://github.com/gastownhall/bdp/issues/6), [62](https://github.com/gastownhall/bdp/issues/62),280 crosswalk | Prefix removal alone selects no stable scopeId/relocation/trust model | Sybil |
| P04 | P: expected foreign Type assertion; old bead-shaped path premise stale | [11](https://github.com/gastownhall/bdp/issues/11),280 correspondence | No foreign verification/acquisition policy inferred | Sybil—open proposal only |
| P05 | C: numeric model, Problem rows and diagnostic limits propagated/closed | [21](https://github.com/gastownhall/bdp/issues/21), [3](https://github.com/gastownhall/bdp/issues/3), [4](https://github.com/gastownhall/bdp/issues/4) | Keep closed; specification closure is not product qualification | None—closed; Molly records status |
| P06 | C/D: broad/historical Type drafts, copied CLI assumptions, naming lineage | [60](https://github.com/gastownhall/bdp/pull/60), [85](https://github.com/gastownhall/bdp/pull/85),142/171/173 history;282/283 current Type port,277 domain split | No wholesale historical merge, automatic catalog adoption or stale wording veto | Molly—historical index only |

### Resolution handoff to Trish

The driver named in each row develops the already-authorized resolution, keeps
its concrete BDP issue current, and hands Trish the ruling/proposal, exact source
revision, relevant checks and remaining contract/implementation gaps. Trish owns
composition and landing on `codex/bdp-v0.1`, including her own Types changes,
and communication of the resulting status. Sybil and Trish coordinate the
shared Core/Types/Write seams; Molly maintains curation/status rather than
writing their semantics. Olivia returns proposals, not source changes.

A driver label is an accountability pointer within existing authority, not a
new assignment for closed/deferred work, a lifted hold or permission to adopt an
open proposal. Actual unresolved human choices go through the existing Donna
loop. The row's decision, source propagation, owner communication and runtime
support remain separate even after its driver hands a change to Trish.

### New disposition since the original recovery

The exact affiliation carrier is now **human-selected**, superseding the
original recovery's carrier-open question. [Issue279](https://github.com/gastownhall/bdp/issues/279)
records Sybil turn `01a1627b-2310-76a2-8dfe-6ab039b42b17`, user message
`01a16284-38fe-7c63-95c8-1b33cd8bedda`: URI or `{uri, revision}`, no separate
`typeRevision`; Types registered-default resolution/exact output and Core-only
opaque carrying remain distinct. Draft284 `42cfdf2c7ff6ca419932be55b4b17f8124ef09d7`
and draft283 `a2aa88d9b5a0e0d78f48de2967d4ceaa38177876` are composition inputs,
not adopted contract. Author finite/grammar checks do not close the Type-only
Event/owned-effect gap or establish runtime behavior. No parallel legacy HTTP
descriptor endpoint or general v0 migration project is required by the selected
fleet-only compatibility boundary.

Canonical CLI authority correction: a configured default Scope is selected;
option-over-environment-over-config precedence and dedicated `--scope` versus
positional URI grammar remain proposals. Product Issue-family defaults and
`--type any` conventions do not establish a domain-neutral protocol default or
a special full-URI `/any` exception. Preserve the relevant product owner record
without adopting those broader meanings here.

## Genuine unresolved work and deliberate exclusions

Trish/Sybil should derive settled cases before sending another question to
Donna. Current concrete gaps are:

- Required Event read-only/production/observation baseline, Type-only and induced
  owner transitions, payload/version/subscription/replay/retention semantics.
- Atomic batch capability/refusal, durable outcome/retry/in-flight rules and
  bounded CLI authoring/ID capture, without replica/public-receipt prerequisites.
- Scope/discovery/kind/alias correspondence and identity/locator trust/equality;
  friendly exact-Type CLI pin syntax. The carrier and prefix-removal decision
  are already answered.
- Concrete retained-definition read binding/budgets and controlled intrinsic
  publication. General registration/install/removal/upgrade/acquisition lifecycle
  remains deferred; do not manufacture finite semantic domain maxima.
- Ownership/pinning alternatives, prospective ownership-entry/older-state
  treatment and retained-citation lifecycle. Olivia may propose explicit
  requirement changes; existing requirements are not silently withdrawn.

[Experimental](../../experimental/README.md) parks replica synchronization,
public retained receipts and set-write explorations. It is not POR, a product
commitment, a conformance obligation or promised implementation. Required
Events, ordinary safe writes, guards and durable retry outcomes remain retained.
Parameterized batches, predicate Event filtering, property-path Event projection,
full Type CLI and native Issue/Dependency purity rewrites are not added here.

## Bounded affected-owner coverage

This is a proposed communication set from existing work pointers, **not a fresh
implementation-impact audit**. Trish owns the stage1 receipt history and phase3
announcement/ACK requests.
Donna's working-POR baseline approval is recorded above; this index does not
claim that each affected owner has acknowledged or supplied an impact response.
Through Trish's phase3 rollout, each owner should return: exact
implementation/pin/work source,
affected/none/held assessment, concrete discrepancy issue and any required next
action. Holds remain until explicitly lifted. Names below are owners, not new
assignments or permission to restart them.

| Owner | Existing bounded reason / pointer | Interim and later communication boundary |
| --- | --- | --- |
| Cleo | Canonical CRUD/output/compatibility; [Beads PR180](https://github.com/donnabox/beads/pull/180) bare Issue ID versus slash-sensitive graph selector is a known prefix-dependent pointer | Preserve stage1 receipt; phase3 assesses exact product grammar/pin impact, without treating slash as a universal BDP kind rule |
| Janet | Release integration/runbook and [Beads7656](https://github.com/gastownhall/beads/issues/7656); product205/217 completed at6a5f47b4 | Keep actual build/contract pin and honest delta list; no new release reconciliation campaign |
| Iris | Interchange, [agent-coordination6](https://github.com/donnabox/agent-coordination/issues/6), batch152/Events153 dependencies | Preserve explicit budget/Preview4 holds; no import/export audit or restart; later adoption impact distinct from prior delivery |
| Melinda | Memory/domain/query and [BDP277](https://github.com/gastownhall/bdp/pull/277), [Memory7661](https://github.com/gastownhall/beads/issues/7661), [CLI7758](https://github.com/gastownhall/beads/issues/7758) | Domain catalog/CLI publication not generic profile adoption; later identify actual affected definitions/query/output promises |
| Vickie | Reference implementation/client/conformance, [BDP190](https://github.com/gastownhall/bdp/pull/190) and current exact implementation inputs | Explicitly held; baseline notice cannot restart implementation, serve or validation |
| Polly | History/ProvenanceV2 [BDP183](https://github.com/gastownhall/bdp/pull/183), [Beads7510](https://github.com/gastownhall/beads/issues/7510); recorded source205a26f | Polly's current chat ACKs stage1 only and preserves this pointer; no adoption or impact claim. Provenance remains a separate proposal/cutline |
| Olivia | [Ownership/pinning sidebar13](https://github.com/donnabox/agent-coordination/issues/13), Spec→Requirement and Refines | Exploration only; no adopted winner or implicit requirement revision; no hold on independent consolidation |
| Trish | [59](https://github.com/gastownhall/bdp/issues/59), integration/Types282/283 | Donna reviewed baseline2265; own phase3 communication record and actual source composition |
| Sybil | Core/Write/CLI/Experimental,152/153/279/280/284 | Read-only curation review and actual owned-source correspondence; no duplicate front-door writer or implementation restart |
| Molly | [archived recovery](https://github.com/donnabox/agent-coordination/tree/e480d5684382fda6db5d033a164e59707420ca1e/context/trish/bdp-v0.1-20261021/recovery/), this front door/register | Evidence/status/consumer curation; readiness goes to Trish for Donna, not a fleet-completion announcement |

The distinct focused Preview3 Read-pin/HTTP-projection consumer is named in
Janet's [existing handoff](https://github.com/donnabox/agent-coordination/blob/dc700d100e75c3971e03a951d0bc65b146404332/context/janet/preview3-read-interactive-handoff-20261021.md).
Trish resolved the existing chat as **Beads: Preview 3 Read pin alignment**,
thread `01a15f01-aa13-7db0-a68f-6ef6aca89561`, and delivered stage1 there. Her
communication record owns phase3 follow-through; no new role or census follows.

Donna is the baseline approver, not another implementation-impact assignee.
Chris/Max requirements input and Brian's identity consultation are supporting
human/design inputs, not established additional implementation owners in this
bounded source set. Propose another recipient only with a concrete owned
consumer/source dependency; absence of a launch file does not remove an owner.

## Omissions and communication record to complete

No complete consumer census, runtime discrepancy audit, new provenance/Memory
adoption, broad history reread or additional review campaign was performed.
This register does not independently verify every older Type human quotation,
claim that every accepted rule is already in a schema, or count a missing
hosted check as green. Original source/check limitations remain attached to
the linked records. Ordinary source checks on this two-file curation are only
documentation-integrity evidence.

Molly has not sent a fleet adoption announcement or implementation-impact
request. Trish owns rollout of the reviewed baseline `2265a640` and this
editorial successor, the [changes-since-notice bulletin](../../specs/README.md#changes-since-the-stage-1-notice)
and each owner's explicit ACK/impact response through59. These editorial
clarifications add no protocol semantics or implementation scope. Do not use
this document as an automatically completed checklist or second standing tracker.
