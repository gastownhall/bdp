# Proposal: revision provenance and activity provenance

Status: discussion draft, October 11, 2026. Not an adopted BDP amendment or an
implementation commitment.

## Purpose

Let someone answer: **“What information did the author say this version was
based on?”** Save that information with the version, alongside who changed it
and when. The same mechanism applies to Beads and Links.

Also let someone answer **“What happened around this resource?”** Record that
activity independently, so reporting a commit or a use of information does not
require editing the subject. These two questions need different record shapes.

## Recommendation: one revision-provenance field

Use **`revisionProvenance`** as a common top-level member on every Bead and Link
version, alongside `id`, `type`, and `properties`. It groups who the version is
attributed to, when it was committed, and what information it was based on.
Optional assisting-agent and change-message information belongs there too.

Recommend the **same name, shape, and meaning in BDP and the graph CLI**. Replace
the separate BDP `attribution` and `changeContext` containers and the preview's
combined attribution/time container with this one common representation. This is
a proposed amendment and migration target, not a claim that either has changed.

Prefer `revisionProvenance` to bare `provenance`, which also describes activity
history, and to `changeProvenance`, which suggests a change operation. The
containing version is the subject even when it is the initial creation or a
historical read. No extra subject reference is needed.

Use **activity provenance** for the independently recorded work history served by
`bd provenance`. Its records remain **Activity Beads**, whose Type-specific fields
live in `properties`. Do not add an `activityProvenance` list to every subject or
a second common envelope to Activity Beads. Each Activity Bead has ordinary
`revisionProvenance` describing how that activity record was written.

### Existing representations and the proposed common shape

| Information | **EXISTING — BDP** | **EXISTING — graph CLI preview** | **PROPOSED — both** |
| --- | --- | --- | --- |
| Responsible actor and qualification | `attribution.principal`, `.status` | `attribution.actor`, `.status` | `revisionProvenance.actor.id`, `.status` |
| Revision time | `changeContext.committedAt` where History context is available | `attribution.recordedAt` | `revisionProvenance.committedAt` |
| Assisting agent | `changeContext.agent` | Not in the preview attribution structure | `revisionProvenance.agent` |
| Change message | `changeContext.message` | Not in the preview attribution structure | `revisionProvenance.message` |
| Information sources | No shared source member | No shared source member | `revisionProvenance.sources` |
| Source-list completeness | No shared source member | No shared source member | `revisionProvenance.sourcesCompleteness` |

The actor retains its `claimed` or `unknown` qualification; grouping it with a
server-observed time does not authenticate the actor or verify the source list.
An absent actor stays absent. For this draft, retain the existing History value
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

