# Provenance V2 — proposed Core amendment

Status: **design draft for review**, October 20, 2026. This document records
Donna's selected product semantics and a proposed shared representation. It does
not replace the current [Core](core.md), [Write](../write/write.md), or their
closed schemas. Publication is not protocol adoption, executable support, or
conformance evidence. The remaining contract work is listed at the end.

Decision source: [Provenance V2, Beads #7510](https://github.com/gastownhall/beads/issues/7510).
Shared coordination: [BDP #59](https://github.com/gastownhall/bdp/issues/59).
Authoring baseline: BDP Preview 3 integration
`205a26f5e89e7b14516f45a3087dff22d5b780f1`. This baseline already contains
the empty-update and endpoint pin-only amendments; this proposal does not revert
or duplicate them.

## 1. Scope

For a particular Bead or Link revision, describe who reportedly participated,
when it was committed, and which information sources were declared for its write.
Use one common `revisionProvenance` member outside `properties` and common
`metadata`. The containing revision is its subject.

Core must be useful with unsigned, writer-supplied data. A subsequent optional
attestation specification may add signatures and DSSE or an equivalent envelope.
It owns algorithms, keys, signature subjects, verification and evidence storage.
Those mechanics are not prerequisites for this amendment.

Activity reports, generic project-feed expansion, cross-tier replication timing
and identity remapping are separate work. This document introduces no additional
profile, capability advertisement, automatic graph Links or target fetches.

## 2. Principals and roles

A principal is an identity: a human, agent or service account. Replace singleton
revision `actor` and generic `agent` fields with principal records and role lists.
One principal can have several roles; several principals can occupy the same role.

| Initial role | Meaning |
| --- | --- |
| `initiator` | Requested the work, possibly a broader task whose exact changes were not individually approved. |
| `contributor` | Helped produce the change. |
| `submitter` | The identity under which the change was submitted for acceptance. |

All three roles are optional in Core. Missing means not recorded, not that nobody
performed the role. Services may require particular roles under their own policy.
Do not invent participants to fill missing roles.

The role vocabulary is open. Preserve unfamiliar roles without guessing their
meaning or granting permissions. Array position supplies no role priority or
authentication strength. Initiation does not imply approval of an exact
change; contribution is a reported participation claim. Delegation, approval and
authorization are separate concerns.

Use scoped identifiers without requiring a global account directory or agent
registry. A session-specific identity can identify an agent. Optional
`displayName` is a saved human-readable label, not identity, authentication or a
matching key. Names may change or collide. Do not resolve a display label into a
verified account by guesswork.

### Identity basis

Each principal has an identity basis. It describes how identity was established,
not whether every attached role claim was verified. The proposed vocabulary is:

| Basis | Meaning |
| --- | --- |
| `writer-supplied` | The writer supplied the identity. Configured local identities do not become authenticated facts. |
| `unknown` | The recorded identity's establishment is undetermined. Preserve uncertain original facts without inventing a stronger basis. |
| `channel-authenticated` | The accepting service established the submitting identity from authentication on the communication channel for this submission. |

`channel-authenticated` can come from authenticated request credentials or a
client certificate. It identifies the principal associated with the credential
accepted by the service; it does not identify the physical person or agent
operating that credential. If an agent uses Donna's credentials, Donna is the
channel principal and the agent's separately reported participation remains a
claim. Shared or delegated credential use supplies no proof of the credential
owner's personal action, initiation, contribution or approval. Do not record
secret credential material as a principal identifier.

TLS alone does not establish the caller's identity. A native
caller-provided label cannot establish the accepting service's authentication
claim. The service records the authority behind its claim; importing that claim
does not make the destination its issuer or independently prove it.

Current Core admits only carried `writer-supplied|unknown` attribution and says
future authority-attested data uses a distinct member. This amendment must
deliberately reconcile that text: a limited recorded service claim is not portable
cryptographic evidence. The exact authority field and native input/output
admission rules remain part of the schema work, not an already-adopted wire.

### Concrete workflows

| Workflow | Initiator | Contributor | Submitter |
| --- | --- | --- | --- |
| Donna requests, Polly produces, Polly uses Donna's credentials | Donna | Polly | Donna |
| Donna requests, Polly produces, CI submits with its own credentials | Donna | Polly | CI service account |
| Donna edits directly through an authenticated client | May be omitted | Donna | Donna |
| Human requests, agent produces, controller submits locally | Human | Agent session | Controller, writer-supplied |

In the first case Donna can have one record with initiator and submitter roles,
and channel-authenticated identity. This does not authenticate the initiator
claim or prove approval. Polly's identity and participation may be writer-supplied.

Participation describes this write, not everyone who ever helped. Resolve the
submitter afresh; do not inherit earlier initiators/contributors automatically.
Earlier participation remains on earlier revisions.

For an embedded write or a shell invocation with no accepting-service
authentication, `writer-supplied` is the named identity basis; its absence is not
needed to express lack of authentication. An environment variable, Git user name,
component label or fallback literal such as `human` does not establish an
authenticated human. Preserve uncertain historical values without inventing an
accountable party. Transport locality is separate: a service on the local machine
can authenticate a request through its own declared mechanism. Core does not add
a channel-existence field merely to distinguish a shell from HTTP.

## 3. One mutation-local object

Donna accepted this design shape. The example proposes member layout, not input
accepted by the current closed Core schema:

```json
{
  "principals": [
    {
      "id": "human:donna",
      "displayName": "Donna",
      "roles": ["initiator"],
      "basis": "writer-supplied"
    },
    {
      "id": "urn:example:agent-session:polly-a7f3",
      "displayName": "Polly",
      "roles": ["contributor"],
      "basis": "writer-supplied"
    }
  ],
  "sources": [
    {
      "ref": {
        "uri": "https://example.org/project/beads/report",
        "revision": "r4"
      },
      "note": "Measurements used for this change"
    }
  ],
  "sourceWithdrawals": [
    "https://example.org/reports/obsolete-guidance"
  ],
  "sourcesCompleteness": "complete"
}
```

These members are optional. The example's principal identifiers need defined
namespace/scope context; `human:donna` is not assigned a global identity by this
document. An optional change message remains available using the final shared
value-state encoding. Message/time representation simplification is not part of
this design decision.

| Mutation | Placement and meaning |
| --- | --- |
| Create Bead or Link | Optional `revisionProvenance` alongside existing creation fields. |
| Update Bead or Link | Same object alongside target, edits and guards. |
| Delete Bead or Link | Same object describes this deletion, recorded on the real terminal revision when that lifecycle amendment is implemented. |
| Sequence or batch member | Same object inside that operation. Different members may have different participants and sources. |

Preserve existing carriers: singleton targets supply their operation; sequence
and batch members carry their existing operation discriminator. Do not invent
a carrier-wide provenance override or inheritance/precedence system. Sequence
remains non-atomic and batch remains atomic under their existing contracts.

For historical Update, `fromRevision` stays outside provenance as the operation's
content-base selector. It does not copy the selected or current revision's
provenance. See [Beads #7719](https://github.com/gastownhall/beads/issues/7719)
and [BDP PR174](https://github.com/gastownhall/bdp/pull/174).

The service-resolved result includes native `committedAt`, applicable lifecycle
Inception and any service-derived submitting identity. These are not caller-set
native claims. Resolve matching principal records without implying that service
authentication verifies their other roles. Original imported claims use their
separately specified admission path.

### Product CLI correspondence

Proposed CLI input is one `--provenance JSON|@FILE|-` option supplying the object.
Batch input embeds it per member. These are not claims of executable support.

Explicit `--provenance` and `--actor` are mutually exclusive. Configured actor
defaults apply only when neither is supplied. Service-derived authentication is
independent of that client-side choice. `--actor` remains writer-defined; its
exact compatibility role mapping must be deliberate. Submitter shorthand is a
recommendation, not permission to reinterpret every historical actor as a newly
verified submitter. The Activity command's local actor has a distinct reported
domain meaning. Coordinate product flag/help/output mapping with its owner.

## 4. Sources for this write, accumulated through history

Each revision explicitly records the sources for its write. Do not copy the
predecessor's growing list into every revision. Accumulate declarations across
ordinary revision history to derive a source account as of a selected revision.
No separate content-derivation traversal graph is required by this amendment.

Use the existing Reference syntax in source entries and withdrawals:

```json
"https://example.org/project/beads/report"
```

```json
{
  "uri": "https://example.org/project/beads/report",
  "revision": "r4"
}
```

A pin names that exact source revision; unpinned names the identity without
claiming a selected revision. Do not silently substitute latest content or infer
a pin from timestamps. Sources can identify Beads, Links and external URIs.
Optional entry notes explain use; an open relation tag remains a possible
refinement whose exact grammar is unselected. A source is an information input,
not automatically an output artifact or an Activity report about the subject.

### Knowledge and completeness

| Declaration | Meaning |
| --- | --- |
| Omitted sources | Unknown declaration for this write. |
| `[]` | Explicitly no sources for this write. |
| Nonempty sources | The writer declares these sources for this write. |

Neither omission nor `[]` clears prior accumulated sources. Completeness applies
only to this write's declaration. Proposed values remain `complete`, `incomplete`
and `unknown`; empty does not automatically imply complete. These are writer
claims, not proof of truth, actual use, support or exhaustiveness.

A complete declaration on the latest revision does not make all prior history
available or complete. Aggregate readers must respect History authorization,
retention and erasure, and disclose missing coverage rather than fabricate a
complete result. This proposal requires no aggregate materialization, new query
endpoint or mandatory background fetch. Any index/cache is derived, not a second
editable source authority.

### Withdrawal

Withdrawal stops counting a named source in the accumulated account from this
revision onward. Prior revision declarations remain unchanged. It is not a claim
that the source is false.

Use ordinary References for withdrawals and match the declared reference,
including any pin. A pinned reference differs from its unpinned identity or
another pin. Notes are not the matching key; withdrawing `A@r1` does not silently
withdraw every revision of A.

| Revision | Declaration | Accumulated account in this example |
| --- | --- | --- |
| R1 | Adds A | A |
| R2 | Adds B | A, B |
| R3 | Withdraws A | B |

Repeated declarations, simultaneous add/withdraw, ordering/duplicates and their
no-op/equality mapping need explicit final rules before schema/runtime adoption.
The selected direction is that real source/completeness changes are
revision-worthy. Do not implement that by comparing against an inherited flat
list or by silently making participant-only context revision-worthy.

### Service policy and preservation

Generic Core does not require source-target fetches, existence checks or truth
verification. A service or Type may impose admission policy and accept or reject
a write. It must not silently rewrite accepted submitter source declarations.
That would also invalidate a later signature covering those declarations.

Any service-generated declaration needs explicit attribution rather than being
presented as the submitter's statement. Exact evidence/canonicalization mechanics
belong to the later signing specification. Read authorization may limit
disclosure; it does not rewrite immutable source history. This does not waive
Memory-specific admission rules or treat every citation as a graph endpoint.

## 5. Time and application-owned validity

`committedAt` is the authority-observed commit time of this revision. Ordinary
callers cannot backdate it. Time alone cannot turn a no-op into a revision.
Timestamps do not replace opaque revisions or ordered replay positions.

Preserve imported original commit times as reported original claims, including
when unsigned, without treating them as destination-verified facts. Unknown old
time stays unknown; new local import heads have their own commit time. This
does not relax retained-copy admission, erasure or identity evidence rules.

Effective dates and validity windows are application-owned. Users may experiment
in ordinary common metadata and later define structured Bead/Link Types. This
adds no reserved effective-date fields, validity filters, clock-driven writes or
bitemporal query engine. Metadata edits follow existing revision/equality rules;
the passage of time itself creates no revision.

Donna explicitly deferred the broader multiple-storage-tier/eventual-consistency
problem, including Brian's unstable-ID concern. No per-tier receipt/visibility
timestamps, identifier remapping, authority transition or revision minting on
propagation is selected here. Existing selected identity/revision laws remain in
force until a deliberate broader amendment changes them. This deferral does not
block the narrower provenance contract.

## 6. Lifecycle and immutable history

Save accepted changed state and provenance atomically under existing mutation
owners. Failed writes expose neither half. A saved revision's provenance is
immutable. Guard checking precedes no-op handling. Preserve native participation
fences and per-Resource exactly-once ownership, including owned-Link composites.

Ordinary participant/message-only changes remain subject to the existing no-op
direction. A participant-correction operation is not introduced implicitly.
Adding later endorsements is separate evidence work, not permission to edit old
provenance or fake a content change.

One shared open `inception` field describes how this identity's current period
of presence in the Scope began:

| Value | Meaning |
| --- | --- |
| `create` | Ordinary creation introduced the identity. |
| `import-insert` | Insert import introduced an absent identity. |
| `import-upsert` | Insert branch of upsert, only if that operation is later offered. |
| `revert` | Same-ID recovery made a deleted identity live again. |
| `unknown` | How the current period began is unknown. |

Preserve valid unfamiliar values and missing original knowledge. Ordinary live
updates and historical-base updates preserve current Inception; terminal
deletion retains it; deleted-to-live recovery sets `revert`. Do not backfill
retained originals. The enum spelling does not introduce a `bd revert` command.

Attributed terminal deletion is the accepted direction across Beads and Links.
Its actual terminal carrier, guards and History/Event/receipt effects need the
shared lifecycle amendment; current Core behavior is not claimed to have changed
by this document. Logical deletion and historical erasure remain distinct.

Historical Update decisions in #7719 use optional `fromRevision`, exact retained
same-identity admission, explicit edits, independent optional current/deletion
guards and ordinary equal-result live no-op behavior. Initial recovery scope is
Beads; historical Link recovery is excluded. Do not implicitly roll back Type,
endpoints or owned state, resurrect other Links or copy old provenance.

Owned-source pins remain deferred for the selected first endpoint slice per
[Beads #7659](https://github.com/gastownhall/beads/issues/7659). This document
selects no before/after owner revision interpretation and does not reinterpret
provenance source References as endpoint admission permissions.

## 7. Review cases and qualification boundary

These are semantic review targets, not executed runtime tests or claimed
conformance cases:

| Case | Expected distinction |
| --- | --- |
| Donna requests broad work | Initiation does not prove exact approval. |
| Donna initiates and submits | One principal can hold both roles. |
| Several contributors or unknown roles | Preserve reported participation without granting authority. |
| Donna's channel identity plus initiator claim | Authentication establishes submitting identity, not every role. |
| Local unsigned write | Writer-supplied provenance remains usable. |
| Ordinary subsequent update | Participants and source declarations describe this write; no copied old envelope. |
| Missing versus empty sources | Unknown declaration differs from explicitly no sources for this write. |
| R1 adds A, R2 adds B, R3 withdraws A | History can derive A, then A/B, then B, without copied lists. |
| Withdraw pinned A | Match its reference/pin, not notes or every revision of A. |
| Service policy rejects a source declaration | No partial write or silent rewrite. |
| Import original time/identity claim | Do not substitute today's importer or clock as the original fact. |
| Stale guard with otherwise equal content | Refuse before no-op handling. |
| Clock crosses application effective date | No automatic revision or deletion. |
| No signature extension | Core remains usable. |

Current schemas, SDK/runtime and installed product paths are unchanged. A later
implementation must name the exact contract/build, applicable validation and
honest coverage; passing this document's JSON/link checks is not that evidence.
Shipping behavior compatibility remains; Preview1/2 adapters and release data
migration are not requirements of this slice.

## 8. Remaining work

1. Finalize the exact schema: identity scope/normalization, authority placement,
   complete basis/unknown admission, role extension grammar, record merging and
   service-only versus caller-reported facts. Existing closed Core/Write and
   mirrored schema artifacts must be amended deliberately, together.
2. Finalize source/withdrawal ordering, duplicates, repeated/simultaneous
   declarations, equality/no-op and truthful aggregate availability semantics.
3. Decide the existing `--actor` compatibility role, configuration and Activity
   command mapping. Optional display labels and mutually exclusive structured
   input must not silently alter shipping audit or workflow semantics.
4. Map current/exact/versions reads, native indirect writes, terminal lifecycle,
   receipts/Events and admitted interchange through one selected representation,
   under existing operation ownership. No separate recorder or private extra
   protocol fields.
5. Specify participant corrections and service-added context without rewriting
   old claims. Keep attestation evidence placement/signing in the subsequent
   specification; keep Activity/query expansion separately scoped.
6. Prepare the schema/fixture and implementation cohorts, review and qualify
   applicable paths in self-describing PRs under MEM-POL-003. No merge, runtime
   pin, release/default change or capability claim follows from this draft.
7. Reconcile the merge-scoped OSS vocabulary discussed in Julian's October19
   [upstream update](https://gascityinc.slack.com/archives/C0BHVRDE6LW/p1792459256307549)
   (`actors[]`, `effective_at`, `original_committed_at`) with this selected design.
   That message explicitly limits those choices to the merge effort rather than
   final proposal judgment. Do not infer a strict-subset mapping, participant
   roles, array-order meaning or a reserved temporal contract without the exact
   implemented/adopted source. Preserve source observations and planned changes
   as separate evidence.
8. Coordinate Conformance's domain `evidence` property with per-write sources.
   Current Memory defines free-form claim support; sources describe inputs used
   by a particular write. Identify any duplicate authority and the intended
   retained meaning before changing the owned Memory Type or requiring a
   validator to cite the same run twice. No removal or conversion of that
   property is selected by this document.

Review context: [October20 #eng feedback](https://gascityinc.slack.com/archives/C0BHVRDE6LW/p1792546221311659).
Concrete reviewer proposals for `--actor` as contributor plus submitter,
source-only explicit-declaration minting, URI/URN-only principal identifiers,
`{ref,note}` withdrawal wrappers, `{basis,authority}` placement and the
`--message`/`--change-message` spelling are not adopted by these clarifications.
They remain explicit review choices, not executable contracts inferred from the
Slack discussion.
