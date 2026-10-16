# Proposal: Provenance V2

Status: proposal for review, updated October 14, 2026. Not an adopted BDP amendment or an
implementation commitment.

## Purpose

Let someone answer: **“What information did the author say this version was
based on?”** Save that information with the version, alongside who changed it
and when. The same mechanism applies to Beads and Links.

Also **connect work items to the work performed**: commits, pull requests,
handoffs, and uses of information. Let someone answer **“What happened around
this resource, and which artifacts were involved?”** Record that activity
independently, including reports received after the work item changed or was
deleted. Reporting work must not require editing its subject. These questions
need different record shapes.

## Recommendation: two mechanisms for provenance

Adopt **two complementary mechanisms**, with the same shared meanings in BDP
and Beads:

| Mechanism | What it records | How it is written |
| --- | --- | --- |
| **Revision provenance** | Who a specific Bead or Link revision is attributed to, when it was committed, and what information it was based on | The common `revisionProvenance` field, saved by normal create/update/delete operations with the resulting live or proposed terminal revision |
| **Activity provenance** | What reportedly happened around a Bead, Link, or external resource, including reports received later | Ordinary create/update/delete of an Activity-typed Bead; `bd provenance record` is a create convenience command |

Revision provenance accompanies the subject's own revision. Activity provenance
is recorded independently, without changing its subject. An Activity Bead has
revision provenance of its own, just like any other Bead: who recorded the report
is distinct from who performed the reported activity.

### Revision provenance: one common field

Use **`revisionProvenance`** as a common top-level member on every Bead and Link
version, alongside `id`, `type`, and `properties`. It groups who the version is
attributed to, when it was committed, and what information it was based on.
Optional assisting-agent and change-message information belongs there too.

Recommend the **same name, shape, and meaning in BDP and the graph CLI**. Replace
the separate BDP `attribution` and `changeContext` containers and the preview's
combined attribution/time container with this one common representation. This is
a proposed amendment and migration target, not a claim that either has changed.

The containing version is its subject, including creation and historical reads.

### Activity provenance: ordinary Activity Beads

Use **activity provenance** for the independently recorded work history served by
`bd provenance`. Its records remain **Activity Beads**, whose Type-specific fields
live in `properties`. Do not add an `activityProvenance` list to every subject or
a second common envelope to Activity Beads. Each Activity Bead has ordinary
`revisionProvenance` describing how that activity record was written.

### Existing representations and the proposed common shape

| Information | **EXISTING — BDP** | **EXISTING — graph CLI preview** | **PROPOSED — both** |
| --- | --- | --- | --- |
| Responsible actor and qualification | Main: `attribution.principal`, `.status`; PR65: `.principal`, `.basis` | Public graph output: `attribution.actor`, `.basis` | `revisionProvenance.actor.id`, `.basis` |
| Revision time | `changeContext.committedAt` where History context is available | `attribution.recordedAt` | `revisionProvenance.committedAt` |
| Assisting agent | `changeContext.agent` | Not in the preview attribution structure | `revisionProvenance.agent` |
| Change message | `changeContext.message` | Not in the preview attribution structure | `revisionProvenance.message` |
| Information sources | No shared source member | No shared source member | `revisionProvenance.sources` |
| Source-list completeness | No shared source member | No shared source member | `revisionProvenance.sourcesCompleteness` |