For this protocol, reserve **attestation** for a statement with a verifiable
issuer and a defined claim about a specific subject. A signature is one possible
mechanism; this proposal introduces no signing or attestation mechanism. The
issuer may differ from the actor credited with producing the version.

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
      "status": "claimed"
    },
    "committedAt": { "state": "present", "value": "2026-10-11T18:00:00Z" },
    "message": { "state": "present", "value": "Record the storage decision" },
    "sources": [
      {
        "ref": {
          "uri": "https://example.org/project/beads/benchmark",
          "revision": "r17"
        },
        "note": "Supplied the measurements used to choose the storage engine."
      }
    ],
    "sourcesCompleteness": "incomplete"
  }
}
```

Here Alice is the claimed author of the decision version, and benchmark R17 is
its declared information source. This does not say Alice authored the benchmark.
The optional assisting-agent field is omitted; no agent is inferred. During
mapping from existing History, preserve explicit absent/undetermined agent or
message states when present. Unknown legacy commit time uses the existing
`{ "state": "undetermined" }` representation.

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

For example, R1 records report A as its source. Correcting that to report B
creates R2. Reading R1 still reports A; reading R2 reports B. Both versions use
the ordinary attribution and history rules for their respective writes.

## What this does—and does not—claim

These are the author's recorded sources, not proof that the sources are true,
that the list is exhaustive, or that the decision was correct. An optional note
can say a source supplied evidence, imposed a requirement, or described a rejected
alternative. No mandatory relationship taxonomy is introduced.

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
editable copy. Inception and Change Attribution remain separate concepts.

Changes to sources or their completeness count when deciding whether to create a
new version. Moving the existing actor/context fields into `revisionProvenance`
does not change their no-op behavior. On a real write, attribution is supplied
for the new version and commit time is assigned by the authority. Do not blindly
copy the entire previous envelope: that could credit the prior writer or preserve
a stale time. The source-list carry-forward decision below is separate.

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
cascades to its activity rows. Whether to retain Activity Beads about deleted
subjects or preserve that cascade remains an explicit product decision; a
reference property does not implement it automatically. Access and retention
also require explicit policy, not presumed inheritance of subject permissions.

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

- **Source defaults:** the CLI strawman below recommends preserving source fields
  on update, and unknown sources on create/delete. Carry-forward does not prove a
  new source read. Adopt or revise that rule and specify the BDP wire encoding for
  omission versus an explicit reset to unknown.
- **Exact source versions:** allow both pinned and unpinned references, as Memory
  R3 does, or require pins for Bead/Link sources? The draft above allows both and
  states their different promises.
- **Reference checks:** decide local and cross-Scope validation without making
  the write depend on a live external fetch.
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
name, then the OS user. No common actor-status/source-list/change-message flags
are registered for all three lifecycle verbs in the inspected source.

There are two important spelling collisions:

- [`--message` / `-m`](https://github.com/donnabox/beads/blob/72cd9dc3c7a2304f15dbe5d3e880d903cf077a35/cmd/bd/flags.go#L11)
  already aliases the Issue description on create/update. Other commands also use
  it for different purposes. Do not silently reinterpret it as revision metadata.
- [`bd provenance record --actor`](https://github.com/donnabox/beads/blob/72cd9dc3c7a2304f15dbe5d3e880d903cf077a35/cmd/bd/provenance.go#L190)
  is a local flag for the activity's actor, and `--source` names its producer.
  Neither should silently change meaning.

### Common revision-provenance options

| Proposed option, on create/update/delete | Meaning |
| --- | --- |
| `--revision-actor ID` | Set `revisionProvenance.actor.id`. Ordinary lifecycle `--actor` remains a compatibility alias; contradictory explicit values are an error. |
| `--actor-status claimed\|unknown` | Qualify the revision actor. Default `claimed` when the CLI supplies an actor, including its configured default. `unknown` preserves an identity whose relationship to the version is uncertain. No `verified` or `authenticated` value. |
| `--no-actor` | Suppress actor defaulting and leave revision actor absent; mutually exclusive with explicit revision actor or actor-status. |
| `--revision-message TEXT` | Set the optional revision message, distinct from content/description or backend commit messages. An explicit empty string is a known empty message. |
| `--assisting-agent ID` | Record an optional assisting agent, distinct from the responsible actor. Do not infer it from login identity. |
| `--no-revision-message`, `--no-assisting-agent` | Record known absence rather than undetermined; each excludes its corresponding value option. |
| `--sources JSON`, `--sources @FILE`, or `--sources -` | Supply the entire source-entry array inline, from a UTF-8 JSON file, or stdin. Replaces the source list; no comma-splitting of URLs and no implicit append. |
| `--sources-unknown` | Explicitly reset source knowledge to unknown; excludes `--sources` and any non-unknown completeness value. |
| `--sources-completeness complete\|incomplete\|unknown` | Declare completeness of the source list. Reject complete/incomplete when the resulting sources are unknown. |

Only one input may consume stdin, and only one `--sources` option is allowed.
Reject empty explicit actor/agent IDs and actor-status without a resolved actor.
Each source entry has `ref` and optional `note`, using the same reference grammar
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
agent/message means undetermined; absent resolved actor stays absent.

| Source input | Create | Update | Delete |
| --- | --- | --- | --- |
| Omitted | Unknown | Preserve previous sources and completeness | Unknown; never inherit reasons from the deleted content |
| `--sources '[]'` | Known empty list | Replace with known empty list | Explicitly no information sources declared for deletion |
| Nonempty `--sources` | Save list | Replace list | Save deletion's sources on terminal revision |
| `--sources-unknown` | Unknown | Reset to unknown | Unknown |

A replacement source list defaults its completeness to unknown unless supplied;
a preserved list preserves completeness unless explicitly changed. Completeness
alone may change a known existing list on update. An explicit empty list does
not imply complete. These omission defaults are strawman recommendations replacing
the earlier undecided source carry-forward question.

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
    "note": "Measurements supporting this decision"
  }
]
```

Illustrative commands; the flags are proposed:

```sh
bd create "Choose storage engine" --revision-actor human:alice \
  --revision-message "Record the decision" \
  --sources @sources.json --sources-completeness incomplete
bd update DECISION_ID --sources @sources.json \
  --revision-message "Correct the supporting sources"
bd delete DECISION_ID --if-revision R2 --force \
  --sources '[{"ref":"https://example.org/policies/retention"}]' \
  --revision-message "Remove under retention policy"
```

