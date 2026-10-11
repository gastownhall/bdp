# Proposal: revision sources and activity records

Status: discussion draft, October 11, 2026. Not an adopted BDP amendment or an
implementation commitment.

## Purpose

Let someone answer: **“What information did the author say this version was
based on?”** Save that information with the version, alongside who changed it
and when. The same mechanism applies to Beads and Links.

Also let someone answer **“What happened around this resource?”** Record that
activity independently, so reporting a commit or a use of information does not
require editing the subject. These two questions need different record shapes.

## How this relates to actor and date

We already save part of a version's story. This proposal adds its sources:

| Status | Information | Question it answers |
| --- | --- | --- |
| **EXISTING** | Actor / attribution | Who is recorded as responsible for this version? |
| **EXISTING** | Revision time / change context | When was this version recorded, and what change context is available? |
| **PROPOSED** | Sources and completeness | What information does the author say it was based on, and how complete is that list? |

Together these are **provenance information**: the recorded account of how this
version came about. Sources are one part of provenance; actor and date are other
parts. We do not need duplicate actor/date fields or a second history system.
The resource's original creation date and a particular revision's recording date
answer different questions; existing timestamp meanings stay unchanged.

Being saved together does not give every field the same assurance. A server may
observe the write time while merely carrying an actor name and source list
supplied by the writer. Preserve those differences, including unknown values.

## Provenance versus attestation

**Provenance says what is recorded about how something came about. An attestation
is a statement someone explicitly stands behind.** An attestation can be about
provenance; the words do not name competing places to store the same information.

For this protocol, reserve **attestation** for a statement with a verifiable
issuer and a defined claim about a specific subject. A signature is one possible
mechanism; this proposal introduces no signing or attestation mechanism. The
issuer may differ from the actor credited with producing the version.

For example, “Alice is listed as the author; report A is listed as a source” is
recorded provenance. “Service S attests that it accepted these exact bytes from
authenticated account Alice” is a narrower, checkable statement. It does not
establish that Alice actually consulted A or that A supports the conclusion.
Verifying who issued a statement does not prove that its contents are true.

Use **attribution** for the existing actor information, **source provenance** for
the new source information, and **provenance** for the broader story. Ordinary
stored values remain recorded claims; do not call them attested merely because
they have an actor, timestamp, or immutable revision.