Recommend **`basis: writer-supplied | unknown | authenticated`**. Retain the
`basis` vocabulary from [BDP PR65](https://github.com/gastownhall/bdp/pull/65) and
[Beads PR79](https://github.com/donnabox/beads/pull/79); `authenticated` is a new
proposal, not a claim about those changes. The October 11 source check found
PR65 open at `a7edb0c` (normative source `de99030`, included in open PR83) and
PR79 merged into the fork. Public graph output uses `basis`; private storage
still has older names. The CLI basis-input flag below is also proposed.

| Proposed actor basis | Meaning and authority |
| --- | --- |
| `writer-supplied` | The caller supplied the identity; no authentication claim. This includes configured local CLI defaults. |
| `unknown` | An identity is recorded, but its relationship to this revision is uncertain. |
| `authenticated` | The accepting service derived the actor from the authenticated principal for this write. Only the service may assign this basis. |

A saved actor requires `id` and `basis`. In a service mode that supplies
authenticated attribution, the service assigns both from its verified request
context on create/update/delete. Input may supply an actor ID without a basis
in this mode. A caller's matching actor ID may be accepted,
but is not the evidence; a conflicting ID or explicit request to suppress the
service actor is rejected before mutation. Reject caller-supplied
`basis: authenticated` in flags and ordinary JSON writes, even if the ID matches.
Do not silently replace a conflicting attribution request. Services must declare
their attribution mode; a backend without authenticated derivation retains
writer-supplied/unknown behavior and must not label an OS username authenticated.

Authentication identifies the principal that submitted the write. If that is
an agent or service account, record that account, not an inferred human behind
it. It does not authenticate the Activity participant, assisting agent, sources,
or a claim of delegated responsibility. Delegation and causality are outside
this round. The storing authority is the issuer of this limited authentication
claim; a copied record is not proof. Import must preserve the distinction between
original attribution and the importing account, and may preserve an original
authenticated basis only through a separately specified evidence/trust path.
Never upgrade historical attribution because the importer authenticated today.

Without service-derived or caller-supplied attribution, actor stays absent.
For this draft, retain the existing History value
states for time, agent, and message rather than silently dropping distinctions
between known absence and missing knowledge. The example below shows that
conservative encoding; simplifying those value encodings is a separate choice.

`committedAt` means the observed commit time of **this revision**, not the
resource's original creation time or the time of an activity it describes. New
native versions use the authority-observed instant, shared within an atomic
transaction. Callers cannot backdate it. Preserve a known original commit time
on import only with supporting evidence; otherwise mark it undetermined.
The preview's `recordedAt` serves a similar purpose but has a looser wall-clock
contract: migration must establish equivalence before relabeling old values as
commit times. No second revision timestamp is proposed.

This consolidates information introduced by the existing
[History H11 decision](history-profile-packet.md#h11--change-context-beyond-existing-attribution)
to meet Memory R12's actor, assisting-agent, time, and change-message requirements.
It keeps those meanings while replacing the separate containers.

### An Activity has two different actors only when reality does

Alice may land a commit, and an importer may later write the Activity Bead.
`properties.actor` records Alice as the reported participant;
`revisionProvenance.actor` attributes the saved record to its writer. Neither is
automatically copied from the other. The distinction is between performing an
activity and recording a report about it, not two competing authors of a revision.

Similarly, `properties.producer` identifies the reporting system (today's
`--source`), while `revisionProvenance.sources` identifies information used to
write the Activity record, such as a CI report. Its `properties.subject` identifies
what the activity concerns and does not implicitly become a source. The reported
activity time is `properties.occurredAt`; recording the version has its own
`revisionProvenance.committedAt`. Unknown values stay unknown.

## Provenance versus attestation

**Provenance says what is recorded about how something came about. An attestation
is a statement someone explicitly stands behind.** An attestation can be about
provenance; the words do not name competing places to store the same information.

Reserve **attestation** for a statement with a verifiable issuer and a defined
claim about a specific subject. This proposal introduces no signing or portable
attestation mechanism. Issuer and credited actor may differ.

For example, “Alice is listed as the author; report A is listed as a source” is
recorded provenance. “Service S attests that it accepted these exact bytes from
authenticated account Alice” is a narrower, checkable statement. It does not
establish that Alice actually consulted A or that A supports the conclusion.
Verifying who issued a statement does not prove that its contents are true.

Use **revision provenance** for the containing version's account, **activity
provenance** for reported work history, and **source provenance** for the input
information within revision provenance. Attribution is the actor portion. Ordinary
stored values remain recorded claims; do not call them attested merely because
they have an actor, timestamp, or immutable revision.

This usage follows the broad provenance model in
[W3C PROV](https://www.w3.org/TR/prov-dm/) and the authenticated-statement use of
attestation in [SLSA](https://slsa.dev/spec/v1.2/attestation-model). It is a naming
recommendation for this proposal, not a claim that every field uses identical
terminology or requires cryptographic signatures.

## Proposed revision record

All fields below are outside Type-specific `properties`. In addition to the
actor, time, agent, and message described above, `revisionProvenance` records:

- **Sources:** references to information used. A source may be a Bead, Link, or
  external URL/URN. It may identify an exact revision; an optional note explains
  how it mattered.
- **Sources completeness:** `complete`, `incomplete`, or `unknown`, as declared
  by the writer. This qualifies only the source list, not the actor or timestamp.
  Omission means `unknown`.

An absent source list means the sources are unknown. An explicitly empty list
means the writer deliberately records no sources and asserts the content directly.
If sources are unknown, their completeness is also unknown. Older records without
source information stay unknown; readers do not invent sources or authorship.

Illustrative decision Bead version excerpt; identity, Type, and revision are
omitted for brevity. These are recommended field names, not an adopted wire schema:

```json
{
  "properties": {
    "decision": "Use storage engine A"
  },
  "revisionProvenance": {
    "actor": {
      "id": "human:alice",
      "basis": "writer-supplied"
    },
    "committedAt": { "state": "present", "value": "2026-10-11T18:00:00Z" },
    "agent": { "state": "present", "value": "agent:research-assistant" },
    "message": { "state": "present", "value": "Record the storage decision" },
    "sources": [
      {
        "ref": {
          "uri": "https://example.org/project/beads/benchmark",
          "revision": "r17"
        },
        "rel": "evidence",
        "note": "Supplied the measurements used to choose the storage engine."
      }
    ],
    "sourcesCompleteness": "incomplete"
  }
}
```

Here Alice is the writer-supplied responsible actor, the research assistant is
the assisting agent, and benchmark R17 is the declared information source. This
does not say Alice authored the benchmark or that the server verified these
identities. During mapping from existing History, preserve explicit
absent/undetermined agent or
message states when present. Unknown legacy commit time uses the existing
`{ "state": "undetermined" }` representation.

For a native write authenticated as Alice, the service instead writes
`"actor": { "id": "human:alice", "basis": "authenticated" }` in this same
envelope. If a CI account submits the write, that account is the authenticated
revision actor even when the Activity's reported participant is Alice.

## Shared reference entries and optional relationship tags

Use the same entry shape for revision `sources` and Activity `artifacts`:
`{ ref, rel?, note? }`. Make activity artifacts a list, so one report can refer to
several inputs or outputs. The reference keeps ordinary URI/exact-pin semantics.

Recommend **`rel`**, an optional relationship tag describing how the referenced
item relates to the containing revision or activity. This follows the useful
[HTTP Link relation pattern](https://www.rfc-editor.org/rfc/rfc8288.html#section-2.1),
not the HTTP target `type` attribute. It is neither the referenced resource's Bead
Type nor a new graph Link Type. No graph edge or automatic target fetch is created.

Candidate short relations for discussion are `input`, `evidence`, `policy`,
`output`, and `related`; final names and their definitions need agreement.
For example, a revision source could carry `rel: evidence`, while a commit
produced by an activity could carry `rel: output`. A source remains information
used to produce the revision, so a known output-only relation does not belong in
its `sources` list. An Activity may legitimately have both inputs and outputs.
An omitted relation on a source means an unspecified input role; on an artifact,
it means unspecified association. The tag records a claim, not proof of support.

Allow agreed short names plus absolute URI extension relations. Preserve unknown
extension relations without guessing their meaning; do not require a registry
lookup or dereference to read the record. This borrows the extensibility pattern,
not the entire IANA relation vocabulary or HTTP header grammar. Relationship
extensions must still respect the containing field's meaning.

No run/session member or causality ID is added in this round. A run or other
causal input can be referenced through existing `sources` with an appropriate
extension `rel`, when it satisfies the field's meaning. Defining causal relation
vocabularies, cascading/transitive causality, or automatic propagation is deferred;
the presence of a relation alone requires none of those behaviors.

One shared shape does not make every Activity artifact a source of its subject
or of the Activity record. A CI report can be the source used to write an Activity
record while a resulting commit is the output of the reported activity.

Legacy `bd provenance --ref` values may be arbitrary strings, not Resource URIs.
Keep their spelling and optional `refKind` in an explicitly marked legacy artifact
entry during conversion; do not silently promote a SHA to a global Resource
identity. The compatibility extension is `{ legacyRef, refKind?, rel?, note? }`,
mutually exclusive with `ref`. New native entries use `ref`. Artifact kind (for
example `git-sha`) describes the identifier; relation describes its role. Existing
opaque references need this adapter even when their spelling resembles a URL.

## Saving, reading, and correcting

1. Save provenance as part of the same successful write as the resulting Bead
   or Link version. A failed write saves neither.
2. A saved version's provenance is immutable. A complete read of that version
   returns the provenance saved with it, subject to ordinary access rules.
3. Changing sources or their completeness creates a new Resource version, even
   if its content is unchanged. Grouping the fields does not change existing
   attribution/context no-op rules: actor, agent, or message alone still do not
   create a revision. Assign commit time only after deciding to mint a version;
   a new clock value must not turn an otherwise identical write into a change.
4. A source-list correction creates a new version. It does not edit the sources
   saved with an older version. An independently recorded activity, described
   below, may refer to an older version without changing that version's sources.
5. Preserve source references as recorded. A pin names an exact source revision;
   an unpinned reference identifies a source without claiming which revision
   was used. A source changing later never rewrites existing provenance.
6. References do not automatically become graph Links, fetch their targets,
   grant access, or guarantee that referenced content remains available.

For example, correcting R1's source A to source B creates R2. Reading R1 still
reports A; reading R2 reports B.

## What this does—and does not—claim

These are the author's recorded sources, not proof that the sources are true,
that the list is exhaustive, or that the decision was correct. An optional note
can say a source supplied evidence, imposed a requirement, or described a rejected
alternative. Optional relationship tags refine that explanation without requiring
every source to be classified; see the shared entry shape above.

Who changed the record and when remain distinct fields in the same envelope. The
decision's explanation can remain in its content. Approval, access policy,
automatic capture of agent inputs, and how a record entered a store are not
defined by this source list.

## Relationship to Memory Beads and existing BDP

This is intended to meet the source-recording portion of
[Memory Beads R3](https://github.com/gastownhall/beads/issues/5877): source
references, unknown versus empty sources, and declared completeness. It gives
that information a common location usable by other Bead Types and by Links.
It does not claim full Memory proposal conformance.

If adopted, the Memory proposal should map its derived-from and derivation
completeness fields to this member, rather than keep a second independently
editable copy. The Memory proposal's **Change Attribution** is the actor, time,
assisting agent, and message now housed in `revisionProvenance`; it is not an
additional field or competing mechanism.

**Inception** is that proposal's name for how a Memory first entered the system
(native creation, conversion, or import). That differs from who wrote its latest
revision: importing an old Memory today does not make today its original creation
or original revision time. This speclet introduces no new Inception field. A
future mapping may use an import Activity and appropriate source references;
meeting the Memory proposal's exact origin requirements still needs a separate
mapping, not a second copy of Change Attribution.

On a real write, resolve attribution for the new version and assign commit time
at the authority. Never copy the previous envelope wholesale: source carry-forward
must not credit the prior writer or preserve a stale time.

## Proposed activity records in BDP

An **Activity Bead** records a reported occurrence: for example, a CI service
reports that a commit landed for an Issue. It is an ordinary Bead with a proposed
well-known Activity Type, not a new core Resource kind. Its subject can be a
**Bead, Link, or external resource**. The Type identifier and wire spelling still
need selecting; the following is a proposed contract, not implemented behavior.

### What an activity contains

| Proposed field | Meaning |
| --- | --- |
| `subject` — required | A reference tagged as `bead`, `link`, or `external`. Bead and Link references may include an exact revision; external references are absolute URLs or URNs. |
| `kind` — required | What reportedly happened. Preserve today's `cut`, `claim`, `suspend`, `resume`, `handoff`, `commit`, `land`, and `used` meanings in the CLI mapping. Extension rules remain open. |
| `producer` — required | The reporting system; maps to today's `--source`. This is not a source of information used to author the subject. |
| `actor` — optional | Who reportedly performed the activity. This can differ from the attribution on the Activity Bead's own write. |
| `occurredAt` — optional | Caller/producer-supplied time when the activity reportedly happened. Never generated or defaulted by the server; omission means unknown. The Activity revision commit time separately records its write. |
| `artifacts` — optional list | Related inputs/outputs using the shared `{ ref, rel?, note? }` shape. Legacy opaque artifact references use the explicit compatibility entry described above. |
| `payload` — optional | Producer-supplied details. Preserve existing opaque payload strings without assuming they contain JSON. |

The Activity Bead also has ordinary Bead identity, a pinned Type reference,
revision, and `revisionProvenance`. Those describe the **record**, not proof of the
reported activity. Illustrative Type-specific properties for activity about a
Link revision:

```json
{
  "subject": {
    "kind": "link",
    "ref": {
      "uri": "https://example.org/project/links/approval",
      "revision": "r7"
    }
  },
  "kind": "used",
  "producer": "release-checker",
  "actor": "release-bot",
  "occurredAt": "2026-10-11T18:00:00Z",
  "artifacts": [
    { "ref": "https://ci.example.org/runs/123", "rel": "related" }
  ]
}
```

This says the producer reports using that approval Link revision, with the CI
run as a related artifact. It does not say the run was an input to the Link.

### Subjects, pins, and Scope boundaries

- **Bead or Link:** an unpinned reference means the resource generally. A pinned
  reference identifies the exact revision claimed. Late ingestion must not
  silently pin to the subject's current revision or derive a pin from a timestamp.
- **Local or another Scope:** preserve the reference and any supplied pin.
  Neither subject resolution nor proof of existence is required to record an
  Activity. The declared kind and revision are claims, not verified facts.
- **External resource:** a URL or URN can identify a document, repository, or
  other subject outside BDP. No BDP revision or lifecycle guarantees apply.

The subject is a **reference property**, not a normal graph Link endpoint.
Consequently a Link can be a subject without making Links valid graph endpoints.
These references do not create incident graph Links or automatic traversal edges.
Activity records belong to their storing Scope; referencing a subject does not
grant access to it or authority to change it.

### Recording a report does not require resolving its subject

Validate the Activity's shape and reference syntax, and authorize the write to
its storing Scope. Reading the subject is not a prerequisite. Acceptance records
what the writer reported; it does not certify that the subject exists, has the
claimed kind, or was seen by the writer, or that the activity happened. Even a
successful lookup would not establish those last two claims.

| Activity subject at admission | Proposed result, absent stricter declared policy |
| --- | --- |
| Retained revision of a deleted Bead or Link | Accept the supplied reference. Authorized History may resolve retained content or the terminal deleted state. |
| Deleted local identity, with or without a pin | Accept; preserve the pin or its absence. No existence evidence is required. |
| Pruned or erased revision | Accept the exact pin. A later read may be unavailable or gone; never substitute latest content. |
| Local identity or revision that never existed | Accept as a report, not a verified fact. No special import path is required. |
| Subject hidden by permissions, remote, or unavailable during an outage | Accept without requiring a lookup or subject read permission. Grant no additional access. |
| Malformed reference or unauthorized Activity write | Reject independently of subject existence. |

A Scope or application may declare stricter constraints, including reliable local
kind or typo checks. Such constraints are additional policy, not a universal
provenance requirement; an external tag must not bypass an applicable local rule.
Recording Activities requires no retained subject-existence index, verification
flag, or background verification pass. Later reads retain their own authorization
and retention rules; a 404 must not be treated as proof of never-existence.

> **Sidebar — late reports and decision sources make different promises.**
> A CI report can arrive today about work completed before its subject was
> deleted. Accepting that report preserves work history; it does not say the
> reporting service read the subject's old content today. A new decision citing
> an unavailable old revision as evidence raises a different question. These
> Activity admission rules do not relax revision-source validation or Memory
> write-time requirements. In particular, reconcile Memory R19 separately;
> a gone-with-reason result is consistent with R16, not an exception to every
> write-time check. Source omission on update preserves the existing list and
> completeness, but does not prove the writer reread those sources. In either
> mechanism, preserve exact pins and never substitute current content.

### Recording and finding activities

Under this proposal, `bd provenance record` would create an Activity Bead whose subject
is Issue I, kind is `land`, and artifact is commit C. **I gets no new revision.**
If the producer knows the relevant I revision, it may supply a pin; otherwise
the subject stays unpinned. The report may arrive after I has changed.

Where the BDP profile supports Events, this write produces the ordinary
`created` Event for the **Activity Bead**. It does not introduce a BDP `land`
Event or assert that the BDP server witnessed a landing. Existing BDP Events
describe committed graph changes, while the Activity Type describes reported
work. See [BDP Events](https://github.com/gastownhall/bdp/blob/182f1fcf8a01d896976bff3c9e3fb87c596c6ca6/docs/specs/bdp.md#L1701).

`log` finds Activity Beads by subject identity, optionally filtered by kind;
an identity query includes both pinned and unpinned reports about that subject.
An explicit exact-revision filter matches only that pin, excluding unpinned
reports. `by-ref` matches any artifact entry as defined in the CLI section. Index subject
identity/revision, kind, occurrence time, and artifact reference so these queries
do not require scanning every Bead or its history. Query spelling, paging, and
ordering are proposed in the CLI strawman below; indexes are a storage choice.

For a compatible CLI adapter, retries must preserve today's durable duplicate
handling: the same event identity produces one Activity Bead, and a retry with
changed actor or payload does not overwrite the first record. Ordinary Bead
no-op rules alone do not supply this guarantee. The adapter must also preserve
current reference validation and the requirement for an occurrence time when
no artifact reference is supplied. BDP identity and atomic create behavior must
be mapped to the existing deduplication key before claiming compatibility.

### Decisions and acceptance cases

**Selected direction:** Activity Beads use ordinary create/update/delete. A
correction creates a new Activity revision; deletion removes it from live queries
and leaves the proposed terminal revision described below. This deliberately
extends today's append-only command surface. A retry of `record` is still a
create retry, never an implicit correction or resurrection of a deleted Activity.

Deleting the activity's subject is a different operation. Today's Issue deletion
cascades to its activity rows. **Retain Activity Beads by default when their
subject is deleted.** They have independent lifetimes and remain queryable under
their own authorization and retention policy. A subject reference grants no
access and must not accidentally make a retained report public.

An explicit cascade option may delete selected Activity Beads through ordinary
Activity deletion, including terminal revisions. Its scope, authorization and
atomicity must be defined before it is offered; it is not an implicit recursive
deletion rule. Normal subject deletion is neither Activity deletion nor erasure.
Separate erasure/retention policies still apply to content, history and indexes.
The default is selected for this proposal; concrete access rules and the optional
cascade interface remain implementation gates.

| Acceptance case | Required result under this proposal |
| --- | --- |
| CI reports a landing after the Issue changed | One Activity Bead; no Issue revision; event time distinct from recording time |
| Producer retries the same event with changed payload | No second record and no overwrite of the first report |
| Report identifies a local Link at revision R7 | Preserve the Link pin; no Link revision or new graph endpoint capability |
| Report names an unavailable remote Bead or an external URL | Accept under the base contract; preserve the reference, with no fetch, verification, or access grant |
| Query by subject identity versus exact revision | Identity includes all reports about that resource; exact revision excludes unknown/unpinned reports |
| A supported Event stream reports the write | `created` identifies the Activity Bead, not an update to its subject |
| Delete an Issue that has activity records | Retain Activity Beads by default; live subject GET is 404 while authorized activity queries still find the reports |
| Late report names a deleted local subject, with or without a pin | Accept without requiring existence evidence; preserve the supplied pin or lack of pin |
| Report pins a pruned revision with no surviving existence evidence | Accept; later resolution may be unavailable or gone, never current content |
| Report names a nonexistent identity or revision | Accept as a claim under the base contract; a stricter declared policy may reject |
| Reporter cannot read the subject but can write Activities | Accept a well-formed report; do not disclose hidden subject information |
| Reference is malformed, or reporter cannot write Activities | Reject; no subject lookup is needed |
| Explicit cascade is requested | Delete only its authorized, defined selection under declared atomicity; no undeclared recursive cascade |

BDP owns the Activity Type's shared field meanings and reference/query semantics.
Beads owns the command adapter, indexes, deduplication implementation, and
operator policy within those semantics. The Activity Type, subject expansion,
and adapter are **PROPOSED / NYI**; today's Issue event log is **EXISTING**.

## Source-member decisions and remaining choices

- **Source defaults — selected for this proposal:** preserve source list and
  completeness on update omission; create/delete omission means unknown.
  Carry-forward does not prove a new source read. The BDP wire encoding for
  omission versus an explicit reset to unknown remains to specify.
- **Exact source versions:** allow both pinned and unpinned references, as Memory
  R3 does, or require pins for Bead/Link sources? The draft above allows both and
  states their different promises.
- **Revision-source checks:** decide local and cross-Scope validation without
  making the write depend on a live external fetch. Activity subjects use the
  independent admission rule above; ordinary Link constraints are unchanged.
- **Compatibility:** adopt or revise the recommended names, then define negotiated
  write/read forms and mapping for history, exports, and applicable Event records.
  Legacy `bd provenance` events cannot be assigned subject revisions
  by guesswork; any conversion needs a separate explicit policy.

## BDP and CLI alignment plan

1. Adopt one shared `revisionProvenance` contract in BDP's specification and
   schemas, including reference, absence, write-input, and no-op rules. Update
   matching examples and conformance cases together.
2. Map the graph CLI and its JSON output to that same contract, rather than
   preserving a separate CLI attribution schema. Friendly display labels may
   differ; actor/time/source meanings may not. Stored columns need not mirror
   the public object's nesting.
3. Define a versioned or negotiated compatibility boundary for existing clients.
   Read legacy shapes through explicit adapters; write one canonical shape for
   the selected contract. Do not expose independently editable copies of
   `attribution`, `changeContext`, and `revisionProvenance`. Reject conflicting
   duplicate inputs instead of guessing precedence. Preserve original historical
   records; no migration silently rewrites a retained revision or fabricates facts.
4. Map legacy Issue `created_at`/`created_by` and `updated_at` only under their
   actual meanings. Creation information is not automatically the latest version's
   attribution, and a legacy update time is not automatically a proven commit time.
5. Describe today's `bd provenance` as activity provenance. Keep existing commands
   working; selecting a clearer future command name or alias is a separate CLI
   decision. Map its records to Activity Beads only after the activity compatibility
   decisions above are resolved.

This is a **PROPOSED / NYI** alignment plan. This draft changes no canonical schema,
CLI output, storage, or historical records. Cross-profile transport changes and
migration require their own implementation/review pass after product decisions.

## Acceptance examples

- A Bead and a Link can each save and return provenance through the same member.
- An old record without provenance reads as unknown, not as a complete empty list.
- An explicit empty list remains distinguishable from unknown sources.
- Correcting only a source or completeness creates a new version; the old version
  and its provenance remain unchanged. An identical write creates no version.
- Updating a referenced source does not change either saved version's reference.
- A failed combined content/provenance write publishes neither change.
- BDP and graph CLI return the same actor/time/source structure for a new version.
- An actor/message-only no-op creates no version or fresh timestamp; a source-only
  change creates a version with that write's attribution and commit time.
- Missing imported actor or time stays unknown; import time is not substituted.
- A service authenticated as Alice derives actor Alice with basis `authenticated`;
  no caller field is accepted as proof of authentication.
- A caller supplies authenticated basis, a conflicting actor, or suppression in
  service-attribution mode: reject before mutation. Local defaults remain
  writer-supplied; they cannot forge or suppress service-derived attribution.
- A service account records work reportedly performed by Alice: authenticate the
  service account as revision writer, not Alice as participant or delegated human.
- An authenticated import does not upgrade original historical attribution.
- Legacy adapters preserve known values and reject contradictory old/new inputs.
- An Activity can name Alice as participant and an importer as record writer;
  activity time and record commit time retain their different meanings.

BDP owns these shared meanings. Beads owns CLI spelling and storage realization.
The open choices above need resolution before this becomes an implementable
contract. Background: [proposal and product comparison](memory-provenance-governance-review-20261011.md).

## Deletion and ordering foundations for the CLI strawman

**Deletion recommendation:** an ordinary delete atomically creates a terminal
history revision containing `revisionProvenance`, the deleted identity, and its
last live revision, while removing the resource from the live graph. The terminal
revision contains no live properties or endpoints. Ordinary GET returns 404;
authorized history enumeration includes the deletion entry, and retained earlier
live revisions remain available under normal History rules. Delete provenance
sources explain the deletion, not the content of the last live revision.

This changes current BDP's rule that deletion mints no revision. The amended
contract must specify terminal-history row shape, exact-reference resolution to
a terminal revision (a typed deleted-state result, never the previous live body),
Event/receipt/replication representation, and interaction with pruning and erasure.
Do not represent a projection-only disappearance as a deletion. Existing live
Link safety and concurrency checks still apply. A failed delete saves no terminal
revision; a retry under the same retained idempotency key creates no second one.
Deletion of an owned Link can also version its source; all effects and provenance
must remain atomic under the applicable operation contract.

**Ordering recommendation:** timestamps describe time; they do not provide a
reliable replay position. Transactional BDP's Scope epoch, ordered change groups,
and stable Event ordinals provide commit order and resumable cursors. A late
Activity appears at its newly committed position even if `occurredAt` is old.
Activity corrections and deletions are later transitions in that stream. Never
sort opaque Scope-position strings or use an occurrence-time watermark for replay.

A display can sort by occurrence time with stable identity tie-breaking and
unknown times last. Snapshot pagination must remain stable across concurrent
writes. Reliable follow/replay requires an advertised ordered-stream capability;
we do not add that guarantee to lower profiles by inventing timestamps. Ordering
is per Scope epoch; a multi-Scope aggregation must identify its own ordering
contract. Expired cursors or epoch changes require an explicit resnapshot/restart,
not a silent claim that no changes were missed.

## CLI strawman — proposed, not implemented

These options apply to create/update/delete of both Beads and Links, through
whatever command routes select those resources. Examples use the ordinary Bead
verbs; equivalent Link writes must share the same option parser and semantics.
Existing selectors, revision guards, dry-run behavior, and deletion confirmation
remain in force. Unsupported backends must reject requested provenance features
before a write, never silently discard them.

### What exists today

Source check October 11: upstream main `7477ec13`, graph preview integration
`72cd9dc3`, and BDP main `182f1fcf`, freshly rechecked. The preview's global
[`--actor`](https://github.com/donnabox/beads/blob/72cd9dc3c7a2304f15dbe5d3e880d903cf077a35/cmd/bd/main.go#L935)
is inherited by ordinary mutations and defaults from `BEADS_ACTOR`, Git user
name, then the OS user. No common actor-basis/source-list/change-message flags
are registered for all three lifecycle verbs in the inspected source.

There are two important spelling collisions:

- [`--message` / `-m`](https://github.com/donnabox/beads/blob/72cd9dc3c7a2304f15dbe5d3e880d903cf077a35/cmd/bd/flags.go#L11)
  already aliases the Issue description on create/update. Other commands also use
  it for different purposes. The proposed lifecycle contract intentionally removes
  the description alias: use `--description` or `--body` for content.
- [`bd provenance record --actor`](https://github.com/donnabox/beads/blob/72cd9dc3c7a2304f15dbe5d3e880d903cf077a35/cmd/bd/provenance.go#L190)
  is a local flag for the activity's actor, and `--source` names its producer.
  Both collisions require explicit migration in the proposed CLI contract.

### Common revision-provenance options

| Proposed option, on create/update/delete | Meaning |
| --- | --- |
| `--actor ID` | Supply the revision actor consistently on create/update/delete and the Activity wrapper. Retain configured defaults for backends without service-derived attribution; explicit conflict with the service-derived actor is an error. |
| `--actor-basis writer-supplied\|unknown` | Qualify caller-supplied attribution; default `writer-supplied`. No caller-selectable authenticated value. Service-derived output follows the authentication rules above. |
| `--no-actor` | Suppress local actor defaulting; mutually exclusive with explicit actor or basis. Cannot suppress service-derived attribution: reject in that mode. |
| `--message TEXT` | Set the optional revision message, distinct from content/description or backend commit messages. An explicit empty string is a known empty message. |
| `--assisting-agent ID` | Record an optional assisting agent, distinct from the responsible actor. Do not infer it from login identity. |
| `--sources JSON`, `--sources @FILE`, or `--sources -` | Supply the entire source-entry array inline, from a UTF-8 JSON file, or stdin. Replaces the source list; no comma-splitting of URLs and no implicit append. |
| `--sources-unknown` | Explicitly reset source knowledge to unknown; excludes `--sources` and any non-unknown completeness value. |
| `--sources-completeness complete\|incomplete\|unknown` | Declare completeness of the source list. Reject complete/incomplete when the resulting sources are unknown. |

Only one input may consume stdin, and only one `--sources` option is allowed.
Reject empty explicit actor/agent IDs and actor-basis without a resolved actor.
For service-derived attribution, omit automatic local actor defaults and let the
service supply the actor. An explicit matching ID does not authenticate it; the
service derives the output independently. A basis option requesting preservation
of `unknown` or `writer-supplied` attribution conflicts with mandatory service
derivation and must be rejected, not silently relabeled.
Each source entry has `ref` and optional `rel` and `note`, using the same reference grammar
as BDP. A plain URI is unpinned; `{ "uri": "…", "revision": "…" }` pins exactly.
Do not resolve unpinned sources to latest silently. CLI-local identity shorthand,
if supported, must expand through the normal reference resolver without guessing
revisions. The exact JSON form supports notes and pins without extra flag syntax.

All caller-provided values travel in the operation's proposed
`revisionProvenance` input, with explicit absence/unknown intent preserved.
`committedAt` is output-only for ordinary lifecycle writes; reject attempts to
set it through a generic JSON write as well as flags. Imports remain a separately
specified path and may not backdate native writes. Actor/message/agent describe
this write: omission must never copy them from the previous revision. Omitted
agent/message means undetermined; actor is resolved afresh by the applicable
service or local attribution mode, never inherited.

| Source input | Create | Update | Delete |
| --- | --- | --- | --- |
| Omitted | Unknown | Preserve previous sources and completeness | Unknown; never inherit reasons from the deleted content |
| `--sources '[]'` | Known empty list | Replace with known empty list | Explicitly no information sources declared for deletion |
| Nonempty `--sources` | Save list | Replace list | Save deletion's sources on terminal revision |
| `--sources-unknown` | Unknown | Reset to unknown | Unknown |

A replacement source list defaults its completeness to unknown unless supplied;
a preserved list preserves completeness unless explicitly changed. Completeness
alone may change a known existing list on update. An explicit empty list does
not imply complete. These omission defaults are selected for this proposal;
the exact BDP input/reset encoding remains to specify.

Source-only changes mint a revision. Actor/message/agent-only submissions retain
the existing no-op rule; the CLI must report that no revision was created and
that those supplied values were not recorded. It must not imply that a message
was saved on a no-op. Failed validation, revision guards, or writes save neither
content nor provenance. For batch operations apply metadata only to actual
successful transitions, preserving the batch's advertised atomicity boundary.

Example source file `sources.json`:

```json
[
  {
    "ref": { "uri": "https://example.org/project/beads/benchmark", "revision": "r17" },
    "rel": "evidence",
    "note": "Measurements supporting this decision"
  }
]
```

Illustrative commands; the flags are proposed:

```sh
bd create "Choose storage engine" --actor human:alice \
  --assisting-agent agent:research-assistant \
  --message "Record the decision" \
  --sources @sources.json --sources-completeness incomplete
bd update DECISION_ID --sources @sources.json \
  --message "Correct the supporting sources"
bd delete DECISION_ID --if-revision R2 --force \
  --sources '[{"ref":"https://example.org/policies/retention"}]' \
  --message "Remove under retention policy"
```

The delete example is logical deletion, not an erasure request. JSON output for
an actual deletion should return a discriminated terminal-history record with
its new revision and revision provenance; ordinary GET still returns 404.

### Message naming, omission, and compatibility

Recommend **`--message`** for the short explanation attached to this revision.
The name comes from BDP History/Memory's change-message requirement and the
familiar commit-message convention, not a need for another discussion system.
`comment` would also be understandable prose, but Beads already has separate
comments on Issues; avoid implying that this option creates one of those.
If `comment` is selected later, rename field/flag consistently rather than keep
multiple names for the same thing.

No `--no-message` or `--no-agent` family is needed in the everyday CLI: neither
message nor agent defaults or inherits from the previous revision. Omission
means no value was supplied for this write; `--message ''` is an explicitly empty
message. Keep existing known-absent versus undetermined states losslessly in
History/import/structured inputs, without dedicated negative flags. This is a CLI
simplification, not permission to erase those distinctions from saved records.
`--no-actor` disables the local automatic actor default; it cannot disable
authenticated attribution supplied by a service.

Reusing `--message` and making wrapper `--actor` consistent are deliberate breaking
changes from the inspected legacy meanings. Cut them over at an explicit CLI
contract/version boundary with migration notes and updated help/examples: old
create/update `--message` content becomes `--description`; old `record --actor`
becomes `--activity-actor`. Do not infer intended meaning from argument contents or
silently accept both interpretations. Output adapters alone cannot solve a flag
meaning change. No implementation ships before that compatibility choice is made.

### `bd provenance record` is an Activity-create convenience command

The command invokes ordinary create with the Activity Type, adding validation
and retry handling beyond a bare unkeyed create.

| Wrapper option | Activity content or revision metadata |
| --- | --- |
| `--subject REF --subject-kind bead\|link\|external` | Activity subject; preserve an explicit pin. Existing `--issue ID` is a shorthand for an unpinned Issue subject; reject conflicting forms. |
| `--kind KIND` | Activity kind |
| `--producer NAME` | Activity producer; preserve `--source` as an alias and reject contradictory values |
| `--activity-actor ID` | Activity participant; replaces this command's former local `--actor` meaning in the new contract |
| `--artifacts JSON\|@FILE\|-` | Activity reference-entry list; same input conventions as `--sources`, different content role. Mutually exclusive with legacy `--ref` / `--ref-kind`. |
| `--ref`, `--ref-kind`, `--at`, `--payload` | Legacy artifact shorthand, caller-supplied occurrence time, and opaque payload. The legacy pair creates one `legacyRef` entry. |
| Common revision-provenance options above | Provenance of creating the Activity record, including any information sources used to write the report |

In the proposed contract, **`--actor` always names the record writer**, including
this wrapper. `--activity-actor` names the participant. Do not retain the old local
`--actor` meaning as an ambiguous alias. `--actor-basis` and `--no-actor` apply only
to revision attribution. `--at` is supplied by a human or automated producer;
there is no server or CLI fallback to now when it is omitted.

```sh
bd provenance record --issue ISSUE_ID --kind land --producer ci \
  --activity-actor human:alice --actor svc:ci-reporter \
  --ref 0123456789abcdef0123456789abcdef01234567 --ref-kind git-sha \
  --at 2026-10-11T18:00:00Z --sources @sources.json \
  --message "Record CI landing report"
```

Return the Activity identity and revision so ordinary `bd update` and `bd delete`
can correct or delete it. Those operations target the Activity ID, never its
subject. Native Activity creation and this wrapper must share the Type schema,
validation, authorization, and provenance semantics.

Preserve legacy deterministic event identity for legacy inputs through a durable
create-idempotency mapping; define a canonical key for new subject forms and
multi-artifact records before implementation. Never choose the first artifact as
a guessed retry identity. A duplicate `record` is not an update: changed actor, payload,
or revision metadata must not overwrite the original. Return an explicit
already-recorded disposition. If the Activity has since changed or been deleted,
a replay must not recreate it or claim the original creation is its current
state. Retry retention/expiry must be specified before claiming parity with the
existing log. Ordinary creates without an equivalent idempotency key are not
promised this deduplication behavior.

### `log` and `by-ref`: explicit modes, activity-only by default

Recommend `--mode activity|revision|all` on both commands. Omission retains
**activity-only** meaning; do not silently mix two different kinds of result.

| Command | `activity` | `revision` |
| --- | --- | --- |
| `bd provenance log SUBJECT` | Current live Activity reports about that subject; identity includes both pinned and unpinned subjects | Retained revisions of that subject, including terminal deletion entries, with their revision provenance |
| `bd provenance by-ref REF` | Activity reports with a matching entry in `artifacts` | Retained resource revisions whose `revisionProvenance.sources` reference the supplied resource |

For revision `by-ref`, an unpinned reference matches the source identity across
pinned and unpinned citations; a pinned reference matches only that exact pin.
The activity branch uses exact reference equality for native entries (including
any supplied pin), and exact opaque string equality for `legacyRef`. A matching
legacy string remains labeled legacy even if it resembles a URI. Reject a raw
artifact value that is not a valid Resource reference in revision/all mode,
rather than guess a URI. Neither branch automatically searches actors, producers,
subjects, or message text. `--kind` remains an activity filter and is rejected in
revision mode; in all mode it narrows only the activity branch.

An optional `--subject-revision REV` narrows `log`: activity mode includes only
that exact subject pin, excluding unpinned reports; revision mode selects that
revision. In all mode apply each rule to its branch. Neither query recursively
includes the revision history of every matching Activity unless those Activity
identities are themselves selected as subjects.

Emit each Activity identity or resource/revision pair once per result branch;
multiple matching source entries are included as match details on that row.

`--mode all` combines the two sets with explicit row discriminators (`activity`
or `revision`), subject identity, exact revision where applicable, and labeled
times. Human output labels rows; machine output uses distinct schemas. It must
not imply that artifact association and source citation are the same relation.
For activity rows expose the latest Activity revision and its own revision
provenance; that is metadata on one result, not an additional revision-mode row.
Preserve existing default JSON output through the compatibility adapter until a
versioned output change is selected; opt-in modes use the new result envelope.

```sh
bd provenance log ISSUE_ID
bd provenance log ISSUE_ID --mode revision
bd provenance log ISSUE_ID --mode all
bd provenance by-ref https://example.org/reports/benchmark --mode all
```

**Display versus following changes:** activity mode defaults to occurrence time,
unknown last, then stable Activity identity. Recommend `--order recorded` for
activity creation order, unaffected by later edits, using authority order rather
than sorting timestamps. Revision mode orders by revision commit order; all mode
uses the same Scope order, Activity rows placed at their original creation and
revision rows at their own commits. An incompatible `--order occurred` with
revision/all is an error. Returned rows still show actual timestamps for people.
All pageable modes use one stable authorized snapshot and opaque continuation
cursors. If the backend cannot supply the requested ordering/snapshot guarantee,
it must report unsupported rather than silently fall back to timestamp order.

A future `--follow --after CURSOR` consumes committed transitions, not repeated
sorting of the current Activity list. Initially constrain follow to activity mode
with `--order recorded` and the advertised ordered-stream capability. It includes
Activity create/update/delete transitions and their exact revisions, including
late reports at their newly committed positions. A correction that enters or
leaves a subject/artifact filter needs an explicit added/changed/removed result;
disappearance from a filtered projection must not falsely claim deletion. Deletes
must be matchable from retained prior index state without fetching a now-404
body. Cursor scope/filter/auth bindings, expiry and resnapshot behavior are part
of this feature's contract. Reliable following is NYI, not a timestamp shortcut.

History modes and reverse indexes obey retained-history authorization and erasure;
no index may disclose a revision the caller cannot read. Return the applicable
retention/completeness information, not an implication of an all-time complete
log. Subject deletion retains Activity Beads by default; explicit Activity
deletion, including any defined cascade selection, follows terminal-revision rules.

### CLI acceptance and readiness

| Case | Required result |
| --- | --- |
| Create/update/delete a Bead or Link with sources, actor basis and message | All supplied fields reach that operation's resulting revision or terminal entry; no silent drops |
| Update omits sources; delete omits sources | Update preserves source knowledge; delete records unknown deletion sources |
| Explicit empty sources versus unknown sources | Remain distinct through flags, JSON output, BDP and retained reads |
| Two flags request stdin, conflicting value/default-suppression flags, invalid basis, or client commit time | Fail before mutation |
| Activity performed by Alice, recorded by CI | Separate activity participant and revision actor; no flag shadowing changes their meaning |
| Actor supplied with no basis flag to a backend without service derivation | Record `basis: writer-supplied`; never infer authentication from the flag |
| Authenticated service supplies the actor; caller omits actor | Save the service-derived identity and authenticated basis; no local default overrides it |
| Caller requests authenticated basis, conflicting actor/basis, or `--no-actor` against service derivation | Reject before mutation; neither spoof nor suppress authenticated attribution |
| Omitted activity occurrence time | Remains unknown, or fails the applicable required-time rule; never defaults to server time |
| Message and agent omitted on an update | No copied prior values and no negative flags required |
| Revision cites evidence; Activity identifies an output | Shared entry shape preserves their different roles; optional unknown extension relations round-trip |
| Legacy opaque artifact reference | Survives in a labeled compatibility entry; never becomes a guessed global URI |
| Retry Activity creation after later correction/deletion | No overwrite or resurrection; report retained original disposition or explicit retry expiry |
| Ordinary update/delete of an Activity | New Activity revision/terminal entry; subject content unchanged |
| Ordinary GET after resource deletion | 404; authorized provenance revision mode can show the terminal entry |
| Late Activity, identical timestamps, correction, deletion during pagination | Snapshot pages stay stable; ordered follow observes every visible transition or an explicit gap/expiry |
| Default `log` / `by-ref` versus `--mode all` | Defaults retain activity meaning; all-mode rows identify which relation matched |
| Backend lacks History or reliable stream/index support | Explicit unsupported capability, never misleading empty results or fake timestamp ordering |

**EXISTING:** inherited actor option, Activity-log record/log/by-ref and its retry
rules, preview actor/time metadata. **PROPOSED / NYI:** common provenance flags,
unified output shape, service-derived authenticated actors, Activity wrapper
backed by Beads, ordinary Activity edits,
terminal revisions, revision/all queries and ordered follow. Before implementation,
settle the BDP terminal-history amendment, compatibility/output version, Activity
access/retention and optional cascade details, retry mapping/retention and query
capability declarations. Retaining activities on subject deletion is the proposed default.

## Appendix A: relationship to today's `bd provenance`

Today's commands answer **“What happened around this Issue, and which artifacts
were involved?”** The proposed Activity Beads carry that meaning into BDP. The
source portion of `revisionProvenance` answers **“What information was this particular
Bead or Link version based on?”** Both are useful provenance, but they record
different things.

### Existing commands

| Command | Current meaning |
| --- | --- |
| `bd provenance record --issue <id> --kind <kind> --source <producer>` | Append an event about an Issue; optional flags record an actor, artifact reference, event time and payload |
| `bd provenance log <issue-id>` | List the Issue's recorded events; `--kind` can filter them |
| `bd provenance by-ref <ref>` | Find events carrying that exact artifact reference |

Event kinds include `claim`, `handoff`, `commit`, `land`, and `used`. References
can identify artifacts such as a Git commit, pull request, transcript, or branch.
The log accepts events recorded after they happened. It has no individual-event
update or retraction command; repeating an event's identifying combination is a
no-op, even if its actor or payload has changed.

### Where the meanings differ

| **EXISTING — `bd provenance` event log** | **PROPOSED — per-version source information** |
| --- | --- |
| Subject is an Issue ID, without a subject revision | Subject is the containing Bead or Link version |
| `--source` names the event producer, such as an orchestrator | A source entry identifies information used to produce the content |
| `--actor` describes the event's actor | Revision attribution describes responsibility for the saved version |
| `--at` describes when the event happened; ingest time is recorded separately | Existing revision time describes when the version was recorded |
| Events accumulate independently of Issue edits | Source information is saved with a version; corrections create a new version |
| Deleting the Issue removes its event rows | Provenance is part of its version and follows that version's retention/access rules |

For example, a `used` event connecting Issue I to report A is useful evidence of
recorded use. It does not identify which revision of I used A, establish that A
supported the conclusion, or establish that the source list was complete. A
`commit` event may identify an output of the work rather than an input. Event
timestamps and Git SHAs must not be mistaken for Bead revision identifiers.

Neither the existing events nor the proposed source list is an attestation:
recording an actor or reference does not authenticate or verify the claim.

### Can the proposal replace the existing feature efficiently?

**The per-version source member alone cannot.** The existing feature records work
activity and artifact relationships that need not change the Issue. The proposed member
records the sources of a saved version. A source list alone does not preserve
the existing event kinds, producer, event time, ingest time, payload, retry
identity, or event-log queries.

| Existing requirement | Fit with the proposed source member alone |
| --- | --- |
| Record a commit, handoff, or landing without editing the Issue | **Not met:** changing the member creates a Resource version |
| Record something later, with its original event time | **Not met:** revision time is not event time; separate event details are needed |
| Retry a producer's event without duplicating it | **Not met:** identical-state no-op handling is not durable event deduplication |
| List events by Issue/kind or find them by artifact reference | **Not met:** source retrieval is a different query; it does not reconstruct the event log |
| Record exact input sources with a new version | **Met by the proposal:** save them with that version |

For example, CI can report commit C landing for Issue I after I changes, without
rewriting I or guessing its relevant revision. Forcing that report into I's
sources would create contention with Issue edits and attribute the new revision
to the reporter. Embedding an accumulating event list also enlarges logical
records; distributing events across revisions instead requires historical
queries. Storage deduplication does not remove those semantic costs. No
performance equivalence has been measured.

**Recommendation:** preserve the activity-log behavior, using the Activity Bead
design above as its proposed BDP representation, and add the source member for
version-specific inputs. They can share
storage infrastructure and reference utilities without sharing one record shape.
If reverse lookup of version sources is required, maintain a derived index keyed
by source reference and subject revision as versions are saved and removed,
rather than scan all historical bodies on every query. That index is an
implementation option, not a second authoritative source list.

Existing indexes cover Issue/event time, artifact reference and event kind;
the record path handles duplicate delivery. Preserve those capabilities, with
migration, access/retention and retry policy settled before replacing storage.
Source inspection does not establish deployed usage frequency or performance.

### Proposed compatibility approach

Keep the current commands' event-log meaning while this proposal is evaluated.
Do not silently redefine `record` as an edit of the latest version, or redefine
`log` and `by-ref` to mix event records with version source lists. This appendix
does not select a new CLI spelling or deprecate an existing command.

Existing event rows can map to Activity Beads with unpinned Issue subjects;
preserve their actor, producer, artifact, payload, and known event/ingest times.
Import rules must distinguish original recording time from the new import time.
Do not automatically convert old events into source provenance for an arbitrary
revision. That conversion would need a reliable subject-version mapping
and a stated interpretation of the event. Preserve unknown information where
that evidence is absent. A user could instead make a new version with an explicit
source declaration, but that would be a new declaration, not recovered history.

Source check: released v1.3.1 at `c1c4b642` and upstream main at `7477ec13`,
rechecked October 11; the relevant command/storage behavior is unchanged.
See the [command definitions](https://github.com/gastownhall/beads/blob/c1c4b642ac1c08d8c828007a1c2f96e47e43ef7c/cmd/bd/provenance.go),
[event storage and retry behavior](https://github.com/gastownhall/beads/blob/c1c4b642ac1c08d8c828007a1c2f96e47e43ef7c/internal/storage/issueops/provenance.go),
and [event schema](https://github.com/gastownhall/beads/blob/c1c4b642ac1c08d8c828007a1c2f96e47e43ef7c/internal/storage/schema/migrations/0063_create_provenance_events.up.sql).
