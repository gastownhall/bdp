# Proposal: record provenance with each Bead or Link version

Status: discussion draft, October 11, 2026. Not an adopted BDP amendment or an
implementation commitment.

## Purpose

Let someone answer: **“What information did the author say this version was
based on?”** Save that information with the version, alongside who changed it
and when. The same mechanism applies to Beads and Links.

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
4. A correction creates a new version. It does not edit or attach information
   to an older version. Adding later assertions about old versions is outside
   this proposal.
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

## Choices still to settle

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
were involved?”** This proposal answers **“What information was this particular
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

**Not as currently written.** The existing feature records work activity and
artifact relationships that need not change the Issue. The proposed member
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

**Recommendation:** retain the event log for independently arriving work events,
and add the proposed source member for version-specific inputs. They can share
storage infrastructure and reference utilities without sharing one record shape.
If reverse lookup of version sources is required, maintain a derived index keyed
by source reference and subject revision as versions are saved and removed,
rather than scan all historical bodies on every query. That index is an
implementation option, not a second authoritative source list.

The existing schema already has indexes for Issue/event time, artifact reference
and event kind, and the record path handles duplicate delivery. This is a
grounded implementation contract. Source inspection alone does not establish
how frequently each command is used in deployed systems. Replacing the log would
require a separate design preserving those behaviors; this speclet proposes an
addition, not that replacement.

### Proposed compatibility approach

Keep the current commands' event-log meaning while this proposal is evaluated.
Do not silently redefine `record` as an edit of the latest version, or redefine
`log` and `by-ref` to mix event records with version source lists. This appendix
does not select a new CLI spelling or deprecate an existing command.

Do not automatically convert old events into provenance for an arbitrary
revision. A deliberate conversion would need a reliable subject-version mapping
and a stated interpretation of the event. Preserve unknown information where
that evidence is absent. A user could instead make a new version with an explicit
source declaration, but that would be a new declaration, not recovered history.

Source check: released v1.3.1 at `c1c4b642` and upstream main at `7477ec13`,
rechecked October 11; the relevant command/storage behavior is unchanged.
See the [command definitions](https://github.com/gastownhall/beads/blob/c1c4b642ac1c08d8c828007a1c2f96e47e43ef7c/cmd/bd/provenance.go),
[event storage and retry behavior](https://github.com/gastownhall/beads/blob/c1c4b642ac1c08d8c828007a1c2f96e47e43ef7c/internal/storage/issueops/provenance.go),
and [event schema](https://github.com/gastownhall/beads/blob/c1c4b642ac1c08d8c828007a1c2f96e47e43ef7c/internal/storage/schema/migrations/0063_create_provenance_events.up.sql).