This usage follows the broad provenance model in
[W3C PROV](https://www.w3.org/TR/prov-dm/) and the authenticated-statement use of
attestation in [SLSA](https://slsa.dev/spec/v1.2/attestation-model). It is a naming
recommendation for this proposal, not a claim that every field uses identical
terminology or requires cryptographic signatures.

## Proposed information

Each version may carry a common `provenance` member, outside its Type-specific
properties. That working field name holds only the **source** part described
above; `sourceProvenance` is an alternative to consider when choosing wire names.
It records:

- **Sources:** references to the information used. A source may be a Bead, a
  Link, or an external resource identified by a URL or URN. A reference may
  identify an exact source revision. An optional note explains how it mattered.
- **Completeness:** `complete`, `incomplete`, or `unknown`, as declared by the
  author. Missing completeness means `unknown`, never `complete`.

An absent source list means the sources are unknown. An explicitly empty list
means the author deliberately records no sources and asserts the content
directly. These states are different. If sources are unknown, completeness is
also unknown. Older records without provenance remain unknown; readers do not
invent sources or authorship.

Illustrative spelling, not a final wire schema:

```json
{
  "provenance": {
    "sources": [
      {
        "ref": {
          "uri": "https://example.org/project/beads/benchmark",
          "revision": "r17"
        },
        "note": "Supplied the measurements used to choose the storage engine."
      }
    ],
    "completeness": "incomplete"
  }
}
```

The containing record already identifies the subject and its version. No
separate subject reference, provenance identity, or graph Link is required.

## Saving, reading, and correcting

1. Save provenance as part of the same successful write as the resulting Bead
   or Link version. A failed write saves neither.
2. A saved version's provenance is immutable. A complete read of that version
   returns the provenance saved with it, subject to ordinary access rules.
3. Changing only provenance creates a new Resource version, even if its other
   content is unchanged. Submitting an identical resulting record is a no-op.
4. A source-list correction creates a new version. It does not edit the sources
   saved with an older version. An independently recorded activity, described
   below, may refer to an older version without changing that version's sources.
5. Preserve source references as recorded. A pin names an exact source revision;
   an unpinned reference identifies a source without claiming which revision
   was used. A source changing later never rewrites existing provenance.
6. References do not automatically become graph Links, fetch their targets,
   grant access, or guarantee that referenced content remains available.

For example, R1 records report A as its source. Correcting that to report B
creates R2. Reading R1 still reports A; reading R2 reports B. Both versions use
the ordinary attribution and history rules for their respective writes.

## What this does—and does not—claim

These are the author's recorded sources, not proof that the sources are true,
that the list is exhaustive, or that the decision was correct. An optional note
can say a source supplied evidence, imposed a requirement, or described a rejected
alternative. No mandatory relationship taxonomy is introduced.

Who changed the record and when remain separate existing information. The
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
editable copy. Inception and Change Attribution remain separate concepts.

Provenance changes would count when deciding whether to create a new version.
That differs from current BDP's attribution/change-context-only no-op behavior;
this proposal does not change the behavior of those existing fields.

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
| `occurredAt` — optional | When the activity reportedly happened. Omission means unknown. The Activity Bead's creation time separately records when the report was saved. |
| `artifact` — optional | A related artifact reference, with an optional kind. Preserve today's opaque `--ref` values and `--ref-kind` classifications; do not require old artifact references to become URLs. |
| `payload` — optional | Producer-supplied details. Preserve existing opaque payload strings without assuming they contain JSON. |

The Activity Bead also has ordinary Bead identity, a pinned Type reference,
revision, and attribution. Those describe the **record**, not proof of the
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
  "artifact": {
    "ref": "https://ci.example.org/runs/123"
  }
}
```

This says the producer reports using that approval Link revision, with the CI
run as a related artifact. It does not say the run was an input to the Link.

### Subjects, pins, and Scope boundaries

- **Bead or Link:** an unpinned reference means the resource generally. A pinned
  reference identifies the exact revision involved. Late ingestion must not
  silently pin to the subject's current revision or derive a pin from a timestamp.
- **Another Scope:** preserve the Bead or Link reference and any supplied pin.
  Accepting the report need not require fetching the other Scope. Its declared
  kind is a claim unless checked; acceptance does not prove the subject exists.
- **External resource:** a URL or URN can identify a document, repository, or
  other subject outside BDP. No BDP revision or lifecycle guarantees apply.
- **Local validation:** use the reference's Scope identity to distinguish local
  from remote references. Known local kind mismatches should be rejected. The
  policy for missing, deleted, or no-longer-retained local subjects remains open;
  it must accommodate delayed reporting and historical imports explicitly.

The subject is a **reference property**, not a normal graph Link endpoint.
Consequently a Link can be a subject without making Links valid graph endpoints.
These references do not create incident graph Links or automatic traversal edges.
An external subject must not be used to bypass checks on a recognized local BDP
reference. Activity records belong to their storing Scope; referencing a subject
does not grant access to it or authority to change it.

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
reports. `by-ref` matches the artifact's recorded reference exactly. Index subject
identity/revision, kind, occurrence time, and artifact reference so these queries
do not require scanning every Bead or its history. Query spelling, paging, and
ordering guarantees still need specifying; indexes are a storage choice.

For a compatible CLI adapter, retries must preserve today's durable duplicate
handling: the same event identity produces one Activity Bead, and a retry with
changed actor or payload does not overwrite the first record. Ordinary Bead
no-op rules alone do not supply this guarantee. The adapter must also preserve
current reference validation and the requirement for an occurrence time when
no artifact reference is supplied. BDP identity and atomic create behavior must
be mapped to the existing deduplication key before claiming compatibility.

### Decisions and acceptance cases

The existing CLI is append-only. A compatible Activity implementation must
enforce that behavior through its write policy; an ordinary Bead wrapper alone
does not prevent updates. Correction/retraction operations, if introduced, need
an explicit policy. Likewise, today's Issue deletion cascades to its activity
rows. A reference property does not implement that cascade: choose and implement
equivalent deletion behavior, or explicitly approve a behavior change. Set
activity access and retention rules without assuming subject permissions are
automatically inherited.

| Acceptance case | Required result under this proposal |
| --- | --- |
| CI reports a landing after the Issue changed | One Activity Bead; no Issue revision; event time distinct from recording time |
| Producer retries the same event with changed payload | No second record and no overwrite of the first report |
| Report identifies a local Link at revision R7 | Preserve the Link pin; no Link revision or new graph endpoint capability |
| Report names an unavailable remote Bead or an external URL | Preserve the reference under the chosen admission policy; no implied fetch, verification, or access grant |
| Query by subject identity versus exact revision | Identity includes all reports about that resource; exact revision excludes unknown/unpinned reports |
| A supported Event stream reports the write | `created` identifies the Activity Bead, not an update to its subject |
| Delete an Issue that has activity records | Apply the explicitly selected lifecycle policy; compatibility is not ready until this is decided and tested |

BDP owns the Activity Type's shared field meanings and reference/query semantics.
Beads owns the command adapter, indexes, deduplication implementation, and
operator policy within those semantics. The Activity Type, subject expansion,
and adapter are **PROPOSED / NYI**; today's Issue event log is **EXISTING**.

## Source-member choices still to settle

- **Omitted on update:** preserve the existing provenance or require the writer
  to restate it? Suggested default: preserve it, like other editable state;
  carrying it forward must not be presented as evidence of a new source read.
  The wire form for explicitly resetting sources to unknown also needs choosing.
- **Exact source versions:** allow both pinned and unpinned references, as Memory
  R3 does, or require pins for Bead/Link sources? The draft above allows both and
  states their different promises.
- **Reference checks:** decide local and cross-Scope validation without making
  the write depend on a live external fetch.
- **Compatibility:** select field names and write/read forms; define how clients
  preserve the member and how history, exports, and applicable Event records
  carry it. Legacy `bd provenance` events cannot be assigned subject revisions
  by guesswork; any conversion needs a separate explicit policy.

## Acceptance examples

- A Bead and a Link can each save and return provenance through the same member.
- An old record without provenance reads as unknown, not as a complete empty list.
- An explicit empty list remains distinguishable from unknown sources.
- Correcting only a source or completeness creates a new version; the old version
  and its provenance remain unchanged. An identical write creates no version.
- Updating a referenced source does not change either saved version's reference.
- A failed combined content/provenance write publishes neither change.

BDP owns these shared meanings. Beads owns CLI spelling and storage realization.
The open choices above need resolution before this becomes an implementable
contract. Background: [proposal and product comparison](memory-provenance-governance-review-20261011.md).

## Appendix A: relationship to today's `bd provenance`

Today's commands answer **“What happened around this Issue, and which artifacts
were involved?”** The proposed Activity Beads carry that meaning into BDP. The
separate per-version source member answers **“What information was this particular
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

Consider a CI job reporting that commit C landed for Issue I after another
writer has already updated I. Today it appends a small event row associated with
I. It does not need to rewrite I's current content or guess which revision C
belongs to. The source-only model would require a new I revision and additional
event fields, bringing activity recording into contention with ordinary Issue
edits. A changed actor on that new revision would describe recording the event,
not necessarily producing the Issue's substantive content.

An ever-growing event list on every version also enlarges successive logical
records. Storing only new events on each version instead requires retained
history and an event index to answer the existing queries. Storage engines may
reduce physical copying, but that does not remove the extra Resource revisions
or their changed meaning. These are architectural costs, not measured benchmark
results; this review ran no performance tests.

**Recommendation:** preserve the activity-log behavior, using the Activity Bead
design above as its proposed BDP representation, and add the source member for
version-specific inputs. They can share
storage infrastructure and reference utilities without sharing one record shape.
If reverse lookup of version sources is required, maintain a derived index keyed
by source reference and subject revision as versions are saved and removed,
rather than scan all historical bodies on every query. That index is an
implementation option, not a second authoritative source list.

The existing schema already has indexes for Issue/event time, artifact reference
and event kind, and the record path handles duplicate delivery. This is a
grounded implementation contract. Source inspection alone does not establish
how frequently each command is used in deployed systems. The Activity design
provides a route to preserving those behaviors in BDP, but migration, deletion,
access policy, and retry identity must be settled before replacing the current
storage path. No implementation or measured performance equivalence is claimed.

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