The delete example is logical deletion, not an erasure request. JSON output for
an actual deletion should return a discriminated terminal-history record with
its new revision and revision provenance; ordinary GET still returns 404.

### `bd provenance record` is an Activity-create convenience command

Yes: it builds an Activity Bead and invokes the same underlying create operation
as `bd create` with the Activity Type. It is not another event-storage API.
It retains useful validation and retry handling beyond a bare unkeyed create.

| Wrapper option | Activity content or revision metadata |
| --- | --- |
| `--subject REF --subject-kind bead\|link\|external` | Activity subject; preserve an explicit pin. Existing `--issue ID` is a shorthand for an unpinned Issue subject; reject conflicting forms. |
| `--kind KIND` | Activity kind |
| `--producer NAME` | Activity producer; preserve `--source` as an alias and reject contradictory values |
| `--activity-actor ID` | Activity participant; preserve this command's existing `--actor` as an alias |
| `--ref`, `--ref-kind`, `--at`, `--payload` | Existing artifact, occurrence time, and opaque payload meanings |
| Common revision-provenance options above | Provenance of creating the Activity record, including any information sources used to write the report |

On this wrapper, `--revision-actor` always names the record writer; local
`--actor` always names the activity participant. Resolve the writer's default
independently of the local activity-actor flag. `--no-actor` suppresses only the
revision actor here; it does not erase an explicitly supplied activity actor.
`--actor-status` qualifies only the revision actor. Help and JSON examples must
make this legacy spelling exception visible.

```sh
bd provenance record --issue ISSUE_ID --kind land --producer ci \
  --activity-actor human:alice --revision-actor svc:ci-reporter \
  --ref 0123456789abcdef0123456789abcdef01234567 --ref-kind git-sha \
  --at 2026-10-11T18:00:00Z --sources @sources.json \
  --revision-message "Record CI landing report"
```

Return the Activity identity and revision so ordinary `bd update` and `bd delete`
can correct or delete it. Those operations target the Activity ID, never its
subject. Native Activity creation and this wrapper must share the Type schema,
validation, authorization, and provenance semantics.

Preserve legacy deterministic event identity for legacy inputs through a durable
create-idempotency mapping; define a canonical key for new subject forms before
implementation. A duplicate `record` is not an update: changed actor, payload,
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
| `bd provenance by-ref REF` | Activity reports whose artifact reference equals the supplied legacy value | Retained resource revisions whose `revisionProvenance.sources` reference the supplied resource |

For revision `by-ref`, an unpinned reference matches the source identity across
pinned and unpinned citations; a pinned reference matches only that exact pin.
The activity branch keeps exact opaque artifact-string equality. Reject a raw
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
log. Whether deleting a subject deletes its Activity Beads remains a product
choice; explicit Activity deletion itself follows ordinary terminal-revision rules.

### CLI acceptance and readiness

| Case | Required result |
| --- | --- |
| Create/update/delete a Bead or Link with sources, actor status and revision message | All supplied fields reach that operation's resulting revision or terminal entry; no silent drops |
| Update omits sources; delete omits sources | Update preserves source knowledge; delete records unknown deletion sources |
| Explicit empty sources versus unknown sources | Remain distinct through flags, JSON output, BDP and retained reads |
| Two flags request stdin, conflicting actor aliases, invalid status, or client commit time | Fail before mutation |
| Activity performed by Alice, recorded by CI | Separate activity participant and revision actor; no flag shadowing changes their meaning |
| Retry Activity creation after later correction/deletion | No overwrite or resurrection; report retained original disposition or explicit retry expiry |
| Ordinary update/delete of an Activity | New Activity revision/terminal entry; subject content unchanged |
| Ordinary GET after resource deletion | 404; authorized provenance revision mode can show the terminal entry |
| Late Activity, identical timestamps, correction, deletion during pagination | Snapshot pages stay stable; ordered follow observes every visible transition or an explicit gap/expiry |
| Default `log` / `by-ref` versus `--mode all` | Defaults retain activity meaning; all-mode rows identify which relation matched |
| Backend lacks History or reliable stream/index support | Explicit unsupported capability, never misleading empty results or fake timestamp ordering |

**EXISTING:** inherited actor option, Activity-log record/log/by-ref and its retry
rules, preview actor/time metadata. **PROPOSED / NYI:** common provenance flags,
unified output shape, Activity wrapper backed by Beads, ordinary Activity edits,
terminal revisions, revision/all queries and ordered follow. Before implementation,
settle the BDP terminal-history amendment, compatibility/output version, Activity
subject deletion policy, retry mapping/retention and query capability declarations.

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
