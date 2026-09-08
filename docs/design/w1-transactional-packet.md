# W1 Transactional packet: wire artifacts for the Transactional profile

Status: **applied 2026-09-08** — decisions T1–T48 and X1–X4 ruled or
ratified, T49 open and teed up for the operator, T50–T61 applied
provisionally; see [Apply record (2026-09-08)](#apply-record-2026-09-08).
The proposals below are kept as written for the record; where a ruling
departed from them, the ruling is what landed. Originally: design packet,
non-normative until applied. Workstream W1, second
half. Base: `gastownhall/bdp` at `2df0216` — the head of
`janet-w1-read-update-wire`, which carries the Read+Update wire artifacts
(`docs/specs/bdp.md`, `schemas/bdp-v0.schema.json`, `fixtures/read-update/`,
`packages/conformance/catalog/read-update-v1.json`, and
`docs/design/w1-read-update-decisions.md` with decisions D1–D31). This
revision folds review council 10 (Codex, Gemini, Claude); the fold is
recorded under [Council 10 fold](#council-10-fold), and every name and
shape the two halves of W1 share is reconciled under
[Reconciliation with Read+Update](#reconciliation-with-readupdate).

This packet proposes, for the Transactional profile, the normative text, the
JSON Schema 2020-12 definitions, the fixtures, and the conformance rows that
the draft says are still missing, and it numbers every judgment call as a
DECISION — T1 through T48, plus the cross-packet decisions X1 through X4
that must be ruled once for both halves of W1 — for the operator to rule.
Each decision is applied in the packet as its recommendation so that the
profile is reviewable as a whole; none is ruled. Nothing here is a
conformance claim. Nothing here changes the draft until it is applied: this
is a packet-only pass, and the proposed text, definitions, fixtures, and
rows are pasted into the specification, the bundle, `fixtures/`, and the
catalog only after the rulings.

## How to read this packet

- "Proposed normative text" blocks are written in the specification's voice,
  ready to paste, and each names the section of `docs/specs/bdp.md` it lands
  in. RFC 2119 capitals are used only where the pasted text is normative.
- Schema blocks preceded by `<!-- bundle-defs -->` are `$defs` entries ready
  to paste into `schemas/bdp-v0.schema.json`. They follow the bundle's
  conventions as the Read+Update wire left them: every protocol-owned
  envelope is closed, `properties` stays open, Type IDs and navigation URLs
  are `absoluteHttpUrl`, operation records compose the Read+Update
  `<operation>Members` mixins with `unevaluatedProperties: false`, and
  problem tables compose by `$ref` from `readUpdateProblem` rather than
  restating rows. No existing definition is redefined; every shared
  primitive (`idempotencyKey`, `localName`, `propertyChange`,
  `jsonPointer`, `expectedRevision`, the reference definitions, the
  diagnostics definitions) is the Read+Update one.
- Fixture blocks preceded by `<!-- fixture: <definition> -->` are examples
  that validate against the named definition once the definitions are
  assembled with the current bundle. Blocks preceded by
  `<!-- fixture-invalid: <definition> -->` are examples the definition must
  reject. The packet's sanity script (kept outside the repository) assembles
  the tagged blocks onto the current bundle, compiles every definition with
  the repository's strict Ajv 2020-12 settings and the `uri` and
  `date-time` formats, checks both kinds of fixture, and re-runs the
  catalog citation check over the rows; its results are in the delivery
  report, not here. Fixture narratives are illustrative assumptions, never
  observations.
- Conformance rows follow the shape of
  `packages/conformance/catalog/read-update-v1.json` — `id`, `title`,
  `kind`, `requiredProfile`, `requirements` — with the existing catalogs'
  id convention `transactional.<area>.<case>`. The coverage category open
  question 13 names (positive, negative, concurrency, disconnect, expiry,
  restore, authorization-view) is a grouping column in this packet, not an
  id segment and not a catalog member (T48). Every row is unclaimed. A row
  that cites this packet cites text that moves into the specification when
  the packet is applied; its anchor is re-pointed at that time.
- Vocabulary follows `CONTEXT.md`: a Reference is a URI or a Pinned
  Reference `{ uri, revision }`; the bundle is the normative schema bundle;
  protocol identifiers are compared, never dereferenced.

## Summary

| Packet item | Definitions added to the bundle | Decisions |
| --- | --- | --- |
| 1. Owned-Link delta member | `wireToken`, `revision`, `dateTime`, `resourceKind`, `resourceIdentity`, `typedLinkReference`, `createdData`, `ownedLinkDelta`, `ownedLinkChange`, `updatedData`, `deletedData`, `linkDeltaData`, `eventType`, `event`, `eventPage` | T1–T4 |
| 2. Batch envelopes | `selector`, `cardinality`, `updateWhereMembers`, `deleteWhereMembers`, `updateWhereRequest`, `deleteWhereRequest`, eight `<operation>Operation` records, `batchOperation`, `batchRequest`, `transactionalOperationDirectory` | T5–T6, T41–T42 |
| 3. Mutation Receipts and the Transactional problem table | `receiptStatus`, `receiptDetail`, `receiptEntryOutcome`, `receiptResult`, `allocatedIdentity`, `receiptCore`, `mutationReceipt`, `mutationReceiptPage`, `transactionalOnlyProblemCode`, `transactionalProblemCode`, `directProblemCode`, `receiptProblemCode`, `transactionalProblem`, `receiptProblem` | T7–T11, T32–T39, T43, T46 |
| 4. Transaction-level idempotency and `sequence` on a Transactional Scope | (text only) | T12–T15, T40–T41, T47 |
| 5. Version erasure on the changefeed | `stateChange`, `erasureDigest`, `erasureRecord`, `changeGroup`, `changefeedPage`, `snapshotManifest`, `transactionalAdvertisedLimits`, `transactionalDiscovery` | T16–T20, T25–T31, T44 |
| 6. Conformance rows | 113 unclaimed Transactional rows in catalog shape, plus the Read+Update rows a Transactional Scope retires | T21, T48 |
| 7. What is still not enough | — | — |
| Shared-shape rules with Read+Update | — | T22–T24, T45, X1–X4 |

## 1. Owned-Link delta member

The draft says: "The delta member carrying the owned-Link change is not yet
part of this draft; until it exists, the Transactional profile cannot be
implemented for owning Types." This section supplies it. The design follows
from three rules the draft already fixes: every owned-Link mutation versions
the source Bead ([Owned Links](../specs/bdp.md#owned-links)); no-op
detection is operation-local and every transition receives its own revision
and Event ([Revisions](../specs/bdp.md#revisions)); and Event data carries
deltas, never Resource snapshots
([Event replay and live observation](../specs/bdp.md#event-replay-and-live-observation)).
Together they imply that one `updated` Event carries exactly one owned-Link
transition, that a source's properties change and its owned-Link change
never share an Event, because no single operation produces both, and — the
council's correction to the first draft of this section — that an `updated`
transition carries the Link's delta, not its record.

### 1.1 Proposed normative text

Target: "Events and Event Sources". Replace the `UpdatedData` block and the
paragraph beginning "An owned-Link change produces an `updated` Event on the
source Bead" with the following.

```text
UpdatedData {
  previousRevision: Revision
  revision: Revision
  change?: PropertyChange        // exactly one of change and ownedLink
  ownedLink?: OwnedLinkChange
  attribution?: Attribution      // the new version's carried attribution
}

OwnedLinkChange {
  operation: created | updated | deleted
  link: LinkState                // created: the owned Link's complete record
      | OwnedLinkDelta           // updated: the owned Link's own delta
      | ResourceIdentity         // deleted: id, type, and final live revision
}

OwnedLinkDelta {
  id: URI                        // the owned Link's canonical URL
  type: TypeId
  previousRevision: Revision     // the Link's revisions, not the source's
  revision: Revision
  change: PropertyChange
  attribution?: Attribution      // the Link's new version's carried attribution
}

ResourceIdentity {
  id: URI                        // the canonical Resource URL
  type: TypeId
  revision: Revision
}
```

An owned-Link change produces an `updated` Event on the source Bead with
its fresh revision; its delta carries `ownedLink` in place of `change`.
Exactly one of the two members is present in any `updated` delta. No single
operation changes both a Bead's `properties` and one of its owned Links, and
every owned-Link mutation mints its own source version, so a Mutation
Transaction that changes both — or that changes two owned Links of one
source — produces one `updated` Event per transition, each with its own
`previousRevision` and `revision`, in operation order.

`ownedLink.operation` names the transition, and `ownedLink.link` is the
delta of that transition, never a snapshot. For `created`, it is the owned
Link's complete record: exactly the record the Link serves at its own URL
after the transition, because creation is the delta from absence, so its
`revision` is the Link's fresh revision and its `attribution`, when present,
is the Link's own. For `updated`, it is the owned Link's delta — the Link's
`id` and `type`, its `previousRevision` and fresh `revision`, the committed
`change`, and the Link's new version's `attribution` when one was recorded —
the same delta the Link's own `updated` fact carries, so that neither fact
carries the Link's properties in full. For `deleted`, it is the deleted
Link's identity — `id`, `type`, and its final live `revision` — because
deletion mints no Link version and a deleted Event does not retain
properties. `previousRevision` and `revision` at the Event level are the
source Bead's. `attribution` at the Event level, when present, is the
source's new version's carried attribution. An operation that mints both a
Link version and a source version records its one attribution on both, so a
`created` or `updated` delta whose Link record or Link delta carries
`attribution` carries the same value at the Event level, and a delta whose
Link record or Link delta carries none carries none.

`CreatedData` and `DeletedData` carry no owned-Link data. A Bead is created
with an empty owned set for every Link Type its Type owns, and the record's
empty `ownedLinks` entries follow from the Type Descriptor rather than from
the Event: a consumer that reconstructs a record from Events alone cannot
know which empty entries the record carries without the Type Descriptor,
and the canonical record read or the snapshot, not the Event stream, is
where that key set is authoritative. A Bead with a live owned Link cannot
be deleted, so a `deleted` Bead Event never has owned Links to report.

A source Bead's owned-Link `updated` Event is in addition to, not instead
of, the facts the Link mutation already induces: the Link's own `created`,
`updated`, or `deleted` fact, and the `linked` or `unlinked` fact at each
in-Scope endpoint, including the source itself. Within a change group, the
facts induced by one owned-Link operation are ordered: the Link's lifecycle
fact first, then the graph facts at its in-Scope endpoints, source before
target — a self-Link's one endpoint Bead receiving its `source` fact before
its `target` fact — then the source's `updated` fact last. Ordinals are
assigned in that order and never renumbered by projection. A Bead-scoped
Event Source for an owning source therefore reports an owned Link's
property change twice, under two subjects: once as the incident Link's
`updated` fact and once as the source's own `updated` fact carrying the
same delta.

A no-op owned-Link property update — one whose patch yields `properties`
equal, under the RFC 6902 Section 4.6 comparison, to the value immediately
before it — retains the Link's revision and emits no Event, and it does not
version the source: there is no transition for the source's version to
cover.

Target: "Events and Event Sources". Replace "Each affected Resource produces
exactly the Event facts that its singleton update or deletion would
produce, including incident Link facts at in-Scope endpoint Beads." with
the following.

Each affected Resource produces exactly the Event facts that its singleton
update or deletion would produce, including incident Link facts at in-Scope
endpoint Beads, and the selected Resources expand in ascending code-unit
order of their canonical `id`s — the `canonical-uri` order of
[Collection retrieval and selection](#collection-retrieval-and-selection) —
so that the Events a set operation induces and the entries its Mutation
Receipt reports follow one order that does not depend on the authority's
selection mechanism.

Target: "Event replay and live observation". Replace the `updated` bullet
with the following.

- `updated` carries `previousRevision`, `revision`, exactly one of `change`
  and `ownedLink`, and the new version's `attribution` when one was
  recorded. `change` uses the same committed Property Change representation
  accepted by singleton DML. `ownedLink` carries one owned-Link transition
  of the source Bead: `operation` is `created`, `updated`, or `deleted`, and
  `link` is the owned Link's complete record for the first, its own delta —
  `id`, `type`, `previousRevision`, `revision`, `change`, and `attribution`
  when recorded — for the second, and its identity — `id`, `type`, and final
  live `revision` — for the third.

Target: "Events and Event Sources", after the paragraph above. Applying the
delta.

A consumer that holds the source's record at `previousRevision` advances it
to `revision` by applying `ownedLink` to the entry keyed by `link.type` in
the record's `ownedLinks` member: for `created`, inserting `link` in
ascending code-unit order of `id`; for `updated`, locating the entry whose
`id` equals `link.id` and whose `revision` equals `link.previousRevision`,
applying `link.change` to its `properties`, and setting its `revision` to
`link.revision` and its `attribution` to `link.attribution`, removing that
member when the delta carries none; for `deleted`, removing the entry whose
`id` equals `link.id`; then setting the record's `revision` to the Event's
`revision` and its `attribution` to the Event's `attribution`, removing the
member when the Event carries none. A consumer whose held revision is not
`previousRevision`, or whose held entry is not at `link.previousRevision`,
is not positioned to apply the delta; it re-reads the record or resumes
from a snapshot. Replicas do not need the delta at all: the containing
change group's `changes` member carries the source Bead's complete
postimage, `ownedLinks` inline, beside the Link's own postimage or
tombstone.

Target: "Change groups and replication", after "Multiple operations on one
Resource normalize to its final projected postimage or tombstone."

An owned-Link mutation changes the state of two Resources, so a group's
`changes` carries both: the owned Link's postimage or tombstone, and the
source Bead's postimage at its fresh revision with the owned set inline.
The two entries describe one graph: the inline record in the source's
postimage and the Link's own postimage are member-for-member equal, and a
consumer verifies that agreement before applying the group, under
[Scope snapshots](#scope-snapshots).

### 1.2 Proposed schema

These definitions add the Event surface to the bundle. `wireToken` is the
Event-ID and checkpoint character profile the draft already fixes; T15
extends it to the other history tokens. `revision` names the bundle's
existing inline `{ "type": "string", "minLength": 1 }` so that later
definitions can reference one spelling; the existing record definitions and
the Read+Update `expectedRevision` keep their spelling until a separate
bundle cleanup references this one. `dateTime` is a validated RFC 3339
instant: it carries `format: date-time`, which the repository's validators
register from ajv-formats' full mode beside `uri` when the packet is
applied (T45). `propertyChange`, `localName`, `jsonPointer`, and the
reference definitions are the Read+Update ones and are not restated.

<!-- bundle-defs -->
```json
{
  "wireToken": {
    "type": "string",
    "pattern": "^[A-Za-z0-9_-]{1,256}$"
  },
  "revision": {
    "type": "string",
    "minLength": 1
  },
  "dateTime": {
    "type": "string",
    "format": "date-time"
  },
  "resourceKind": {
    "enum": ["bead", "link"]
  },
  "resourceIdentity": {
    "type": "object",
    "required": ["id", "type", "revision"],
    "properties": {
      "id": { "$ref": "#/$defs/absoluteHttpUrl" },
      "type": { "$ref": "#/$defs/absoluteHttpUrl" },
      "revision": { "$ref": "#/$defs/revision" }
    },
    "additionalProperties": false
  },
  "typedLinkReference": {
    "type": "object",
    "required": ["id", "type"],
    "properties": {
      "id": { "$ref": "#/$defs/absoluteHttpUrl" },
      "type": { "$ref": "#/$defs/absoluteHttpUrl" }
    },
    "additionalProperties": false
  },
  "createdData": {
    "type": "object",
    "required": ["revision", "properties"],
    "properties": {
      "revision": { "$ref": "#/$defs/revision" },
      "properties": { "$ref": "#/$defs/properties" },
      "attribution": { "$ref": "#/$defs/attribution" },
      "source": { "$ref": "#/$defs/reference" },
      "target": { "$ref": "#/$defs/reference" }
    },
    "dependentRequired": {
      "source": ["target"],
      "target": ["source"]
    },
    "additionalProperties": false
  },
  "ownedLinkDelta": {
    "type": "object",
    "required": ["id", "type", "previousRevision", "revision", "change"],
    "properties": {
      "id": { "$ref": "#/$defs/absoluteHttpUrl" },
      "type": { "$ref": "#/$defs/absoluteHttpUrl" },
      "previousRevision": { "$ref": "#/$defs/revision" },
      "revision": { "$ref": "#/$defs/revision" },
      "change": { "$ref": "#/$defs/propertyChange" },
      "attribution": { "$ref": "#/$defs/attribution" }
    },
    "additionalProperties": false
  },
  "ownedLinkChange": {
    "type": "object",
    "required": ["operation", "link"],
    "properties": {
      "operation": { "enum": ["created", "updated", "deleted"] },
      "link": { "type": "object" }
    },
    "allOf": [
      {
        "if": {
          "properties": { "operation": { "const": "created" } },
          "required": ["operation"]
        },
        "then": {
          "properties": { "link": { "$ref": "#/$defs/linkRecord" } }
        }
      },
      {
        "if": {
          "properties": { "operation": { "const": "updated" } },
          "required": ["operation"]
        },
        "then": {
          "properties": { "link": { "$ref": "#/$defs/ownedLinkDelta" } }
        }
      },
      {
        "if": {
          "properties": { "operation": { "const": "deleted" } },
          "required": ["operation"]
        },
        "then": {
          "properties": { "link": { "$ref": "#/$defs/resourceIdentity" } }
        }
      }
    ],
    "additionalProperties": false
  },
  "updatedData": {
    "type": "object",
    "required": ["previousRevision", "revision"],
    "properties": {
      "previousRevision": { "$ref": "#/$defs/revision" },
      "revision": { "$ref": "#/$defs/revision" },
      "change": { "$ref": "#/$defs/propertyChange" },
      "ownedLink": { "$ref": "#/$defs/ownedLinkChange" },
      "attribution": { "$ref": "#/$defs/attribution" }
    },
    "oneOf": [
      {
        "type": "object",
        "required": ["change"],
        "properties": { "change": true, "ownedLink": false }
      },
      {
        "type": "object",
        "required": ["ownedLink"],
        "properties": { "ownedLink": true, "change": false }
      }
    ],
    "additionalProperties": false
  },
  "deletedData": {
    "type": "object",
    "required": ["revision"],
    "properties": {
      "revision": { "$ref": "#/$defs/revision" }
    },
    "additionalProperties": false
  },
  "linkDeltaData": {
    "type": "object",
    "required": ["endpoint", "link", "source", "target"],
    "properties": {
      "endpoint": { "enum": ["source", "target"] },
      "link": { "$ref": "#/$defs/typedLinkReference" },
      "source": { "$ref": "#/$defs/reference" },
      "target": { "$ref": "#/$defs/reference" }
    },
    "additionalProperties": false
  },
  "eventType": {
    "enum": ["created", "updated", "deleted", "linked", "unlinked"]
  },
  "event": {
    "title": "BDP Event",
    "type": "object",
    "required": [
      "id",
      "ordinal",
      "type",
      "source",
      "subject",
      "subjectType",
      "transaction",
      "time",
      "data"
    ],
    "properties": {
      "id": { "$ref": "#/$defs/wireToken" },
      "ordinal": { "type": "integer", "minimum": 0 },
      "type": { "$ref": "#/$defs/eventType" },
      "source": { "$ref": "#/$defs/absoluteHttpUrl" },
      "subject": { "$ref": "#/$defs/absoluteHttpUrl" },
      "subjectType": { "$ref": "#/$defs/absoluteHttpUrl" },
      "transaction": { "$ref": "#/$defs/wireToken" },
      "time": { "$ref": "#/$defs/dateTime" },
      "data": { "type": "object" }
    },
    "allOf": [
      {
        "if": { "properties": { "type": { "const": "created" } }, "required": ["type"] },
        "then": { "properties": { "data": { "$ref": "#/$defs/createdData" } } }
      },
      {
        "if": { "properties": { "type": { "const": "updated" } }, "required": ["type"] },
        "then": { "properties": { "data": { "$ref": "#/$defs/updatedData" } } }
      },
      {
        "if": { "properties": { "type": { "const": "deleted" } }, "required": ["type"] },
        "then": { "properties": { "data": { "$ref": "#/$defs/deletedData" } } }
      },
      {
        "if": { "properties": { "type": { "enum": ["linked", "unlinked"] } }, "required": ["type"] },
        "then": { "properties": { "data": { "$ref": "#/$defs/linkDeltaData" } } }
      }
    ],
    "additionalProperties": false
  },
  "eventPage": {
    "title": "BDP Event Source page",
    "type": "object",
    "required": ["source", "events", "next"],
    "properties": {
      "source": { "$ref": "#/$defs/absoluteHttpUrl" },
      "events": {
        "type": "array",
        "items": { "$ref": "#/$defs/event" }
      },
      "next": {
        "oneOf": [{ "$ref": "#/$defs/absoluteHttpUrl" }, { "type": "null" }]
      }
    },
    "additionalProperties": false
  }
}
```

### 1.3 Fixtures

The fixtures use the reference domain's owning pair: a `decision` Bead owns
outgoing `cites` Links (`fixtures/reference-domain/reference-domain.json`,
`max` 8). The Scope is the draft's reserved `https://beads.example/acme/`.
One timeline runs through the packet: the first batch under section 2.3
commits at `pos-43`, two administrative erasures follow at `pos-44` and
`pos-45`, the second batch commits at `pos-46`, and an administrative
Link erasure at `pos-47`.

An `updated` Event on the source Bead `dec-9` after an owned `cites` Link
was created from it. The Link record inside the delta is exactly the record
the Link serves at its own URL; the source's new version carries the same
attribution the Link's version carries.

<!-- fixture: event -->
```json
{
  "id": "ckpt-43_4",
  "ordinal": 4,
  "type": "updated",
  "source": "https://beads.example/acme/beads/dec-9?view=events",
  "subject": "https://beads.example/acme/beads/dec-9",
  "subjectType": "https://work.example/types/decision",
  "transaction": "txn-0a1b",
  "time": "2026-09-07T18:04:12Z",
  "data": {
    "previousRevision": "dec-9-r1",
    "revision": "dec-9-r2",
    "ownedLink": {
      "operation": "created",
      "link": {
        "id": "https://beads.example/acme/links/9c1e",
        "type": "https://work.example/types/cites",
        "revision": "9c1e-r1",
        "attribution": { "principal": "agent:planner", "status": "claimed" },
        "source": "https://beads.example/acme/beads/dec-9",
        "target": "https://beads.example/acme/beads/task-42",
        "properties": { "role": "evidence" }
      }
    },
    "attribution": { "principal": "agent:planner", "status": "claimed" }
  }
}
```

An `updated` transition in delta form, from a separate example: the owned
`cites` Link `7a0b` of the Decision `dec-11` had its `role` changed. The
delta carries the Link's own revisions and the committed change, not the
Link's record; the source's version moved from `dec-11-r4` to `dec-11-r5`.

<!-- fixture: event -->
```json
{
  "id": "ckpt-52_1",
  "ordinal": 1,
  "type": "updated",
  "source": "https://beads.example/acme/beads/dec-11?view=events",
  "subject": "https://beads.example/acme/beads/dec-11",
  "subjectType": "https://work.example/types/decision",
  "transaction": "txn-0b77",
  "time": "2026-09-08T09:15:30Z",
  "data": {
    "previousRevision": "dec-11-r4",
    "revision": "dec-11-r5",
    "ownedLink": {
      "operation": "updated",
      "link": {
        "id": "https://beads.example/acme/links/7a0b",
        "type": "https://work.example/types/cites",
        "previousRevision": "7a0b-r1",
        "revision": "7a0b-r2",
        "change": [{ "op": "replace", "path": "/role", "value": "primary" }],
        "attribution": { "principal": "human:donna", "status": "claimed" }
      }
    },
    "attribution": { "principal": "human:donna", "status": "claimed" }
  }
}
```

A finite read of the Bead-scoped Event Source of `dec-9` later, after the
owned Link was deleted by the second batch. Deletion mints no Link version
and the source's new version carries the attribution supplied to the set
deletion; the delta carries the deleted Link's identity only.

<!-- fixture: eventPage -->
```json
{
  "source": "https://beads.example/acme/beads/dec-9?view=events",
  "events": [
    {
      "id": "ckpt-46_3",
      "ordinal": 3,
      "type": "updated",
      "source": "https://beads.example/acme/beads/dec-9?view=events",
      "subject": "https://beads.example/acme/beads/dec-9",
      "subjectType": "https://work.example/types/decision",
      "transaction": "txn-0a1d",
      "time": "2026-09-07T18:09:40Z",
      "data": {
        "previousRevision": "dec-9-r2",
        "revision": "dec-9-r3",
        "ownedLink": {
          "operation": "deleted",
          "link": {
            "id": "https://beads.example/acme/links/9c1e",
            "type": "https://work.example/types/cites",
            "revision": "9c1e-r1"
          }
        },
        "attribution": { "principal": "human:donna", "status": "claimed" }
      }
    }
  ],
  "next": null
}
```

An `updated` delta carrying both a Property Change and an owned-Link change
is rejected: no operation produces both in one transition.

<!-- fixture-invalid: event -->
```json
{
  "id": "ckpt-43_9",
  "ordinal": 9,
  "type": "updated",
  "source": "https://beads.example/acme/events/",
  "subject": "https://beads.example/acme/beads/dec-9",
  "subjectType": "https://work.example/types/decision",
  "transaction": "txn-0a1b",
  "time": "2026-09-07T18:04:12Z",
  "data": {
    "previousRevision": "dec-9-r1",
    "revision": "dec-9-r2",
    "change": [{ "op": "replace", "path": "/status", "value": "accepted" }],
    "ownedLink": {
      "operation": "deleted",
      "link": {
        "id": "https://beads.example/acme/links/9c1e",
        "type": "https://work.example/types/cites",
        "revision": "9c1e-r1"
      }
    }
  }
}
```

An `updated` transition that carries the Link's complete record instead of
its delta is rejected, as is an Event whose `time` is not a calendar
instant.

<!-- fixture-invalid: event -->
```json
{
  "id": "ckpt-52_1",
  "ordinal": 1,
  "type": "updated",
  "source": "https://beads.example/acme/beads/dec-11?view=events",
  "subject": "https://beads.example/acme/beads/dec-11",
  "subjectType": "https://work.example/types/decision",
  "transaction": "txn-0b77",
  "time": "2026-09-08T09:15:30Z",
  "data": {
    "previousRevision": "dec-11-r4",
    "revision": "dec-11-r5",
    "ownedLink": {
      "operation": "updated",
      "link": {
        "id": "https://beads.example/acme/links/7a0b",
        "type": "https://work.example/types/cites",
        "revision": "7a0b-r2",
        "source": "https://beads.example/acme/beads/dec-11",
        "target": "https://beads.example/acme/beads/task-42",
        "properties": { "role": "primary" }
      }
    }
  }
}
```

<!-- fixture-invalid: event -->
```json
{
  "id": "ckpt-43_5",
  "ordinal": 5,
  "type": "deleted",
  "source": "https://beads.example/acme/events/",
  "subject": "https://beads.example/acme/beads/task-42",
  "subjectType": "https://work.example/types/task",
  "transaction": "txn-0a1b",
  "time": "2026-99-99T99:99:99+99:99",
  "data": { "revision": "task-42-r9" }
}
```

### 1.4 Decisions

**T1 — Shape of the owned-Link delta.** RATIFIED 2026-09-08 (operator: as drafted). *Revised (council 10).*
Context: the draft requires an `updated` Event on the source with its fresh
revision but leaves the delta member undefined. Options: (a) a singular
`ownedLink { operation, link }` carrying exactly one transition, exclusive
with `change`, where `link` is the Link's complete record for `created`,
the Link's own delta `{ id, type, previousRevision, revision, change,
attribution? }` for `updated`, and its identity for `deleted`; (b) an object
keyed by owned Link Type URL mirroring the record's `ownedLinks` member,
with `created`, `updated`, and `deleted` arrays, so one Event can carry
several transitions; (c) the complete post-transition `ownedLinks` member as
a snapshot. Tradeoffs: (b) contradicts one version per owned-Link mutation
and forces consumers to reconcile several revisions inside one Event; (c)
contradicts "Event data contains deltas rather than Resource snapshots" and
grows with the owned set's `max`; (a) is bounded, applies in one step, and
needs no new ordering rule inside an Event. The first draft carried the
Link's complete record for `updated` as well, which was a snapshot by
another name, repeated the change the Link's own fact already carries in
full, and widened the surface an erasure must reach (Claude M1); the delta
form is what the draft's own Event law asks for. Recommendation: (a).

**T2 — Payload of a `deleted` owned-Link transition.** RATIFIED 2026-09-08 (operator: as drafted).
Options: (a) the deleted Link's identity `{ id, type, revision }`, with
`revision` the final live revision; (b) the Link's complete last record;
(c) `id` alone. Tradeoffs: (b) makes a deletion carry properties, contrary
to "Deleted Events do not retain the Resource's properties"; (c) drops the
`type` a consumer needs to find the entry without a lookup. Recommendation:
(a), which also matches the changefeed tombstone's identity shape (T17) and
the deleted identity of X1.

**T3 — Ordinal order of the facts one owned-Link operation induces.** RATIFIED 2026-09-08 (operator: as drafted).
*Clarified (council 10).*
Options: (a) the Link's lifecycle fact, then the graph facts at in-Scope
endpoints (source before target, a self-Link's one endpoint receiving both
in that order), then the source's `updated` fact last, with ordinals
assigned in that order and stable under projection; (b) the source's
`updated` fact first; (c) authority-chosen order. Also decided here: a set
operation expands its selected Resources in `canonical-uri` order, so the
receipt's per-Resource entries and the induced facts follow one portable
order — the first draft said "in the authority's selection order", which
no cross-implementation row could assert (Claude L7). Tradeoffs: (c) makes
ordinal assertions non-portable and prevents a cross-implementation row;
(a) lets a consumer observe the Link before the version that covers it,
which is the order a reader of the record would reconstruct. Consumers
apply a group atomically, so the intermediate states between these facts
are never published. Recommendation: (a).

**T4 — No-op owned-Link updates; creation and deletion deltas.** RATIFIED 2026-09-08 (operator: as drafted).
*Clarified (council 10).*
Options: (a) a no-op owned-Link property update versions neither the Link nor
the source, and `CreatedData`/`DeletedData` carry no owned-Link data; (b) the
source is versioned by every owned-Link request even when the Link is
unchanged. Tradeoffs: (b) contradicts the operation-local no-op rule and
would emit a source `updated` Event with nothing to carry. The stated
limitation of (a) is that an Event-only consumer cannot reconstruct the
empty `ownedLinks` key set of a freshly created Bead from `CreatedData`
alone; the record read and the snapshot are authoritative for it, and the
proposed text says so rather than implying otherwise (Codex, T4
assessment). Recommendation: (a).

## 2. Batch envelopes

The draft fixes the batch target, its `Idempotency-Key` field, the
transaction-local label rules, and reference normalization, and it previews
the eight-record operation union as a non-normative sketch. It leaves the
request envelope, the request-side reference grammar, the pre-admission
failure set and its precedence, the admission boundary, and the exact HTTP
statuses unassigned. This section assigns them. The failed-receipt shape
that identifies the failing operation is defined with receipts under
section 3; the durability of admission and the recovery of abandoned
executions are defined with idempotency under section 4.

### 2.1 Proposed normative text

Target: "Batch operation target". Append after the paragraph ending
"Operation order, array order, member presence, and JSON values remain
semantic."

A batch request body conforms to the bundle's `batchRequest` definition:
exactly one member, `operations`, an array of one or more operation records,
each conforming to `batchOperation` — the closed eight-record union whose
`operation` discriminator selects `createBead`, `updateBeadProperties`,
`deleteBead`, `createLink`, `updateLinkProperties`, `deleteLink`,
`updateWhere`, or `deleteWhere`. Each record composes the operation's
member definition shared with the Read+Update singleton and sequence
records — `createBeadMembers` through `deleteLinkMembers`, plus
`updateWhereMembers` and `deleteWhereMembers` — with the `operation`
discriminator and, on a creation record, the optional `name` label, and it
is closed. A body-level `idempotencyKey`, a per-operation `idempotencyKey`,
or any other undefined member makes the request malformed. The
`Idempotency-Key` HTTP field is required and follows
[Idempotency keys](#idempotency-keys); a request that carries no such
field, more than one, or a value outside the grammar is malformed.

Reference members of operation records take the Read+Update reference
definitions: `bead` and `link` are `resourceReference` — a canonical local
ID, an absolute canonical Resource URL, or an `@label` — and `source` and
`target` are `inputReference`, which additionally admits an absolute
out-of-Scope URI and the Pinned Reference form `inputPinnedReference`
around any of those spellings. A creation record's `id` is
`durableResourceReference`: a canonical local ID or an absolute canonical
URL, never an `@label`; a local ID whose first character is `@` is supplied
as its absolute URL. A Pinned Reference whose `uri` is an `@label` is
accepted: the authority resolves the `uri` to the allocated canonical URL
and stores and echoes the `revision` byte-identically, applying no semantic
validation to it, exactly as for every other pin.

Before admission, the authority decides the request's fate in this order,
and a request that fails one step never reaches the next:

1. request bounds — a request target above `request.targetBytes` or a body
   above `request.bodyBytes` is rejected with `413` `request-too-large`
   before the body is parsed;
2. carrier syntax — a body media type other than `application/json` is
   `415` `unsupported-media-type`; a body that is not an I-JSON text under
   [Version erasure](#version-erasure), an absent, repeated, or invalid
   `Idempotency-Key`, a body outside `batchRequest`, a forward, unknown, or
   duplicate label, a label used where the other Resource kind is required,
   a noncanonical local ID spelling, or a supplied `id` beneath the wrong
   fixed root is `400` `malformed-request`, whose problem SHOULD carry
   `pointer`, an RFC 6901 JSON Pointer into the request body naming the
   offending member;
3. the principal — an unauthenticated request is `401` `unauthenticated`,
   and a principal that may not submit mutations to the Scope is `403`
   `forbidden`;
4. the key — a key bound, for this Scope, epoch, and principal, to a
   different normalized request is `409` `idempotency-conflict`, and the
   earlier request's outcome is unaffected; a key bound to the same
   normalized request is answered with its receipt, pending or terminal,
   under [Mutation Transactions](#mutation-transactions), and nothing
   below is evaluated; and
5. admission controls for an unknown key — an `operations` count above
   `transaction.operations` is `413` `limit-exceeded` with `limit`
   `transaction.operations`, a rate limit is `429` `rate-limited`, and an
   authority that cannot admit is `503` `temporarily-unavailable`.

Every one of these is a direct problem that creates no receipt and binds no
key. A syntactically invalid request therefore never consults key state, and
a retained or pending receipt is returned before limits and rate limits are
evaluated, so that a retry that only wants its outcome is never refused for
the capacity its original consumed.

A request is admitted when the authority has durably recorded, in one step,
the key, the normalized request identity, the `pending` Mutation Receipt
with its `transaction` identity, and its own ownership of the execution,
under [Mutation Transactions](#mutation-transactions). From that point
client disconnection, a transport failure, and a bodyless `500` decide
nothing: the transaction commits or fails on its own, the receipt records
which, and every response to that request or to an identical retry is a
Mutation Receipt representation — with one exception. A transient abort
after admission — a serialization conflict the authority does not retry, or
a component it cannot reach — retracts the pending receipt and unbinds the
key in one durable step and is answered, to the original request and to
every joined duplicate, with a direct `503` `temporarily-unavailable` that
SHOULD carry `Retry-After`; the retracted receipt's URL then answers the
uniform `404`, and a retry under the same key executes as a new mutation.
Every other failure after admission is permanent and is reported inside a
`failed` receipt, never as a direct problem.

The batch target's responses are:

- `200 OK` with the terminal Mutation Receipt, whose `status` is `completed`
  or `failed`. A failed transaction is a successful representation of its
  receipt; the HTTP status does not repeat the embedded problem's `status`,
  exactly as a syntactically admitted sequence returns `200 OK` around
  failed members. The synchronous response to the original submission is
  this terminal receipt whenever the transaction reaches its terminal
  disposition within the authority's synchronous wait bound, which is never
  longer than `transaction.duration` when that limit is advertised; the
  normal case therefore requires no follow-up read.
- `202 Accepted` with the `pending` Mutation Receipt: to the original
  submission only when the transaction is still executing at the wait
  bound, and to an identical duplicate that the authority answers before
  the transaction is terminal. The response SHOULD carry `Retry-After` and
  MAY carry `Location` equal to the receipt's `id`. The client waits,
  repeats the original request, or reads the receipt until it is terminal.
- A direct problem, from the ordered list above or the transient-abort
  rule, for a request that is not admitted or whose execution was
  retracted.

Receipt representations use `Content-Type: application/json`,
`Cache-Control: private, no-store`, and the three Transactional response
fields as the serving request's own observation under
[Mutation Receipt responses](#mutation-receipt-responses). Singleton
operation targets on a Transactional Scope use exactly these statuses and
rules: their bodies are the Read+Update singleton request records
`createBeadRequest` through `deleteLinkRequest` — the operation's members
without `operation` and `name`, rejecting `@label` in bare and pinned
forms — and, for the two set targets, `updateWhereRequest` and
`deleteWhereRequest`, the set-operation members without `operation`; each
executes as a one-operation Mutation Transaction and returns its receipt.

The Transactional mutation surface answers as follows; a row's statuses are
exhaustive for that target and method, apart from the bodyless `500` an
unexpected internal fault produces anywhere.

| Target | Method | Response |
| --- | --- | --- |
| `batch`, the eight singleton targets, and `sequence` | `POST` | `200` terminal receipt (`sequence`: the `200` envelope of [Sequence response envelope](#sequence-response-envelope)); `202` pending receipt; direct `400`, `401`, `403`, `409`, `413`, `415`, `429`, `503` |
| the same targets | any other method | `405`, `Allow: POST` — plus `OPTIONS` when cross-origin access is enabled, in which case `OPTIONS` is answered by the CORS rules rather than `405` — and no BDP Problem body |
| `operations/` | `GET`, `HEAD` | `200` Operation Directory; `401`, `403`, `429`, `503` |
| `operations/` | any other method | `405`, `Allow: GET, HEAD` (`OPTIONS` as above) |
| a receipt URL `receipts/{token}` | `GET`, `HEAD` | `200` receipt in its current representation; `401`; `404` for an unknown token, another principal's receipt, a retracted receipt, or a prior epoch's receipt; `429`, `503` |
| a receipt page URL | `GET`, `HEAD` | `200` page; `401`; `404` under the same non-disclosure rule; `410` `cursor-expired` after the receipt's detail expired; `429`, `503` |
| a receipt or page URL | any other method | `405`, `Allow: GET, HEAD` (`OPTIONS` as above) |
| the `receipts` root | any method | `404` `resource-not-found` for `GET` and `HEAD`, `405` with `Allow: GET, HEAD` otherwise |

On a receipt or page read, authentication is decided first, then the
principal and epoch non-disclosure rule, then page expiry, then the
representation: a caller who may not see a receipt learns nothing from an
expired page of it.

Target: "Operation record schema". Replace "The following non-normative
sketch previews the eight-record Transactional union. The sketch has no
independent `$id`." with: "The bundle's `batchOperation` definition is the
normative eight-record union, composed from the same `<operation>Members`
definitions the Read+Update singleton and sequence records use; the sketch
below is a non-normative preview of it and carries no independent `$id`."

Target: "Operation Directory and singleton targets". Replace "It returns the
same Mutation Receipt shape with a one-element `results` array." with: "It
returns the same Mutation Receipt shape, whose `results` holds one entry
for a single-Resource operation and, for a set operation, a `matched` entry
followed by one entry per selected Resource."

### 2.2 Proposed schema

Request-side references are the Read+Update definitions: `resourceReference`
admits the local-ID, absolute-URL, and `@label` spellings the batch accepts
for `bead` and `link`, `inputReference` adds the out-of-Scope URI and the
pinned form for endpoints, and `durableResourceReference` rejects a leading
`@` on a supplied `id`. The label grammar, the kind checks, and the
forward-reference rule are semantic and are enforced before admission; the
schema enforces closure and the `@`-free spelling of a supplied `id`. Each
operation record composes its members mixin with the discriminator, so that
a batch record, a sequence member, and a singleton body can never drift
apart on a member's type.

<!-- bundle-defs -->
```json
{
  "selector": {
    "type": "string",
    "minLength": 1
  },
  "cardinality": {
    "type": "object",
    "properties": {
      "min": { "type": "integer", "minimum": 0 },
      "max": { "type": "integer", "minimum": 0 }
    },
    "minProperties": 1,
    "additionalProperties": false
  },
  "updateWhereMembers": {
    "type": "object",
    "required": ["collection", "selector", "change"],
    "properties": {
      "collection": { "enum": ["beads", "links"] },
      "selector": { "$ref": "#/$defs/selector" },
      "change": { "$ref": "#/$defs/propertyChange" },
      "cardinality": { "$ref": "#/$defs/cardinality" },
      "attribution": { "$ref": "#/$defs/attribution" }
    }
  },
  "deleteWhereMembers": {
    "type": "object",
    "required": ["collection", "selector"],
    "properties": {
      "collection": { "enum": ["beads", "links"] },
      "selector": { "$ref": "#/$defs/selector" },
      "cardinality": { "$ref": "#/$defs/cardinality" },
      "attribution": { "$ref": "#/$defs/attribution" }
    }
  },
  "updateWhereRequest": {
    "title": "BDP Transactional update-where request",
    "type": "object",
    "allOf": [{ "$ref": "#/$defs/updateWhereMembers" }],
    "unevaluatedProperties": false
  },
  "deleteWhereRequest": {
    "title": "BDP Transactional delete-where request",
    "type": "object",
    "allOf": [{ "$ref": "#/$defs/deleteWhereMembers" }],
    "unevaluatedProperties": false
  },
  "createBeadOperation": {
    "type": "object",
    "allOf": [{ "$ref": "#/$defs/createBeadMembers" }],
    "properties": {
      "operation": { "const": "createBead" },
      "name": { "$ref": "#/$defs/localName" }
    },
    "required": ["operation"],
    "unevaluatedProperties": false
  },
  "updateBeadPropertiesOperation": {
    "type": "object",
    "allOf": [{ "$ref": "#/$defs/updateBeadPropertiesMembers" }],
    "properties": {
      "operation": { "const": "updateBeadProperties" }
    },
    "required": ["operation"],
    "unevaluatedProperties": false
  },
  "deleteBeadOperation": {
    "type": "object",
    "allOf": [{ "$ref": "#/$defs/deleteBeadMembers" }],
    "properties": {
      "operation": { "const": "deleteBead" }
    },
    "required": ["operation"],
    "unevaluatedProperties": false
  },
  "createLinkOperation": {
    "type": "object",
    "allOf": [{ "$ref": "#/$defs/createLinkMembers" }],
    "properties": {
      "operation": { "const": "createLink" },
      "name": { "$ref": "#/$defs/localName" }
    },
    "required": ["operation"],
    "unevaluatedProperties": false
  },
  "updateLinkPropertiesOperation": {
    "type": "object",
    "allOf": [{ "$ref": "#/$defs/updateLinkPropertiesMembers" }],
    "properties": {
      "operation": { "const": "updateLinkProperties" }
    },
    "required": ["operation"],
    "unevaluatedProperties": false
  },
  "deleteLinkOperation": {
    "type": "object",
    "allOf": [{ "$ref": "#/$defs/deleteLinkMembers" }],
    "properties": {
      "operation": { "const": "deleteLink" }
    },
    "required": ["operation"],
    "unevaluatedProperties": false
  },
  "updateWhereOperation": {
    "type": "object",
    "allOf": [{ "$ref": "#/$defs/updateWhereMembers" }],
    "properties": {
      "operation": { "const": "updateWhere" }
    },
    "required": ["operation"],
    "unevaluatedProperties": false
  },
  "deleteWhereOperation": {
    "type": "object",
    "allOf": [{ "$ref": "#/$defs/deleteWhereMembers" }],
    "properties": {
      "operation": { "const": "deleteWhere" }
    },
    "required": ["operation"],
    "unevaluatedProperties": false
  },
  "batchOperation": {
    "oneOf": [
      { "$ref": "#/$defs/createBeadOperation" },
      { "$ref": "#/$defs/updateBeadPropertiesOperation" },
      { "$ref": "#/$defs/deleteBeadOperation" },
      { "$ref": "#/$defs/createLinkOperation" },
      { "$ref": "#/$defs/updateLinkPropertiesOperation" },
      { "$ref": "#/$defs/deleteLinkOperation" },
      { "$ref": "#/$defs/updateWhereOperation" },
      { "$ref": "#/$defs/deleteWhereOperation" }
    ]
  },
  "batchRequest": {
    "title": "BDP Transactional batch request",
    "type": "object",
    "required": ["operations"],
    "properties": {
      "operations": {
        "type": "array",
        "minItems": 1,
        "items": { "$ref": "#/$defs/batchOperation" }
      }
    },
    "additionalProperties": false
  },
  "transactionalOperationDirectory": {
    "title": "BDP Transactional Operation Directory",
    "type": "object",
    "required": [
      "createBead",
      "updateBeadProperties",
      "deleteBead",
      "createLink",
      "updateLinkProperties",
      "deleteLink",
      "sequence",
      "updateWhere",
      "deleteWhere",
      "batch"
    ],
    "properties": {
      "createBead": { "const": "create-bead" },
      "updateBeadProperties": { "const": "update-bead-properties" },
      "deleteBead": { "const": "delete-bead" },
      "createLink": { "const": "create-link" },
      "updateLinkProperties": { "const": "update-link-properties" },
      "deleteLink": { "const": "delete-link" },
      "sequence": { "const": "sequence" },
      "updateWhere": { "const": "update-where" },
      "deleteWhere": { "const": "delete-where" },
      "batch": { "const": "batch" }
    },
    "additionalProperties": false
  }
}
```

### 2.3 Fixtures

A three-operation batch: a creator-supplied Decision identity, an owned
`cites` Link from it to an existing Task through the `@decision` label, and a
guarded update of that Task. The batch is submitted as
`POST /acme/operations/batch` with `Idempotency-Key: client-key-0001` and
commits at `pos-43`.

<!-- fixture: batchRequest -->
```json
{
  "operations": [
    {
      "name": "decision",
      "operation": "createBead",
      "id": "beads/dec-9",
      "type": "https://work.example/types/decision",
      "properties": { "title": "Adopt owned Links", "status": "proposed" },
      "attribution": { "principal": "agent:planner", "status": "claimed" }
    },
    {
      "name": "cite",
      "operation": "createLink",
      "type": "https://work.example/types/cites",
      "source": "@decision",
      "target": "beads/task-42",
      "properties": { "role": "evidence" },
      "attribution": { "principal": "agent:planner", "status": "claimed" }
    },
    {
      "operation": "updateBeadProperties",
      "bead": "beads/task-42",
      "expectedRevision": "task-42-r7",
      "change": [{ "op": "replace", "path": "/status", "value": "cited" }]
    }
  ]
}
```

The draft's incident-Link cleanup composed with a Bead deletion, with a
pinned external endpoint written the request-side way. It commits at
`pos-46`, after the two erasures under section 5.3, so the Task is at
`task-42-r9` when the deletion is reached.

<!-- fixture: batchRequest -->
```json
{
  "operations": [
    {
      "operation": "deleteWhere",
      "collection": "links",
      "selector": "$[?@.source == \"https://beads.example/acme/beads/task-42\" || @.target == \"https://beads.example/acme/beads/task-42\"]",
      "cardinality": { "max": 1000 },
      "attribution": { "principal": "human:donna", "status": "claimed" }
    },
    {
      "operation": "deleteBead",
      "bead": "beads/task-42",
      "expectedRevision": "task-42-r9"
    },
    {
      "operation": "createLink",
      "type": "https://work.example/types/relates",
      "source": "beads/task-43",
      "target": { "uri": "https://github.example/issues/123", "revision": "8f0e2b" },
      "properties": {}
    }
  ]
}
```

The body of a `POST operations/delete-where` singleton request: the set
operation's members without `operation`.

<!-- fixture: deleteWhereRequest -->
```json
{
  "collection": "links",
  "selector": "$[?@.type == \"https://work.example/types/relates\" && @.source == \"https://beads.example/acme/beads/task-43\"]",
  "cardinality": { "min": 1 },
  "attribution": { "principal": "human:donna", "status": "claimed" }
}
```

The Transactional Operation Directory, as served by `GET operations/`.

<!-- fixture: transactionalOperationDirectory -->
```json
{
  "createBead": "create-bead",
  "updateBeadProperties": "update-bead-properties",
  "deleteBead": "delete-bead",
  "createLink": "create-link",
  "updateLinkProperties": "update-link-properties",
  "deleteLink": "delete-link",
  "sequence": "sequence",
  "updateWhere": "update-where",
  "deleteWhere": "delete-where",
  "batch": "batch"
}
```

A body-level `idempotencyKey` is rejected: the HTTP field is the only key.

<!-- fixture-invalid: batchRequest -->
```json
{
  "idempotencyKey": "client-key-0001",
  "operations": [
    {
      "operation": "createBead",
      "type": "https://work.example/types/task",
      "properties": { "title": "Not admitted" }
    }
  ]
}
```

A per-operation `idempotencyKey` belongs to `sequence` members and is
rejected in a batch.

<!-- fixture-invalid: batchRequest -->
```json
{
  "operations": [
    {
      "operation": "createBead",
      "idempotencyKey": "member-key-1",
      "type": "https://work.example/types/task"
    }
  ]
}
```

A supplied `id` spelled with a leading `@` is rejected; this fixture carries
nothing else the schema could object to, so it isolates the constraint.

<!-- fixture-invalid: batchRequest -->
```json
{
  "operations": [
    {
      "operation": "createBead",
      "id": "@not-a-label",
      "type": "https://work.example/types/task"
    }
  ]
}
```

A set-operation singleton body that carries the batch discriminator is
rejected.

<!-- fixture-invalid: updateWhereRequest -->
```json
{
  "operation": "updateWhere",
  "collection": "beads",
  "selector": "$[?@.properties.status == \"ready\"]",
  "change": [{ "op": "replace", "path": "/status", "value": "claimed" }]
}
```

### 2.4 Decisions

**T5 — Batch envelope and request-side reference grammar.** RATIFIED 2026-09-08 (operator: as drafted). *Revised
(council 10).*
Context: the draft's operation sketch is non-normative, uses `format: uri`
for Type IDs where the bundle uses `absoluteHttpUrl`, and lets a Pinned
Reference's `uri` be any nonempty string, which is right for requests and
wrong for the response-side `pinnedReference`. Sub-decisions: (a) the
request envelope is the closed `batchRequest` with the single `operations`
member, so body-level and per-operation keys are schema failures rather
than semantic ones; (b) request-side references are the Read+Update
definitions `resourceReference`, `inputReference`, `inputPinnedReference`,
and `durableResourceReference`, distinct from the response-side
`reference`, rather than the first draft's `mutationResourceReference`
family, which restated them (Claude H6, M13); (c) a Pinned Reference whose
`uri` is an `@label` is accepted and echoed with the allocated URL, applying
the draft's one law for every pin, rather than rejected as a pin on a
not-yet-existing version; (d) a supplied `id` is schema-constrained to not
begin with `@`, which is the draft's rule made mechanical; (e) **shared**:
operation records are named `<operation>Operation` and compose the
Read+Update `<operation>Members` mixin with the discriminator and
`unevaluatedProperties: false`, exactly as the sequence members compose it,
and the two set-operation singleton bodies are `updateWhereRequest` and
`deleteWhereRequest` over `updateWhereMembers` and `deleteWhereMembers`,
which the Read+Update half cannot supply (Codex M17). Alternatives: for
(c), reject pins on labels with `malformed-request` (adds semantic pin
validation the draft forbids); for (e), one open definition shared by both
carriers (loses closure), or restated closed records (drift). Recommendation:
(a)–(e) as stated.

**T6 — HTTP statuses for the mutation surface.** RATIFIED 2026-09-08 (operator: as drafted). *Revised (council 10).*
Sub-decisions: (a) `200 OK` for every terminal receipt, `failed` included;
alternatives are the failing operation's would-be status with a receipt body
(mixes a problem status with a non-problem media type and breaks the
one-shape rule for retries) or a fixed `422` for failed receipts (invents a
status the embedded problem already carries); (b) `202 Accepted` for the
original submission only when the synchronous wait bound elapses first
(T38), and for a duplicate answered before the transaction is terminal;
(c) the pre-admission direct-problem set is closed to `413`
`request-too-large`, `415` `unsupported-media-type`, `400`
`malformed-request`, `401`, `403`, `409` `idempotency-conflict`, `413`
`limit-exceeded`, `429`, and `503`, decided in the precedence order of
section 2.1 (T41), and the post-admission direct set is exactly the
transient-abort `503` (T34); (d) `405` with `Allow: POST` for other methods
on mutation targets, with `OPTIONS` answered by the CORS rules rather than
`405` when cross-origin access is enabled; (e) `Retry-After` SHOULD and
`Location` MAY accompany `202`; (f) the matrix under section 2.1 is the
one statement of every target's statuses (T42), replacing the first
draft's three partly inconsistent lists (Codex M12). Recommendation: (a)–(f)
as stated.

**T41 — Carrier-neutral semantic identity and pre-admission precedence.** RATIFIED 2026-09-08 (operator: as drafted).
Context: T13 chose one key namespace across carriers but left the semantic
comparison to the draft's "delivery-only metadata" sentence, which does not
say whether `name` is significant or how a `@label` compares before its
identity exists (Codex H6, Claude M8); and the first draft's pre-admission
list stated no order, so a rate-limited retry could be refused the receipt
it had already paid for, or a malformed request could consult key state
(Codex M12). Options: (a) adopt Read+Update D3 whole — operation kind plus
the normalized record, `name` and the carrier excluded, `expectedRevision`
and `attribution` included, RFC 6902 Section 4.6 equality — and, for a
batch, normalize a `@label` to the creating operation's zero-based index
when it supplies no `id` and to the supplied identity's canonical URL when
it does; decide admission in the order bounds → carrier syntax →
principal → key → admission controls; (b) treat `name` as semantic (a
retry that renames a label conflicts for no protocol reason); (c) normalize
a batch `@label` to the identity the original execution allocated (does not
exist before commit, and would make an admitted-but-pending request
incomparable to its own duplicate); (d) evaluate limits and rate limits
before the key (a retry can then be refused the outcome it already owns).
Recommendation: (a). The proposed text is under sections 2.1 and 4.1.

**T42 — The endpoint/status matrix.** RATIFIED 2026-09-08 (operator: as drafted).
Context: the first draft assigned statuses in three places that disagreed
— its pre-admission set included `429` and `503` in one list and not
another, "every method other than POST" swept up a CORS `OPTIONS` it also
advertised in `Allow`, "every response after admission is a receipt"
contradicted the bodyless `500` and later authentication failures, and the
decision index said `202` for "any pending answer" while receipt reads
used `200` (Codex M12). Options: (a) one matrix, in section 2.1, that is
exhaustive per target and method, with the HTTP-native exceptions (`405`,
bodyless `500`, CORS preflight) stated once, the receipt-read precedence
(authentication, non-disclosure, expiry, representation) stated once, and
the sentence that a transport failure after admission decides nothing;
(b) leave the statuses in prose per section. Recommendation: (a).

## 3. Mutation Receipts and the Transactional problem table

The draft fixes what a receipt records, that it is durable, principal-bound,
re-authorized on read, paginated for large set results, retained as a
compact tombstone after its detail expires, and returned unchanged to an
identical retry. It leaves the receipt schema, the `pending` and expired
representations, the result-entry model, the failed-receipt problem shape,
the receipt problem codes, and the receipt HTTP statuses unassigned. This
section assigns them, and — following the council — it makes the receipt a
store that erasure reaches, gives every delivery path one authorization
projection, separates the body's historical facts from the serving
request's observation, and keeps the disposition and the allocated
identities after the detail is gone.

### 3.1 Proposed normative text

Target: "Mutation Receipt responses". Replace the example receipt and the
sentence "A successful batch contains one result per operation in
declaration order:" with "A successful batch contains one entry per
single-Resource operation and, for a set operation, a `matched` entry
followed by one entry per selected Resource, in declaration order:" and the
receipt example under section 3.4 (`rcpt-7`). Replace the last paragraph's
final sentence, "Exact HTTP statuses and receipt problem schemas are not yet
assigned in this draft.", with the following.

Every admitted mutation has one Mutation Receipt at an authority-allocated
URL beneath the discovered `receipts` root — `receipts/{token}`, where the
token is a checkpoint-profile token — and the receipt's `id` is that
absolute URL. `GET` and `HEAD` of the receipt URL return the receipt's
current representation with `200 OK`, `Cache-Control: private, no-store`,
and the Transactional response fields. A receipt URL that does not exist,
that belongs to another principal, that was retracted under
[Mutation Transactions](#mutation-transactions), or that was allocated in
another Scope epoch returns the uniform `404` `resource-not-found`:
receipts are principal-bound, and they are not an enumeration oracle. The
`receipts` root is a namespace prefix, not a Resource: it is discovered so
that receipt URLs are recognizably the authority's and clients never
construct them, BDP v0 defines no receipt listing and no lookup by key, and
a `GET` of the root returns `404` `resource-not-found`. A client resolves a
lost response by retrying the original request with its original key,
which returns the receipt.

A receipt's `status` is `pending` until the transaction is terminal and then
exactly one of `completed` or `failed`, forever. Every receipt carries `id`,
`status`, `idempotencyKey`, `scopeEpoch`, `authorizationView`, and
`transaction`, the opaque identity every Event and change group of the
transaction carries. A terminal receipt additionally carries
`requiredPosition` and `detail`, and, when the transaction produced a change
group, `effectPosition`. `detail` states what the representation discloses
beyond the disposition: `available` — the results or the problem are
present; `expired` — the authority discarded them under its receipt
retention; `withheld` — the caller's current Authorization View may not see
any of them. When `detail` is `available`, a `completed` receipt carries
`results`, `next`, and `expiresAt`, and a `failed` receipt carries `problem`
and `expiresAt`. `expiresAt` is the instant until which the authority
retains the detail; when discovery advertises `retention.receipt`, it MUST
be no earlier than the terminal instant plus that duration. After
`expiresAt` the authority MAY discard the detail and serve the receipt with
`detail` `expired`. What it never discards is the compact receipt — the
key, the normalized request identity, the disposition, the positions, and,
for every creation operation, the identity it allocated — which it retains
for the rest of the Scope epoch. An `expired` `completed` receipt therefore
carries `allocated`: one entry per creation operation in operation order,
with the operation's `operationIndex`, its `operationName` when it declared
one, and the allocated `id` and `type` — the same identities the vanished
`created` entries carried and the ones a later `@name` reference in a
sequence still resolves through. An identical retry after expiry returns
the `expired` receipt with `200 OK` and never executes the mutation again.

`results` is an ordered array of result entries in the vocabulary of
[Mutation results](#mutation-results). Each entry carries the zero-based
`operationIndex` of the operation that produced it and, when that operation
declared one, its `operationName`. A single-Resource operation produces
exactly one entry: `created` or `updated`, carrying `resource`, the
complete postimage — the Resource's state immediately after that
operation, which a later operation in the same transaction may supersede —
or `deleted`, carrying `deleted`, the deleted Resource's identity: `id`,
`type`, and final live `revision`. A semantic no-op update, defined under
[Revisions](#revisions), produces an `updated` entry carrying the postimage
at the retained revision, and a transaction all of whose operations are
no-ops is an admitted no-effect mutation: it completes, produces no group,
and its receipt omits `effectPosition`. An entry for an operation on an
owned Link additionally carries `source`, the source Bead's canonical URL,
and `sourceRevision`, the source Bead's resulting revision, on creation,
update, and deletion alike; on a no-op update `sourceRevision` is the
source's unchanged revision. A set operation produces one `matched` entry
carrying `count`, the number of Resources it selected, followed by one
`updated` or `deleted` entry per selected Resource in ascending code-unit
order of their canonical `id`s, the order in which the operation expands
under [Events and Event Sources](#events-and-event-sources); a zero-match
operation produces its `matched` entry with `count` `0` and nothing else.
Entries appear in operation order. `page.maximumItems`, when advertised,
bounds the entries in the receipt's inline `results` and in each page,
every entry counting as one whatever its outcome; when it is not, the
authority applies a bound of its own. When every entry fits within the
bound, `results` holds them all and `next` is `null`; otherwise `results`
holds a prefix and `next` is an absolute URL whose `GET` returns a
`mutationReceiptPage` — `receipt`, the receipt's `id`; `results`, the next
entries; and `next`. Pages are immutable in what they record, never split
an entry, and are served through the same projection as the receipt. After
the receipt's detail expires, a page URL returns `410` `cursor-expired`,
decided after authentication and the receipt's non-disclosure rule.

Every delivery of a receipt — the synchronous response, the response to a
duplicate, a later `GET` or `HEAD`, every page, and the projection of a
member's receipt into a sequence response — is one representation, the
receipt as retained projected under the serving request's current
Authorization View. An entry that carries a Resource record — `created`
or `updated` — is served only when the current view projects that record
as retained, whether or not the Resource still exists or is at that
revision, and the view's closure over owned Links applies: hiding a Bead
hides the entries of every Bead that owns a Link to it and of those Links.
An entry the view does not project is served as `withheld`, carrying only
`operationIndex` and, when present, `operationName`; an `allocated` entry
is re-authorized the same way and carries `withheld` `true` in place of its
identity. Entries that carry no record — `matched` counts, `deleted` and
`erased` identities, and `withheld` entries — and a `failed` receipt's
`problem` are the transaction's own execution facts, disclosed to the
principal when it executed, and are served as retained. When a `completed`
receipt's every entry is withheld, the receipt carries `detail` `withheld`
and neither `results`, `next`, nor `allocated`; a `failed` receipt is never
`withheld`. The disposition, `requiredPosition`, and `effectPosition` are
never withheld. Withholding is authorization, never deletion: an entry
whose Resource was since deleted is served like any other when the view
projects its retained record.

A receipt is a store of every version its postimages carry, and
[Version erasure](#version-erasure) reaches it: from the moment the
authority processes the erasure record, on every delivery path and
whatever `expiresAt` promised, an entry whose postimage is an erased
version never carries the content again. To a caller authorized for the
subject's retained history — the one authorization that gates the
`resource-erased` disclosure under [Reads after deletion](#reads-after-deletion)
— the entry is served as `erased`: `operationIndex`, `operationName` when
present, `erased`, the version's lineage marker `{ id, type, revision }`,
and `source` and `sourceRevision` when the operation was on an owned Link.
To every other caller it is the uniform `withheld` entry, so that a receipt
is no more an erasure oracle than a read is.

The three Transactional response fields on a receipt or page response are
the serving request's own observation, never the body's history:
`BDP-Scope-Epoch` and `BDP-Authorization-View` carry the current epoch and
the caller's current view token, and `BDP-Scope-Position` carries the
position the read observed — at or after `effectPosition` on a terminal
receipt served synchronously, honoring `BDP-Minimum-Scope-Position` on a
later read exactly as any read does, and the observed head on a `202`. The
body's `scopeEpoch`, `authorizationView`, `requiredPosition`, and
`effectPosition` are the execution's recorded facts and never change; after
a view rotation the body still names the view under which the transaction
executed, and the recorded `requiredPosition` remains evidence about that
view rather than a checkpoint for the current one.

A `failed` receipt's `problem` is a Problem Details object of the receipt
form. It carries the code's `status` — the HTTP status the failure would
have had as a direct response, required because the enclosing status is
`200 OK` — and `operationIndex`, the zero-based index of the operation
being evaluated when the failure was detected, with `operationName` when
that operation declared one. A failure the authority establishes for the
transaction as a whole rather than at one operation — a `limit-exceeded`
on `transaction.duration`, `transaction.inducedEvents`,
`transaction.examinedResources`, `transaction.matchedResources`, or
`transaction.mutatedResources` counted across operations, or an
`aggregate-constraint-violation` established at commit — omits
`operationIndex` rather than fabricating one. When the authority can locate
the cause within the request, the problem carries `pointer`, an RFC 6901
JSON Pointer into the request body as submitted, so that in a batch it
begins with `/operations/{operationIndex}` and in a singleton it addresses
the record directly. A `limit-exceeded` problem SHOULD carry `limit`, the
dotted name of the crossed limit under `limits`. A `validation-failed`
problem carries `diagnostics` and, when it truncated them,
`diagnosticsTruncated`, exactly as [Problem details](#problem-details)
defines them for the Read+Update rows. A `failed` receipt's problem
describes the rejected request, not a committed version, and lies outside
erasure; an authority that nonetheless quoted a committed version's content
in `detail` or a diagnostic scrubs it as a store would.

### 3.2 Transactional problem table

Target: "Problem details". Append after the paragraph ending "The bundle
defines `readUpdateProblemCode`, `readUpdateProblem` (with the member-level
`retryAfter` under [Sequence response envelope](#sequence-response-envelope)),
`validationDiagnostic`, and `validationDiagnostics`."

The Transactional profile inherits the Read table and the Read+Update rows
above and adds three rows:

| Code | Family suffix | HTTP status | Retry |
| --- | --- | --- | --- |
| `cardinality-violated` | `conflict` | 409 | `after-state-change` |
| `event-history-expired` | `gone` | 410 | `never` |
| `catch-up-timeout` | `unavailable` | 503 | `after-delay` |

The Transactional rows mean:

- `cardinality-violated`: a set operation's matched count is outside its
  `cardinality`, under [Set mutation](#set-mutation).
- `event-history-expired`: an Event Source's history aged out of the
  retention window, disclosed only to a principal authorized for that
  subject's retained history, under
  [Reads after deletion](#reads-after-deletion).
- `catch-up-timeout`: a read carrying `BDP-Minimum-Scope-Position` could
  not be served at or after that position within the authority's wait
  bound, under
  [HTTP consistency, caching, and CORS fields](#http-consistency-caching-and-cors-fields).

On a Transactional Scope every code occurs in one of two contexts, and the
bundle closes each context to its codes. A *direct* code is served as a
direct problem response: every Read code, `unsupported-media-type`,
`idempotency-conflict`, `event-history-expired`, and `catch-up-timeout`. A
*receipt* code occurs inside a `failed` Mutation Receipt, where the problem
carries the code's `status` as the failure's would-be direct status:
`validation-failed`, `type-not-installed`, `identity-taken`,
`revision-mismatch`, `incident-links-exist`,
`aggregate-constraint-violation`, `cardinality-violated`, and three Read
codes with these meanings — `forbidden`, operation-local authorization
denied the operation when it was reached, including a selected Resource
that is not writable; `resource-not-found`, `bead`, `link`, or an in-Scope
endpoint does not identify a live Resource visible in the request's
Authorization View, or a durable reference names a Resource of another
kind; and `limit-exceeded`, an advertised or enforced transaction limit —
examined, matched, or mutated Resources, induced Events, or duration — was
crossed after admission. A `failed` receipt never carries
`temporarily-unavailable`: an abort the authority does not retry is
transient and retracts the receipt under
[Mutation Transactions](#mutation-transactions), so no receipt is ever
bound to an outcome a retry could change. Inside a `failed` receipt, `retry`
`never` means the request as written can never succeed, and `retry`
`after-state-change` means a new request under a new key may succeed after
the client refreshes its state; neither means the same key executes again.
The Read+Update dispositions `idempotency-in-progress`,
`idempotency-expired`, and `binding-unavailable` are never direct problems
on a Transactional Scope — a pending receipt is joined and an expired one
is returned — and occur only as the sequence-member projections defined
under [Mutation Transactions](#mutation-transactions). The bundle defines
`transactionalOnlyProblemCode`, `transactionalProblemCode`,
`directProblemCode`, `receiptProblemCode`, `transactionalProblem`, and
`receiptProblem`; the Transactional profile adds no `status` value beyond
the Read+Update set.

### 3.3 Proposed schema

`receiptCore` types every member once; `mutationReceipt` closes the six
representations — `pending`, `completed` and `failed` with detail,
`completed` and `failed` with expired detail, and `completed` with withheld
detail — over it. `receiptResult` uses the Read+Update result vocabulary and
adds the `matched`, `withheld`, and `erased` outcomes. `transactionalProblem`
and `receiptProblem` route every Read+Update code through
`readUpdateProblem` by reference, so that the shared rows are stated once,
and add only the three Transactional rows, the context enums, and the
attribution rules.

<!-- bundle-defs -->
```json
{
  "receiptStatus": {
    "enum": ["pending", "completed", "failed"]
  },
  "receiptDetail": {
    "enum": ["available", "expired", "withheld"]
  },
  "receiptEntryOutcome": {
    "enum": ["created", "updated", "deleted", "matched", "withheld", "erased"]
  },
  "receiptResult": {
    "type": "object",
    "required": ["operationIndex", "outcome"],
    "properties": {
      "operationIndex": { "type": "integer", "minimum": 0 },
      "operationName": { "$ref": "#/$defs/localName" },
      "outcome": { "$ref": "#/$defs/receiptEntryOutcome" },
      "resource": {
        "oneOf": [
          {
            "allOf": [
              { "$ref": "#/$defs/beadRecord" },
              { "type": "object", "properties": { "links": false } }
            ]
          },
          { "$ref": "#/$defs/linkRecord" }
        ]
      },
      "deleted": { "$ref": "#/$defs/resourceIdentity" },
      "erased": { "$ref": "#/$defs/resourceIdentity" },
      "source": { "$ref": "#/$defs/absoluteHttpUrl" },
      "sourceRevision": { "$ref": "#/$defs/revision" },
      "count": { "type": "integer", "minimum": 0 }
    },
    "allOf": [
      {
        "if": {
          "properties": { "outcome": { "enum": ["created", "updated"] } },
          "required": ["outcome"]
        },
        "then": {
          "required": ["resource"],
          "properties": { "resource": true, "deleted": false, "erased": false, "count": false }
        }
      },
      {
        "if": {
          "properties": { "outcome": { "const": "deleted" } },
          "required": ["outcome"]
        },
        "then": {
          "required": ["deleted"],
          "properties": { "deleted": true, "resource": false, "erased": false, "count": false }
        }
      },
      {
        "if": {
          "properties": { "outcome": { "const": "erased" } },
          "required": ["outcome"]
        },
        "then": {
          "required": ["erased"],
          "properties": { "erased": true, "resource": false, "deleted": false, "count": false }
        }
      },
      {
        "if": {
          "properties": { "outcome": { "const": "matched" } },
          "required": ["outcome"]
        },
        "then": {
          "required": ["count"],
          "properties": {
            "count": true,
            "operationName": false,
            "resource": false,
            "deleted": false,
            "erased": false,
            "source": false,
            "sourceRevision": false
          }
        }
      },
      {
        "if": {
          "properties": { "outcome": { "const": "withheld" } },
          "required": ["outcome"]
        },
        "then": {
          "properties": {
            "resource": false,
            "deleted": false,
            "erased": false,
            "source": false,
            "sourceRevision": false,
            "count": false
          }
        }
      },
      {
        "if": {
          "required": ["resource"],
          "properties": { "resource": { "$ref": "#/$defs/beadRecord" } }
        },
        "then": {
          "properties": { "source": false, "sourceRevision": false }
        }
      }
    ],
    "dependentRequired": {
      "source": ["sourceRevision"],
      "sourceRevision": ["source"]
    },
    "additionalProperties": false
  },
  "allocatedIdentity": {
    "type": "object",
    "required": ["operationIndex"],
    "properties": {
      "operationIndex": { "type": "integer", "minimum": 0 },
      "operationName": { "$ref": "#/$defs/localName" },
      "id": { "$ref": "#/$defs/absoluteHttpUrl" },
      "type": { "$ref": "#/$defs/absoluteHttpUrl" },
      "withheld": { "const": true }
    },
    "oneOf": [
      {
        "required": ["id", "type"],
        "properties": { "id": true, "type": true, "withheld": false }
      },
      {
        "required": ["withheld"],
        "properties": { "withheld": true, "id": false, "type": false }
      }
    ],
    "additionalProperties": false
  },
  "receiptCore": {
    "type": "object",
    "properties": {
      "id": { "$ref": "#/$defs/absoluteHttpUrl" },
      "status": { "$ref": "#/$defs/receiptStatus" },
      "detail": { "$ref": "#/$defs/receiptDetail" },
      "idempotencyKey": { "$ref": "#/$defs/idempotencyKey" },
      "scopeEpoch": { "$ref": "#/$defs/wireToken" },
      "authorizationView": { "$ref": "#/$defs/wireToken" },
      "transaction": { "$ref": "#/$defs/wireToken" },
      "requiredPosition": { "$ref": "#/$defs/wireToken" },
      "effectPosition": { "$ref": "#/$defs/wireToken" },
      "results": {
        "type": "array",
        "items": { "$ref": "#/$defs/receiptResult" }
      },
      "next": {
        "oneOf": [{ "$ref": "#/$defs/absoluteHttpUrl" }, { "type": "null" }]
      },
      "allocated": {
        "type": "array",
        "items": { "$ref": "#/$defs/allocatedIdentity" }
      },
      "problem": { "$ref": "#/$defs/receiptProblem" },
      "expiresAt": { "$ref": "#/$defs/dateTime" }
    },
    "allOf": [
      {
        "if": { "properties": { "status": { "const": "failed" } }, "required": ["status"] },
        "then": { "properties": { "effectPosition": false } }
      }
    ],
    "additionalProperties": false
  },
  "mutationReceipt": {
    "title": "BDP Mutation Receipt",
    "type": "object",
    "allOf": [{ "$ref": "#/$defs/receiptCore" }],
    "oneOf": [
      {
        "type": "object",
        "required": ["id", "status", "idempotencyKey", "scopeEpoch", "authorizationView", "transaction"],
        "properties": {
          "id": true,
          "status": { "const": "pending" },
          "idempotencyKey": true,
          "scopeEpoch": true,
          "authorizationView": true,
          "transaction": true,
          "detail": false,
          "requiredPosition": false,
          "effectPosition": false,
          "results": false,
          "next": false,
          "allocated": false,
          "problem": false,
          "expiresAt": false
        }
      },
      {
        "type": "object",
        "required": [
          "id",
          "status",
          "detail",
          "idempotencyKey",
          "scopeEpoch",
          "authorizationView",
          "transaction",
          "requiredPosition",
          "results",
          "next",
          "expiresAt"
        ],
        "properties": {
          "id": true,
          "status": { "const": "completed" },
          "detail": { "const": "available" },
          "idempotencyKey": true,
          "scopeEpoch": true,
          "authorizationView": true,
          "transaction": true,
          "requiredPosition": true,
          "effectPosition": true,
          "results": true,
          "next": true,
          "expiresAt": true,
          "allocated": false,
          "problem": false
        }
      },
      {
        "type": "object",
        "required": [
          "id",
          "status",
          "detail",
          "idempotencyKey",
          "scopeEpoch",
          "authorizationView",
          "transaction",
          "requiredPosition",
          "problem",
          "expiresAt"
        ],
        "properties": {
          "id": true,
          "status": { "const": "failed" },
          "detail": { "const": "available" },
          "idempotencyKey": true,
          "scopeEpoch": true,
          "authorizationView": true,
          "transaction": true,
          "requiredPosition": true,
          "problem": true,
          "expiresAt": true,
          "effectPosition": false,
          "results": false,
          "next": false,
          "allocated": false
        }
      },
      {
        "type": "object",
        "required": [
          "id",
          "status",
          "detail",
          "idempotencyKey",
          "scopeEpoch",
          "authorizationView",
          "transaction",
          "requiredPosition",
          "allocated"
        ],
        "properties": {
          "id": true,
          "status": { "const": "completed" },
          "detail": { "const": "expired" },
          "idempotencyKey": true,
          "scopeEpoch": true,
          "authorizationView": true,
          "transaction": true,
          "requiredPosition": true,
          "effectPosition": true,
          "allocated": true,
          "results": false,
          "next": false,
          "problem": false,
          "expiresAt": false
        }
      },
      {
        "type": "object",
        "required": [
          "id",
          "status",
          "detail",
          "idempotencyKey",
          "scopeEpoch",
          "authorizationView",
          "transaction",
          "requiredPosition"
        ],
        "properties": {
          "id": true,
          "status": { "const": "failed" },
          "detail": { "const": "expired" },
          "idempotencyKey": true,
          "scopeEpoch": true,
          "authorizationView": true,
          "transaction": true,
          "requiredPosition": true,
          "effectPosition": false,
          "results": false,
          "next": false,
          "allocated": false,
          "problem": false,
          "expiresAt": false
        }
      },
      {
        "type": "object",
        "required": [
          "id",
          "status",
          "detail",
          "idempotencyKey",
          "scopeEpoch",
          "authorizationView",
          "transaction",
          "requiredPosition"
        ],
        "properties": {
          "id": true,
          "status": { "const": "completed" },
          "detail": { "const": "withheld" },
          "idempotencyKey": true,
          "scopeEpoch": true,
          "authorizationView": true,
          "transaction": true,
          "requiredPosition": true,
          "effectPosition": true,
          "results": false,
          "next": false,
          "allocated": false,
          "problem": false,
          "expiresAt": false
        }
      }
    ]
  },
  "mutationReceiptPage": {
    "title": "BDP Mutation Receipt page",
    "type": "object",
    "required": ["receipt", "results", "next"],
    "properties": {
      "receipt": { "$ref": "#/$defs/absoluteHttpUrl" },
      "results": {
        "type": "array",
        "minItems": 1,
        "items": { "$ref": "#/$defs/receiptResult" }
      },
      "next": {
        "oneOf": [{ "$ref": "#/$defs/absoluteHttpUrl" }, { "type": "null" }]
      }
    },
    "additionalProperties": false
  },
  "transactionalOnlyProblemCode": {
    "enum": ["cardinality-violated", "event-history-expired", "catch-up-timeout"]
  },
  "transactionalProblemCode": {
    "anyOf": [
      { "$ref": "#/$defs/readUpdateProblemCode" },
      { "$ref": "#/$defs/transactionalOnlyProblemCode" }
    ]
  },
  "directProblemCode": {
    "enum": [
      "malformed-request",
      "invalid-parameter",
      "unauthenticated",
      "forbidden",
      "resource-not-found",
      "resource-pruned",
      "resource-erased",
      "foreign-view",
      "cursor-expired",
      "request-too-large",
      "limit-exceeded",
      "rate-limited",
      "temporarily-unavailable",
      "unsupported-media-type",
      "idempotency-conflict",
      "event-history-expired",
      "catch-up-timeout"
    ]
  },
  "receiptProblemCode": {
    "enum": [
      "forbidden",
      "resource-not-found",
      "limit-exceeded",
      "validation-failed",
      "type-not-installed",
      "identity-taken",
      "revision-mismatch",
      "incident-links-exist",
      "aggregate-constraint-violation",
      "cardinality-violated"
    ]
  },
  "transactionalProblem": {
    "title": "BDP Transactional Problem Details",
    "type": "object",
    "required": ["type", "code", "retry"],
    "properties": {
      "type": { "$ref": "#/$defs/absoluteHttpUrl" },
      "title": { "type": "string" },
      "status": { "type": "integer", "enum": [400, 401, 403, 404, 409, 410, 413, 415, 422, 429, 503] },
      "detail": { "type": "string" },
      "instance": { "$ref": "#/$defs/absoluteUri" },
      "code": { "$ref": "#/$defs/directProblemCode" },
      "retry": { "$ref": "#/$defs/retryDisposition" },
      "retryAfter": { "type": "integer", "minimum": 0 },
      "pointer": { "$ref": "#/$defs/jsonPointer" },
      "limit": { "type": "string", "pattern": "^[a-z]+\\.[A-Za-z]+$" },
      "archivedAt": { "$ref": "#/$defs/reference" }
    },
    "allOf": [
      {
        "if": {
          "properties": { "code": { "$ref": "#/$defs/readUpdateProblemCode" } },
          "required": ["code"]
        },
        "then": { "$ref": "#/$defs/readUpdateProblem" }
      },
      {
        "if": { "properties": { "code": { "const": "event-history-expired" } }, "required": ["code"] },
        "then": {
          "properties": {
            "type": { "const": "https://github.com/gastownhall/bdp/problems/gone" },
            "status": { "const": 410 },
            "retry": { "const": "never" }
          }
        }
      },
      {
        "if": { "properties": { "code": { "const": "catch-up-timeout" } }, "required": ["code"] },
        "then": {
          "properties": {
            "type": { "const": "https://github.com/gastownhall/bdp/problems/unavailable" },
            "status": { "const": 503 },
            "retry": { "const": "after-delay" }
          }
        }
      },
      {
        "if": { "properties": { "code": { "const": "resource-erased" } }, "required": ["code"] },
        "then": { "properties": { "pointer": false } }
      },
      {
        "if": { "not": { "properties": { "code": { "const": "limit-exceeded" } }, "required": ["code"] } },
        "then": { "properties": { "limit": false } }
      },
      {
        "if": { "properties": { "retry": { "const": "after-delay" } }, "required": ["retry"] },
        "else": { "properties": { "retryAfter": false } }
      }
    ]
  },
  "receiptProblem": {
    "title": "BDP Mutation Receipt problem",
    "type": "object",
    "required": ["type", "code", "status", "retry"],
    "properties": {
      "type": { "$ref": "#/$defs/absoluteHttpUrl" },
      "title": { "type": "string" },
      "status": { "type": "integer", "enum": [403, 404, 409, 413, 422] },
      "detail": { "type": "string" },
      "instance": { "$ref": "#/$defs/absoluteUri" },
      "code": { "$ref": "#/$defs/receiptProblemCode" },
      "retry": { "$ref": "#/$defs/retryDisposition" },
      "operationIndex": { "type": "integer", "minimum": 0 },
      "operationName": { "$ref": "#/$defs/localName" },
      "pointer": { "$ref": "#/$defs/jsonPointer" },
      "limit": { "type": "string", "pattern": "^[a-z]+\\.[A-Za-z]+$" },
      "diagnostics": { "$ref": "#/$defs/validationDiagnostics" },
      "diagnosticsTruncated": { "type": "boolean" }
    },
    "allOf": [
      {
        "if": {
          "properties": { "code": { "$ref": "#/$defs/readUpdateProblemCode" } },
          "required": ["code"]
        },
        "then": { "$ref": "#/$defs/readUpdateProblem" }
      },
      {
        "if": { "properties": { "code": { "const": "cardinality-violated" } }, "required": ["code"] },
        "then": {
          "properties": {
            "type": { "const": "https://github.com/gastownhall/bdp/problems/conflict" },
            "status": { "const": 409 },
            "retry": { "const": "after-state-change" }
          }
        }
      },
      {
        "if": {
          "not": {
            "properties": { "code": { "enum": ["limit-exceeded", "aggregate-constraint-violation"] } },
            "required": ["code"]
          }
        },
        "then": { "required": ["operationIndex"], "properties": { "operationIndex": true } }
      },
      {
        "if": { "not": { "properties": { "code": { "const": "limit-exceeded" } }, "required": ["code"] } },
        "then": { "properties": { "limit": false } }
      }
    ],
    "dependentRequired": {
      "operationName": ["operationIndex"]
    }
  }
}
```

### 3.4 Fixtures

The completed receipt for the first batch under section 2.3, as returned
synchronously at `pos-43`. The Decision's result shows its state
immediately after its own operation — revision `dec-9-r1`, empty owned
set — while the Link's result carries `source` and `sourceRevision`
`dec-9-r2`, the source's revision after the owned Link was created. The
final Decision state is in the change group under section 5.3, not restated
here.

<!-- fixture: mutationReceipt -->
```json
{
  "id": "https://beads.example/acme/receipts/rcpt-7",
  "status": "completed",
  "detail": "available",
  "idempotencyKey": "client-key-0001",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "transaction": "txn-0a1b",
  "requiredPosition": "pos-43",
  "effectPosition": "pos-43",
  "results": [
    {
      "operationIndex": 0,
      "operationName": "decision",
      "outcome": "created",
      "resource": {
        "id": "https://beads.example/acme/beads/dec-9",
        "type": "https://work.example/types/decision",
        "revision": "dec-9-r1",
        "attribution": { "principal": "agent:planner", "status": "claimed" },
        "properties": { "title": "Adopt owned Links", "status": "proposed" },
        "ownedLinks": { "https://work.example/types/cites": [] }
      }
    },
    {
      "operationIndex": 1,
      "operationName": "cite",
      "outcome": "created",
      "resource": {
        "id": "https://beads.example/acme/links/9c1e",
        "type": "https://work.example/types/cites",
        "revision": "9c1e-r1",
        "attribution": { "principal": "agent:planner", "status": "claimed" },
        "source": "https://beads.example/acme/beads/dec-9",
        "target": "https://beads.example/acme/beads/task-42",
        "properties": { "role": "evidence" }
      },
      "source": "https://beads.example/acme/beads/dec-9",
      "sourceRevision": "dec-9-r2"
    },
    {
      "operationIndex": 2,
      "outcome": "updated",
      "resource": {
        "id": "https://beads.example/acme/beads/task-42",
        "type": "https://work.example/types/task",
        "revision": "task-42-r8",
        "properties": { "title": "Specify BDP mutation", "status": "cited" }
      }
    }
  ],
  "next": null,
  "expiresAt": "2026-09-14T18:04:12Z"
}
```

The same receipt read by the same principal — one authorized for the
Task's retained history — after the correction group at `pos-45` erased
`task-42-r8`: the Task's entry no longer carries the postimage, only the
version's lineage marker, although `expiresAt` has not passed. A principal
without that authorization receives the entry as `withheld`. The serving
request's own observation is in its response fields
(`BDP-Scope-Position: pos-45` or later), not in the body.

<!-- fixture: mutationReceipt -->
```json
{
  "id": "https://beads.example/acme/receipts/rcpt-7",
  "status": "completed",
  "detail": "available",
  "idempotencyKey": "client-key-0001",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "transaction": "txn-0a1b",
  "requiredPosition": "pos-43",
  "effectPosition": "pos-43",
  "results": [
    {
      "operationIndex": 0,
      "operationName": "decision",
      "outcome": "created",
      "resource": {
        "id": "https://beads.example/acme/beads/dec-9",
        "type": "https://work.example/types/decision",
        "revision": "dec-9-r1",
        "attribution": { "principal": "agent:planner", "status": "claimed" },
        "properties": { "title": "Adopt owned Links", "status": "proposed" },
        "ownedLinks": { "https://work.example/types/cites": [] }
      }
    },
    {
      "operationIndex": 1,
      "operationName": "cite",
      "outcome": "created",
      "resource": {
        "id": "https://beads.example/acme/links/9c1e",
        "type": "https://work.example/types/cites",
        "revision": "9c1e-r1",
        "attribution": { "principal": "agent:planner", "status": "claimed" },
        "source": "https://beads.example/acme/beads/dec-9",
        "target": "https://beads.example/acme/beads/task-42",
        "properties": { "role": "evidence" }
      },
      "source": "https://beads.example/acme/beads/dec-9",
      "sourceRevision": "dec-9-r2"
    },
    {
      "operationIndex": 2,
      "outcome": "erased",
      "erased": {
        "id": "https://beads.example/acme/beads/task-42",
        "type": "https://work.example/types/task",
        "revision": "task-42-r8"
      }
    }
  ],
  "next": null,
  "expiresAt": "2026-09-14T18:04:12Z"
}
```

A failed receipt: the same batch resubmitted under a new key after the
Decision identity was committed. Nothing was committed; the problem carries
the would-be `409`, the failing index and name, and a pointer into the
request body.

<!-- fixture: mutationReceipt -->
```json
{
  "id": "https://beads.example/acme/receipts/rcpt-8",
  "status": "failed",
  "detail": "available",
  "idempotencyKey": "client-key-0002",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "transaction": "txn-0a1c",
  "requiredPosition": "pos-43",
  "problem": {
    "type": "https://github.com/gastownhall/bdp/problems/conflict",
    "title": "Supplied identity was previously committed",
    "status": 409,
    "detail": "beads/dec-9 has been committed in this Scope and is never reassigned.",
    "code": "identity-taken",
    "retry": "never",
    "operationIndex": 0,
    "operationName": "decision",
    "pointer": "/operations/0/id"
  },
  "expiresAt": "2026-09-14T18:05:30Z"
}
```

A pending receipt, as returned with `202 Accepted` to a duplicate that did
not wait, or read from its URL before the transaction is terminal.

<!-- fixture: mutationReceipt -->
```json
{
  "id": "https://beads.example/acme/receipts/rcpt-7",
  "status": "pending",
  "idempotencyKey": "client-key-0001",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "transaction": "txn-0a1b"
}
```

The completed receipt after its detail expired, as returned to an identical
retry with `200 OK`: the disposition and positions remain, the postimages
are gone, the two allocated identities survive, and the mutation is never
executed again.

<!-- fixture: mutationReceipt -->
```json
{
  "id": "https://beads.example/acme/receipts/rcpt-7",
  "status": "completed",
  "detail": "expired",
  "idempotencyKey": "client-key-0001",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "transaction": "txn-0a1b",
  "requiredPosition": "pos-43",
  "effectPosition": "pos-43",
  "allocated": [
    {
      "operationIndex": 0,
      "operationName": "decision",
      "id": "https://beads.example/acme/beads/dec-9",
      "type": "https://work.example/types/decision"
    },
    {
      "operationIndex": 1,
      "operationName": "cite",
      "id": "https://beads.example/acme/links/9c1e",
      "type": "https://work.example/types/cites"
    }
  ]
}
```

The receipt for the second batch under section 2.3 at `pos-46`: a set
deletion that matched two Links in `canonical-uri` order — `9c1e`, the
owned `cites` Link, whose entry names its source and the source's fresh
revision, then `blocks-3` — followed by the Bead deletion and a Link
creation. The entries did not fit in one page.

<!-- fixture: mutationReceipt -->
```json
{
  "id": "https://beads.example/acme/receipts/rcpt-9",
  "status": "completed",
  "detail": "available",
  "idempotencyKey": "client-key-0003",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "transaction": "txn-0a1d",
  "requiredPosition": "pos-46",
  "effectPosition": "pos-46",
  "results": [
    { "operationIndex": 0, "outcome": "matched", "count": 2 },
    {
      "operationIndex": 0,
      "outcome": "deleted",
      "deleted": {
        "id": "https://beads.example/acme/links/9c1e",
        "type": "https://work.example/types/cites",
        "revision": "9c1e-r1"
      },
      "source": "https://beads.example/acme/beads/dec-9",
      "sourceRevision": "dec-9-r3"
    }
  ],
  "next": "https://beads.example/acme/receipts/rcpt-9?page=2",
  "expiresAt": "2026-09-14T18:09:40Z"
}
```

Its second and last page.

<!-- fixture: mutationReceiptPage -->
```json
{
  "receipt": "https://beads.example/acme/receipts/rcpt-9",
  "results": [
    {
      "operationIndex": 0,
      "outcome": "deleted",
      "deleted": {
        "id": "https://beads.example/acme/links/blocks-3",
        "type": "https://work.example/types/blocks",
        "revision": "blocks-3-r1"
      }
    },
    {
      "operationIndex": 1,
      "outcome": "deleted",
      "deleted": {
        "id": "https://beads.example/acme/beads/task-42",
        "type": "https://work.example/types/task",
        "revision": "task-42-r9"
      }
    },
    {
      "operationIndex": 2,
      "outcome": "created",
      "resource": {
        "id": "https://beads.example/acme/links/2d4f",
        "type": "https://work.example/types/relates",
        "revision": "2d4f-r1",
        "source": "https://beads.example/acme/beads/task-43",
        "target": { "uri": "https://github.example/issues/123", "revision": "8f0e2b" },
        "properties": {}
      }
    }
  ],
  "next": null
}
```

The first receipt read later by the same principal after a grant change hid
the Decision, before the erasure at `pos-45`. The view is closed over owned
Links, so hiding `dec-9` hides its owned `cites` Link as well: both entries
are withheld, and the Task's entry — the Task is the Link's target, which
closure does not hide — is served.

<!-- fixture: mutationReceipt -->
```json
{
  "id": "https://beads.example/acme/receipts/rcpt-7",
  "status": "completed",
  "detail": "available",
  "idempotencyKey": "client-key-0001",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "transaction": "txn-0a1b",
  "requiredPosition": "pos-43",
  "effectPosition": "pos-43",
  "results": [
    { "operationIndex": 0, "operationName": "decision", "outcome": "withheld" },
    { "operationIndex": 1, "operationName": "cite", "outcome": "withheld" },
    {
      "operationIndex": 2,
      "outcome": "updated",
      "resource": {
        "id": "https://beads.example/acme/beads/task-42",
        "type": "https://work.example/types/task",
        "revision": "task-42-r8",
        "properties": { "title": "Specify BDP mutation", "status": "cited" }
      }
    }
  ],
  "next": null,
  "expiresAt": "2026-09-14T18:04:12Z"
}
```

A singleton `update-bead-properties` whose patch was a semantic no-op: the
receipt completes with an `updated` entry at the retained revision, reports
the current `requiredPosition`, and omits `effectPosition` because no group
was produced.

<!-- fixture: mutationReceipt -->
```json
{
  "id": "https://beads.example/acme/receipts/rcpt-10",
  "status": "completed",
  "detail": "available",
  "idempotencyKey": "client-key-0004",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "transaction": "txn-0a1e",
  "requiredPosition": "pos-46",
  "results": [
    {
      "operationIndex": 0,
      "outcome": "updated",
      "resource": {
        "id": "https://beads.example/acme/beads/task-43",
        "type": "https://work.example/types/task",
        "revision": "task-43-r2",
        "properties": { "title": "Draft the receipt schema", "status": "open" }
      }
    }
  ],
  "next": null,
  "expiresAt": "2026-09-14T18:12:00Z"
}
```

The direct problem for a key reused with different semantics; no receipt is
created and the earlier receipt is untouched.

<!-- fixture: transactionalProblem -->
```json
{
  "type": "https://github.com/gastownhall/bdp/problems/conflict",
  "title": "Idempotency key is bound to a different request",
  "status": 409,
  "code": "idempotency-conflict",
  "retry": "never",
  "instance": "https://beads.example/acme/receipts/rcpt-7"
}
```

The direct problem for a transient abort after admission: the pending
receipt was retracted, the key is unbound, and a retry executes anew.

<!-- fixture: transactionalProblem -->
```json
{
  "type": "https://github.com/gastownhall/bdp/problems/unavailable",
  "title": "Transaction aborted before commit",
  "status": 503,
  "code": "temporarily-unavailable",
  "retry": "after-delay",
  "retryAfter": 2
}
```

A receipt problem for a validation failure, with its diagnostics in the
Read+Update shape, pointing into the request body.

<!-- fixture: receiptProblem -->
```json
{
  "type": "https://github.com/gastownhall/bdp/problems/validation",
  "title": "Resulting properties violate an effective Type contract",
  "status": 422,
  "code": "validation-failed",
  "retry": "never",
  "operationIndex": 2,
  "pointer": "/operations/2/change/0",
  "diagnostics": [
    {
      "type": "https://work.example/types/work-item",
      "schemaLocation": "https://work.example/schemas/work-item-properties-v1#/properties/status/enum",
      "instanceLocation": "/status",
      "message": "status must be one of open, closed"
    }
  ]
}
```

A transaction-level failure: the induced-Event limit was crossed across
operations, so the problem names the limit and no operation.

<!-- fixture: receiptProblem -->
```json
{
  "type": "https://github.com/gastownhall/bdp/problems/size",
  "title": "Transaction would induce more Events than advertised",
  "status": 413,
  "code": "limit-exceeded",
  "retry": "never",
  "limit": "transaction.inducedEvents"
}
```

A `completed` receipt with `detail` `available` but no `results` is
rejected: the six representations are closed.

<!-- fixture-invalid: mutationReceipt -->
```json
{
  "id": "https://beads.example/acme/receipts/rcpt-7",
  "status": "completed",
  "detail": "available",
  "idempotencyKey": "client-key-0001",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "transaction": "txn-0a1b",
  "requiredPosition": "pos-43",
  "next": null,
  "expiresAt": "2026-09-14T18:04:12Z"
}
```

An expired `completed` receipt without `allocated` is rejected: allocated
identities outlive the detail.

<!-- fixture-invalid: mutationReceipt -->
```json
{
  "id": "https://beads.example/acme/receipts/rcpt-7",
  "status": "completed",
  "detail": "expired",
  "idempotencyKey": "client-key-0001",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "transaction": "txn-0a1b",
  "requiredPosition": "pos-43",
  "effectPosition": "pos-43"
}
```

A receipt problem without the failure's would-be `status` is rejected, as
is a receipt problem carrying a direct-only code, a direct problem carrying
a receipt-only code, a `validation-failed` receipt problem without
`diagnostics`, an operation-level receipt problem without `operationIndex`,
and a `resource-erased` problem carrying a `pointer`.

<!-- fixture-invalid: receiptProblem -->
```json
{
  "type": "https://github.com/gastownhall/bdp/problems/conflict",
  "code": "revision-mismatch",
  "retry": "after-state-change",
  "operationIndex": 2
}
```

<!-- fixture-invalid: receiptProblem -->
```json
{
  "type": "https://github.com/gastownhall/bdp/problems/conflict",
  "code": "idempotency-conflict",
  "status": 409,
  "retry": "never",
  "operationIndex": 0
}
```

<!-- fixture-invalid: transactionalProblem -->
```json
{
  "type": "https://github.com/gastownhall/bdp/problems/conflict",
  "code": "revision-mismatch",
  "status": 409,
  "retry": "after-state-change"
}
```

<!-- fixture-invalid: receiptProblem -->
```json
{
  "type": "https://github.com/gastownhall/bdp/problems/validation",
  "code": "validation-failed",
  "status": 422,
  "retry": "never",
  "operationIndex": 2
}
```

<!-- fixture-invalid: receiptProblem -->
```json
{
  "type": "https://github.com/gastownhall/bdp/problems/conflict",
  "code": "revision-mismatch",
  "status": 409,
  "retry": "after-state-change"
}
```

<!-- fixture-invalid: transactionalProblem -->
```json
{
  "type": "https://github.com/gastownhall/bdp/problems/gone",
  "code": "resource-erased",
  "status": 410,
  "retry": "never",
  "pointer": "/properties/title"
}
```

A `deleted` entry that carries `sourceRevision` without `source` is
rejected: the pair is present together or not at all.

<!-- fixture-invalid: receiptResult -->
```json
{
  "operationIndex": 0,
  "outcome": "deleted",
  "deleted": {
    "id": "https://beads.example/acme/links/9c1e",
    "type": "https://work.example/types/cites",
    "revision": "9c1e-r1"
  },
  "sourceRevision": "dec-9-r3"
}
```

### 3.5 Decisions

**T7 — Result-entry model, pagination unit, and counting.** RATIFIED 2026-09-08 (operator: as drafted). *Revised
(council 10).*
Context: the draft says a successful batch "contains one result per
operation in declaration order" and that "Large set-operation results
continue through immutable pages of that same receipt"; both cannot hold
if a set operation's result is one nested array. Options: (a) flat entries,
each stamped with `operationIndex`, in the Read+Update result vocabulary
(`outcome`, `resource`, `deleted`, `source`, `sourceRevision`,
`operationName`), where a set operation contributes a leading `matched`
entry plus one entry per selected Resource in `canonical-uri` order, and
pages cut between entries; (b) one nested result per operation whose
`resources` array is split across pages; (c) one result per operation with
no pagination of set results, which the prohibition on truncation rules
out. Tradeoffs: (b) needs a rule for reassembling a split array and a second
continuation inside the result; (a) keeps one pagination unit, keeps
zero-match operations visible through their `matched` entry, and gives
every entry an independent authorization decision, which the `withheld`
entry relies on. Also decided here: a postimage is the state immediately
after its operation, and the receipt does not restate final states, because
the change group already normalizes them; the underlying result is
immutable while every delivered representation is the re-authorized
projection of it (T32); and the sentence "one result per operation" in the
draft is replaced at apply time (Claude M5). Counting is T46.
Recommendation: (a).

**T8 — Receipt lifecycle representation.** RATIFIED 2026-09-08 (operator: as drafted). *Revised (council 10).*
Options: (a) `status` ∈ {`pending`, `completed`, `failed`} as the
immutable disposition plus `detail` ∈ {`available`, `expired`,
`withheld`} on terminal receipts, with the expired `completed`
representation carrying `allocated` (T36) and `failed` never `withheld`
(T32); (b) a fourth `status` value `expired` plus a `disposition` member
carrying the original outcome; (c) a boolean `resultsRetained`. Tradeoffs:
(b) changes `status` after the draft says the disposition never changes and
cannot express `withheld`; (c) cannot express three states. Also decided:
`transaction` is present on every receipt, `pending` included, because the
draft's receipt records "the transaction identity" and the identity is
assigned at admission; a retry after retention expiry receives the
`expired` receipt with `200 OK`, not a `410` problem, so that a retry
always has one response shape; `pending` is not itself immutable — it is
the one state that ends, by terminalization or by retraction (T34) — while
a terminal disposition is. Recommendation: (a).

**T9 — Receipt addressing and access.** RATIFIED 2026-09-08 (operator: as drafted). *Clarified (council 10).*
Sub-decisions: (a) receipts live at `receipts/{token}`, token in the
checkpoint character profile, and `id` is the absolute URL; (b) unknown,
foreign-principal, retracted, and prior-epoch receipt URLs return `404`
`resource-not-found`; (c) no listing and no lookup by key: the retry is the
lookup, and a client must persist its request to retry at all; (d) a `GET`
of the `receipts` root returns `404`, and the proposed text now says why
the member is discovered at all — so that receipt URLs are recognizably
the authority's and clients never construct them — rather than leaving a
required navigation member that appears to lead nowhere (Claude L12);
(e) page URLs after detail expiry return `410` `cursor-expired`, treating a
`next` URL as the continuation cursor it is, decided after authentication
and non-disclosure (T42). Alternatives: for (c), `GET receipts/?idempotencyKey=`
(new surface, and it leaks whether a key exists to any holder of the
principal's credentials); for (d), a `200` namespace document with no
members (a representation with no protocol meaning); for (e), `404`.
Recommendation: (a)–(e) as stated.

**T10 — Receipt problem form.** RATIFIED 2026-09-08 (operator: as drafted). *Revised (council 10).*
Options: (a) the Read+Update problem shape composed by reference, plus
required `status`, `operationIndex` under the T37 rule, optional
`operationName`, `pointer`, `limit`, and the Read+Update `diagnostics` and
`diagnosticsTruncated` members, reusing the `operationIndex` and
`operationName` spellings the draft fixes for sequence members
(**shared**); (b) a receipt-specific taxonomy; (c) the first draft's own
`problemDiagnostic` shape (`{ message, typeId?, schemaLocation?, pointer? }`),
which the Read+Update wire has since superseded with
`validationDiagnostic` (Claude H6). Tradeoffs: (b) is the "separate
sequence-only taxonomy" the draft refused for sequences; (c) states one
diagnostic twice. Recommendation: (a).

**T11 — Transactional problem table.** RATIFIED 2026-09-08 (operator: as drafted). *Revised (council 10).*
Sub-decisions: (a) three Transactional-only rows — `cardinality-violated`,
`event-history-expired`, `catch-up-timeout` — beside the inherited Read
table and Read+Update rows, with the meanings of the three Read codes
reused inside receipts; the first draft's eleven-row table restated eight
Read+Update rows under spellings the sibling has since fixed
(`identity-conflict`, `constraint-violated`, `patch-failed`) and is
withdrawn: `identity-taken` and `aggregate-constraint-violation` are the
names, and a patch that cannot be applied is `validation-failed` (T24);
(b) **shared**: every code the two profiles share has one row, stated by
the Read+Update half, and the Transactional profile adds only its own
rows; (c) the direct and receipt contexts are closed enums the bundle
enforces (T43), and `temporarily-unavailable` is never a receipt code
(T34); (d) `unsupported-media-type` (`415`) is inherited, so the first
draft's "no BDP problem code for unsupported request media types" sentence
is withdrawn and the `status` enum carries `415`. Alternatives: for (a),
keep `patch-failed` as a distinct code (the client action is the same —
construct a new request — and the diagnostics locate the failure); for
(b), separate per-profile code sets (the same failure would have two
names). Recommendation: (a)–(d) as stated.

**T32 — One current-authorization projection for every receipt delivery
path.** RATIFIED 2026-09-08 (operator: as drafted).
Context: the first draft re-authorized "later reads" only, said nothing
about duplicate `POST` responses, pages, or sequence projections, left
`matched` summaries and deleted or superseded results unclassified, and
its fixture hid a Task while serving the entry of the Decision that owns a
Link to it, which the view-closure rule forbids (Codex H4, Claude M4).
Options: (a) one rule for every delivery path: record-bearing entries are
re-authorized against the retained record under the current view with
owned closure applied, exactly as Read+Update D21 re-authorizes a retained
`created` or `updated` result; entries that carry no record — `matched`
counts, `deleted` and `erased` identities, `withheld` entries — and a
failed receipt's problem are served as retained, as D21 serves retained
problems and deleted identities; a whole `completed` receipt is `withheld`
when every entry is; `failed` is never withheld; (b) withhold `matched`
counts and `deleted` identities as well whenever any record of the
transaction is hidden, on the argument that counts and page boundaries
disclose the original selected-set cardinality (Codex H4); (c) require a
separate historical-detail grant for deleted and superseded results.
Tradeoffs: (b) withholds facts the principal already received when it
executed the transaction — a later read repeats a disclosure, it does not
make one — and diverges from D21 for no protection; (c) invents a grant
the draft does not have. The fixture now hides the Decision, so closure
withholds the Decision and its owned Link and serves the Task.
Recommendation: (a), with (b) recorded for the operator as the stricter
reading.

**T33 — Receipt response fields are the serving request's observation.** RATIFIED 2026-09-08 (operator: as drafted).
Context: the first draft required a terminal receipt's `BDP-Scope-Position`
to equal the historical `requiredPosition`, which after a view rotation
belongs to another view and after later mutations can precede a caller's
`BDP-Minimum-Scope-Position` (Codex H5, Claude L1). Options: (a) the three
response fields describe the serving request — current epoch, the
caller's current view, and the observed position, at or after
`effectPosition` when served synchronously and honoring a minimum-position
request like any read — while the body keeps the execution's recorded
epoch, view, and positions; (b) echo the body's values in the fields.
Tradeoffs: (b) asserts a stale or foreign observation and breaks the
strict-read law that success is never reported with an older position.
Recommendation: (a).

**T34 — Transient aborts after admission retract the receipt and unbind
the key.** RULED 2026-09-08 (operator: (a)).
Context: a retained `failed` receipt carrying `temporarily-unavailable`
with `retry` `after-delay` answered every retry of its key forever, so the
delay could never lead to another execution (Codex H7, Claude H3).
Options: (a) a transient abort after admission never terminalizes: the
authority retracts the pending receipt and unbinds the key in one durable
step, answers the request and every joined duplicate with a direct `503`
`temporarily-unavailable`, and a retry executes as new; `retry` inside a
permanent `failed` receipt is defined as guidance for a new request under
a new key; (b) a distinct non-terminal receipt state (`aborted`) whose
retry re-executes under the same receipt identity; (c) the first draft.
Also decided: exceeding `transaction.duration` is permanent, not transient
— the request as written does not fit the advertised bound, the receipt
fails with `limit-exceeded` and `limit` `transaction.duration`, and the
client divides the work under new keys, which is what `retry` `never`
already means for every other limit. Tradeoffs: (b) keeps a URL alive for
an execution that produced nothing and needs a fourth status; (c) is the
finding. Alternative for the duration bound: treat it as transient
(`temporarily-unavailable`), which would hide the advertised limit the
client crossed. Recommendation: (a).

**T35 — Admission as one durable step; execution ownership; pending
recovery bound.** RULED 2026-09-08 (operator: (a); the operator noted (b)
was the expected answer — see the ruling note).
Context: the first draft admitted a request when the key and a pending
receipt were "durably recorded" but said nothing about the atomicity of
that record, about which worker may commit, or about a `pending` receipt
whose execution died, which could then answer `202` forever (Codex H7,
Claude H4, Gemini H2). Options: (a) admission records the key, the
normalized identity, the pending receipt with its transaction identity,
and the execution's exclusive ownership together; a commit is atomic with
the terminal receipt and succeeds only while the committing execution
still owns the receipt, so a retracted or reclaimed execution cannot
commit; on restart or failover every pending receipt without a committed
group is retracted within `transaction.duration` (a finite bound of the
authority's choosing when unadvertised), the authority never resumes an
execution on its own, and an older pending receipt is a conformance
failure; allocated identities become durable only at commit; (b) resume
abandoned executions on recovery under a lease (needs durable request
bodies and a recovery executor, and a client cannot tell a resumed
execution from a cleared one until it retries anyway — the same reasoning
as Read+Update D22, which clears rather than resumes); (c) leave recovery
to the implementation. Recommendation: (a), which mirrors D22 and D23 in
Transactional terms: "cleared" is "retracted", and the client's retry is
the recovery path.

**Ruling note (T35, 2026-09-08).** The operator ruled (a) while noting that
(b) — resumption under a lease — was the expected answer. Why (a) holds:
(b) needs the full request body durably queued before execution and a
recovery executor that resumes partial progress idempotently, which in
Dolt makes every progress checkpoint a commit and in Postgres a journal
of its own, and the client still cannot tell a resumed execution from a
retracted one until it retries; (a) needs one durable admission row and
a fenced commit, which both stores give directly — a Postgres transaction
that writes the receipt row with the effects, one Dolt commit under the
lease fence — and it is D22/D23's rule with the words changed.

**T36 — Terminal disposition and allocated identities survive detail
expiry.** RATIFIED 2026-09-08 (operator: as drafted).
Context: the first draft's expired representation dropped `results`
entirely, so a client retrying after expiry received `200 OK` and lost the
authority-allocated identities of everything the transaction created, and
a sequence member's `@name` could no longer resolve through an expired
creator (Gemini C1, Claude M3, Codex H6). Options: (a) an `expired`
`completed` receipt carries `allocated` — per creation operation, the
`operationIndex`, `operationName` when declared, and the allocated `id`
and `type`, re-authorized like a `created` entry — while `updated`,
`deleted`, and set entries are not retained in compact form; (b) retain a
skeletal `results` array with one entry per operation (unbounded for a set
deletion of a hundred thousand Resources, which is exactly the bulk the
expiry exists to shed); (c) carry `allocated` on every terminal
representation. Tradeoffs: (c) duplicates the `created` entries on
`available` receipts; (a) bounds the retained set by
`transaction.operations`, since only single-Resource creations allocate.
This is the receipt-side twin of Read+Update D24. Recommendation: (a).

**T37 — Receipt problem attribution: `operationIndex`, `pointer`, and
`resource-erased`.** RATIFIED 2026-09-08 (operator: as drafted).
Context: the first draft required `operationIndex` on every receipt
problem although a serialization abort, a duration or induced-Event limit,
or a joint aggregate constraint has no single index (Claude M6); its
`pointer` was relative to the operation record in a receipt but to the
request body in a direct problem (Claude L11); and the shared problem
definition let a `resource-erased` problem carry a `pointer` although
PR #16 says even a pointer would disclose what erasure exists to remove
(Codex M13). Options: (a) `operationIndex` is the operation being
evaluated when the failure was detected and is omitted only for
`limit-exceeded` on the transaction-wide limits and for an
`aggregate-constraint-violation` established at commit, never fabricated;
`pointer` has one base, the request body as submitted, in every context;
`pointer` is prohibited on `resource-erased`; (b) always require
`operationIndex` and set it to the last operation for transaction-wide
failures; (c) an `operationPointer` member relative to the record beside
the body-relative `pointer`. Tradeoffs: (b) fabricates attribution; (c)
two members for one location. Recommendation: (a).

**T38 — `202` on the original submission only past the wait bound.**
RULED 2026-09-08 (operator: (a)).
Context: T6 (b) in the first draft made `202` legal for any original
submission, which contradicted "the normal case requires no follow-up
read" (Claude M9). Options: (a) the original submission receives its
terminal receipt whenever the transaction is terminal within the
authority's synchronous wait bound, which is never longer than an
advertised `transaction.duration`; `202` on the original only when the
bound elapses first, with `Retry-After`; a duplicate may receive `202` at
any time before the transaction is terminal, as the draft already allows;
(b) advertise the wait bound as a new limit (a discovery change for a
value the client learns from `Retry-After` anyway); (c) forbid `202` on
the original (an authority must then hold a connection for the whole
duration). Recommendation: (a).

**T39 — No-op entries and all-no-op transactions.** RATIFIED 2026-09-08 (operator: as drafted).
Context: the first draft did not say how a receipt reports a semantic
no-op update, which Read+Update D11 reports as `updated` with the retained
revision (Claude M10). Options: (a) `updated` with the retained revision
and the unchanged postimage, `sourceRevision` unchanged for an owned Link,
and a transaction all of whose operations are no-ops is the draft's
admitted no-effect mutation, completing without a group and without
`effectPosition`; (b) an `unchanged` outcome. Tradeoffs: (b) is the fourth
outcome D11 declined for the same reason; a client that holds
`expectedRevision` already sees the no-op through revision equality.
Recommendation: (a).

**T43 — Problem definitions composed by context from the Read+Update
definitions.** RATIFIED 2026-09-08 (operator: as drafted).
Context: the first draft's `problemCodeRows` restated every Read row and
its direct and receipt definitions did not enforce their own taxonomy —
strict Ajv accepted `idempotency-conflict` inside a receipt problem,
`revision-mismatch` as a direct problem, and `validation-failed` without
diagnostics (Codex M13, Claude M7). Options: (a) `directProblemCode` and
`receiptProblemCode` enums; `transactionalProblem` and `receiptProblem`
route every Read+Update code through `readUpdateProblem` by `$ref`, which
already routes Read codes through `readProblem` and requires diagnostics
on `validation-failed`, and add branches only for the three Transactional
rows, the `operationIndex` rule, the `limit` rule, and the
`resource-erased` pointer prohibition; (b) one `problemCodeRows` definition
that every profile's problem references (the first draft's T11 (c), which
would move Read's sealed rows into a new definition and duplicate them
until then). Tradeoffs: (b) touches the sealed Read definition or states
rows twice; (a) states nothing twice today. Recommendation: (a).

**T46 — Receipt pagination counting.** RATIFIED 2026-09-08 (operator: as drafted).
Context: the first draft bounded receipt pages by "the advertised bound"
while `page.maximumItems` counts Resource records, so it was unstated how
`matched`, `withheld`, and `erased` entries count (Codex M17). Options:
(a) `page.maximumItems` bounds entries in the receipt's inline `results`
and in each page, every entry counting as one whatever its outcome, with
an authority-chosen bound when the limit is not advertised, and the
Advertised-limits bullet amended to say the two page limits count result
entries on receipts; (b) count only record-bearing entries (pages could
then hold an unbounded run of `withheld` markers); (c) a separate
`receipt.maximumEntries` limit (a new limit for the same quantity).
Recommendation: (a).

## 4. Transaction-level idempotency

The draft qualifies a Mutation Transaction's key by Scope, epoch, and
principal, defines the normalized comparison, duplicate joining, conflict,
and the epoch-long tombstone, and the Read+Update wire has since fixed the
key grammar, the semantic-identity rule, the durable boundary, and the
recovery contract for its own carriers. The two halves must not define two
key grammars or two namespaces for the same Scope, and a `sequence` on a
Transactional Scope must have exactly one meaning. This section adopts the
Read+Update rules where the profiles agree, states the Transactional-only
rules — durable admission, ownership, retraction, epoch-long retention —
and defines how a Transactional Scope projects a member's receipt into the
unchanged sequence envelope.

### 4.1 Proposed normative text

Target: "Mutation Transactions". Append after "Retrying returns that same
outcome, including authority-allocated IDs."

An idempotency key is the token defined under
[Idempotency keys](#idempotency-keys): the `Idempotency-Key` HTTP field of
a batch or singleton request and the `idempotencyKey` member of a sequence
member carry the same case-sensitive `[A-Za-z0-9_-]{1,256}` token, bare,
compared byte-exactly; a request whose key is absent, repeated, or outside
the grammar is malformed. On a Transactional Scope the key's namespace is
the canonical Scope URL, the Scope epoch, and the authenticated principal —
the Read+Update namespace with the epoch it lacks — and every mutation
carrier feeds that one namespace: a singleton request, a `batch`, and each
member of a `sequence` is a Mutation Transaction with its own durable
Mutation Receipt, and the carrier is delivery metadata that the semantic
comparison excludes.

The semantic identity of a Mutation Transaction is the sequence, in
declaration order, of its operations' semantic identities under
[Idempotency keys](#idempotency-keys): each is the operation kind plus its
normalized record — durable references canonicalized, protocol defaults
expanded, array order preserved, member order ignored, `name` and the
carrier excluded, `expectedRevision` and `attribution` included, opaque
URIs and pins compared byte-exactly, and the records compared under RFC
6902 Section 4.6. In a batch, a `@label` reference is normalized to the
creating operation's zero-based index when that operation supplies no
`id`, and to the supplied identity's canonical URL when it does — never to
the label's spelling, so renaming a label is not a semantic change, and
never to an allocated identity, which does not exist before commit. In a
sequence, a `@name` reference is normalized to the identity its creating
member bound, as in Read+Update. A one-operation batch, the equivalent
singleton request, and the equivalent sequence member therefore present
one semantic request, and any of them retrieves the receipt the others
created.

Concurrent identical requests join one execution and receive the same
receipt identity, pending or terminal. Read+Update refuses a concurrent
duplicate with `idempotency-in-progress` because it has no durable receipt
to hand the duplicate; the Transactional profile joins the duplicate to
the one execution and hands it the pending receipt, which is the same
exactly-once promise made with the profile's own vehicle. A later identical
request returns the retained receipt — with its detail available, expired,
or withheld — and never executes again. A request with the same key and a
different normalized request is refused before admission with `409`
`idempotency-conflict` for the rest of the Scope epoch, whether or not the
earlier outcome's detail has expired. A new epoch is a new namespace: a key
first used under a prior epoch is unbound, and a retry under the new epoch
executes as a new mutation, which a client that observes a changed
`scopeEpoch` MUST treat as a first execution rather than a replay.
Authorization View changes do not create a new namespace.

Admission is one durable step. The authority records the key, the
normalized request identity, the `pending` Mutation Receipt with its
`transaction` identity, and its own exclusive ownership of the execution
together or not at all, so that a crash leaves a key either unknown with
nothing committed or bound to a receipt. Exactly one execution owns a
pending receipt, and ownership is what a commit checks: the Resource state,
the change group, and the terminal receipt commit atomically only while the
committing execution still owns the receipt, so an execution that lost
ownership — because the authority retracted the receipt, or because
recovery reclaimed it — cannot commit and produces no group. Identities an
execution allocates become durable only with its commit; a retry after a
retraction allocates anew, or reuses a supplied `id`. On restart or
failover, every `pending` receipt without a committed group is retracted
under the transient-abort rule of
[Batch operation target](#batch-operation-target) within
`transaction.duration` when that limit is advertised and within a finite
bound of the authority's choosing otherwise: the authority never resumes an
execution on its own initiative, the client's retry is the recovery path,
and a `pending` receipt older than the bound is a conformance failure.
Every mutation route — each singleton target, the batch target, the
sequence target, and every replica that accepts mutations — consults one
authoritative key state for the namespace; two routes MUST NOT each treat
the same key as unknown.

A terminal receipt, `failed` included, is retained under its key for the
rest of the Scope epoch: the compact receipt outlives the detail, and a
retry of a failed transaction returns that same failed receipt. A client
that has refreshed its state constructs a new request under a new key.

On a Transactional Scope the `sequence` target is the carrier defined under
[Read+Update sequence target](#readupdate-sequence-target), and it keeps
its envelope, its member records, its declaration order, its separate
commitment, its lack of isolation, and its `@name` rules unchanged; what
the profile changes is what a member's disposition is. Each member is a
one-operation Mutation Transaction: the sequence's admission admits every
member whose key is unknown, in declaration order, recording a pending
receipt for each — the profile's form of claiming a key — and the members
then execute in order, each committing its own state, change group, and
terminal receipt. The envelope projects each member's receipt into one
entry, and it adds no receipt member:

- a `completed` receipt with its detail available projects the receipt's
  one result entry in the shape of
  [Sequence response envelope](#sequence-response-envelope), carrying
  `operationIndex` and `operationName` for the present member; an entry
  the current view withholds projects as the `forbidden` member problem of
  [Duplicate keys and retained dispositions](#duplicate-keys-and-retained-dispositions),
  which is not retained; an entry whose version was erased projects as a
  `resource-erased` member problem to a caller authorized for the subject's
  retained history and as `forbidden` to every other caller;
- a `failed` receipt projects its problem as the member problem, with the
  present member's `operationIndex` and `operationName`;
- a `pending` receipt — the member's key is bound to a transaction still
  executing, here or elsewhere — projects as an `idempotency-in-progress`
  member problem, which MAY carry `retryAfter`; the sequence does not wait,
  executes nothing for the member, and retains nothing, and the pending
  receipt continues to be the key's state;
- a receipt whose detail expired projects as an `idempotency-expired`
  member problem carrying, for a `completed` creation, the extension
  member `allocated` — the `id` and `type` the receipt retains under
  [Mutation Receipt responses](#mutation-receipt-responses) — so that the
  member's disposition and identity are never lost to the envelope; and
- a member whose `@name` creator's receipt is `failed` fails with
  `binding-unavailable`, retained; a member whose creator's receipt is
  `pending`, or whose creator was answered transiently in this request,
  fails transiently with `idempotency-in-progress`, consults no key state,
  executes nothing, retains nothing, and claims no key, exactly as
  Read+Update rules; a member whose creator's receipt has expired
  resolves the binding through the receipt's `allocated` identity.

The Read+Update dispositions therefore keep their meanings inside the
sequence envelope and lose their direct forms: on a Transactional Scope a
pending key is joined rather than refused, an expired key returns its
expired receipt rather than `410`, and a failed disposition is retained for
the epoch rather than forgotten after an interval. The conformance rows
those direct forms bind are retired for a Transactional Scope under
[Transactional conformance rows](#transactional-conformance-rows).

Target: "Advertised limits". Append after the paragraph ending "while
keeping `retention.idempotency` and the pagination
`retention.maximumSnapshotLifetime`."

On a Transactional Scope, receipts retain a key's disposition for the rest
of the epoch, so `retention.idempotency` is a Read+Update-only member: a
Transactional discovery document MUST NOT advertise it, `retention.receipt`
bounds how long detailed outcomes remain, and the bundle's
`transactionalAdvertisedLimits` rejects the member. `page.defaultItems` and
`page.maximumItems` also count the result entries of a Mutation Receipt and
its pages, every entry counting as one.

Target: "Event-ID and checkpoint character profile". Append.

Scope epochs, Authorization View tokens, Scope positions, transaction
identifiers, receipt tokens, and idempotency keys use this same profile, so
that every history token is safe in a JSON value, a URL query, and an HTTP
field. Resource revisions are not covered: a revision is an opaque nonempty
string compared only for equality, and how the protocol projection encodes
one as an HTTP validator is a separate rule.

### 4.2 Fixtures

A sequence response on a Transactional Scope, projecting three members'
receipts: a completed creation, a member whose key is bound to a pending
receipt, and a creation whose receipt's detail expired. The envelope is
the Read+Update `sequenceResponse`; the third entry's `allocated` is an
RFC 9457 extension member.

<!-- fixture: sequenceResponse -->
```json
{
  "results": [
    {
      "operationIndex": 0,
      "operationName": "adr",
      "outcome": "created",
      "resource": {
        "id": "https://beads.example/acme/beads/adr-104",
        "type": "https://work.example/types/decision",
        "revision": "adr-104-r1",
        "attribution": { "principal": "agent:planner", "status": "claimed" },
        "properties": { "title": "Adopt sequence envelopes", "status": "proposed" },
        "ownedLinks": { "https://work.example/types/cites": [] }
      }
    },
    {
      "type": "https://github.com/gastownhall/bdp/problems/conflict",
      "title": "Key is bound to a transaction still executing",
      "status": 409,
      "code": "idempotency-in-progress",
      "retry": "after-delay",
      "retryAfter": 1,
      "operationIndex": 1
    },
    {
      "type": "https://github.com/gastownhall/bdp/problems/gone",
      "title": "Receipt detail expired",
      "status": 410,
      "code": "idempotency-expired",
      "retry": "never",
      "operationIndex": 2,
      "operationName": "task",
      "allocated": {
        "id": "https://beads.example/acme/beads/task-77",
        "type": "https://work.example/types/task"
      }
    }
  ]
}
```

### 4.3 Decisions

**T12 — Key grammar and HTTP field form (shared).** RATIFIED 2026-09-08 (operator: as drafted).
Options: (a) the checkpoint character profile, bare token in the HTTP field
— now stated once by the Read+Update wire (D1) and referenced here; (b) the
IETF `Idempotency-Key` draft's quoted `sf-string`; (c) any nonempty string
up to an advertised byte bound. Tradeoffs: (b) makes the draft's own
example (`Idempotency-Key: client-generated-opaque-key`) invalid and adds a
structured-field parser; (c) admits characters that need escaping in a
header and gives the sequence member and the header different effective
grammars; (a) reuses a profile the draft already fixes and keeps both
carriers byte-identical. Recommendation: (a).

**T13 — One key namespace across carriers on a Transactional Scope
(shared).** *Revised (council 10).* RULED 2026-09-08 (operator: (a)).
Options: (a) a singleton, a batch, and each sequence member is a Mutation
Transaction in one namespace; the carrier is excluded from the semantic
comparison under the completed rule of T41; every one has a receipt; the
sequence envelope is unchanged and projects each member's receipt under
T40; a member's receipt is reached by resubmitting the member as a
singleton with the same key; (b) sequence members keep Read+Update
semantics only (retained inline outcome, no receipt) with a namespace
separate from the batch/singleton keys; (c) as (a) but with an optional
`receipt` URL member added to sequence member results. Tradeoffs: (b)
leaves the same key on two carriers undefined and makes "identical
allocation, patch, validation, authorization, idempotency ... semantics"
false for one carrier; (c) changes an envelope owned by the Read+Update
half for a convenience (a) already provides. The council did not approve
the first draft's (a) because it selected the namespace without completing
the identity rule, the member projections, or the dependent-member cases
(Codex H6, Claude H5); T40 and T41 complete it. Recommendation: (a).

**T14 — `retention.idempotency` on a Transactional Scope.** RATIFIED 2026-09-08 (operator: as drafted).
Options: (a) prohibited, because the epoch-long receipt retention makes any
finite value false, and the Advertised-limits text says the member is
Read+Update-only (X2); (b) allowed as a lower bound; (c) allowed and
binding. Tradeoffs: (c) contradicts the draft's tombstone rule; (b)
advertises a number that means nothing to a client. Recommendation: (a);
the cross-packet statement is X2.

**T15 — Character profile for the other history tokens.** RATIFIED 2026-09-08 (operator: as drafted). *Revised
(council 10).*
Options: (a) extend the Event-ID and checkpoint profile to epochs, view
tokens, positions, transaction identifiers, receipt tokens, and keys, and
say that Resource revisions are not covered — a revision stays an opaque,
equality-only nonempty string, and its HTTP validator encoding is a
separate rule; (b) leave them opaque nonempty strings. The first draft
added "a revision is also an entity tag, and its grammar is the
entity-tag grammar's", which contradicted the nonempty-string schema, the
unquoted revision fixtures, and the equality-only revision contract, and
is struck (Codex M14, Claude verdict T15). Tradeoffs: (b) leaves the three
`BDP-*` HTTP fields carrying values with no header-safe grammar.
Recommendation: (a).

**T40 — `sequence` on a Transactional Scope: member projections and the
retired Read+Update forms.** RATIFIED 2026-09-08 (operator: as drafted).
Context: the draft lists `sequence` among the Transactional targets, says
sequence responses are not durable receipts, and says every mutation is a
Mutation Transaction; the first draft chose one namespace but did not say
what a member shows when its key is in flight (Read+Update refuses; the
Transactional join has no `202` inside a `200` envelope), when its detail
expired, when its `@name` creator is pending or transiently failed, or how
a receipt entry projects onto the Read+Update `sequenceMemberResult`
(Claude H5, Codex H6). Options: (a) the projection table under section
4.1: completed → the entry in the Read+Update result shape; withheld →
the D21 `forbidden` member problem, not retained; erased →
`resource-erased` to an authorized caller and `forbidden` otherwise;
failed → the problem; pending → transient `idempotency-in-progress`, no
wait, no claim; expired → `idempotency-expired` with the `allocated`
extension; dependents follow D15, D24, and D27 — `binding-unavailable` only
for a permanently failed creator, transient for a pending or transient
creator, resolved through `allocated` for an expired one; and the
Read+Update rows bound to the refused, `410`, and forgotten direct forms
are retired for a Transactional Scope (T48); (b) a sequence member waits
for a pending duplicate up to the wait bound (holds a connection per
member against another request's progress, the cost D5 declined); (c) a
Transactional-specific member-result definition carrying `receipt`,
`detail`, and `allocated` as first-class members (a second envelope for
one carrier, which T13 (c) already declined). Tradeoffs: (a) keeps one
envelope and one member vocabulary and uses RFC 9457's extension latitude
for the one member the vocabulary lacks. Recommendation: (a).

**T47 — Failed dispositions are retained for the epoch.** RULED 2026-09-08
(operator ACKed (a), found (b) plausible, and delegated the judgment with
implementability against Dolt and Postgres to weigh; ruled **(b)** — see
the ruling note).
Context: Read+Update D28 forgets a retained failure after its retention
interval, so that no principal can grow permanent storage with requests
that commit nothing; the draft's Transactional law retains "a compact
tombstone — the key, the request identity, and the disposition — for the
rest of the Scope epoch" for every admitted mutation and says "Retrying
returns that same failed receipt" (Claude H6, tombstone lifetime; Codex
H7). Options: (a) keep the draft's law: every terminal receipt, `failed`
included, is retained for the epoch, because a receipt is a URL the client
may hold, a joined duplicate may still be reading it, and the epoch itself
bounds the retention; the two tombstone lifetimes are then the same rule —
the lifetime of the key's namespace, which is the logical Scope for
Read+Update and the epoch for Transactional; (b) adopt D28: after
`retention.receipt` a `failed` receipt may be forgotten, its URL answers
`404`, and its key is unknown and executes; (c) retain failed receipts for
`retention.receipt` only but keep their key bound to a permanent
`idempotency-conflict`. Tradeoffs: (b) bounds storage by committed effects
at the cost of contradicting two sentences of the draft and of making a
held receipt URL vanish; (c) answers a retry of a failed request with a
conflict about itself. Recommendation: (a), recorded as a deliberate
divergence from D28 for the operator to weigh; the transient-abort rule
(T34) already keeps every abort the client can retry out of the retained
set.

**Ruling note (T47, 2026-09-08).** Ruled (b), for three reasons. First,
the uniform rule is D28's, not the draft's: a disposition is retained for
as long as it has effects to protect — a completed receipt's disposition
and allocated identities for the epoch (T36), because exactly-once
protects committed effects; a failed receipt for `retention.receipt`,
because it committed nothing and allocated nothing durable (T35), so a
presentation of its key after the window can double-apply nothing.
Second, storage: under (a) every permanently failed transaction leaves a
tombstone until epoch rotation, an administrative act that may never
occur, so rejected traffic grows the authority's storage without bound —
in Postgres a table autovacuum can never trim, in Dolt a table whose live
size and replication working set grow with every refusal — whereas under
(b) the live set is bounded by rate times window, using the reaper that
`retention.receipt` already requires for completed receipts' detail,
deleting the row instead of trimming it. Third, the client contract is no
worse: a held URL answers `404` after the window exactly as a retracted
receipt does (T9), and a retry after forgetting executes as new, which is
the outcome a client that still wants the work done needs; under (a) that
client is told `failed` for the epoch and made to mint a new key. Law for
the apply pass: a failed receipt — disposition and detail alike — is
retained for at least `retention.receipt` after it becomes terminal; an
authority MAY retain it longer; once forgotten, its URL answers `404`
(non-disclosure, as for a retracted receipt) and its key is unknown, so a
later presentation executes as new. A failed receipt never enters
`detail: expired`; that state belongs to completed receipts. "Retrying
returns that same failed receipt" holds within the window. The draft's
"compact tombstone for the rest of the Scope epoch" applies to committed
transactions only, and the recorded divergence from D28 is withdrawn:
both profiles keep tombstones for committed effects only.

### 4.4 Shared-shape rules and cross-packet decisions

**T22 — Owned-source secondary revision and the deleted-identity shape
(shared).** RATIFIED 2026-09-08 (operator: as drafted). *Revised (council 10).*
Context: the draft says the member carrying the source Bead's resulting
revision "is defined with the write profiles" and that deletes return "the
canonical deleted identity", without fixing either spelling. The
Read+Update wire has since fixed `sourceRevision` and added `source`
beside it (D10 revised), and chose a bare URL for `deleted` (D9). Options:
(a) `source` and `sourceRevision` together on every owned-Link result —
creation, update, and deletion — present exactly when the other is,
rejected on a Bead postimage, in receipt entries and Read+Update results
alike (X4); and the deleted identity as the record `{ id, type,
revision }` under the Read+Update member name `deleted`, `revision` the
final live revision, in both profiles (X1); (b) an embedded
`source: { id, revision }` object (collides with the Link's `source`
Reference member); (c) `id` alone for deletions (loses the `type` and final
revision that tombstones and `DeletedData` carry); (d) the first draft's
`{ resourceKind, resource: { id, type, revision } }`, which carried a
redundant kind and a member name the sibling does not use. Recommendation:
(a).

**T23 — Bundle naming and validator conventions (shared).** RATIFIED 2026-09-08 (operator: as drafted). *Revised
(council 10).*
Options: (a) operation records are `<operation>Operation` over the
Read+Update `<operation>Members` mixins, singleton bodies are
`<operation>Request`, RFC 3339 instants are the `dateTime` definition
carrying `format: date-time` with the format registered in both canonical
validators (T45), and profile problem tables compose by `$ref` (T43); (b)
the first draft's pattern-only `dateTime` and its `problemCodeRows`
definition. Tradeoffs: (b) accepted impossible dates and stated every Read
row twice. Recommendation: (a).

**T24 — Reconciliation with the landed Read+Update wire.** RATIFIED 2026-09-08 (operator: as drafted).
Context: the first draft was written against a sibling branch that carried
no change and said its spellings would be "re-pointed at apply time"; the
sibling has since landed 71 definitions, six spec subsections, fixtures,
61 rows, and D1–D31, and several of the packet's spellings contradicted it
(Claude H6). Options: (a) adopt the landed spellings wherever the halves
must agree — `identity-taken` for `identity-conflict`,
`aggregate-constraint-violation` for `constraint-violated`,
`validation-failed` absorbing `patch-failed`, `unsupported-media-type`
inherited with its `415`, `validationDiagnostic` for `problemDiagnostic`,
`operationName` for `name` on entries, `localName` for `localLabel`,
`resourceReference`, `inputReference`, `inputPinnedReference`, and
`durableResourceReference` for the `mutation*Reference` family,
`expectedRevision`, `idempotencyKey`, `propertyChange`, and `jsonPointer`
defined once, `<operation>Members` composition, and `$ref` problem
composition — and state the true cross-profile rulings once as X1–X4;
(b) keep the first draft's spellings and re-point at apply time.
Tradeoffs: (b) leaves two spellings of one thing in the repository until a
third pass reconciles them. The full table is under
[Reconciliation with Read+Update](#reconciliation-with-readupdate).
Recommendation: (a).

**T45 — Validated timestamps.** RATIFIED 2026-09-08 (operator: as drafted).
Context: the first draft's `dateTime` was a pattern that checked
punctuation and digit counts, accepted `2026-99-99T99:99:99+99:99`, and
rejected the lowercase `t` and `z` RFC 3339 permits (Codex M15, Claude
L2). Options: (a) `format: date-time`, registered in
`packages/conformance/src/schema-validator.ts` and in the protocol tests
from ajv-formats' full mode exactly as `uri` is, which validates the
calendar and the clock and accepts either case; with a prose profile that
authorities emit uppercase `T` and `Z`; (b) a stricter lexical pattern
plus semantic validation in the harness. Tradeoffs: (b) puts calendar
rules in test code the bundle does not express. Boundaries the packet's
sanity check exercises: `2026-99-99T99:99:99+99:99` and
`2026-02-30T00:00:00Z` rejected, `2026-09-07T18:04:12Z` and
`2026-09-07T18:04:12.5+02:00` accepted. Recommendation: (a).

**X1 — The deleted identity is a record in both profiles.** RULED 2026-09-08 (operator, option B): the
identity record `{ resourceKind, resource: { id, type, revision } }` with `revision` the final live
revision, in both profiles; the Read+Update draft's D9 (`deleted` as a URL string) is superseded and its
bundle, fixture, and row change on #19.
Context: Read+Update D9 spells `deleted` as the absolute canonical URL and
reports no revision, because deletion mints none; T22 spelled it as a
record carrying the final live revision, matching the changefeed tombstone
and `DeletedData`; the two must be ruled once (cross-packet note X1; Codex
H8; Gemini 3). Options: (a) `deleted` is the record `{ id, type,
revision }` in the Read+Update `mutationResultMembers` and in receipt
entries, `revision` documented as the final live revision and not a newly
minted one, so D9's "deletion mints no version" stays true; (b) a bare URL
in both profiles (a client cannot cite what it deleted, and the receipt
entry would carry less than the tombstone for the same fact); (c) keep the
two profiles different. Cost of (a): the Read+Update bundle's
`mutationResultMembers.deleted`, fixture `sequence-positive.json` and the
other deletion exchanges, and the rows `read-update.singleton.delete-bead`
and `read-update.singleton.delete-link`. Recommendation: (a), for both
profiles.

**X2 — `retention.idempotency` is Read+Update-only.** RULED 2026-09-08 (operator: ACK as drafted).
Context: D6 makes `retention.idempotency` the Read+Update floor; T14
prohibits it on Transactional discovery. The two are consistent, but the
Advertised-limits text had to say so (cross-packet note X2). Decision: the
sentence proposed under section 4.1 — the member is Read+Update-only, a
Transactional discovery document MUST NOT advertise it, and
`transactionalAdvertisedLimits` rejects it. Recommendation: apply to both
halves' reading of the Advertised-limits section.

**X3 — Why Read+Update refuses and Transactional joins.** RULED 2026-09-08 (operator: ACK as drafted; the uniformity principle carries the sentence once).
Context: D5 refuses a concurrent duplicate (`idempotency-in-progress`);
the Transactional profile joins it through a pending receipt (`202`).
Both packets say so; the specification's own text should carry the reason
once (cross-packet note X3; Gemini 4). Decision: the sentence proposed
under section 4.1, in "Mutation Transactions" — Read+Update refuses because
it has no durable receipt to hand the duplicate, and the Transactional
join is the same exactly-once promise made with the profile's own vehicle.
Recommendation: apply.

**X4 — `source` beside `sourceRevision` on owned-Link results in both
profiles.**
Context: D10 (revised) put `source`, the source Bead's canonical URL,
beside `sourceRevision` on every owned-Link result, present exactly when
the other is, because a deletion returns no Link record that could name
the source; the council found the same defect in the first draft's receipt
entries (Codex H8, Claude M2, Gemini 3). Decision: receipt entries carry
the pair exactly as `mutationResultMembers` does, including on `deleted`
and `erased` entries; the bundle's `receiptResult` rejects either member
alone and both on a Bead postimage. Recommendation: apply to both
profiles; already applied on the Read+Update side.

X4 RULED 2026-09-08 (operator, option A): `source` beside `sourceRevision` on every owned-Link result — create, update, delete — in both profiles; `receiptResult` gains `source` and its fixture follows when this packet is applied.

## 5. Version erasure on the changefeed

bdp#12 and bdp#16 ruled that erasure propagates and retention does not, and
the draft's "Version erasure" section fixes the erasure record's three
members, its per-view projection, its position, and the atomic correction
case. What remains unassigned is the wire form of the change group that
carries it — the draft's `ChangeGroup` model has `erasures` and the
changefeed examples do not — the tombstone entry's `operation` name, the
digest discipline and its input domain, what happens when the erased
version is the live one, how inline owned-Link copies are reached, what
every store that holds a version must do, and how the obligation survives
replay, resnapshot, view rotation, and restore. This section assigns them.
The council rejected the first draft's T20 as written — it withheld Events
by type rather than by content, left receipts and snapshots out of the
store list, had no replay representation for a scrubbed group, and let
the obligation lapse across restore — and this section is its replacement.

### 5.1 Proposed normative text

Target: "BDP JSON and HTTP Protocol". Append to the section's introduction,
before "Scope discovery and human documentation".

Every JSON text BDP admits or emits is an I-JSON text (RFC 7493): its
strings are sequences of Unicode scalar values, so an escape that would
produce an unpaired surrogate is invalid; its numbers are exactly
representable as IEEE 754 binary64 values, so an integer beyond 2^53 − 1 in
magnitude or a decimal that does not round-trip is invalid; and an object
carries no duplicate member name. A request body that is not an I-JSON
text is carrier syntax rejected before execution with `malformed-request`
in every profile. An authority that adapts an existing store MUST map or
refuse values outside this contract before it serves them as BDP Resources.
The contract is what gives every Resource record exactly one RFC 8785
canonical serialization, which [Version erasure](#version-erasure) digests.
Every instant BDP emits — an Event's `time`, a receipt's or a snapshot's
`expiresAt` — is an RFC 3339 `date-time` written with uppercase `T` and
`Z`, and the bundle's `dateTime` definition validates the calendar and the
clock, not merely the punctuation; a client accepts the lowercase forms
RFC 3339 permits.

Target: "Scope changefeed". Insert before "When a transaction has no
visible effect, the group is instead a projection advance".

On the wire, a change group carries `scopeEpoch`, `authorizationView`,
`checkpoint`, `position`, `previousPosition`, `projectionAdvance`,
`transaction`, `eventCount`, `changes`, `erasures`, and `events`. `changes`,
`erasures`, and `events` are always present, and each is empty when the
group carries nothing of its kind; a visible group carries at least one of
the three non-empty. A `changes` entry is either an `upsert` — `operation`
`upsert`, `resourceKind`, and `resource`, the complete canonical Bead or
Link record at its final projected revision, without the `links`
aggregate — or a `tombstone` — `operation` `tombstone`, `resourceKind`,
and `resource` carrying the `id`, the immutable `type`, and the last
visible `revision`. A tombstone has the same shape whether the Resource
was deleted or merely left the view, because an authorization-projection
tombstone does not assert underlying deletion. A projection advance
carries `projectionAdvance` `true`, no `transaction`, `eventCount` `0`, and
three empty arrays. `eventCount` equals the number of entries in `events`
as the group is served. A finite read's `after` is the exclusive checkpoint
the page continues from: the requested `after`, or, for `start=now`, the
head checkpoint the authority observed when it admitted the request.

Target: "Change groups and replication". Replace the `ChangeGroup` model
block's member list with `scopeEpoch`, `authorizationView`, `checkpoint`,
`position`, `previousPosition`, `projectionAdvance`, `transaction?`,
`changes`, `erasures`, `eventCount`, and `events`: `checkpoint` is a group
member on the wire, as every changefeed example already shows.

Target: "Version erasure". Append.

Each `erasures` entry carries `subject`, the canonical Resource URL;
`revision`, the erased version's token; and `digest`, an object with
`scheme` and `value`. BDP v0 defines exactly one scheme, `sha-256-jcs`:
`value` is the lowercase hexadecimal SHA-256 of the RFC 8785 (JCS)
serialization of the erased version's complete Resource record — the
record the authority served for that revision, `attribution` and
`ownedLinks` included and the `links` aggregate excluded — with JCS's
ES6 number serialization and its UTF-16 code-unit member ordering. BDP
JSON is I-JSON, so every record has exactly one canonical serialization
and one digest, and implementations agree on it without a BDP-specific
canonicalization rule. Digest computation never gates erasure: an authority
that cannot serialize a version under JCS has committed a value outside
the data contract, which is its own conformance failure; it erases the
content all the same, emits the record with the digest it computes over
its best canonical serialization, and reports the escape out of band, and
the mismatch a replica then reports is the correct audit signal for a
record that escaped the contract, never a reason to hold the content.

The **erased content** of a version is its record less its lineage marker
— everything but `id`, `type`, and `revision`: `properties`,
`attribution`, a Link's `source`, `target`, and pin, and a source Bead's
inline owned-Link records. The lineage marker, the erasure record, and the
digest survive erasure everywhere; the erased content survives nowhere.

An erasure group is an ordinary visible group at its own position —
`projectionAdvance` `false`, `transaction` present and minted by the
authority for the administrative act, which has no Mutation Receipt because
erasure is not a BDP operation. An erasure-only group, one that erases
historical versions and commits nothing, carries empty `changes` and
`events`. Because a source Bead's version record inlines its owned Links'
records, erasing an owned Link's version erases every source version that
inlined it: the authority emits one erasure record per erased version in
the same group, and each is applied on its own.

An authority MUST NOT commit an erasure of a Resource's live version
without, in the same group, either the successor's `upsert` postimage or
the Resource's `tombstone`; a replica never holds a live Resource without
content. When the group commits a successor, the successor's `updated`
fact is the delta from a version whose content must not exist, and an
ordinary Property Change — its `remove` and `replace` paths and prior
values — would disclose it. The successor's fact therefore carries the
content-free delta form: `change` is exactly one `replace` at the root
pointer `""` whose `value` is the successor's complete `properties`, and
`previousRevision` is the erased revision. The successor MUST differ from
the erased version — a `properties` value equal under RFC 6902 Section 4.6
would re-commit the erased content and, under [Revisions](#revisions),
mints nothing — or the group tombstones the Resource instead. An owned
Link's successor is carried the same way in its own `updated` fact and in
the source's `ownedLink` delta.

Erasing a live version with a tombstone is an administrative deletion of
the Resource. It is subject to deletion safety — a Bead with a live
incident Link cannot be tombstoned, so the administrator first deletes or
erases those Links — and it induces the ordinary facts of a deletion: the
subject's `deleted` fact, an `unlinked` fact at each in-Scope endpoint of a
deleted Link, and, for an owned Link, the source Bead's fresh version, whose
postimage joins `changes` and whose `updated` fact carries `ownedLink` with
`operation` `deleted` and the Link's identity. Those facts carry the
administrative transaction identity and are subject to the withholding rule
below like every other Event, so that in the common case — every version
of a Link erased with its tombstone — its graph facts are withheld and only
the identity-bearing `deleted` fact is served. A group carrying a
live-version erasure is valid only when its successor `upsert` or
`tombstone` leaves every Link's in-Scope endpoints live, every view closed
over owned Links, and every owning source at a version whose inline owned
set agrees with the Links' first-class records.

A store, cache, or replica that processes an erasure record MUST, for the
named subject and revision:

1. discard the erased content wherever it holds it — the retained version
   record, stored change-group postimages, retained Events, Mutation
   Receipts and receipt pages, retained sequence dispositions, snapshots
   and snapshot pages, caches, and derived indexes — before it makes any
   further state visible;
2. retain the lineage marker, the erasure record, and the digest, so that
   an audit can prove which version once stood at that point without
   recovering it, and a replica SHOULD verify the digest against its held
   copy before discarding it and report a mismatch out of band — a mismatch
   never suspends the obligation;
3. answer reads of that version with the `resource-erased` disclosure to
   callers authorized for the subject's retained history and with the
   uniform `404` `resource-not-found` to every other caller; serve a
   receipt entry whose postimage was the version as `erased` to the former
   and as `withheld` to the latter, under
   [Mutation Receipt responses](#mutation-receipt-responses); and, for a
   tombstoned subject, keep serving the Event-Source cursors and the
   `deleted` fact its lineage marker permits;
4. withhold, from every Event Source it serves, every Event whose `data`
   carries erased content: the `created` or `updated` fact that minted the
   erased revision; the source Bead's `updated` fact whose `ownedLink`
   carries the erased Link version; and a `linked` or `unlinked` fact whose
   endpoint References are erased content — which is the case exactly when
   every version of the Link that carried them is erased, since a Link's
   endpoints are immutable across its versions. A `deleted` fact carries
   only a lineage marker and is never withheld. Withholding removes the
   Event from every projection and leaves its ordinal as a gap exactly as a
   hidden fact does; every served Event's cursor stays valid, a cursor
   whose Event was withheld remains a valid exclusive `after` position, and
   a group's `eventCount` counts the Events it serves;
5. carry the record onward on any changefeed and in every snapshot manifest
   it serves, under [Scope snapshots](#scope-snapshots); and
6. expire, in every view that received the record, every changefeed
   checkpoint and every snapshot anchored before the record's position, as
   the next paragraph requires.

An erasure record committed at position P invalidates, in each view that
receives it, every changefeed checkpoint and every snapshot anchored before
P: `minimumReplayPosition` advances to at least P, a read whose `after`
precedes P fails with `cursor-expired`, a page of a snapshot anchored
before P returns `410` `cursor-expired`, and the manifest's `expiresAt` is
superseded. A replica behind P therefore bootstraps from a fresh snapshot —
anchored at or after P, and so free of the erased content by construction —
rather than replaying the groups that carried it, and no group that
predates an erasure it must apply is ever served to it again. Within a view
that never received the record nothing expires. An erasure does not rotate
the Scope epoch: every token anchored at or after the erasure position
remains exactly as valid as it was.

Erasure records are identity-level state, outside fenced history. The
authority keeps every erasure record it has committed — the **erasure
ledger** — for the lifetime of the logical Scope, exactly as it keeps the
identity non-reuse guarantee, and the ledger survives restore, epoch
rotation, and view rotation. Every snapshot manifest carries `erasures`,
the ledger projected for the manifest's view — each record whose subject
was observable in that view — so that a replica installing a replacement
generation, after resnapshot, after a view rotation, or after a restore,
applies the same obligations to everything it retains from before: its
previous generation, retained groups, Events, receipts, indexes, and
caches. After a restore into a new epoch the authority also re-emits the
projected ledger as erasure-only groups at the new epoch's first positions,
before any other group, and no group of the prior epoch is served under the
new one. Epoch rotation never revokes an erasure obligation. A replica that
retains content whose erasure status it cannot establish — content held
under a view or epoch for which it can no longer obtain the ledger — MUST
discard that content.

Target: "Scope snapshots". Append.

A snapshot manifest carries `erasures`, the erasure ledger projected for
the manifest's view under [Version erasure](#version-erasure), and a
replica applies those records before it publishes the replacement
generation. A snapshot's two streams describe one graph: every Link whose
in-Scope endpoint is in the projection appears in the `links` stream and
its endpoint Bead in the `beads` stream, and every owned Link inlined in a
Bead record of the `beads` stream also appears as a first-class record in
the `links` stream, member for member. A replica stages both streams
completely and verifies that agreement before it publishes; a snapshot in
which an inline owned Link and its first-class record disagree, or in which
a Link's in-Scope endpoint is absent, is invalid, and the replica discards
it and fetches a new one rather than choosing an authoritative stream. The
same verification applies to a change group: a source Bead's `upsert` and
the `upsert` or `tombstone` of each of its owned Links MUST agree, and a
group whose entries disagree is rejected as an authority fault, never
applied in part. A snapshot anchored before an erasure record's position is
expired by that record in the view that receives it.

### 5.2 Proposed schema

`changeGroup` closes the group; its conditional makes a projection advance
carry nothing but positions and a visible group carry something.
`snapshotManifest` adds `erasures`. `transactionalAdvertisedLimits`
composes the shared limit primitives and rejects `retention.idempotency`,
as `readUpdateAdvertisedLimits` rejects the Transactional groups;
`transactionalDiscovery` is transcribed from the draft's discovery table
and references it.

<!-- bundle-defs -->
```json
{
  "stateChange": {
    "type": "object",
    "required": ["operation", "resourceKind", "resource"],
    "properties": {
      "operation": { "enum": ["upsert", "tombstone"] },
      "resourceKind": { "$ref": "#/$defs/resourceKind" },
      "resource": { "type": "object" }
    },
    "allOf": [
      {
        "if": {
          "properties": { "operation": { "const": "upsert" }, "resourceKind": { "const": "bead" } },
          "required": ["operation", "resourceKind"]
        },
        "then": {
          "properties": {
            "resource": {
              "allOf": [
                { "$ref": "#/$defs/beadRecord" },
                { "type": "object", "properties": { "links": false } }
              ]
            }
          }
        }
      },
      {
        "if": {
          "properties": { "operation": { "const": "upsert" }, "resourceKind": { "const": "link" } },
          "required": ["operation", "resourceKind"]
        },
        "then": {
          "properties": { "resource": { "$ref": "#/$defs/linkRecord" } }
        }
      },
      {
        "if": {
          "properties": { "operation": { "const": "tombstone" } },
          "required": ["operation"]
        },
        "then": {
          "properties": { "resource": { "$ref": "#/$defs/resourceIdentity" } }
        }
      }
    ],
    "additionalProperties": false
  },
  "erasureDigest": {
    "type": "object",
    "required": ["scheme", "value"],
    "properties": {
      "scheme": { "enum": ["sha-256-jcs"] },
      "value": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
    },
    "additionalProperties": false
  },
  "erasureRecord": {
    "type": "object",
    "required": ["subject", "revision", "digest"],
    "properties": {
      "subject": { "$ref": "#/$defs/absoluteHttpUrl" },
      "revision": { "$ref": "#/$defs/revision" },
      "digest": { "$ref": "#/$defs/erasureDigest" }
    },
    "additionalProperties": false
  },
  "changeGroup": {
    "title": "BDP change group",
    "type": "object",
    "required": [
      "scopeEpoch",
      "authorizationView",
      "checkpoint",
      "position",
      "previousPosition",
      "projectionAdvance",
      "eventCount",
      "changes",
      "erasures",
      "events"
    ],
    "properties": {
      "scopeEpoch": { "$ref": "#/$defs/wireToken" },
      "authorizationView": { "$ref": "#/$defs/wireToken" },
      "checkpoint": { "$ref": "#/$defs/wireToken" },
      "position": { "$ref": "#/$defs/wireToken" },
      "previousPosition": { "$ref": "#/$defs/wireToken" },
      "projectionAdvance": { "type": "boolean" },
      "transaction": { "$ref": "#/$defs/wireToken" },
      "eventCount": { "type": "integer", "minimum": 0 },
      "changes": {
        "type": "array",
        "items": { "$ref": "#/$defs/stateChange" }
      },
      "erasures": {
        "type": "array",
        "items": { "$ref": "#/$defs/erasureRecord" }
      },
      "events": {
        "type": "array",
        "items": { "$ref": "#/$defs/event" }
      }
    },
    "allOf": [
      {
        "if": {
          "properties": { "projectionAdvance": { "const": true } },
          "required": ["projectionAdvance"]
        },
        "then": {
          "properties": {
            "transaction": false,
            "eventCount": { "const": 0 },
            "changes": { "type": "array", "maxItems": 0 },
            "erasures": { "type": "array", "maxItems": 0 },
            "events": { "type": "array", "maxItems": 0 }
          }
        },
        "else": {
          "type": "object",
          "required": ["transaction"],
          "properties": { "transaction": true },
          "anyOf": [
            { "properties": { "changes": { "type": "array", "minItems": 1 } } },
            { "properties": { "erasures": { "type": "array", "minItems": 1 } } },
            { "properties": { "events": { "type": "array", "minItems": 1 } } }
          ]
        }
      }
    ],
    "additionalProperties": false
  },
  "changefeedPage": {
    "title": "BDP changefeed page",
    "type": "object",
    "required": [
      "scope",
      "scopeEpoch",
      "authorizationView",
      "after",
      "observedHeadPosition",
      "groups",
      "next"
    ],
    "properties": {
      "scope": { "$ref": "#/$defs/absoluteHttpUrl" },
      "scopeEpoch": { "$ref": "#/$defs/wireToken" },
      "authorizationView": { "$ref": "#/$defs/wireToken" },
      "after": { "$ref": "#/$defs/wireToken" },
      "observedHeadPosition": { "$ref": "#/$defs/wireToken" },
      "groups": {
        "type": "array",
        "items": { "$ref": "#/$defs/changeGroup" }
      },
      "next": {
        "oneOf": [{ "$ref": "#/$defs/absoluteHttpUrl" }, { "type": "null" }]
      }
    },
    "additionalProperties": false
  },
  "snapshotManifest": {
    "title": "BDP snapshot manifest",
    "type": "object",
    "required": [
      "id",
      "scope",
      "scopeEpoch",
      "authorizationView",
      "scopePosition",
      "checkpoint",
      "expiresAt",
      "erasures",
      "beads",
      "links"
    ],
    "properties": {
      "id": { "$ref": "#/$defs/absoluteHttpUrl" },
      "scope": { "$ref": "#/$defs/absoluteHttpUrl" },
      "scopeEpoch": { "$ref": "#/$defs/wireToken" },
      "authorizationView": { "$ref": "#/$defs/wireToken" },
      "scopePosition": { "$ref": "#/$defs/wireToken" },
      "checkpoint": { "$ref": "#/$defs/wireToken" },
      "expiresAt": { "$ref": "#/$defs/dateTime" },
      "erasures": {
        "type": "array",
        "items": { "$ref": "#/$defs/erasureRecord" }
      },
      "beads": {
        "allOf": [
          { "$ref": "#/$defs/beadCollection" },
          {
            "type": "object",
            "properties": {
              "items": {
                "type": "array",
                "items": { "type": "object", "properties": { "links": false } }
              }
            }
          }
        ]
      },
      "links": { "$ref": "#/$defs/linkCollection" }
    },
    "additionalProperties": false
  },
  "transactionalAdvertisedLimits": {
    "type": "object",
    "allOf": [{ "$ref": "#/$defs/advertisedLimits" }],
    "properties": {
      "retention": {
        "type": "object",
        "properties": { "idempotency": false }
      }
    }
  },
  "transactionalDiscovery": {
    "title": "BDP Transactional discovery document",
    "type": "object",
    "required": [
      "bdpVersion",
      "profile",
      "scope",
      "scopeEpoch",
      "authorizationView",
      "headPosition",
      "minimumReplayPosition",
      "beads",
      "links",
      "types",
      "operations",
      "receipts",
      "snapshot",
      "changes",
      "events"
    ],
    "properties": {
      "bdpVersion": { "$ref": "#/$defs/bdpVersion" },
      "profile": { "const": "transactional" },
      "scope": { "$ref": "#/$defs/absoluteHttpUrl" },
      "scopeEpoch": { "$ref": "#/$defs/wireToken" },
      "authorizationView": { "$ref": "#/$defs/wireToken" },
      "headPosition": { "$ref": "#/$defs/wireToken" },
      "minimumReplayPosition": { "$ref": "#/$defs/wireToken" },
      "beads": { "$ref": "#/$defs/absoluteHttpUrl" },
      "links": { "$ref": "#/$defs/absoluteHttpUrl" },
      "types": { "$ref": "#/$defs/absoluteHttpUrl" },
      "operations": { "$ref": "#/$defs/absoluteHttpUrl" },
      "receipts": { "$ref": "#/$defs/absoluteHttpUrl" },
      "snapshot": { "$ref": "#/$defs/absoluteHttpUrl" },
      "changes": { "$ref": "#/$defs/absoluteHttpUrl" },
      "events": { "$ref": "#/$defs/absoluteHttpUrl" },
      "aliases": { "$ref": "#/$defs/absoluteHttpUrl" },
      "order": { "enum": ["canonical-uri"] },
      "limits": { "$ref": "#/$defs/transactionalAdvertisedLimits" },
      "maximumEndpointMultiplicity": {
        "type": "array",
        "items": { "$ref": "#/$defs/maximumEndpointMultiplicityPolicy" }
      }
    },
    "additionalProperties": false
  }
}
```

### 5.3 Fixtures

The change group for the first batch under section 2.3 at `pos-43`,
projected for the view that saw everything. `changes` carries three
postimages — the Decision at `dec-9-r2` with its owned set inline, the
Link, and the Task — and `events` carries six facts in the order T3 fixes:
the Decision's creation, then the Link's creation, its two graph facts, and
the source's owned-Link `updated` fact, then the Task's update.

<!-- fixture: changeGroup -->
```json
{
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "checkpoint": "ckpt-43",
  "position": "pos-43",
  "previousPosition": "pos-42",
  "projectionAdvance": false,
  "transaction": "txn-0a1b",
  "eventCount": 6,
  "changes": [
    {
      "operation": "upsert",
      "resourceKind": "bead",
      "resource": {
        "id": "https://beads.example/acme/beads/dec-9",
        "type": "https://work.example/types/decision",
        "revision": "dec-9-r2",
        "attribution": { "principal": "agent:planner", "status": "claimed" },
        "properties": { "title": "Adopt owned Links", "status": "proposed" },
        "ownedLinks": {
          "https://work.example/types/cites": [
            {
              "id": "https://beads.example/acme/links/9c1e",
              "type": "https://work.example/types/cites",
              "revision": "9c1e-r1",
              "attribution": { "principal": "agent:planner", "status": "claimed" },
              "source": "https://beads.example/acme/beads/dec-9",
              "target": "https://beads.example/acme/beads/task-42",
              "properties": { "role": "evidence" }
            }
          ]
        }
      }
    },
    {
      "operation": "upsert",
      "resourceKind": "link",
      "resource": {
        "id": "https://beads.example/acme/links/9c1e",
        "type": "https://work.example/types/cites",
        "revision": "9c1e-r1",
        "attribution": { "principal": "agent:planner", "status": "claimed" },
        "source": "https://beads.example/acme/beads/dec-9",
        "target": "https://beads.example/acme/beads/task-42",
        "properties": { "role": "evidence" }
      }
    },
    {
      "operation": "upsert",
      "resourceKind": "bead",
      "resource": {
        "id": "https://beads.example/acme/beads/task-42",
        "type": "https://work.example/types/task",
        "revision": "task-42-r8",
        "properties": { "title": "Specify BDP mutation", "status": "cited" }
      }
    }
  ],
  "erasures": [],
  "events": [
    {
      "id": "ckpt-43_0",
      "ordinal": 0,
      "type": "created",
      "source": "https://beads.example/acme/events/",
      "subject": "https://beads.example/acme/beads/dec-9",
      "subjectType": "https://work.example/types/decision",
      "transaction": "txn-0a1b",
      "time": "2026-09-07T18:04:12Z",
      "data": {
        "revision": "dec-9-r1",
        "properties": { "title": "Adopt owned Links", "status": "proposed" },
        "attribution": { "principal": "agent:planner", "status": "claimed" }
      }
    },
    {
      "id": "ckpt-43_1",
      "ordinal": 1,
      "type": "created",
      "source": "https://beads.example/acme/events/",
      "subject": "https://beads.example/acme/links/9c1e",
      "subjectType": "https://work.example/types/cites",
      "transaction": "txn-0a1b",
      "time": "2026-09-07T18:04:12Z",
      "data": {
        "revision": "9c1e-r1",
        "properties": { "role": "evidence" },
        "attribution": { "principal": "agent:planner", "status": "claimed" },
        "source": "https://beads.example/acme/beads/dec-9",
        "target": "https://beads.example/acme/beads/task-42"
      }
    },
    {
      "id": "ckpt-43_2",
      "ordinal": 2,
      "type": "linked",
      "source": "https://beads.example/acme/events/",
      "subject": "https://beads.example/acme/links/9c1e",
      "subjectType": "https://work.example/types/cites",
      "transaction": "txn-0a1b",
      "time": "2026-09-07T18:04:12Z",
      "data": {
        "endpoint": "source",
        "link": {
          "id": "https://beads.example/acme/links/9c1e",
          "type": "https://work.example/types/cites"
        },
        "source": "https://beads.example/acme/beads/dec-9",
        "target": "https://beads.example/acme/beads/task-42"
      }
    },
    {
      "id": "ckpt-43_3",
      "ordinal": 3,
      "type": "linked",
      "source": "https://beads.example/acme/events/",
      "subject": "https://beads.example/acme/links/9c1e",
      "subjectType": "https://work.example/types/cites",
      "transaction": "txn-0a1b",
      "time": "2026-09-07T18:04:12Z",
      "data": {
        "endpoint": "target",
        "link": {
          "id": "https://beads.example/acme/links/9c1e",
          "type": "https://work.example/types/cites"
        },
        "source": "https://beads.example/acme/beads/dec-9",
        "target": "https://beads.example/acme/beads/task-42"
      }
    },
    {
      "id": "ckpt-43_4",
      "ordinal": 4,
      "type": "updated",
      "source": "https://beads.example/acme/events/",
      "subject": "https://beads.example/acme/beads/dec-9",
      "subjectType": "https://work.example/types/decision",
      "transaction": "txn-0a1b",
      "time": "2026-09-07T18:04:12Z",
      "data": {
        "previousRevision": "dec-9-r1",
        "revision": "dec-9-r2",
        "ownedLink": {
          "operation": "created",
          "link": {
            "id": "https://beads.example/acme/links/9c1e",
            "type": "https://work.example/types/cites",
            "revision": "9c1e-r1",
            "attribution": { "principal": "agent:planner", "status": "claimed" },
            "source": "https://beads.example/acme/beads/dec-9",
            "target": "https://beads.example/acme/beads/task-42",
            "properties": { "role": "evidence" }
          }
        },
        "attribution": { "principal": "agent:planner", "status": "claimed" }
      }
    },
    {
      "id": "ckpt-43_5",
      "ordinal": 5,
      "type": "updated",
      "source": "https://beads.example/acme/events/",
      "subject": "https://beads.example/acme/beads/task-42",
      "subjectType": "https://work.example/types/task",
      "transaction": "txn-0a1b",
      "time": "2026-09-07T18:04:12Z",
      "data": {
        "previousRevision": "task-42-r7",
        "revision": "task-42-r8",
        "change": [{ "op": "replace", "path": "/status", "value": "cited" }]
      }
    }
  ]
}
```

A finite changefeed read whose one group erases a historical version of the
Task — `task-42-r7`, superseded by `task-42-r8` — so no state change is
needed and no Event is induced. The digest is the SHA-256 of the JCS
serialization of the record the authority served for `task-42-r7` (the
snapshot record below); in the view that receives it, every checkpoint and
snapshot anchored before `pos-44` — the `pos-42` snapshot included —
expires.

<!-- fixture: changefeedPage -->
```json
{
  "scope": "https://beads.example/acme/",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "after": "ckpt-43",
  "observedHeadPosition": "pos-44",
  "groups": [
    {
      "scopeEpoch": "epoch-1",
      "authorizationView": "view-a",
      "checkpoint": "ckpt-44",
      "position": "pos-44",
      "previousPosition": "pos-43",
      "projectionAdvance": false,
      "transaction": "adm-e1",
      "eventCount": 0,
      "changes": [],
      "erasures": [
        {
          "subject": "https://beads.example/acme/beads/task-42",
          "revision": "task-42-r7",
          "digest": {
            "scheme": "sha-256-jcs",
            "value": "5c9db2f807bbed90617ec1a01f3c4c86e44967c703bf6e480ca97c2ce4fae832"
          }
        }
      ],
      "events": []
    }
  ],
  "next": null
}
```

The correction case: the Task's live version `task-42-r8` is erased and its
corrected successor `task-42-r9` — a different title — is committed in the
same group, so the group carries the erasure record, the successor's
postimage, and the successor's own `updated` fact in the content-free
delta form: one root `replace` carrying the successor's complete
`properties`, from which nothing of `task-42-r8` can be read.

<!-- fixture: changeGroup -->
```json
{
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "checkpoint": "ckpt-45",
  "position": "pos-45",
  "previousPosition": "pos-44",
  "projectionAdvance": false,
  "transaction": "adm-e2",
  "eventCount": 1,
  "changes": [
    {
      "operation": "upsert",
      "resourceKind": "bead",
      "resource": {
        "id": "https://beads.example/acme/beads/task-42",
        "type": "https://work.example/types/task",
        "revision": "task-42-r9",
        "properties": { "title": "Specify BDP mutation receipts", "status": "cited" }
      }
    }
  ],
  "erasures": [
    {
      "subject": "https://beads.example/acme/beads/task-42",
      "revision": "task-42-r8",
      "digest": {
        "scheme": "sha-256-jcs",
        "value": "f51ab17bca9039a933d2780986bbc02d3efacae2e4dc372c9c26fe3646543677"
      }
    }
  ],
  "events": [
    {
      "id": "ckpt-45_0",
      "ordinal": 0,
      "type": "updated",
      "source": "https://beads.example/acme/events/",
      "subject": "https://beads.example/acme/beads/task-42",
      "subjectType": "https://work.example/types/task",
      "transaction": "adm-e2",
      "time": "2026-09-07T18:20:05Z",
      "data": {
        "previousRevision": "task-42-r8",
        "revision": "task-42-r9",
        "change": [
          {
            "op": "replace",
            "path": "",
            "value": { "title": "Specify BDP mutation receipts", "status": "cited" }
          }
        ]
      }
    }
  ]
}
```

The identifier-free projection advance a view that never saw the Task
receives at the erasure's position.

<!-- fixture: changeGroup -->
```json
{
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-b",
  "checkpoint": "ckpt-44",
  "position": "pos-44",
  "previousPosition": "pos-43",
  "projectionAdvance": true,
  "eventCount": 0,
  "changes": [],
  "erasures": [],
  "events": []
}
```

The tombstone path at `pos-47`: the only version of the unowned `relates`
Link `rel-5` (`task-43` → `task-44`) is erased with the Link's tombstone,
an administrative deletion. The deletion induces three facts — the Link's
`deleted` fact and an `unlinked` fact at each endpoint — but the two graph
facts carry the erased endpoints and are withheld, leaving ordinals 1 and 2
as gaps; only the identity-bearing `deleted` fact is served and counted.

<!-- fixture: changeGroup -->
```json
{
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "checkpoint": "ckpt-47",
  "position": "pos-47",
  "previousPosition": "pos-46",
  "projectionAdvance": false,
  "transaction": "adm-e3",
  "eventCount": 1,
  "changes": [
    {
      "operation": "tombstone",
      "resourceKind": "link",
      "resource": {
        "id": "https://beads.example/acme/links/rel-5",
        "type": "https://work.example/types/relates",
        "revision": "rel-5-r1"
      }
    }
  ],
  "erasures": [
    {
      "subject": "https://beads.example/acme/links/rel-5",
      "revision": "rel-5-r1",
      "digest": {
        "scheme": "sha-256-jcs",
        "value": "818526cfc51ba7e4efcb8b77e78b97f570a19d90411e4bfb8984baa947bfa784"
      }
    }
  ],
  "events": [
    {
      "id": "ckpt-47_0",
      "ordinal": 0,
      "type": "deleted",
      "source": "https://beads.example/acme/events/",
      "subject": "https://beads.example/acme/links/rel-5",
      "subjectType": "https://work.example/types/relates",
      "transaction": "adm-e3",
      "time": "2026-09-07T18:31:00Z",
      "data": { "revision": "rel-5-r1" }
    }
  ]
}
```

The draft's snapshot manifest example at `pos-42`, completed into a closed
projection: `blocks-3` targets the in-Scope `task-41`, which the `beads`
stream therefore carries, and the ledger is empty because nothing had been
erased.

<!-- fixture: snapshotManifest -->
```json
{
  "id": "https://beads.example/acme/snapshot?snapshot=snapshot-42",
  "scope": "https://beads.example/acme/",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "scopePosition": "pos-42",
  "checkpoint": "ckpt-42",
  "expiresAt": "2026-09-07T19:22:00Z",
  "erasures": [],
  "beads": {
    "items": [
      {
        "id": "https://beads.example/acme/beads/task-41",
        "type": "https://work.example/types/task",
        "revision": "task-41-r3",
        "properties": { "title": "Land the Read+Update wire", "status": "closed" }
      },
      {
        "id": "https://beads.example/acme/beads/task-42",
        "type": "https://work.example/types/task",
        "revision": "task-42-r7",
        "properties": { "title": "Specify BDP mutation", "status": "open" }
      }
    ],
    "next": null
  },
  "links": {
    "items": [
      {
        "id": "https://beads.example/acme/links/blocks-3",
        "type": "https://work.example/types/blocks",
        "revision": "blocks-3-r1",
        "source": "https://beads.example/acme/beads/task-42",
        "target": "https://beads.example/acme/beads/task-41",
        "properties": {}
      }
    ],
    "next": null
  }
}
```

A manifest taken at `pos-47`, after the three erasures, for a replica that
resnapshots: the ledger carries every record the view received, so that the
replica scrubs whatever it still holds from before, and the live state
carries only the successor and the surviving Resources.

<!-- fixture: snapshotManifest -->
```json
{
  "id": "https://beads.example/acme/snapshot?snapshot=snapshot-47",
  "scope": "https://beads.example/acme/",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "scopePosition": "pos-47",
  "checkpoint": "ckpt-47",
  "expiresAt": "2026-09-07T19:40:00Z",
  "erasures": [
    {
      "subject": "https://beads.example/acme/beads/task-42",
      "revision": "task-42-r7",
      "digest": {
        "scheme": "sha-256-jcs",
        "value": "5c9db2f807bbed90617ec1a01f3c4c86e44967c703bf6e480ca97c2ce4fae832"
      }
    },
    {
      "subject": "https://beads.example/acme/beads/task-42",
      "revision": "task-42-r8",
      "digest": {
        "scheme": "sha-256-jcs",
        "value": "f51ab17bca9039a933d2780986bbc02d3efacae2e4dc372c9c26fe3646543677"
      }
    },
    {
      "subject": "https://beads.example/acme/links/rel-5",
      "revision": "rel-5-r1",
      "digest": {
        "scheme": "sha-256-jcs",
        "value": "818526cfc51ba7e4efcb8b77e78b97f570a19d90411e4bfb8984baa947bfa784"
      }
    }
  ],
  "beads": {
    "items": [
      {
        "id": "https://beads.example/acme/beads/dec-9",
        "type": "https://work.example/types/decision",
        "revision": "dec-9-r3",
        "attribution": { "principal": "human:donna", "status": "claimed" },
        "properties": { "title": "Adopt owned Links", "status": "proposed" },
        "ownedLinks": { "https://work.example/types/cites": [] }
      },
      {
        "id": "https://beads.example/acme/beads/task-41",
        "type": "https://work.example/types/task",
        "revision": "task-41-r3",
        "properties": { "title": "Land the Read+Update wire", "status": "closed" }
      },
      {
        "id": "https://beads.example/acme/beads/task-43",
        "type": "https://work.example/types/task",
        "revision": "task-43-r2",
        "properties": { "title": "Draft the receipt schema", "status": "open" }
      },
      {
        "id": "https://beads.example/acme/beads/task-44",
        "type": "https://work.example/types/task",
        "revision": "task-44-r1",
        "properties": { "title": "Draft the erasure ledger", "status": "open" }
      }
    ],
    "next": null
  },
  "links": {
    "items": [
      {
        "id": "https://beads.example/acme/links/2d4f",
        "type": "https://work.example/types/relates",
        "revision": "2d4f-r1",
        "source": "https://beads.example/acme/beads/task-43",
        "target": { "uri": "https://github.example/issues/123", "revision": "8f0e2b" },
        "properties": {}
      }
    ],
    "next": null
  }
}
```

The draft's Transactional discovery example, with limits that omit
`retention.idempotency`.

<!-- fixture: transactionalDiscovery -->
```json
{
  "bdpVersion": "0",
  "profile": "transactional",
  "scope": "https://beads.example/acme/",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "headPosition": "pos-42",
  "minimumReplayPosition": "pos-17",
  "beads": "https://beads.example/acme/beads/",
  "links": "https://beads.example/acme/links/",
  "types": "https://beads.example/acme/types/",
  "operations": "https://beads.example/acme/operations/",
  "receipts": "https://beads.example/acme/receipts/",
  "snapshot": "https://beads.example/acme/snapshot",
  "changes": "https://beads.example/acme/changes/",
  "events": "https://beads.example/acme/events/",
  "limits": {
    "page": { "defaultItems": 50, "maximumItems": 200 },
    "transaction": { "operations": 200, "inducedEvents": 10000, "duration": "PT30S" },
    "retention": { "receipt": "P7D", "maximumSnapshotLifetime": "PT300S", "replay": "P30D" }
  }
}
```

A projection advance that names a transaction is rejected; so is a visible
group that carries nothing, a Transactional discovery document that
advertises `retention.idempotency`, a digest whose hexadecimal is not
lowercase, and a manifest without its ledger.

<!-- fixture-invalid: changeGroup -->
```json
{
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-b",
  "checkpoint": "ckpt-44",
  "position": "pos-44",
  "previousPosition": "pos-43",
  "projectionAdvance": true,
  "transaction": "adm-e1",
  "eventCount": 0,
  "changes": [],
  "erasures": [],
  "events": []
}
```

<!-- fixture-invalid: changeGroup -->
```json
{
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "checkpoint": "ckpt-44",
  "position": "pos-44",
  "previousPosition": "pos-43",
  "projectionAdvance": false,
  "transaction": "adm-e1",
  "eventCount": 0,
  "changes": [],
  "erasures": [],
  "events": []
}
```

<!-- fixture-invalid: transactionalDiscovery -->
```json
{
  "bdpVersion": "0",
  "profile": "transactional",
  "scope": "https://beads.example/acme/",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "headPosition": "pos-42",
  "minimumReplayPosition": "pos-17",
  "beads": "https://beads.example/acme/beads/",
  "links": "https://beads.example/acme/links/",
  "types": "https://beads.example/acme/types/",
  "operations": "https://beads.example/acme/operations/",
  "receipts": "https://beads.example/acme/receipts/",
  "snapshot": "https://beads.example/acme/snapshot",
  "changes": "https://beads.example/acme/changes/",
  "events": "https://beads.example/acme/events/",
  "limits": { "retention": { "idempotency": "P1D", "receipt": "P7D" } }
}
```

<!-- fixture-invalid: erasureRecord -->
```json
{
  "subject": "https://beads.example/acme/beads/task-42",
  "revision": "task-42-r7",
  "digest": {
    "scheme": "sha-256-jcs",
    "value": "5C9DB2F807BBED90617EC1A01F3C4C86E44967C703BF6E480CA97C2CE4FAE832"
  }
}
```

<!-- fixture-invalid: snapshotManifest -->
```json
{
  "id": "https://beads.example/acme/snapshot?snapshot=snapshot-42",
  "scope": "https://beads.example/acme/",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "scopePosition": "pos-42",
  "checkpoint": "ckpt-42",
  "expiresAt": "2026-09-07T19:22:00Z",
  "beads": { "items": [], "next": null },
  "links": { "items": [], "next": null }
}
```

### 5.4 Digest vectors

Interoperability vectors for `sha-256-jcs`, computed by the packet's sanity
script over the records the fixtures serve. Each line gives the JCS
serialization — member names in UTF-16 code-unit order, numbers in ES6
form, non-ASCII characters literal, control characters escaped — and its
SHA-256. An implementation that reproduces these digests agrees with the
scheme on member ordering, pins, attribution, inline owned Links, numbers,
and Unicode.

`task-42-r7` (the snapshot record above):

```text
{"id":"https://beads.example/acme/beads/task-42","properties":{"status":"open","title":"Specify BDP mutation"},"revision":"task-42-r7","type":"https://work.example/types/task"}
5c9db2f807bbed90617ec1a01f3c4c86e44967c703bf6e480ca97c2ce4fae832
```

`task-42-r8` (the postimage in the `pos-43` group):

```text
{"id":"https://beads.example/acme/beads/task-42","properties":{"status":"cited","title":"Specify BDP mutation"},"revision":"task-42-r8","type":"https://work.example/types/task"}
f51ab17bca9039a933d2780986bbc02d3efacae2e4dc372c9c26fe3646543677
```

`9c1e-r1` (attribution, unpinned in-Scope endpoints):

```text
{"attribution":{"principal":"agent:planner","status":"claimed"},"id":"https://beads.example/acme/links/9c1e","properties":{"role":"evidence"},"revision":"9c1e-r1","source":"https://beads.example/acme/beads/dec-9","target":"https://beads.example/acme/beads/task-42","type":"https://work.example/types/cites"}
e9de824dfe1c19c21703d7644e5d248fd52a74e99a8c31e94cc441e21725119e
```

`2d4f-r1` (a pinned external endpoint; the pin's members are ordered too):

```text
{"id":"https://beads.example/acme/links/2d4f","properties":{},"revision":"2d4f-r1","source":"https://beads.example/acme/beads/task-43","target":{"revision":"8f0e2b","uri":"https://github.example/issues/123"},"type":"https://work.example/types/relates"}
a1997ba742b515687a1fea7949b82e4276e1381ba6f110a86831514cc3fb4a78
```

`dec-9-r2` (an inline owned Link inside `ownedLinks`):

```text
{"attribution":{"principal":"agent:planner","status":"claimed"},"id":"https://beads.example/acme/beads/dec-9","ownedLinks":{"https://work.example/types/cites":[{"attribution":{"principal":"agent:planner","status":"claimed"},"id":"https://beads.example/acme/links/9c1e","properties":{"role":"evidence"},"revision":"9c1e-r1","source":"https://beads.example/acme/beads/dec-9","target":"https://beads.example/acme/beads/task-42","type":"https://work.example/types/cites"}]},"properties":{"status":"proposed","title":"Adopt owned Links"},"revision":"dec-9-r2","type":"https://work.example/types/decision"}
be72a080a2fcdf1d964ce0e23b85d82d9f4b54a45ab2e25b584cfd079b2307f0
```

`vec-1-r1` (numbers: `1.0` serializes as `1`, `-0` as `0`, `1e21` as
`1e+21`, `1e-7` as `1e-7`, and 2^53 − 1 is the largest integer the contract
admits):

```text
{"id":"https://beads.example/acme/beads/vec-1","properties":{"big":1e+21,"count":100,"largest":9007199254740991,"negativeZero":0,"ratio":0.1,"tiny":1e-7,"whole":1},"revision":"vec-1-r1","type":"https://work.example/types/task"}
f025bb14be7c25892c79db7e1ffbd1328789f8a4f93759fbe9ffaf53e5c60a4b
```

`vec-2-r1` (Unicode: `Z` sorts before `a`, `é` after both, and the
surrogate-pair key last; a newline and a tab inside `a` are escaped as
`\n` and `\t`; `é` is emitted literally):

```text
{"id":"https://beads.example/acme/beads/vec-2","properties":{"Z":"\"quoted\" \\ back","a":"line\nbreak\ttab","é":"café","😀":"emoji"},"revision":"vec-2-r1","type":"https://work.example/types/task"}
135fbc96c7deb12207e0b0321ac97686a77d40cf1cf07c75eb730b67d96b9d06
```

### 5.5 Decisions

**T16 — Change-group wire form.** RATIFIED 2026-09-08 (operator: as drafted). *Revised (council 10).*
Sub-decisions: (a) `erasures` is required and possibly empty, like
`changes` and `events`, so the draft's two changefeed examples gain an
empty `erasures` array; (b) `checkpoint` is a group member on the wire, as
the draft's examples already show, and the model block gains it at apply
time (Claude M5); (c) an erasure group carries `transaction`, minted by the
authority for the administrative act, because it is a visible group and
the draft makes `transaction` present on every visible group; (d) a page's
`after` for `start=now` is the head checkpoint observed at admission;
(e) a visible group carries at least one of `changes`, `erasures`, and
`events` non-empty, which the first draft's schema did not require (Claude
L4); (f) an erasure group's `events` is empty only when the group commits
nothing — the tombstone path induces the ordinary deletion facts (T31).
Alternatives: for (a), optional `erasures` (a consumer cannot tell "no
erasures" from "a producer that predates erasure"); for (c), omit
`transaction` (breaks the visible-group invariant and the schema's
conditional). Recommendation: (a)–(f) as stated.

**T17 — Tombstone entry.** RATIFIED 2026-09-08 (operator: as drafted).
Options: (a) `operation` `tombstone` with `resource` `{ id, type,
revision }`, one shape for deletion and for projection removal; (b)
`operation` `delete`; (c) distinct `deleted` and `hidden` operations.
Tradeoffs: (b) asserts deletion where the draft says a projection tombstone
does not; (c) discloses whether a Resource still exists to a view that lost
it. Recommendation: (a).

**T18 — Erasure digest discipline and encoding.** RATIFIED 2026-09-08 (operator: as drafted). *Revised (council 10).*
Options: (a) one registered scheme, `sha-256-jcs`, SHA-256 over the RFC
8785 canonical serialization of the served version record, `value` as 64
lowercase hexadecimal characters, `scheme` schema-closed to that value,
over the I-JSON input domain of T44; (b) base64url `value`; (c) an open
`scheme` string with implementation-defined disciplines. Tradeoffs: (c)
makes the digest unverifiable across implementations, which defeats
"version lineage remains verifiable"; (b) carries padding and case
questions hex does not; (a) is computable by any implementation from the
record it already serves once the input domain is the contract's, and is
extensible by a later scheme value. The first draft's fixtures carried
synthetic digests; the packet now carries the real ones and the vectors
under section 5.4 (Codex M16, Claude L6). Recommendation: (a).

**T19 — Erasing the live version and inline owned-Link copies.** RULED 2026-09-08 (operator: (a)).
*Revised (council 10).*
Options: (a) an erasure of the live version MUST be accompanied in the same
group by the successor's `upsert` or the Resource's `tombstone`, the
successor carried in the content-free delta form (T27), the tombstone path
being an administrative deletion (T31), the group valid only when it
leaves endpoint liveness, owned closure, and source-version agreement
intact (T30), and an owned Link's erased version yielding one erasure
record per source version that inlined it; (b) permit an "erased but live"
state served as `resource-erased`; (c) require replicas to scrub inline
copies without a record. Tradeoffs: (b) leaves a replica's live set
containing a Resource with no content and no way to represent it in
`changes`; (c) is an implicit obligation no digest covers. Recommendation:
(a).

**T20 — Event Sources after erasure and the store obligations.**
*Replaced (council 10).*
The first draft's (a) — withhold "the content-bearing Events" named by
type, keep serving every `linked` and `unlinked` fact as content-free, and
make five replica obligations normative — is withdrawn: graph facts carry
endpoint References and pins that are versioned Link state, so an erasure
whose subject is an endpoint survived in them (Codex C1); receipts,
pages, and snapshots were not in the store list (Claude C1, Codex H2); and
nothing said what a replay before the erasure position should see (Claude
H2). Its replacement is T25 (withholding by content), T26 (receipts as
stores), T28 (replication), and T29 (the ledger), and the six obligations
under section 5.1. The alternatives the first draft weighed still hold:
serving withheld Events with `data` replaced by a marker invents an Event
shape and keeps a pointer where the draft says even a pointer discloses,
and leaving Event-Source behavior to policy lets one implementation leak
what another erases.

**T25 — Erased content and withholding by content.** RULED 2026-09-08 (operator: (a)).
Context: Codex C1. Options: (a) define the erased content of a version as
its record less the lineage marker, and withhold every Event whose `data`
carries it — the minting fact, the source's `ownedLink` fact, and a graph
fact whose endpoints are erased content, which is the case exactly when
every version of the Link that carried them is erased, since endpoints are
immutable across a Link's versions — while `deleted` facts, which carry
only a lineage marker, are never withheld; ordinals stay as gaps, cursors
of served Events stay valid, a cursor naming a withheld Event remains a
valid `after` position, and `eventCount` counts served Events; (b) withhold
every fact of every erased subject (destroys the lineage the draft wants
verifiable, and hides `deleted` facts that carry nothing); (c) the first
draft's type-based rule. Recommendation: (a).

**T26 — Receipts, pages, and retained dispositions are erasure stores.** RULED 2026-09-08 (operator: (a)).
Context: Claude C1: fixture `rcpt-7` served the erased `task-42-r8`
postimage for a week. Options: (a) add receipts, receipt pages, and
retained sequence dispositions — which on a Transactional Scope are
receipts — to the store list; serve an affected entry as `erased`, carrying
only `operationIndex`, `operationName`, the lineage marker, and the
owned-source pair, to a caller authorized for the subject's retained
history, and as the uniform `withheld` entry to every other caller, so
that the receipt is no more an erasure oracle than a read; identity,
`sourceRevision`, the disposition, the positions, and `allocated` survive;
erasure overrides `expiresAt` for the erased content alone; a failed
receipt's problem describes the rejected request and lies outside erasure
unless the authority quoted committed content into it; (b) a `withheld`
entry with a `reason` member (`erased` versus `authorization`), which
discloses erasure to every caller of the receipt; (c) drop the entry
(renumbers nothing but hides that an operation existed). Recommendation:
(a).

**T27 — Successor delta form after a live-version erasure.** RULED 2026-09-08 (operator: (a)).
Context: Claude H1: the successor's `updated` fact carried an ordinary
Property Change whose paths and prior values describe the erased content,
and fixture `pos-45`'s successor was byte-identical to the erased version.
Options: (a) the successor's fact carries `change` as exactly one root
`replace` whose `value` is the successor's complete `properties`, with
`previousRevision` the erased revision; the successor MUST differ from the
erased version or the group tombstones instead; an owned Link's successor
is carried the same way in its own fact and in the source's `ownedLink`
delta; (b) withhold the successor's fact and require consumers to re-read;
(c) an ordinary delta. Tradeoffs: (b) leaves a gap in the successor's own
history that a consumer cannot distinguish from a hidden fact; (c) is the
finding. The fixture now changes the title. Recommendation: (a).

**T28 — Replication across an erasure: invalidation at the erasure
position.** RULED 2026-09-08 (operator: (a)).
Context: Claude H2 and Codex H2 (with Codex H3): obligation 1 scrubs
stored postimages, so a group published before the erasure would have to
change after publication; there was no wire form for a scrubbed group; a
replica resuming between the version's `upsert` and the erasure would
either lack the Resource while a Link to it existed or hold it
identity-only, which T19 forbids; and snapshots anchored before the
erasure kept serving the content until `expiresAt`. Options: (a) an
erasure record at P invalidates, in each view that receives it, every
checkpoint and snapshot anchored before P — `minimumReplayPosition`
advances to at least P, earlier cursors fail `cursor-expired`, earlier
snapshot pages `410` — so a replica behind P bootstraps from a snapshot
anchored at or after P, which is free of the erased content by
construction, and no group predating an erasure a view must apply is ever
served to that view again; the draft's "every other token remains exactly
as valid as it was" is amended to tokens anchored at or after the erasure
position; (b) a defined scrubbed-group wire form — an identity-only
`upsert` marked `erased`, `eventCount` the visible count — plus a rule for
the replica's state in the window before the successor arrives. Tradeoffs:
(b) keeps replicas behind the erasure replaying, at the cost of a second
`upsert` shape, a group whose content changes after publication, and an
interval in which a replica holds a live Resource without content — the
state T19 exists to forbid; (a) costs every replica behind an erasure a
resnapshot, which erasure's rarity and the snapshot lifetime bound make
acceptable, and keeps groups immutable. Recommendation: (a), with (b)
recorded as the alternative Codex preferred.

**T29 — The erasure ledger outside fenced history.** RULED 2026-09-08 (operator: (a)).
Context: Codex H3 and Claude M12: the obligations began when a replica
processed the record and did not reach a replica whose checkpoint had
expired, whose view had rotated, or whose Scope had been restored into a
new epoch; a replacement snapshot carries live state and cannot tell
deletion from erasure by absence; a pre-erasure backup would resurrect the
version. Options: (a) the ledger — every committed erasure record — is
identity-level state kept for the logical Scope's lifetime like the
non-reuse guarantee; every snapshot manifest carries it projected for the
view, and a replica applies it to everything it retains before publishing
a replacement generation; after a restore the ledger is re-emitted as
erasure-only groups at the new epoch's first positions and no prior-epoch
group is served under the new epoch; epoch rotation never revokes an
obligation; content whose erasure status a replica cannot establish is
destroyed; (b) a separate `erasures/` discovery Resource instead of a
manifest member (a second bootstrap fetch a replica could skip); (c)
destruction only, with no ledger transport (a longer-retention replica
would destroy everything on every resnapshot). Tradeoffs: the ledger is
bounded by the number of erasures, which are rare administrative acts.
Recommendation: (a).

**T30 — Snapshot and group agreement verified; disagreement rejected.** RULED 2026-09-08 (operator: (a)).
Context: Codex H10: Appendix B.13 of the first draft proposed treating the
`links` stream as authoritative for the Link and the Bead postimage as
authoritative for the source revision when they disagree, which permits
two incompatible records for one owned Link and violates the one-graph
rule; independent page boundaries create incomplete staged input, not
inconsistent records at one anchor. Options: (a) stage both streams,
verify that every inline owned Link equals its first-class record and that
every in-Scope endpoint is present, reject an inconsistent snapshot or
group outright and fetch anew, and require a live-version erasure's group
to leave endpoint liveness, owned closure, and source-version agreement
intact; (b) the withdrawn authority rule. Recommendation: (a); Appendix B
item 13 is rewritten accordingly.

**T31 — The tombstone path is an administrative deletion.** RULED 2026-09-08 (operator: (a)).
Context: Claude M11: erasing a live version with the tombstone is a
deletion, subject to deletion safety, and for an owned Link it versions the
source and induces `deleted` and `unlinked` facts, yet T16 said erasure
groups carry empty `events`. Options: (a) as proposed: deletion safety
applies, the ordinary facts are induced under the administrative
transaction identity, an owned Link's source postimage joins `changes`
with its `ownedLink` `deleted` fact, and the facts are subject to T25's
withholding — so a Link erased in every version has its graph facts
withheld and its `deleted` fact served; (b) an erasure tombstone induces
no facts (a replica's Event Sources then never learn the Link ended, and
an owning source's version history skips a transition). Recommendation:
(a).

**T44 — Digest input domain: the I-JSON contract.** RATIFIED 2026-09-08 (settled by gastownhall/bdp#21, ruled C: exact equality plus I-JSON admission; landed by PR #23).
Context: Codex H9: JCS is defined only over I-JSON values — binary64
numbers, no unpaired surrogates — and BDP's open `properties` did not
establish that, so an otherwise accepted record could fail canonicalization
exactly when erasure needed its digest; Claude L6 asked for the RFC 8785
number rule to be cited. Options: (a) a uniform data contract: every JSON
text BDP admits or emits is I-JSON, enforced at admission as carrier syntax
(`malformed-request`) in every profile, with adapters obliged to map or
refuse out-of-contract values in existing stores, so that every record has
one canonical serialization; digest failure never gates erasure; vectors
under section 5.4; (b) a digest discipline defined over the full JSON
value domain (BDP would have to specify its own canonicalization of
non-binary64 numbers and lone surrogates, which no other implementation
language reproduces); (c) narrow only Transactional records (two data
contracts for one Resource model, which the council rejected). Tradeoffs:
(a) is a protocol-wide sentence, proposed for the protocol section's
introduction rather than for the Transactional profile alone.
Recommendation: (a).

## 6. Conformance rows

### 6.1 Conventions

Rows use the catalog shape (`id`, `title`, `kind`, `requiredProfile`,
`requirements`) with `requiredProfile` `transactional` and the id
convention of the existing catalogs, `transactional.<area>.<case>`, where
the area is the functional area the row belongs to — `discovery`, `batch`,
`set`, `singleton`, `receipt`, `idempotency`, `sequence`, `event`,
`changefeed`, `snapshot`, `erasure`, `http`, `restore` — as the sealed Read
catalog uses `read.collections.*` and the Read+Update catalog
`read-update.idempotency.*`. The coverage category open question 13 names
— positive, negative, concurrency, disconnect, expiry, restore,
authorization-view — is the grouping in the table under section 6.2; it is
not an id segment and not a catalog member (T48). Every row is unclaimed:
no manifest plan, fixture, or evidence exists for any of them, and the
evidence law in `packages/conformance/matrices/README.md` governs when one
may be claimed. Citations name the draft where the text exists today and
this packet where the text is proposed; a packet citation is re-pointed to
the draft when the packet is applied.

`bdpbd` is outside the Transactional profile: it does not claim it, so no
Transactional row is recorded for it at all. Honest not-applicable
recording is for an optional capability within a claimed profile, as the
Read cohort uses it; a profile's mandatory behavior cannot be
capability-gated out of a claim, and missing the harness needed to observe
mandatory behavior is an evidence limitation that keeps the claim closed,
never an absence to record (T21, revised).

Fixture capabilities the rows will need, proposed here and defined nowhere
yet: `transactional-v1` (a reference realization with the Decision/`cites`
owning pair, Tasks with `blocks` Links, and one external endpoint);
`controlled-transactional-concurrency-v1` (two-client races with
deterministic serialization); `controlled-transactional-disconnect-v1`
(admission-then-disconnect, crash-after-admission, and SSE reconnect
controls); `controlled-transactional-retention-v1` (clock control across
`retention.receipt`, snapshot expiry, and `minimumReplayPosition`);
`controlled-transactional-restore-v1` (epoch rotation at the same canonical
Scope, with and without a pre-erasure backup); `controlled-transactional-view-v1`
(view token rotation and per-view projection);
`controlled-transactional-erasure-v1` (administrative erasure trigger for
historical, live-successor, live-tombstone, and owned-Link cases);
`controlled-transactional-problem-table-v1` (injection of every
Transactional code through a public route).

A Transactional claim inherits the Read rows and the Read+Update rows whose
obligations the Transactional profile preserves — the Read+Update singleton
obligations are observed through the receipt's one entry — and retires the
Read+Update rows the profile contradicts. The retired rows and the
Transactional rows that replace them are listed below; the `retires`
member that carries the list in the catalog is T48's proposal and is added
to the catalog shape at apply time, not by these rows.

<!-- catalog-retirements -->
```json
{
  "transactional.discovery.document": ["read-update.discovery.document"],
  "transactional.discovery.limits": ["read-update.discovery.limits"],
  "transactional.discovery.operation-directory": ["read-update.discovery.operation-directory"],
  "transactional.singleton.receipt": ["read-update.singleton.result-headers"],
  "transactional.idempotency.concurrent-join": ["read-update.idempotency.in-progress"],
  "transactional.receipt.reauthorization": ["read-update.idempotency.authorization-view"],
  "transactional.discovery.no-idempotency-retention": ["read-update.idempotency.retention-minimum"],
  "transactional.idempotency.expired-detail": ["read-update.idempotency.expired"],
  "transactional.idempotency.failed-retained": ["read-update.idempotency.expired-failure"],
  "transactional.restore.key-namespace": ["read-update.idempotency.restore"]
}
```

**T21 — Category tagging, capability names, and `bdpbd`.** RATIFIED 2026-09-08 (operator: as drafted). *Revised
(council 10).*
Options: (a) no catalog member for the category — it is the packet's
grouping — and the capability names above are proposed for the fixtures;
`bdpbd` stays outside Transactional claims with no rows recorded; (b) add a
`category` member to the catalog (changes `SCENARIO_KEYS` and the
validator); (c) encode the category in `kind` (conflates claim eligibility
with coverage); (d) the first draft's recommendation that `bdpbd` record
every Transactional row as honestly not-applicable, which misused the
evidence law: missing a profile is unsupported-profile and missing an
observation harness is an evidence limitation, and neither is the absence
of an optional capability (Codex H11). Recommendation: (a).

**T48 — Id convention, category grouping, and retired Read+Update rows.** RULED 2026-09-08 (operator: (a)).
Context: the first draft's ids put the coverage category in the second
segment (`transactional.positive.…`) where the existing catalogs put the
functional area (Claude M14), and its section 6.1 said a Transactional run
"inherits every Read and Read+Update row", which is false for the rows
bound to Read+Update's refused, `410`, forgotten, and restore forms and to
its discovery and result-body shapes (Claude H5), while the selection rule
in `packages/conformance/src/selection.ts` applies every lower-profile row
to a higher claim. Options: (a) `transactional.<area>.<case>` ids, the
category as a packet grouping, and a `retires` member on a Transactional
row naming the Read+Update rows it supersedes, with the selection rule
excluding a retired row from the claim that retires it — a catalog-shape
change (`SCENARIO_KEYS`, the validator, `selection.ts`) proposed for the
apply step; (b) rewrite the retired Read+Update rows profile-neutrally
(their cited sentences are Read+Update-specific by design); (c) leave
inheritance as is and let a Transactional claim fail the retired rows
(makes the profile unclaimable by construction). Recommendation: (a).

### 6.2 Category grouping

| Category | Rows |
| --- | --- |
| positive | `discovery.document`, `discovery.operation-directory`, `discovery.limits`, `batch.atomic-commit`, `batch.local-references`, `batch.owned-link-transitions`, `batch.no-op-entries`, `set.mutation`, `set.zero-match`, `set.singleton-targets`, `set.attribution-fanout`, `singleton.receipt`, `singleton.semantics`, `receipt.readable`, `receipt.pagination`, `receipt.headers`, `receipt.deleted-identity`, `receipt.owned-link-source`, `receipt.pending-202`, `idempotency.semantic-identity`, `idempotency.cross-carrier`, `idempotency.key-grammar`, `idempotency.durable-admission`, `sequence.member-transactions`, `sequence.completed-projection`, `event.owned-link-delta`, `event.owned-link-update-delta`, `event.owned-link-deleted-identity`, `event.fact-order`, `event.no-op-owned-update`, `event.graph-facts`, `event.self-link`, `event.set-expansion-order`, `changefeed.group`, `changefeed.wire-form`, `changefeed.sse`, `changefeed.owned-link-agreement`, `changefeed.consistency-fields`, `snapshot.rendezvous`, `snapshot.closed-projection`, `erasure.record-digest`, `erasure.digest-domain`, `erasure.historical-version`, `erasure.live-successor`, `erasure.live-tombstone`, `erasure.owned-link-cascade`, `http.status-matrix`, `http.timestamps`, `http.token-profile` |
| negative | `discovery.no-idempotency-retention`, `batch.rollback`, `batch.label-errors`, `batch.envelope-errors`, `batch.pre-admission-precedence`, `batch.transaction-limits`, `batch.duration-limit`, `batch.deletion-safety`, `set.cardinality`, `receipt.page-expiry`, `receipt.nondisclosure`, `receipt.root`, `receipt.problem-shape`, `receipt.transaction-level-failure`, `receipt.validation-diagnostics`, `receipt.no-transient-failure`, `idempotency.conflict`, `idempotency.transient-abort`, `idempotency.failed-retained`, `sequence.failed-creator`, `changefeed.start-intent`, `changefeed.catch-up-timeout`, `erasure.reads`, `http.method-405`, `http.problem-table`, `http.problem-contexts`, `http.internal-fault` |
| concurrency | `idempotency.concurrent-join`, `idempotency.ownership-fencing`, `idempotency.one-key-state`, `batch.revision-guard-race`, `batch.aggregate-constraint-race`, `sequence.in-flight-projection`, `sequence.pending-creator` |
| disconnect | `http.disconnect-admitted`, `idempotency.pending-recovery`, `changefeed.sse-reconnect` |
| expiry | `receipt.expiry-allocated`, `receipt.retention-minimum`, `idempotency.expired-detail`, `sequence.expired-projection`, `changefeed.replay-window`, `snapshot.expiry`, `event.history-expired`, `event.cursor-after-withheld`, `erasure.replication-invalidation`, `erasure.retention-non-propagation`, `erasure.epoch-unrotated` |
| restore | `restore.epoch-fence`, `restore.key-namespace`, `erasure.restore`, `erasure.unestablishable-content` |
| authorization-view | `receipt.reauthorization`, `receipt.reauthorization-paths`, `receipt.non-record-entries`, `receipt.whole-withheld`, `sequence.member-reauthorization`, `changefeed.projection-advance`, `changefeed.owned-closure`, `erasure.view-projection`, `erasure.event-withholding`, `erasure.graph-facts`, `erasure.receipts`, `snapshot.erasure-ledger` |

### 6.3 Discovery, batch, set, and singleton rows

<!-- catalog-rows -->
```json
[
  {
    "id": "transactional.discovery.document",
    "title": "Transactional discovery has the exact required history and replication members",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#scope-discovery-and-human-documentation",
        "selectedText": "The history, receipt, snapshot, changefeed, and Event members are required only in Transactional and prohibited in both lower profiles."
      }
    ]
  },
  {
    "id": "transactional.discovery.operation-directory",
    "title": "The Transactional Operation Directory lists all ten targets",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#operation-directory-and-singleton-targets",
        "selectedText": "The discovered `operations/` Resource is a directory of the generic mutation targets available under the Scope's profile."
      }
    ]
  },
  {
    "id": "transactional.discovery.limits",
    "title": "Transactional discovery may advertise the transaction group and receipt and replay retention",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#advertised-limits",
        "selectedText": "`retention.idempotency`, `retention.receipt`, `retention.maximumSnapshotLifetime`, and `retention.replay` are ISO 8601 durations."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "`retention.receipt` bounds how long detailed outcomes remain"
      }
    ]
  },
  {
    "id": "transactional.discovery.no-idempotency-retention",
    "title": "Transactional discovery never advertises retention.idempotency",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "a Transactional discovery document MUST NOT advertise it"
      }
    ]
  },
  {
    "id": "transactional.batch.atomic-commit",
    "title": "A multi-operation batch commits atomically with ordered postimages",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-transactions",
        "selectedText": "executes atomically, so every operation commits or none do;"
      },
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-receipt-responses",
        "selectedText": "Created and updated results carry complete postimages — the full Resource state after the change — and revisions."
      }
    ]
  },
  {
    "id": "transactional.batch.local-references",
    "title": "Batch-local labels bind staged identity, including as Link endpoints and inside pins",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#batch-operation-target",
        "selectedText": "In a Resource-reference member, a string beginning with `@` refers to the Resource created by the preceding operation with that name."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#21-proposed-normative-text",
        "selectedText": "A Pinned Reference whose `uri` is an `@label` is accepted"
      }
    ]
  },
  {
    "id": "transactional.batch.rollback",
    "title": "A failing operation rolls back the complete batch into a failed receipt",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-receipt-responses",
        "selectedText": "The receipt contains no committed operation results because the complete transaction is rolled back. Retrying returns that same failed receipt."
      }
    ]
  },
  {
    "id": "transactional.batch.label-errors",
    "title": "Forward, unknown, duplicate, and wrong-kind labels are rejected before admission",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#batch-operation-target",
        "selectedText": "The service rejects forward references, unknown names, duplicate names, and Resource-kind mismatches."
      }
    ]
  },
  {
    "id": "transactional.batch.envelope-errors",
    "title": "A batch without exactly one header key, or with a body or per-operation key, is malformed",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#batch-operation-target",
        "selectedText": "A batch request carries exactly one required `Idempotency-Key` HTTP field; the JSON body does not repeat it."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#21-proposed-normative-text",
        "selectedText": "A body-level `idempotencyKey`, a per-operation `idempotencyKey`, or any other undefined member makes the request malformed."
      }
    ]
  },
  {
    "id": "transactional.batch.pre-admission-precedence",
    "title": "Pre-admission checks run bounds, syntax, principal, key, then admission controls, and never consult key state for an invalid request",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#21-proposed-normative-text",
        "selectedText": "A syntactically invalid request therefore never consults key state, and a retained or pending receipt is returned before limits and rate limits are evaluated"
      }
    ]
  },
  {
    "id": "transactional.batch.transaction-limits",
    "title": "Advertised transaction limits fail the whole transaction without partial effect",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#set-mutation",
        "selectedText": "Exceeding a limit fails the operation without changing anything."
      },
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#events-and-event-sources",
        "selectedText": "If a set mutation would exceed that limit, the complete transaction fails before commit."
      }
    ]
  },
  {
    "id": "transactional.batch.duration-limit",
    "title": "Exceeding transaction.duration is a permanent limit-exceeded failure naming the limit, not a transient abort",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#35-decisions",
        "selectedText": "exceeding `transaction.duration` is permanent, not transient"
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "A `limit-exceeded` problem SHOULD carry `limit`, the dotted name of the crossed limit under `limits`."
      }
    ]
  },
  {
    "id": "transactional.batch.deletion-safety",
    "title": "Deleting a Bead with live incident Links fails the transaction",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#explicit-bead-operations",
        "selectedText": "`DeleteBead` fails if any live Link is incident upon (attached to) the Bead when the operation is reached."
      }
    ]
  },
  {
    "id": "transactional.batch.owned-link-transitions",
    "title": "Several owned-Link transitions of one source in one batch mint one source version and one updated Event each, in operation order, each carrying its attribution",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#owned-links",
        "selectedText": "Every mutation of an owned Link versions the source Bead."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#11-proposed-normative-text",
        "selectedText": "produces one `updated` Event per transition, each with its own `previousRevision` and `revision`, in operation order."
      }
    ]
  },
  {
    "id": "transactional.batch.no-op-entries",
    "title": "A no-op update reports updated at the retained revision, and an all-no-op transaction completes without a group or effectPosition",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#change-groups-and-replication",
        "selectedText": "A failed or admitted no-effect mutation produces no group and no new position. Its receipt reports the current `requiredPosition` and omits `effectPosition`."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "a transaction all of whose operations are no-ops is an admitted no-effect mutation: it completes, produces no group, and its receipt omits `effectPosition`."
      }
    ]
  },
  {
    "id": "transactional.batch.revision-guard-race",
    "title": "Racing guarded updates serialize into one success and one revision-mismatch",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#revisions",
        "selectedText": "The authority applies the operation only if the Resource still has that revision. A mismatch fails the complete Mutation Transaction."
      }
    ]
  },
  {
    "id": "transactional.batch.aggregate-constraint-race",
    "title": "Racing Link creations cannot jointly cross a maximum multiplicity",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#scope-aggregate-constraints",
        "selectedText": "Authorities MUST produce serializable outcomes when concurrent mutations could cross a maximum."
      }
    ]
  },
  {
    "id": "transactional.set.mutation",
    "title": "Set mutation mutates the complete matched set and reports flat entries in canonical-uri order",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#set-mutation-objects",
        "selectedText": "Set mutation is never paginated: the service either mutates the complete matched set atomically or fails before commit."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "A set operation produces one `matched` entry carrying `count`, the number of Resources it selected, followed by one `updated` or `deleted` entry per selected Resource in ascending code-unit order of their canonical `id`s"
      }
    ]
  },
  {
    "id": "transactional.set.zero-match",
    "title": "A zero-match set operation reports matched 0 and induces no Events",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#events-and-event-sources",
        "selectedText": "A zero-match operation produces no Events."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "a zero-match operation produces its `matched` entry with `count` `0` and nothing else."
      }
    ]
  },
  {
    "id": "transactional.set.cardinality",
    "title": "A matched count outside the supplied cardinality fails the transaction with cardinality-violated",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#set-mutation",
        "selectedText": "If the matched count falls outside a supplied range, the complete transaction fails."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#32-transactional-problem-table",
        "selectedText": "`cardinality-violated`: a set operation's matched count is outside its `cardinality`"
      }
    ]
  },
  {
    "id": "transactional.set.singleton-targets",
    "title": "The update-where and delete-where singleton targets accept the set-operation body without the discriminator and return receipts",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#21-proposed-normative-text",
        "selectedText": "for the two set targets, `updateWhereRequest` and `deleteWhereRequest`, the set-operation members without `operation`; each executes as a one-operation Mutation Transaction and returns its receipt."
      }
    ]
  },
  {
    "id": "transactional.set.attribution-fanout",
    "title": "A set mutation's attribution is recorded on every version it mints, owned sources included",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#set-mutation",
        "selectedText": "An `attribution` supplied to a set mutation fans out exactly as the corresponding singleton operations would record it"
      }
    ]
  },
  {
    "id": "transactional.singleton.receipt",
    "title": "Singleton targets execute one-operation transactions and return receipts under the batch statuses",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#operation-directory-and-singleton-targets",
        "selectedText": "The request executes as a one-operation Mutation Transaction."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#21-proposed-normative-text",
        "selectedText": "Singleton operation targets on a Transactional Scope use exactly these statuses and rules"
      }
    ]
  },
  {
    "id": "transactional.singleton.semantics",
    "title": "A singleton and the equivalent one-operation batch have identical allocation, validation, idempotency, and Event semantics",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#operation-directory-and-singleton-targets",
        "selectedText": "Within the Transactional profile, the singleton and batch forms have identical allocation, patch, validation, authorization, idempotency, concurrency, event, and deletion semantics."
      }
    ]
  }
]
```

### 6.4 Receipt rows

<!-- catalog-rows -->
```json
[
  {
    "id": "transactional.receipt.readable",
    "title": "Receipts are independently readable with GET and HEAD",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-receipts",
        "selectedText": "The receipt remains independently readable, so a client can resolve a lost response, a pending duplicate, or a paginated result."
      }
    ]
  },
  {
    "id": "transactional.receipt.pagination",
    "title": "Large set results continue through immutable pages bounded by page.maximumItems, every entry counting as one",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-receipt-responses",
        "selectedText": "Otherwise the response contains the first page and an absolute `next` URL for another immutable page of the same receipt."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "`page.maximumItems`, when advertised, bounds the entries in the receipt's inline `results` and in each page, every entry counting as one whatever its outcome"
      }
    ]
  },
  {
    "id": "transactional.receipt.page-expiry",
    "title": "A page URL returns 410 cursor-expired after detail expiry, decided after authentication and non-disclosure",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "After the receipt's detail expires, a page URL returns `410` `cursor-expired`, decided after authentication and the receipt's non-disclosure rule."
      }
    ]
  },
  {
    "id": "transactional.receipt.nondisclosure",
    "title": "Unknown, foreign-principal, retracted, and prior-epoch receipt URLs share one 404",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-receipts",
        "selectedText": "Receipt access is principal-bound: possessing its URL does not grant access."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "receipts are principal-bound, and they are not an enumeration oracle."
      }
    ]
  },
  {
    "id": "transactional.receipt.root",
    "title": "The receipts root is a namespace with no listing or key lookup",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "BDP v0 defines no receipt listing and no lookup by key, and a `GET` of the root returns `404` `resource-not-found`."
      }
    ]
  },
  {
    "id": "transactional.receipt.headers",
    "title": "Receipt responses carry the serving request's observation in the response fields and the execution's facts in the body",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-receipt-responses",
        "selectedText": "The recorded `requiredPosition` remains evidence about the original view; it is not a valid minimum-read checkpoint for the replacement view."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "The three Transactional response fields on a receipt or page response are the serving request's own observation, never the body's history"
      }
    ]
  },
  {
    "id": "transactional.receipt.reauthorization",
    "title": "A view change withholds record-bearing entries under owned closure without changing the disposition",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-receipt-responses",
        "selectedText": "Reading the receipt after such a change returns its unchanged identity and disposition, but the detailed `results` and problem information are re-authorized under the caller's current view."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "hiding a Bead hides the entries of every Bead that owns a Link to it and of those Links."
      }
    ]
  },
  {
    "id": "transactional.receipt.reauthorization-paths",
    "title": "The synchronous response, a duplicate's response, later reads, pages, and sequence projections share one authorization projection",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "Every delivery of a receipt — the synchronous response, the response to a duplicate, a later `GET` or `HEAD`, every page, and the projection of a member's receipt into a sequence response — is one representation"
      }
    ]
  },
  {
    "id": "transactional.receipt.non-record-entries",
    "title": "Matched counts, deleted and erased identities, withheld entries, and failed problems are served as retained",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "Entries that carry no record — `matched` counts, `deleted` and `erased` identities, and `withheld` entries — and a `failed` receipt's `problem` are the transaction's own execution facts, disclosed to the principal when it executed, and are served as retained."
      }
    ]
  },
  {
    "id": "transactional.receipt.whole-withheld",
    "title": "A completed receipt whose every entry is withheld reports detail withheld; a failed receipt is never withheld",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "When a `completed` receipt's every entry is withheld, the receipt carries `detail` `withheld` and neither `results`, `next`, nor `allocated`; a `failed` receipt is never `withheld`."
      }
    ]
  },
  {
    "id": "transactional.receipt.pending-202",
    "title": "The original submission receives 202 only past the wait bound; a duplicate may receive it any time before terminal",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#21-proposed-normative-text",
        "selectedText": "`202 Accepted` with the `pending` Mutation Receipt: to the original submission only when the transaction is still executing at the wait bound, and to an identical duplicate that the authority answers before the transaction is terminal."
      }
    ]
  },
  {
    "id": "transactional.receipt.deleted-identity",
    "title": "A deleted entry carries the identity record with the final live revision",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "or `deleted`, carrying `deleted`, the deleted Resource's identity: `id`, `type`, and final live `revision`."
      }
    ]
  },
  {
    "id": "transactional.receipt.owned-link-source",
    "title": "Owned-Link entries carry source and sourceRevision together on creation, update, and deletion",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "An entry for an operation on an owned Link additionally carries `source`, the source Bead's canonical URL, and `sourceRevision`, the source Bead's resulting revision, on creation, update, and deletion alike"
      }
    ]
  },
  {
    "id": "transactional.receipt.problem-shape",
    "title": "A receipt problem carries the would-be status, the failing operationIndex, and a request-body pointer",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "It carries the code's `status` — the HTTP status the failure would have had as a direct response, required because the enclosing status is `200 OK` — and `operationIndex`"
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "the problem carries `pointer`, an RFC 6901 JSON Pointer into the request body as submitted"
      }
    ]
  },
  {
    "id": "transactional.receipt.transaction-level-failure",
    "title": "A transaction-wide failure omits operationIndex rather than fabricating one",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "omits `operationIndex` rather than fabricating one."
      }
    ]
  },
  {
    "id": "transactional.receipt.validation-diagnostics",
    "title": "A validation-failed receipt problem carries the Read+Update diagnostics and truncation marker",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "A `validation-failed` problem carries `diagnostics` and, when it truncated them, `diagnosticsTruncated`"
      }
    ]
  },
  {
    "id": "transactional.receipt.no-transient-failure",
    "title": "No failed receipt ever carries temporarily-unavailable",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#32-transactional-problem-table",
        "selectedText": "A `failed` receipt never carries `temporarily-unavailable`"
      }
    ]
  },
  {
    "id": "transactional.receipt.expiry-allocated",
    "title": "An expired receipt keeps its disposition, positions, and allocated identities and never re-executes",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-receipts",
        "selectedText": "A later retry returns an outcome-expired result and never executes the mutation as new."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "An `expired` `completed` receipt therefore carries `allocated`: one entry per creation operation in operation order"
      }
    ]
  },
  {
    "id": "transactional.receipt.retention-minimum",
    "title": "expiresAt is no earlier than the terminal instant plus an advertised retention.receipt",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "when discovery advertises `retention.receipt`, it MUST be no earlier than the terminal instant plus that duration."
      }
    ]
  }
]
```

### 6.5 Idempotency and sequence rows

<!-- catalog-rows -->
```json
[
  {
    "id": "transactional.idempotency.concurrent-join",
    "title": "Concurrent identical requests join one execution and one receipt",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-transactions",
        "selectedText": "Concurrent requests with the same key and the same semantic request join one execution. A duplicate may wait for the terminal response or receive the same pending receipt. Either way, it never executes again."
      }
    ]
  },
  {
    "id": "transactional.idempotency.conflict",
    "title": "A reused key with different semantics is refused without execution for the rest of the epoch",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-transactions",
        "selectedText": "Reusing the key for a different semantic request is an idempotency conflict."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "A request with the same key and a different normalized request is refused before admission with `409` `idempotency-conflict` for the rest of the Scope epoch, whether or not the earlier outcome's detail has expired."
      }
    ]
  },
  {
    "id": "transactional.idempotency.semantic-identity",
    "title": "Semantic identity excludes name and the carrier, normalizes labels to the creator's index or supplied identity, and includes pins, attribution, guards, and order",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "In a batch, a `@label` reference is normalized to the creating operation's zero-based index when that operation supplies no `id`, and to the supplied identity's canonical URL when it does"
      }
    ]
  },
  {
    "id": "transactional.idempotency.cross-carrier",
    "title": "A one-operation batch, the equivalent singleton, and the equivalent sequence member present one semantic request and share one receipt",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "A one-operation batch, the equivalent singleton request, and the equivalent sequence member therefore present one semantic request, and any of them retrieves the receipt the others created."
      }
    ]
  },
  {
    "id": "transactional.idempotency.key-grammar",
    "title": "Keys are bare checkpoint-profile tokens compared byte-exactly, and an absent, repeated, or invalid key is malformed",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "carry the same case-sensitive `[A-Za-z0-9_-]{1,256}` token, bare, compared byte-exactly; a request whose key is absent, repeated, or outside the grammar is malformed."
      }
    ]
  },
  {
    "id": "transactional.idempotency.expired-detail",
    "title": "A retry after detail expiry receives the expired receipt with 200 and never re-executes",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "An identical retry after expiry returns the `expired` receipt with `200 OK` and never executes the mutation again."
      }
    ]
  },
  {
    "id": "transactional.idempotency.transient-abort",
    "title": "A transient abort after admission retracts the pending receipt, unbinds the key, answers 503, and a retry executes anew",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#21-proposed-normative-text",
        "selectedText": "A transient abort after admission — a serialization conflict the authority does not retry, or a component it cannot reach — retracts the pending receipt and unbinds the key in one durable step"
      }
    ]
  },
  {
    "id": "transactional.idempotency.failed-retained",
    "title": "A failed receipt is retained for the epoch and a retry returns it; a new request needs a new key",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "A terminal receipt, `failed` included, is retained under its key for the rest of the Scope epoch: the compact receipt outlives the detail, and a retry of a failed transaction returns that same failed receipt."
      }
    ]
  },
  {
    "id": "transactional.idempotency.durable-admission",
    "title": "Admission records key, identity, pending receipt, transaction identity, and ownership as one durable step",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "The authority records the key, the normalized request identity, the `pending` Mutation Receipt with its `transaction` identity, and its own exclusive ownership of the execution together or not at all"
      }
    ]
  },
  {
    "id": "transactional.idempotency.ownership-fencing",
    "title": "A commit succeeds only while the committing execution owns the pending receipt; a fenced execution produces no group",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "the Resource state, the change group, and the terminal receipt commit atomically only while the committing execution still owns the receipt"
      }
    ]
  },
  {
    "id": "transactional.idempotency.pending-recovery",
    "title": "After a crash every uncommitted pending receipt is retracted within the bound; an older pending receipt is a conformance failure",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "a `pending` receipt older than the bound is a conformance failure."
      }
    ]
  },
  {
    "id": "transactional.idempotency.one-key-state",
    "title": "Every mutation route consults one authoritative key state",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "two routes MUST NOT each treat the same key as unknown."
      }
    ]
  },
  {
    "id": "transactional.sequence.member-transactions",
    "title": "Each sequence member is a one-operation transaction with its own receipt, admitted in declaration order, in an unchanged envelope",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "Each member is a one-operation Mutation Transaction: the sequence's admission admits every member whose key is unknown, in declaration order, recording a pending receipt for each"
      }
    ]
  },
  {
    "id": "transactional.sequence.completed-projection",
    "title": "A completed member projects its receipt's one entry in the Read+Update result shape",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "a `completed` receipt with its detail available projects the receipt's one result entry in the shape of"
      }
    ]
  },
  {
    "id": "transactional.sequence.in-flight-projection",
    "title": "A member whose key is bound to a pending receipt projects a transient idempotency-in-progress problem without waiting or retaining",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "projects as an `idempotency-in-progress` member problem, which MAY carry `retryAfter`; the sequence does not wait, executes nothing for the member, and retains nothing"
      }
    ]
  },
  {
    "id": "transactional.sequence.expired-projection",
    "title": "A member whose receipt detail expired projects idempotency-expired carrying the allocated identity of a creation",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "a receipt whose detail expired projects as an `idempotency-expired` member problem carrying, for a `completed` creation, the extension member `allocated`"
      }
    ]
  },
  {
    "id": "transactional.sequence.pending-creator",
    "title": "A dependent whose creator is pending or transient fails transiently and claims no key",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "a member whose creator's receipt is `pending`, or whose creator was answered transiently in this request, fails transiently with `idempotency-in-progress`, consults no key state, executes nothing, retains nothing, and claims no key"
      }
    ]
  },
  {
    "id": "transactional.sequence.failed-creator",
    "title": "A dependent whose creator's receipt is failed fails with binding-unavailable, retained",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "a member whose `@name` creator's receipt is `failed` fails with `binding-unavailable`, retained"
      }
    ]
  },
  {
    "id": "transactional.sequence.member-reauthorization",
    "title": "A withheld entry projects as a forbidden member problem and an erased one as resource-erased to an authorized caller",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "an entry the current view withholds projects as the `forbidden` member problem of"
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "an entry whose version was erased projects as a `resource-erased` member problem to a caller authorized for the subject's retained history and as `forbidden` to every other caller"
      }
    ]
  }
]
```

### 6.6 Event, changefeed, and snapshot rows

<!-- catalog-rows -->
```json
[
  {
    "id": "transactional.event.owned-link-delta",
    "title": "Owned-Link mutations emit source updated Events carrying exactly one ownedLink delta",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#events-and-event-sources",
        "selectedText": "An owned-Link change produces an `updated` Event on the source Bead with its fresh revision"
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#11-proposed-normative-text",
        "selectedText": "Exactly one of the two members is present in any `updated` delta."
      }
    ]
  },
  {
    "id": "transactional.event.owned-link-update-delta",
    "title": "An updated owned-Link transition carries the Link's delta, not its record",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#11-proposed-normative-text",
        "selectedText": "For `updated`, it is the owned Link's delta — the Link's `id` and `type`, its `previousRevision` and fresh `revision`, the committed `change`, and the Link's new version's `attribution` when one was recorded"
      }
    ]
  },
  {
    "id": "transactional.event.owned-link-deleted-identity",
    "title": "A deleted owned-Link transition carries the Link's identity with its final live revision",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#11-proposed-normative-text",
        "selectedText": "For `deleted`, it is the deleted Link's identity — `id`, `type`, and its final live `revision` — because deletion mints no Link version and a deleted Event does not retain properties."
      }
    ]
  },
  {
    "id": "transactional.event.fact-order",
    "title": "One owned-Link operation's facts are ordered lifecycle, graph facts source before target, then the source's updated fact",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#11-proposed-normative-text",
        "selectedText": "the Link's lifecycle fact first, then the graph facts at its in-Scope endpoints, source before target"
      }
    ]
  },
  {
    "id": "transactional.event.no-op-owned-update",
    "title": "A no-op owned-Link update versions neither the Link nor the source and emits no Event",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#11-proposed-normative-text",
        "selectedText": "retains the Link's revision and emits no Event, and it does not version the source"
      }
    ]
  },
  {
    "id": "transactional.event.graph-facts",
    "title": "Link lifecycle produces linked and unlinked facts at every in-Scope endpoint",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#events-and-event-sources",
        "selectedText": "Link creation produces a `created` fact about the Link and a `linked` fact at each in-Scope endpoint Bead. Link deletion produces a `deleted` fact about the Link and an `unlinked` fact at each in-Scope endpoint Bead."
      }
    ]
  },
  {
    "id": "transactional.event.self-link",
    "title": "A self-Link's one endpoint receives a source fact and a target fact in the same group",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#events-and-event-sources",
        "selectedText": "For a self-Link, whose source and target are the same Bead, that one endpoint Bead receives two graph facts in the same group: one whose `endpoint` is `source` and one whose `endpoint` is `target`."
      }
    ]
  },
  {
    "id": "transactional.event.set-expansion-order",
    "title": "A set operation's induced facts and receipt entries follow canonical-uri order",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#11-proposed-normative-text",
        "selectedText": "the selected Resources expand in ascending code-unit order of their canonical `id`s"
      }
    ]
  },
  {
    "id": "transactional.event.history-expired",
    "title": "event-history-expired is disclosed only to a principal authorized for the subject's retained history",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#reads-after-deletion",
        "selectedText": "an authority may return `410` `event-history-expired` only to a principal authorized for that subject's retained history and only when its policy permits disclosing that the history elapsed."
      }
    ]
  },
  {
    "id": "transactional.event.cursor-after-withheld",
    "title": "A cursor naming a withheld Event remains a valid exclusive after position, and eventCount counts served Events",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "every served Event's cursor stays valid, a cursor whose Event was withheld remains a valid exclusive `after` position, and a group's `eventCount` counts the Events it serves"
      }
    ]
  },
  {
    "id": "transactional.changefeed.group",
    "title": "Change groups carry normalized postimages and ordered Events behind one checkpoint",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#scope-changefeed",
        "selectedText": "The client applies an entire group atomically and advances its durable cursor only to that group's `checkpoint`."
      }
    ]
  },
  {
    "id": "transactional.changefeed.wire-form",
    "title": "Every group carries changes, erasures, and events; a visible group carries transaction and at least one non-empty array",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "`changes`, `erasures`, and `events` are always present, and each is empty when the group carries nothing of its kind; a visible group carries at least one of the three non-empty."
      }
    ]
  },
  {
    "id": "transactional.changefeed.sse",
    "title": "SSE delivery frames one complete group per message",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#scope-changefeed",
        "selectedText": "Accepting `text/event-stream` on the same Resource delivers one complete group per SSE message. The SSE `id` is the group's checkpoint, `event` is `change-group`, and `data` is the complete JSON group."
      }
    ]
  },
  {
    "id": "transactional.changefeed.start-intent",
    "title": "A changefeed read without an explicit starting intent is an error",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#scope-changefeed",
        "selectedText": "Omitting both is an error. It never means “start at whatever history remains.”"
      }
    ]
  },
  {
    "id": "transactional.changefeed.owned-link-agreement",
    "title": "A group carries the owned Link's and the source's postimages, and their inline and first-class records agree",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#11-proposed-normative-text",
        "selectedText": "The two entries describe one graph: the inline record in the source's postimage and the Link's own postimage are member-for-member equal, and a consumer verifies that agreement before applying the group"
      }
    ]
  },
  {
    "id": "transactional.changefeed.consistency-fields",
    "title": "Scope-bounded responses carry epoch, view, and position, and honor minimum positions",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#http-consistency-caching-and-cors-fields",
        "selectedText": "It never reports success with an older position."
      }
    ]
  },
  {
    "id": "transactional.changefeed.catch-up-timeout",
    "title": "A minimum-position read that cannot be served within the wait bound fails with catch-up-timeout",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#32-transactional-problem-table",
        "selectedText": "`catch-up-timeout`: a read carrying `BDP-Minimum-Scope-Position` could not be served at or after that position within the authority's wait bound"
      }
    ]
  },
  {
    "id": "transactional.changefeed.replay-window",
    "title": "Late, foreign-epoch, and foreign-view cursors fail explicitly",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#snapshots-and-strict-reads",
        "selectedText": "A cursor presented too late, from another Scope epoch, or from another Authorization View fails explicitly and never silently skips history."
      }
    ]
  },
  {
    "id": "transactional.changefeed.sse-reconnect",
    "title": "SSE reconnection resumes from Last-Event-ID without gaps or duplicates",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#scope-changefeed",
        "selectedText": "On automatic reconnect, `Last-Event-ID` overrides the original `after` value."
      }
    ]
  },
  {
    "id": "transactional.changefeed.projection-advance",
    "title": "A hidden transaction projects an identifier-free advance",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#change-groups-and-replication",
        "selectedText": "For an invisible group, `projectionAdvance` is true, `transaction` is absent, and `changes` and `events` are empty."
      }
    ]
  },
  {
    "id": "transactional.changefeed.owned-closure",
    "title": "Feeds and Event Sources project owned Links with their visible source",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#owned-links",
        "selectedText": "An Authorization View that projects a Bead projects its owned Links and their in-Scope target Beads: a view is closed over owned Links, and hiding a Bead from a view therefore requires hiding every Bead that owns a Link to it."
      }
    ]
  },
  {
    "id": "transactional.snapshot.rendezvous",
    "title": "A snapshot checkpoint continues losslessly into the changefeed",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#scope-snapshots",
        "selectedText": "`checkpoint` is the opaque, epoch-qualified value that is supplied as the exclusive `after` cursor to the Scope changefeed."
      }
    ]
  },
  {
    "id": "transactional.snapshot.closed-projection",
    "title": "A snapshot is a closed projection whose inline and first-class owned-Link records agree; a disagreeing snapshot is rejected",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "a snapshot in which an inline owned Link and its first-class record disagree, or in which a Link's in-Scope endpoint is absent, is invalid, and the replica discards it and fetches a new one rather than choosing an authoritative stream."
      }
    ]
  },
  {
    "id": "transactional.snapshot.expiry",
    "title": "A snapshot stays continuable through expiresAt, and a page it cannot serve before then is a service failure",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#scope-snapshots",
        "selectedText": "The authority keeps the snapshot continuable through `expiresAt`. If the authority cannot serve a page before then, that is a service failure, not an expired-cursor result."
      }
    ]
  },
  {
    "id": "transactional.snapshot.erasure-ledger",
    "title": "Every snapshot manifest carries the erasure ledger projected for its view",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "Every snapshot manifest carries `erasures`, the ledger projected for the manifest's view — each record whose subject was observable in that view"
      }
    ]
  }
]
```

### 6.7 Erasure, HTTP, and restore rows

<!-- catalog-rows -->
```json
[
  {
    "id": "transactional.erasure.record-digest",
    "title": "Erasure records propagate with a verifiable sha-256-jcs digest",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#version-erasure",
        "selectedText": "An erasure occupies its own Scope position, carried by the Change Group's `erasures` member as an **erasure record**: the subject's canonical Resource URL, the erased `revision`, and a digest of the erased version record taken before erasure"
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "BDP v0 defines exactly one scheme, `sha-256-jcs`"
      }
    ]
  },
  {
    "id": "transactional.erasure.digest-domain",
    "title": "BDP JSON is I-JSON, so every record has one canonical serialization, and digest computation never gates erasure",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "Every JSON text BDP admits or emits is an I-JSON text (RFC 7493)"
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "Digest computation never gates erasure"
      }
    ]
  },
  {
    "id": "transactional.erasure.historical-version",
    "title": "Erasing a historical version commits no state change and induces no Event",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "An erasure-only group, one that erases historical versions and commits nothing, carries empty `changes` and `events`."
      }
    ]
  },
  {
    "id": "transactional.erasure.live-successor",
    "title": "A live-version erasure with a successor carries the content-free root-replace delta, and the successor differs from the erased version",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#version-erasure",
        "selectedText": "The correction case commits the erasure record and the successor's `StateChange` in one atomic group at one position."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "The successor MUST differ from the erased version"
      }
    ]
  },
  {
    "id": "transactional.erasure.live-tombstone",
    "title": "A live-version erasure with a tombstone is an administrative deletion under deletion safety, inducing the ordinary facts",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "Erasing a live version with a tombstone is an administrative deletion of the Resource."
      }
    ]
  },
  {
    "id": "transactional.erasure.owned-link-cascade",
    "title": "Erasing an owned Link's version erases every source version that inlined it, one record each",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "the authority emits one erasure record per erased version in the same group, and each is applied on its own."
      }
    ]
  },
  {
    "id": "transactional.erasure.event-withholding",
    "title": "Event Sources withhold every Event whose data carries erased content, leaving ordinal gaps",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "withhold, from every Event Source it serves, every Event whose `data` carries erased content"
      }
    ]
  },
  {
    "id": "transactional.erasure.graph-facts",
    "title": "Graph facts are withheld exactly when every version of the Link that carried their endpoints is erased; deleted facts never are",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "which is the case exactly when every version of the Link that carried them is erased, since a Link's endpoints are immutable across its versions."
      }
    ]
  },
  {
    "id": "transactional.erasure.receipts",
    "title": "Receipts and pages stop serving an erased postimage at once, serving erased to authorized callers and withheld otherwise",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#31-proposed-normative-text",
        "selectedText": "an entry whose postimage is an erased version never carries the content again."
      },
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#version-erasure",
        "selectedText": "it MUST be applied by every store, cache, and replica holding the version, and the changefeed is the vehicle that carries the obligation."
      }
    ]
  },
  {
    "id": "transactional.erasure.replication-invalidation",
    "title": "An erasure at P expires every checkpoint and snapshot anchored before P in the views that receive it",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "An erasure record committed at position P invalidates, in each view that receives it, every changefeed checkpoint and every snapshot anchored before P"
      }
    ]
  },
  {
    "id": "transactional.erasure.retention-non-propagation",
    "title": "Retention removals do not propagate; a longer-window replica keeps what the authority dropped, while erasure reaches it",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#version-erasure",
        "selectedText": "a replica with a longer window legitimately keeps what the authority dropped, and retention removals therefore do not propagate."
      }
    ]
  },
  {
    "id": "transactional.erasure.restore",
    "title": "After a restore the ledger is re-emitted at the new epoch's first positions and no prior-epoch group is served",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "After a restore into a new epoch the authority also re-emits the projected ledger as erasure-only groups at the new epoch's first positions, before any other group, and no group of the prior epoch is served under the new one."
      }
    ]
  },
  {
    "id": "transactional.erasure.unestablishable-content",
    "title": "A replica destroys retained content whose erasure status it cannot establish",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "A replica that retains content whose erasure status it cannot establish — content held under a view or epoch for which it can no longer obtain the ledger — MUST discard that content."
      }
    ]
  },
  {
    "id": "transactional.erasure.view-projection",
    "title": "An erasure record reaches only views that observed the subject",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#version-erasure",
        "selectedText": "a view receives the record only when the subject Resource was observable in that view."
      }
    ]
  },
  {
    "id": "transactional.erasure.reads",
    "title": "Reads of an erased version disclose resource-erased without a pointer to authorized callers and 404 to everyone else",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#reads-after-deletion",
        "selectedText": "A `resource-erased` problem carries no condition-specific extension members beyond its ordinary problem members: even a pointer would disclose what erasure exists to remove."
      }
    ]
  },
  {
    "id": "transactional.erasure.epoch-unrotated",
    "title": "An erasure does not rotate the epoch; tokens anchored at or after it stay valid",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "An erasure does not rotate the Scope epoch: every token anchored at or after the erasure position remains exactly as valid as it was."
      }
    ]
  },
  {
    "id": "transactional.http.status-matrix",
    "title": "Every mutation-surface target answers with exactly the statuses of the matrix",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#21-proposed-normative-text",
        "selectedText": "a row's statuses are exhaustive for that target and method, apart from the bodyless `500` an unexpected internal fault produces anywhere."
      }
    ]
  },
  {
    "id": "transactional.http.method-405",
    "title": "Mutation targets answer non-POST methods with 405 and Allow: POST, with enabled CORS OPTIONS answered by the CORS rules",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#problem-details",
        "selectedText": "Those profiles define their additional methods and `Allow` values."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#21-proposed-normative-text",
        "selectedText": "`405`, `Allow: POST` — plus `OPTIONS` when cross-origin access is enabled, in which case `OPTIONS` is answered by the CORS rules rather than `405` — and no BDP Problem body"
      }
    ]
  },
  {
    "id": "transactional.http.problem-table",
    "title": "Every Transactional Problem preserves its status, family, code, and retry row",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#problem-details",
        "selectedText": "The code table for later-profile failures is completed with each later profile's schema bundle and conformance material."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#32-transactional-problem-table",
        "selectedText": "The Transactional profile inherits the Read table and the Read+Update rows above and adds three rows:"
      }
    ]
  },
  {
    "id": "transactional.http.problem-contexts",
    "title": "Direct and receipt codes are disjoint contexts, and the Read+Update key dispositions never appear as direct problems",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#32-transactional-problem-table",
        "selectedText": "On a Transactional Scope every code occurs in one of two contexts, and the bundle closes each context to its codes."
      }
    ]
  },
  {
    "id": "transactional.http.internal-fault",
    "title": "A bodyless 500 or transport failure after admission decides nothing; the receipt records the disposition",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#21-proposed-normative-text",
        "selectedText": "client disconnection, a transport failure, and a bodyless `500` decide nothing: the transaction commits or fails on its own, the receipt records which"
      }
    ]
  },
  {
    "id": "transactional.http.disconnect-admitted",
    "title": "A disconnect after admission does not decide the outcome",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-transactions",
        "selectedText": "Once a mutation is admitted, client disconnection does not decide the outcome. The authority commits or rolls back, and it records one terminal receipt."
      }
    ]
  },
  {
    "id": "transactional.http.timestamps",
    "title": "Every emitted instant is a valid RFC 3339 date-time with uppercase T and Z",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#51-proposed-normative-text",
        "selectedText": "is an RFC 3339 `date-time` written with uppercase `T` and `Z`"
      }
    ]
  },
  {
    "id": "transactional.http.token-profile",
    "title": "Epochs, view tokens, positions, transaction ids, receipt tokens, and keys use the checkpoint character profile; revisions do not",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "Scope epochs, Authorization View tokens, Scope positions, transaction identifiers, receipt tokens, and idempotency keys use this same profile"
      }
    ]
  },
  {
    "id": "transactional.restore.epoch-fence",
    "title": "A restore keeps canonical URLs and fences every prior-epoch token",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#scope-history",
        "selectedText": "Restoring the same logical Scope therefore preserves its canonical Scope and Resource URLs while rejecting every history-dependent token from the prior epoch."
      }
    ]
  },
  {
    "id": "transactional.restore.key-namespace",
    "title": "A prior-epoch key is unbound under the new epoch and executes anew, never as a replay",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#41-proposed-normative-text",
        "selectedText": "A new epoch is a new namespace: a key first used under a prior epoch is unbound, and a retry under the new epoch executes as a new mutation, which a client that observes a changed `scopeEpoch` MUST treat as a first execution rather than a replay."
      }
    ]
  }
]
```

## 7. What is still not enough

*Apply note (2026-09-08).* The first three residuals below are resolved by
the apply pass: X1 is ruled B and applied on both sides (`deletedIdentity`),
the `retires` member and selection rule exist (T48), and `date-time` is
registered in both validators (T45). The I-JSON contract lands with
gastownhall/bdp#23 as the number model under *Revisions*; on this branch
the number-model forward reference remains, while council 13 restores the
string and duplicate-member rules separately (T56 amended). The JCS conformance
check is partial: no RFC 8785 serializer exists in the repository or its
installed `node_modules`, none was added, and the lockstep test reproduces
every digest from the vector's recorded serialization — checking that the
serialization parses to the record with members in UTF-16 code-unit order
and that SHA-256 over it is the recorded digest — without recomputing the
canonicalization (T57). The alias targets' Transactional contract is
decision T49, open. Every other residual stands as written.

An implementer who has this packet, ruled, still lacks:

- **The X1 ruling applied on both sides.** Until the deleted identity is
  ruled once, the Read+Update `mutationResultMembers.deleted` is a URL and
  this packet's receipt entries carry a record; the sequence projection of
  a deleted member under T40 follows whichever spelling is ruled.
- **The catalog's `retires` member and selection rule.** T48 proposes them;
  until they exist, `selectNormativeScenariosForProfile` applies every
  Read+Update row to a Transactional claim, including the ten this packet
  retires.
- **`date-time` registration.** T45 needs the format registered in
  `packages/conformance/src/schema-validator.ts` and in
  `packages/protocol/src/read-update-wire.test.ts` beside `uri`; until
  then the bundle cannot carry `format: date-time`.
- **The I-JSON contract as a protocol-wide rule.** T44 proposes one
  sentence for the protocol section; whether existing Read cohort data and
  the `bdpbd` adapter satisfy it is unmeasured.
- **Snapshot stream continuation.** The manifest is transcribed, but the
  grammar of the per-stream `next` URLs, which `410` a snapshot page returns
  after `expiresAt` or after an erasure expires the snapshot, and whether
  the manifest `id` is itself addressable are unwritten.
- **The synchronous wait bound.** T38 bounds `202` on the original
  submission by an authority-chosen bound no longer than
  `transaction.duration`, and T35 bounds pending recovery by the same
  limit; neither says how a client learns the bound except through
  `Retry-After`.
- **Minimum-position reads.** How long an authority waits before
  `catch-up-timeout` and whether `Retry-After` is required on it are
  unwritten; the packet assigns the code and the receipt-header rule (T33).
- **Event correlation across sources.** One fact appears in several Event
  Sources under different source-local IDs; whether a consumer correlates
  them through `transaction`, `subject`, and `ordinal` is unstated.
- **An administrative erasure surface.** Erasure is not a BDP operation, so
  `controlled-transactional-erasure-v1` needs a test-only trigger, and the
  administrative transaction identities the fixtures show (`adm-e1`) are
  minted by a mechanism no specification describes.
- **Receipt page URL stability.** Pages expire with the receipt's detail
  (T9 (e)); whether a page URL is stable across authority restarts is
  unwritten.
- **A JCS conformance check.** Section 5.4 gives vectors; no test in the
  repository computes a digest yet.
- **Owned Links and Selectors.** Selector candidates are `{ id, type,
  properties }`, so `ownedLinks` is not selectable and a set mutation cannot
  target Beads by their owned Links; deliberate, but the draft does not say
  it.
- **Cross-implementation rows.** `bdpbd` is outside the Transactional
  profile (BDBD-003), so the cross-implementation coverage category has no
  realizable row until a second Transactional server exists.
- **Test-only controls for `bdptest`.** View rotation, epoch rotation,
  clock control, crash-after-admission, and the erasure trigger are not BDP
  request fields; the Read cohort's self-certified lifecycle rows show the
  packaged-versus-in-process provenance question these rows will inherit.
- **The `406` media-type code.** Unacceptable response media types remain
  unassigned, as in the draft; `415` is inherited from Read+Update.
- **`ETag` and conditional requests on receipts and groups;** `HEAD` on
  `changes/` and `events/`.
- **Per-Resource diagnostics for set operations.** A `validation-failed`
  or `aggregate-constraint-violation` raised by `updateWhere` locates the
  operation but not the selected Resource; whether a diagnostic's
  `instanceLocation` may name one is unwritten.
- **Discovery `ETag` and `limits` change semantics** for the
  `retention.receipt` value while receipts are outstanding, and for
  `minimumReplayPosition` advancing at an erasure.
- **The erasure ledger's size.** T29 bounds it by the number of erasures
  and carries it on every manifest; an authority with many erasures has no
  paging rule for it.

## 8. Decision index

| Decision | One line |
| --- | --- |
| T1 | Owned-Link delta is a singular `ownedLink { operation, link }`, exclusive with `change`; `link` is the record for `created`, the Link's delta for `updated`, the identity for `deleted`; recommend (revised). **RATIFIED 2026-09-08.** |
| T2 | A `deleted` owned-Link transition carries the identity `{ id, type, revision }`; recommend. **RATIFIED 2026-09-08.** |
| T3 | Facts of one owned-Link operation are ordered lifecycle, graph (source, target), source `updated` last; set expansion in `canonical-uri` order; recommend (clarified). **RATIFIED 2026-09-08.** |
| T4 | A no-op owned-Link update versions neither Resource; `CreatedData`/`DeletedData` carry no owned data; the empty key set is authoritative in the record, not the Event; recommend (clarified). **RATIFIED 2026-09-08.** |
| T5 | Closed `batchRequest`; Read+Update reference definitions; pins on labels accepted; `@`-free supplied `id`; `<op>Operation` over `<op>Members`; `updateWhereRequest`/`deleteWhereRequest`; recommend (revised). **RATIFIED 2026-09-08.** |
| T6 | `200` for every terminal receipt, `202` bounded, closed pre-admission set in precedence order, transient-abort `503`, `405` with the CORS exception, one matrix; recommend (revised). **RATIFIED 2026-09-08.** |
| T7 | Flat entries in the Read+Update vocabulary with `matched`, `withheld`, `erased`; `canonical-uri` order; entry-granular pages; recommend (revised). **RATIFIED 2026-09-08.** |
| T8 | `status` pending/completed/failed plus `detail` available/expired/withheld; `allocated` on expired; `failed` never withheld; expired retry is `200`; recommend (revised). **RATIFIED 2026-09-08.** |
| T9 | `receipts/{token}`, `404` non-disclosure incl. retracted receipts, no listing, root `404` with its rationale, pages `410` after expiry; recommend (clarified). **RATIFIED 2026-09-08.** |
| T10 | Receipt problem = Read+Update shape by `$ref` + `status` + attribution members + Read+Update diagnostics; recommend (revised). **RATIFIED 2026-09-08.** |
| T11 | Three Transactional-only rows beside the inherited tables; one row per shared code; direct/receipt contexts closed; recommend (revised). **RATIFIED 2026-09-08.** |
| T12 | Idempotency key = checkpoint character profile, bare header token (shared, D1); recommend. **RATIFIED 2026-09-08.** |
| T13 | One key namespace across singleton, batch, and sequence members; member = one-operation transaction; envelope unchanged; recommend (revised, completed by T40/T41). **RULED (a) 2026-09-08.** |
| T14 | `retention.idempotency` prohibited on Transactional discovery; recommend (X2). **RATIFIED 2026-09-08.** |
| T15 | History tokens share the checkpoint profile; revisions stay opaque equality-only strings; recommend (revised). **RATIFIED 2026-09-08.** |
| T16 | Group wire form: `erasures` required, `checkpoint` on the wire, `transaction` on erasure groups, non-empty visible groups, `after` for `start=now`; recommend (revised). **RATIFIED 2026-09-08.** |
| T17 | Tombstone entry is `operation: tombstone` with `{ id, type, revision }`; recommend. **RATIFIED 2026-09-08.** |
| T18 | Single digest scheme `sha-256-jcs`, 64 lowercase hex characters, over the I-JSON record; real digests and vectors; recommend (revised). **RATIFIED 2026-09-08.** |
| T19 | Erasing a live version requires a same-group successor or tombstone under T27/T30/T31; inline owned copies get their own records; recommend (revised). **RULED (a) 2026-09-08.** |
| T20 | Replaced by T25, T26, T28, T29 and the six store obligations. |
| T21 | No catalog member for the category; proposed capability names; `bdpbd` outside Transactional claims, no N/A rows; recommend (revised). **RATIFIED 2026-09-08.** |
| T22 | `source` + `sourceRevision` on owned-Link results and `deleted` as an identity record, both profiles (X1, X4); recommend (revised). **RATIFIED 2026-09-08.** |
| T23 | `<op>Operation`/`<op>Request` naming, `format: date-time`, `$ref` problem composition; recommend (revised). **RATIFIED 2026-09-08.** |
| T24 | Adopt the landed Read+Update spellings wherever the halves must agree; recommend. **RATIFIED 2026-09-08.** |
| T25 | Erased content = record less lineage marker; Events withheld by content; ordinals, cursors, `eventCount`; recommend. **RULED (a) 2026-09-08.** |
| T26 | Receipts, pages, retained dispositions are erasure stores; `erased` entry to authorized callers, `withheld` otherwise; recommend. **RULED (a) 2026-09-08.** |
| T27 | Successor delta after a live-version erasure is one root `replace`; successor must differ or tombstone; recommend. **RULED (a) 2026-09-08.** |
| T28 | An erasure at P expires checkpoints and snapshots anchored before P per view; recommend ((b) scrubbed form recorded). **RULED (a) 2026-09-08.** |
| T29 | Erasure ledger outside fenced history: manifest `erasures`, restore re-emission, unestablishable content destroyed; recommend. **RULED (a) 2026-09-08.** |
| T30 | Snapshot and group agreement verified; disagreement rejected, never resolved by authority; recommend. **RULED (a) 2026-09-08.** |
| T31 | Tombstone path is an administrative deletion with the ordinary facts; recommend. **RULED (a) 2026-09-08.** |
| T32 | One current-authorization projection for every receipt delivery path, with owned closure; non-record entries served as retained; recommend. **RATIFIED 2026-09-08.** |
| T33 | Receipt response fields are the serving request's observation; body facts never change; recommend. **RATIFIED 2026-09-08.** |
| T34 | Transient abort after admission retracts the receipt, unbinds the key, answers direct `503`; duration limit is permanent; recommend. **RULED (a) 2026-09-08.** |
| T35 | Admission is one durable step with execution ownership; commits are fenced; pending recovery within `transaction.duration`; recommend. **RULED (a) 2026-09-08.** |
| T36 | Expired `completed` receipts carry `allocated` identities; recommend. **RATIFIED 2026-09-08.** |
| T37 | `operationIndex` omitted only for transaction-wide failures; one `pointer` base; no `pointer` on `resource-erased`; recommend. **RATIFIED 2026-09-08.** |
| T38 | `202` on the original submission only past the synchronous wait bound; recommend. **RULED (a) 2026-09-08.** |
| T39 | No-op entries are `updated` at the retained revision; all-no-op omits `effectPosition`; recommend. **RATIFIED 2026-09-08.** |
| T40 | `sequence` on a Transactional Scope: member projections for completed, withheld, erased, failed, pending, expired, and dependents; retired direct forms; recommend. **RATIFIED 2026-09-08.** |
| T41 | Carrier-neutral semantic identity (`name` excluded, batch `@label` normalized to index or supplied id) and the pre-admission precedence; recommend. **RATIFIED 2026-09-08.** |
| T42 | One endpoint/status matrix; recommend. **RATIFIED 2026-09-08.** |
| T43 | `directProblemCode`/`receiptProblemCode`; problem definitions composed by `$ref` from `readUpdateProblem`; recommend. **RATIFIED 2026-09-08.** |
| T44 | I-JSON data contract for all BDP JSON; JCS over it; digest failure never gates erasure; recommend. **RATIFIED 2026-09-08.** |
| T45 | Validated timestamps through `format: date-time` registered in both validators; uppercase emission profile; recommend. **RATIFIED 2026-09-08.** |
| T46 | `page.maximumItems` bounds receipt entries, every entry counting as one; recommend. **RATIFIED 2026-09-08.** |
| T47 | Failed receipts retained for `retention.receipt`, then forgotten — D28's rule in both profiles; the draft's epoch-lifetime law and the recorded divergence are withdrawn. **RULED (b) 2026-09-08 (judgment delegated).** |
| T48 | `transactional.<area>.<case>` ids; category as grouping; `retires` member and selection rule for the ten retired Read+Update rows; recommend. **RULED (a) 2026-09-08.** |
| X1 | `deleted` is the identity record `{ id, type, revision }` in both profiles; recommend for both. |
| X2 | `retention.idempotency` is Read+Update-only; Transactional discovery MUST NOT advertise it; recommend for both. |
| X3 | One sentence: Read+Update refuses a concurrent duplicate because it has no receipt to hand it; Transactional joins; recommend for both. |
| X4 | `source` beside `sourceRevision` on every owned-Link result in both profiles; recommend for both. **RULED A 2026-09-08; applied.** |
| T49 | Alias targets on a Transactional Scope: receipt, history, changefeed, and `batch` membership; recommend the minimal contract (option 1) with the `batch` fork recorded. **Open, teed up for the operator; applied nowhere.** |
| T50 | Receipt entries spell `deleted` as `deletedIdentity`; `erased` and the owned-Link `deleted` transition keep `resourceIdentity`. **Applied provisionally (apply record).** |
| T51 | `alias-path-taken` joins the receipt context. **Applied provisionally.** |
| T52 | `transactionalAdvertisedLimits` is a closed definition of its own carrying `validation` and rejecting `retention.idempotency`. **Applied provisionally.** |
| T53 | `transactionalOperationDirectory` pins the twelve targets, the alias entries included. **Applied provisionally.** |
| T54 | `binding-unavailable` is a receipt code for a sequence member's failed receipt. **Applied provisionally.** |
| T55 | A transient dependent's admitted pending receipt is retracted and its key unbound. **Applied provisionally.** |
| T56 | Number model references #23; council 13 restores T44's Unicode scalar and duplicate-member rules separately, with their syntax failure code. **Amended; ratification pending.** |
| T57 | Digest vectors reproduced from recorded serializations; no RFC 8785 serializer added; gap recorded. **Applied provisionally.** |
| T58 | T34's duration rule stated under *Mutation Receipt responses*. **Applied provisionally.** |
| T59 | The snapshot example completed into a closed projection. **Applied provisionally.** |
| T60 | The token-profile paragraph scoped to the Transactional profile. **Applied provisionally.** |
| T61 | The council 12 one-element `results` sentence kept, the set-target clause appended. **Applied provisionally.** |

## Appendix A. Paste set

The `$defs` to paste into `schemas/bdp-v0.schema.json` are exactly the
blocks tagged `<!-- bundle-defs -->` in sections 1.2, 2.2, 3.3, and 5.2, in
that order. Assembled onto the current bundle's 71 definitions they add 54
and collide with none:

`wireToken`, `revision`, `dateTime`, `resourceKind`, `resourceIdentity`,
`typedLinkReference`, `createdData`, `ownedLinkDelta`, `ownedLinkChange`,
`updatedData`, `deletedData`, `linkDeltaData`, `eventType`, `event`,
`eventPage`, `selector`, `cardinality`, `updateWhereMembers`,
`deleteWhereMembers`, `updateWhereRequest`, `deleteWhereRequest`,
`createBeadOperation`, `updateBeadPropertiesOperation`,
`deleteBeadOperation`, `createLinkOperation`,
`updateLinkPropertiesOperation`, `deleteLinkOperation`,
`updateWhereOperation`, `deleteWhereOperation`, `batchOperation`,
`batchRequest`, `transactionalOperationDirectory`, `receiptStatus`,
`receiptDetail`, `receiptEntryOutcome`, `receiptResult`,
`allocatedIdentity`, `receiptCore`, `mutationReceipt`,
`mutationReceiptPage`, `transactionalOnlyProblemCode`,
`transactionalProblemCode`, `directProblemCode`, `receiptProblemCode`,
`transactionalProblem`, `receiptProblem`, `stateChange`, `erasureDigest`,
`erasureRecord`, `changeGroup`, `changefeedPage`, `snapshotManifest`,
`transactionalAdvertisedLimits`, `transactionalDiscovery`.

No existing definition is modified by the paste. The packet's sanity check
assembles these onto the current bundle with the repository's strict Ajv
2020-12 settings and the `uri` and `date-time` formats, compiles all 125
definitions, accepts every tagged positive fixture and rejects every tagged
negative one, and re-runs the catalog citation rule over every row; the
delivery report carries the counts. Schema compilation establishes wire
shape only: Scope confinement, Resource kind, label resolution, revision
transitions, attribution equality, owned-record agreement, result
correspondence, `eventCount`, and cursor, view, and epoch relationships
remain semantic checks for the authority and for conformance rows.

The apply step, after the rulings, also does the following, none of which
this packet performs:

1. edits the specification at every "Target:" named in sections 1.1, 2.1,
   3.1, 3.2, 4.1, and 5.1, including the receipt example and the "one
   result per operation" sentence under "Mutation Receipt responses", the
   `ChangeGroup` model block under "Change groups and replication", the
   "one-element `results` array" sentence under "Operation Directory and
   singleton targets", the I-JSON and timestamp sentences in the protocol
   section's introduction, and the "every other token remains exactly as
   valid" sentence under "Version erasure";
2. adds a "Transactional conformance rows" subsection under "Normative
   conformance matrix", mirroring the catalog rows in order as the
   Read+Update subsection does, and lists the retired Read+Update rows;
3. writes `packages/conformance/catalog/transactional-v1.json` from the
   tagged `<!-- catalog-rows -->` blocks with `catalogVersion` `1`, and a
   `transactional-catalog.test.ts` mirroring `read-update-catalog.test.ts`
   (strict parse, citations, profile prefix, no collision with the sealed
   Read and drafted Read+Update catalogs, no manifest binding, spec-table
   mirroring);
4. adds the `retires` member to `SCENARIO_KEYS`, the catalog validator, and
   `selection.ts` (T48), and writes the `<!-- catalog-retirements -->` map
   into the retiring rows;
5. registers `date-time` in `packages/conformance/src/schema-validator.ts`
   and in `packages/protocol/src/read-update-wire.test.ts` from
   ajv-formats' full mode exactly as `uri` is registered, exporting an
   `isJsonSchemaDateTime` beside `isJsonSchemaUri` in
   `packages/protocol/src/schema-formats.ts` (T45);
6. updates the bundle's top-level `description`, which still names only
   the discovery, Read, and Read+Update surface; copies the bundle
   byte-identically to `packages/protocol/schemas/bdp-v0.schema.json`; and
   extends the exact key list in `packages/protocol/src/schema-bundle.test.ts`
   by the 54 names above;
7. writes the tagged fixtures under `fixtures/transactional/` in the
   exchange shape `fixtures/read-update/` uses, with narrated conditions,
   and a `transactional-wire.test.ts` that validates them and checks the
   problem table, the receipt representations, and the digests of section
   5.4 against a JCS implementation;
8. applies X1 and X4 on the Read+Update side (`mutationResultMembers`,
   `sequence-positive.json` and the other deletion exchanges, rows
   `read-update.singleton.delete-bead` and `read-update.singleton.delete-link`)
   and X2 and X3 in the shared specification sentences; and
9. re-points every packet citation in the rows at the specification
   sections the text moved into.

## Appendix B. Contradictions and gaps found in the draft

1. **`ChangeGroup` model versus wire.** The model block under "Change groups
   and replication" has `erasures` and no `checkpoint`; every changefeed
   example has `checkpoint` and no `erasures`. T16 aligns them, and the
   model block is an apply target.
2. **One result per operation versus paged set results.** "A successful
   batch contains one result per operation in declaration order" and "Large
   set-operation results continue through immutable pages of that same
   receipt" cannot both hold for a nested per-operation result. T7 resolves
   it with flat entries, and the sentence is an apply target.
3. **Operation sketch versus bundle conventions.** The non-normative sketch
   types `typeId` as `format: uri` where the bundle uses `absoluteHttpUrl`,
   and its `pinnedReference.uri` accepts any nonempty string where the
   bundle's requires an absolute URI; the draft does not say that the
   request side differs from the response side. The Read+Update reference
   definitions make the difference explicit, and T5 (b) adopts them.
4. **Receipt `transaction` on no-effect and pending receipts.** The receipts
   model says a receipt records "the transaction identity", the example
   shows `transaction`, and the no-effect rule says only that
   `effectPosition` is omitted; whether `transaction` is present when there
   is no change group, or while pending, is unstated. T8 makes it always
   present.
5. **`sequence` on a Transactional Scope.** The Operation Directory lists
   `sequence` among the Transactional children, "Sequence responses are not
   durable Mutation Receipts", and "Every mutation executes as part of a
   Mutation Transaction" — together they leave a sequence member's receipt,
   Events, and key namespace on a Transactional Scope undefined. T13, T40,
   and T41 resolve it.
6. **`retention.idempotency` versus the epoch-long tombstone.** Advertised
   limits define `retention.idempotency` for any profile, while receipts
   retain the key's disposition "for the rest of the Scope epoch". T14 and
   X2 resolve it.
7. **`catch-up-timeout` is named but not defined.** "HTTP consistency,
   caching, and CORS fields" refers to "the normative foreign-view,
   cursor-expired, or catch-up-timeout problem"; no table assigns
   `catch-up-timeout`. T11 assigns it.
8. **`event-history-expired` has no table.** "Reads after deletion" says it
   "remains an Event-Source condition, not a Read-table code"; no other table
   exists. T11 assigns it.
9. **`Idempotency-Key` example versus the IETF draft.** The example is a bare
   token; the IETF `Idempotency-Key` draft quotes the value. T12 and D1
   choose the bare token deliberately.
10. **Batch statuses partly assigned.** "Batch operation target" assigns
    `200` and `202`, while "Mutation Receipt responses" says exact HTTP
    statuses are not yet assigned. T6 and T42 complete the assignment
    consistently with the first.
11. **Double reporting in an owning source's Event Source.** The
    Bead-scoped Event Source reports an incident Link's `updated` fact and,
    once the delta exists, the source's own `updated` fact for the same
    property change; the draft's Event Source rules and the owned-Link rule
    each require one of them. Section 1.1 states the consequence rather
    than removing either, and T1 makes both carry the same delta.
12. **Erasure-only groups and `transaction`.** "For an ordinary visible
    group, `projectionAdvance` is false and `transaction` is present", yet
    erasure is administrative — the draft keeps its mechanism outside BDP
    and it has no receipt — and the draft never says what `transaction` an
    erasure group carries. T16 (c) resolves it.
13. **A snapshot's inline owned Links appear twice.** A snapshot's `beads`
    stream inlines owned Links and its `links` stream carries the same
    Links; the draft says they are one graph but not what a replica does
    when a page boundary leaves them disagreeing. The first draft of this
    packet proposed competing authorities, which the council rejected as an
    invariant violation; T30 requires the replica to stage both streams,
    verify agreement, and reject a disagreeing snapshot or group outright.
14. **"Every other token remains exactly as valid as it was."** The
    erasure section's sentence cannot hold for a checkpoint or snapshot
    anchored before the erasure in a view that receives the record, because
    replaying from it would serve the erased content. T28 amends it to
    tokens anchored at or after the erasure position.
15. **Cumulative profiles versus profile-specific wire shapes.** "Each
    higher profile claims every lower profile" and the selection rule apply
    every Read+Update row to a Transactional claim, while the draft itself
    gives Transactional singletons a receipt body and joins concurrent
    duplicates. T48 names the ten retired rows and proposes the catalog
    member that reconciles the two.
16. **Retention of failed dispositions.** The draft retains every admitted
    mutation's disposition for the epoch; Read+Update D28 forgets failures
    after an interval. T47 keeps the draft's rule and records the
    divergence for the operator.
17. **Erasure versus receipt retention.** "It retains a compact tombstone
    ... for the rest of the Scope epoch" and `expiresAt` promise retention
    of detail that erasure must remove. T26 makes erasure override the
    promise for the erased content alone.

## Reconciliation with Read+Update

The Read+Update wire at `2df0216` is the reference for every shared name
and shape. Where the halves must agree the packet adopts the landed
spelling; where the Transactional side differs, the difference is a
numbered decision with its reason.

| Item | Read+Update (landed) | This packet | Disposition |
| --- | --- | --- | --- |
| Key grammar and header form | D1: `[A-Za-z0-9_-]{1,256}`, bare, byte-exact; repeated field rejected | Same, referenced | Adopted (T12) |
| Key namespace | D2: canonical Scope URL + authenticated principal | Scope URL + epoch + principal | By design: the epoch fences receipts (T13) |
| Semantic identity | D3: kind + normalized record, `name` and key excluded, `@name` to the bound identity, RFC 6902 §4.6 | Adopted, plus the batch `@label` rule (index or supplied id) | Adopted (T41) |
| Concurrent duplicates | D5: refuse with `idempotency-in-progress` | Join through the pending receipt | By design; one sentence in the spec says why (X3) |
| Retention window | D6/D25/D28: interval, then a compact tombstone for committed effects; failures forgotten | Every terminal receipt retained for the epoch | Recorded divergence (T47) |
| Tombstone lifetime | D6: lifetime of the logical Scope | Rest of the epoch | One rule: the lifetime of the key's namespace (T47) |
| `retention.idempotency` | D6: the Read+Update floor | Prohibited on Transactional discovery | X2 |
| Deleted identity | D9: `deleted` is a URL, no revision | `deleted` is `{ id, type, revision }`, final live revision | X1 proposes the record for both profiles |
| Owned-source pair | D10 (revised): `source` + `sourceRevision`, present together, rejected on Bead postimages | Adopted on `created`, `updated`, `deleted`, and `erased` entries | X4 (T22 revised) |
| No-op outcome | D11: `updated` at the retained revision | Adopted; all-no-op transaction omits `effectPosition` | T39 |
| Problem codes | D13: `identity-taken`, `aggregate-constraint-violation`, `validation-failed` absorbs patch failures, `unsupported-media-type` 415, `binding-unavailable` | Adopted; `identity-conflict`, `constraint-violated`, `patch-failed` withdrawn; three Transactional-only rows added | T11 (revised), T24 |
| Diagnostics | D16: `{ type?, schemaLocation?, instanceLocation?, message }`, mandatory on `validation-failed`, `diagnosticsTruncated` | Adopted by `$ref`; packet's `problemDiagnostic` withdrawn | T10 (revised) |
| Entry members | `operationIndex`, `operationName` | Adopted; packet's `name` on entries withdrawn | T24 |
| Definition names | `localName`, `resourceReference`, `localBindingReference`, `inputReference`, `inputPinnedReference`, `durableResourceReference`, `expectedRevision`, `jsonPointer`, `propertyChange`, `idempotencyKey` | Adopted; `localLabel`, `suppliedIdentity`, `mutation*Reference`, and the duplicate `propertyChange`/`idempotencyKey` withdrawn | T24, T5 (revised) |
| Operation composition | `<op>Members` mixins + `unevaluatedProperties: false` | `<op>Operation` composed the same way; `updateWhereMembers`/`deleteWhereMembers` added | T5 (e) |
| Problem composition | `readUpdateProblem` routes Read codes through `readProblem` by `$ref` | `transactionalProblem`/`receiptProblem` route Read+Update codes through `readUpdateProblem` by `$ref`; `problemCodeRows` withdrawn | T43 |
| Discovery limits | `readUpdateAdvertisedLimits` rejects Transactional groups | `transactionalAdvertisedLimits` rejects `retention.idempotency` | T14 |
| Durable boundary and recovery | D22: one durable unit; abandoned claims cleared, never resumed; one key state | Admission as one durable step with ownership; pending receipts retracted, never resumed; commits fenced | Parity (T35) |
| Crash mid-sequence | D23: resubmit; unstarted members never run | Same through the pending-receipt retraction | Parity (T40) |
| Binding metadata after expiry | D24: tombstone keeps allocated identity and kind | `allocated` on expired receipts; `idempotency-expired` projection carries it | T36, T40 |
| Key reservation | D26: claim every member's key at admission | Pending receipts recorded at admission in declaration order | T40 |
| Static reference errors | D27: carrier rejections | Same in a batch, as the draft already said | T5, T41 |
| Replay re-authorization | D21: `forbidden`, not retained; problems and deleted identities served | Receipts: `withheld` entries, non-record entries served; sequence projection: `forbidden` | T32, T40 |
| Restore | D22: a restore that loses recovery state is a different Scope URL | Epoch rotation at the same URL; prior-epoch keys unbound | By design; row retired (T48) |
| `retryAfter` | D30: member-level delay hint | Used on the pending projection | Adopted |
| Timestamps | inline strings | `dateTime` with `format: date-time`, registered in both validators | T45 (apply step) |
| Catalog conventions | `read-update.<area>.<case>`; lockstep test mirrors the spec table; no manifest binds it | `transactional.<area>.<case>`; `retires` member proposed; same tests at apply time | T48 |
| STATUS and design index | Read+Update row and index entry | Transactional row and index entry, edited by this packet | — |

## Council 10 fold

Council 10 (Codex, Gemini, Claude) reviewed the first draft of this packet
(`9ce9159` on `0b7d86e7`) against the Read+Update wire that had since
landed. This revision rebased the packet onto `2df0216` first, then folded
every finding. Each finding below records what was done and where, or why
it was not folded; every judgment the fold required is a numbered decision
above, applied provisionally as its recommendation, not a ruling.

| Finding | Disposition |
| --- | --- |
| Codex 1 (Critical) — erasure leaves the erased Link's endpoint content in graph Events | Folded: T25 defines erased content and withholds by content; the `pos-47` fixture shows withheld graph facts; rows `transactional.erasure.event-withholding`, `transactional.erasure.graph-facts`. |
| Codex 2 (High) — no replay representation after purging postimages; snapshots and receipts carry erased material | Folded: T28 (invalidation at the erasure position), T26 (receipts as stores, `erased` entry), T29 (manifest ledger), `eventCount` = served Events; rows `transactional.erasure.replication-invalidation`, `transactional.erasure.receipts`. |
| Codex 3 (High) — obligations lost across resnapshot, view rotation, restore | Folded: T29 (ledger outside fenced history, manifest `erasures`, restore re-emission, unestablishable content destroyed, epoch rotation never revokes); rows `transactional.erasure.restore`, `transactional.erasure.unestablishable-content`, `transactional.erasure.retention-non-propagation`, `transactional.snapshot.erasure-ledger`. |
| Codex 4 (High) — receipt re-authorization incomplete; fixture violates owned closure | Folded: T32 (every delivery path; owned closure; non-record entries served as retained); the authorization fixture now hides the Decision and withholds it with its owned Link; the stricter reading (withhold counts) is recorded as the alternative; rows `transactional.receipt.reauthorization*`, `transactional.receipt.non-record-entries`, `transactional.receipt.whole-withheld`. |
| Codex 5 (High) — receipt response fields assert a stale or foreign position | Folded: T33; row `transactional.receipt.headers`. |
| Codex 6 (High) — T13 selects a namespace without completing identity or sequence behavior | Folded: T41 (labels excluded, `@label` normalization, precedence), T40 (member projections for pending, expired, withheld, erased, and dependents), T36 (binding metadata after expiry); fixture under section 4.2; rows `transactional.sequence.*`, `transactional.idempotency.semantic-identity`. |
| Codex 7 (High) — no abandoned-execution recovery; terminal transient failures retry forever | Folded: T35 (admission as one durable step, ownership fencing, pending recovery bound) and T34 (transient abort retracts and unbinds; retry table inside failed receipts; duration is permanent); rows `transactional.idempotency.durable-admission`, `.ownership-fencing`, `.pending-recovery`, `.transient-abort`, `.failed-retained`. Resuming abandoned executions was not adopted, for the reason D22 gives. |
| Codex 8 (High) — owned-Link deletion omits the source identity | Folded: X4 (`source` beside `sourceRevision`, both profiles) and X1; `receiptResult` rejects either member alone; fixture `rcpt-9`; row `transactional.receipt.owned-link-source`. |
| Codex 9 (High) — `sha-256-jcs` undefined for every admissible value | Folded: T44 (I-JSON contract, uniform across profiles; digest failure never gates erasure), vectors under section 5.4, real digests in every fixture; row `transactional.erasure.digest-domain`. |
| Codex 10 (High) — snapshot disagreement must be rejected, not assigned authorities | Folded: T30; Appendix B.13 rewritten; live-version erasure validity rule; row `transactional.snapshot.closed-projection`. |
| Codex 11 (High) — mandatory behavior cannot be "honestly not-applicable" | Folded: T21 revised; section 6.1 keeps `bdpbd` outside Transactional claims with no rows recorded. |
| Codex 12 (Medium) — the exact HTTP rules contradict one another | Folded: T42 matrix under section 2.1 (precedence, CORS `OPTIONS`, bodyless `500`, receipt-read precedence, transport failure decides nothing); T6 revised; row `transactional.http.status-matrix`. |
| Codex 13 (Medium) — problem schemas do not enforce their taxonomy | Folded: T43 (context enums, `$ref` composition, diagnostics required through `readUpdateProblem`), T37 (`operationIndex` rule, no `pointer` on `resource-erased`); negative fixtures under section 3.4; rows `transactional.http.problem-contexts`, `transactional.receipt.transaction-level-failure`. |
| Codex 14 (Medium) — T15 turned revisions into HTTP syntax | Folded: the sentence is struck; T15 revised. |
| Codex 15 (Medium) — `dateTime` is not an RFC 3339 validator | Folded: T45 (`format: date-time` registered in both validators, uppercase emission profile); boundary fixture under section 1.3; row `transactional.http.timestamps`. |
| Codex 16 (Medium) — fixtures schema-valid but protocol-invalid | Folded: real digests (r7 `5c9db2f8…`, r8 `f51ab17b…`, recomputed after the fixture changes), a real correction (`task-42-r9` changes the title; root-replace delta), a closed snapshot (`task-41` present), and the owned-closure authorization fixture. |
| Codex 17 (Medium) — not yet a complete wire-and-conformance gate | Folded: `updateWhereRequest`/`deleteWhereRequest` (T5 (e)); pagination counting (T46); apply targets listed in Appendix A (receipt example, "one result per operation", singleton sentence, model block, administrative erasure groups); Appendix B.13 rewritten; section 7's Event-Source misstatements removed; the restore row split into `transactional.restore.epoch-fence` and `transactional.restore.key-namespace`; rows added for cross-carrier identity, pending and transient dependents, expired bindings, restart recovery, owned-Link deletion identity, multiple owned transitions, live erasure, withholding and cursor continuity, retention non-propagation, erasure across bootstrap and restore, and page authorization/expiry precedence. Cross-implementation coverage stays in section 7. |
| Codex T-assessments — T3 self-Link and ordinals; T4 limitation; T7 immutable result versus re-authorized representation; T8 `pending` not immutable; T9 page checks and restart stability; T14 rationale; T16 model amendment; T19 stronger invariants; T22 secondary revision; T23 sibling reconciliation | Folded as the *Clarified*/*Revised* notes on T3, T4, T7, T8, T9, T14, T16, T19, T22, and T23; page URL restart stability remains in section 7. |
| Gemini 1 (Critical) — expired receipts drop allocated identities | Folded: T36 (`allocated`, named so rather than `allocatedIdentities`; per-creation entries rather than a skeletal `results`); fixture and negative fixture under section 3.4; row `transactional.receipt.expiry-allocated`. |
| Gemini 2 (High) — no atomic admission boundary or lease for pending receipts | Folded: T35 (one durable step, ownership, bounded retraction rather than a lease that resumes). |
| Gemini 3 (High) — deleted owned Link lacks `source` | Folded: X4. |
| Gemini 4 (Medium) — the refuse-versus-join sentence | Folded: X3, proposed under "Mutation Transactions" in section 4.1. |
| Gemini 5 (Medium) — the invalid batch fixture fails for the wrong reason | Folded: the per-operation `idempotencyKey` and the `@` `id` are now separate negative fixtures under section 2.3. |
| Claude C1 — erasure obligations omit receipts; `rcpt-7` serves erased content | Folded: T26; the `rcpt-7`-after-erasure fixture; the store list names receipts, pages, and retained dispositions. |
| Claude H1 — the successor's delta discloses erased content; the fixture successor is a no-op | Folded: T27; the `pos-45` fixture rewritten. |
| Claude H2 — replication across an erasure unspecified | Folded: T28 (a), with (b) recorded; the "every other token" sentence amended (Appendix B.14). |
| Claude H3 — transient failures after admission become permanent | Folded: T34; fixture for the direct `503`; row `transactional.idempotency.transient-abort`. |
| Claude H4 — abandoned in-flight claims have no recovery rule | Folded: T35; row `transactional.idempotency.pending-recovery`. |
| Claude H5 — `sequence` on a Transactional Scope half-defined; inherited rows fail | Folded: T40 projections; T48 retired rows and the `retires` mechanism; section 6.1 corrected. |
| Claude H6 — shared decisions stated against a sibling that no longer exists | Folded: step 0 rebase onto `2df0216`; T24; the reconciliation table above; every listed conflict resolved (`identity-taken`, `aggregate-constraint-violation`, `validation-failed` absorbing `patch-failed`, `unsupported-media-type` and `415`, diagnostics, `operationName`, X1, tombstone lifetime as T47, definition names, one `idempotencyKey` and `propertyChange`); T11 (b)'s "eight codes are the same" withdrawn. |
| Claude M1 — `updated` transition carries a snapshot | Folded: T1 revised (`ownedLinkDelta`); fixtures for the delta form and the rejected record form. |
| Claude M2 — owned-Link deletion entries do not name the source | Folded: X4. |
| Claude M3 — expired receipts drop allocated identities | Folded: T36. |
| Claude M4 — `withheld` fixture conflates deletion with authorization and breaks closure | Folded: T32; fixture rewritten; "withholding is authorization, never deletion" in section 3.1. |
| Claude M5 — the draft's receipt example, "one result per operation", and the model block become invalid | Folded: all three are apply targets under sections 3.1 and 5.1 and Appendix A. |
| Claude M6 — `operationIndex` required on transaction-level failures | Folded: T37; fixture and row. |
| Claude M7 — receipt/direct code split is prose-only; `problemCodeRows` duplicates Read | Folded: T43. |
| Claude M8 — normalized identity undefined where T13 needs it | Folded: T41. |
| Claude M9 — `202` legal for any original submission | Folded: T38. |
| Claude M10 — no-op outcomes unspecified | Folded: T39; fixture `rcpt-10`; row `transactional.batch.no-op-entries`. |
| Claude M11 — the tombstone path is a deletion | Folded: T31; fixture `pos-47`; T16 (f). |
| Claude M12 — a pre-erasure backup resurrects the version | Folded: T29 restore re-emission; row `transactional.erasure.restore`. |
| Claude M13 — composition and naming should follow the sibling | Folded: T5 revised, T24. |
| Claude M14 — rows thin; id convention differs | Folded: T48; 113 rows under section 6 in `transactional.<area>.<case>` form, covering every listed gap (T3 ordering, T2 identity, T4 no-op, `202` on the original, page `410`, root `404`, whole-receipt withheld, pinned labels, conflict after expiry, epoch unbinding, every store obligation, live erasure and the owned cascade, digest verification, `retention.idempotency`, the token profile, every T40 projection, `catch-up-timeout` and `event-history-expired`, `expiresAt` versus `retention.receipt`, snapshot expiry, diagnostics, zero-match, self-Link facts, and `Retry-After` on `202`). |
| Claude L1–L12 | Folded: L1 (T33); L2 (T45 prose); L3 (`receiptResult` rejects the pair on a Bead postimage); L4 (non-empty visible groups); L5 (obligation 3 rewritten around tombstoned subjects and cursors); L6 (real digests; RFC 8785 number rule in section 5.4); L7 (`canonical-uri` order); L8 (titles on the envelope definitions; the three revision spellings noted under section 1.2 for the bundle cleanup); L9 (Appendix A apply steps: byte-identical packaged copy, `schema-bundle.test.ts` key list, README index, STATUS row); L10 (Appendix A wording); L11 (one `pointer` base); L12 (the root's rationale, T9 (d)). |
| Claude verdicts | Folded where they departed from the first draft: T1 (M1), T5 (b)/(e) (M13), T6 (b)/(c) (M9, T42), T7 (M10), T10 `operationIndex` (M6), T11 (b) withdrawn and (c) replaced by `$ref` composition, T13 (H5), T14 (D6 reconciliation, T47), T19 (M11), T20 (replaced), T21 (id convention), T22 (X1, X4), T23 (`problemCodeRows` withdrawn). |
| Cross-packet X1, X2, X3 (and X4 from D10) | Folded as the four cross-packet decisions under section 4.4, each to be ruled once for both halves. |
| Synthesis — Codex prefers a scrubbed-group representation where Claude offers invalidation | Folded: T28 recommends invalidation (a) and records the scrubbed form (b) with its cost. |

Validation at the fold, in a scratch directory outside the repository: the
tagged definitions assembled onto the current bundle (71 definitions) add
54 with no collision; all 125 compile under strict Ajv 2020-12 with the
`uri` and `date-time` formats; every tagged positive fixture validates and
every tagged negative fixture is rejected; the 113 rows parse under the
catalog's own rules, collide with no sealed Read or drafted Read+Update id,
and every citation resolves to its anchored section; the two erasure
digests and the section 5.4 vectors were recomputed with an RFC 8785
serializer. None of it is conformance evidence; `claimEligible` remains
`false`, no manifest binds a Transactional row, and no evidence generation
was run.

## Apply record (2026-09-08)

The packet was applied to `gastownhall/bdp` on branch
`janet-w1-transactional-packet` after decisions T1–T48 and X1–X4 were
ruled or ratified, on top of `janet-w1-read-update-wire` at `89f56d1`
(merged as `8386529`). Where a ruling departed from the packet's proposed
text the ruling was applied, and every judgment the apply pass had to make
is numbered below (T50 onward), each applied provisionally. Nothing here is
a conformance claim: every row stays unclaimed, no manifest binds the
catalog, and the fixtures are illustrations, never evidence.

### What landed where

- **Specification** (`docs/specs/bdp.md`): the protocol section's
  introduction (the numeric-model forward reference and the timestamp
  profile); *Events and Event Sources* (the `UpdatedData`,
  `OwnedLinkChange`, `OwnedLinkDelta`, and `ResourceIdentity` model
  blocks, the owned-Link delta paragraphs, the delta-application
  paragraph, and the `canonical-uri` set-expansion order); *Event replay
  and live observation* (the `updated` bullet); *Change groups and
  replication* (`checkpoint` in the model block, the owned-Link
  two-entries paragraph, and the invisible-group sentence); *Batch
  operation target* (section 2.1 whole, with the endpoint/status matrix);
  *Operation record schema* and *Operation Directory and singleton
  targets* (the sentences the packet named); *Mutation Receipt responses*
  (the `rcpt-7` example and section 3.1 whole); *Problem details* (section
  3.2 whole); *Mutation Transactions* (section 4.1 whole); *Advertised
  limits* (the X2 paragraph, beside the amended X6 sentence);
  *Event-ID and checkpoint character profile* (T15); *Scope changefeed*
  (the wire-form paragraph and `erasures` in both examples); *Version
  erasure* (section 5.1 whole, and the amended T28 sentence); *Scope
  snapshots* (the closed-projection and ledger paragraph, and the example
  completed); *Mutation receipts* in the data model (T47); *Normative
  schema bundle* and *Open protocol questions* entries 5, 6, and 13
  (status notes); and a new *Transactional conformance rows* subsection
  mirroring the catalog in order and listing the ten retirements.
- **Bundle** (`schemas/bdp-v0.schema.json`, copied byte-identically to
  `packages/protocol/schemas/bdp-v0.schema.json`): 52 definitions appended
  after the Read+Update definitions — every name in Appendix A except
  `resourceKind` and `resourceIdentity`, which #19's X1 application had
  already defined and which are reused — and the top-level `description`;
  135 definitions in all. The 26 sealed Read definitions and every
  Read+Update definition are byte-identical to the merge base.
- **Fixtures** (`fixtures/transactional/`): `discovery.json`,
  `batch.json`, `receipts.json`, `set-singletons.json`,
  `direct-problems.json`, `sequence.json`, `events.json`,
  `changefeed.json`, and `snapshots.json` in the exchange shape
  `fixtures/read-update/` uses, on the packet's one timeline
  (`pos-42` … `pos-49`), plus `erasure-digest-vectors.json` carrying the
  section 5.4 vectors. Every negative fixture of the packet is a rejected
  shape in the lockstep test rather than a file.
- **Catalog** (`packages/conformance/catalog/transactional-v1.json`): the
  113 rows of section 6 in order, every packet citation re-pointed at the
  specification section the text moved into, every `selectedText` a
  verbatim substring of its anchored section, and the ten `retires`
  members of the `<!-- catalog-retirements -->` map on the retiring rows.
- **Conformance kit**: `retires` on `ScenarioMetadata` (validated:
  nonempty, unique, never self-referential) and `retiredScenarioIds` in
  `packages/conformance/src/selection.ts`, with
  `selectApplicableScenariosForProfile` excluding a retired row from the
  claim that retires it (T48); `date-time` registered from ajv-formats'
  full mode in `packages/conformance/src/schema-validator.ts` and in the
  protocol tests, exported as `isJsonSchemaDateTime` beside
  `isJsonSchemaUri` (T45).
- **Tests**: `packages/protocol/src/transactional-wire.test.ts` (problem
  rows and contexts, fixtures, receipt/operation correspondence, change
  group and snapshot invariants, the digest vectors, the rejected shapes,
  discovery and limits), `packages/conformance/src/transactional-catalog.test.ts`
  (strict parse, citations, prefix and areas, no collision, retirements,
  selection over the concatenated catalogs, no manifest binding, the
  specification table), the bundle key-list test extended by the 52
  names, the `retires` and selection tests in `catalog.test.ts`, the
  `date-time` boundary tests, and the Read+Update problem-table test
  bounded to its own rows.
- **Status**: `STATUS.md`'s Transactional row and `docs/design/README.md`.

### Ruled Read+Update and Read sentences amended

Each carries "(amended 2026-09-08, Transactional apply)" in the
specification.

- *Advertised limits*, the council 12 sentence "The Transactional
  discovery definition, when it is drafted, carries the `validation` group
  as well, since a Transactional authority advertises the same bound." now
  reads "The Transactional discovery document's `limits` is
  `transactionalAdvertisedLimits`, a closed definition of its own on the
  same primitives: it carries the `validation` group as well, since a
  Transactional authority advertises the same bound, admits the
  `transaction` group and the `retention.receipt`,
  `retention.maximumSnapshotLifetime`, and `retention.replay` members, and
  rejects `retention.idempotency` under the paragraph below" (X6, X2).
- *Operation Directory and singleton targets*, the council 12 sentence
  "It returns the same Mutation Receipt shape with a one-element `results`
  array (amended 2026-09-08, council 12)." keeps its text and gains "; the
  two set targets `update-where` and `delete-where` return it with a
  `matched` entry followed by one entry per selected Resource, under
  Mutation Receipt responses" (T61), and the deferral sentence "The alias
  targets' Transactional contract … is defined with the Transactional
  profile." gains "; it is teed up as decision T49 in
  `docs/design/w1-transactional-packet.md` and remains open".
- *Mutation receipts* (data model, Transactional sidebar): "After the
  applicable interval it may discard bulky result data, but it retains a
  compact tombstone — the key, the request identity, and the disposition —
  for the rest of the Scope epoch." now reads "… may discard a completed
  transaction's bulky result data, but it retains a compact tombstone —
  the key, the request identity, the disposition, and the identities the
  transaction allocated — for the rest of the Scope epoch." followed by
  the failed-receipt sentence (T47).
- *Version erasure*: "An erasure does not rotate the Scope epoch: every
  other token remains exactly as valid as it was." now reads "… every
  token anchored at or after the erasure position remains exactly as valid
  as it was" (T28, Appendix B.14).
- The Read profile's closed tables, the Read definitions, and every other
  Read or Read+Update sentence are untouched; the Event-ID profile
  paragraph is appended, scoped to the Transactional profile (T60).

### T49 — Alias targets on a Transactional Scope (open, teed up for the operator)

**Status: open; applied nowhere.** The Transactional profile inherits the
two alias targets under [Alias targets](../specs/bdp.md#alias-targets),
and #19's text defers their Transactional contract — receipt, Scope
history, changefeed appearance, and whether `batch` admits alias members —
to this profile. The apply pass did not decide it: `batchOperation` stays
the eight-record union, the alias targets are outside the endpoint/status
matrix, the directory lists them because the profile inherits them (T53),
and no row claims or retires an alias obligation.

**Context.** An alias is a locator, not a Resource: it mints no version,
has no revision, and is not a member of any Bead record. A Transactional
Scope makes every mutation a Mutation Transaction with a receipt, occupies
a Scope position for every effectful transaction, and replicates state
through change groups; none of those say what an alias put or delete is.

**Options.**

1. **Minimal contract.** A singleton alias target on a Transactional Scope
   is a one-operation Mutation Transaction whose receipt's one entry is
   the alias result — `outcome`, `alias`, and `target` on a put — under
   `operationIndex` `0`; the key and receipt rules of
   [Mutation Transactions](../specs/bdp.md#mutation-transactions) apply
   unchanged, and a sequence member's projection is the Read+Update one.
   Alias mutation occupies no Scope position, induces no Event, and
   appears in no change group or snapshot: the alias table is
   identity-level state beside the erasure ledger, and a replica resolves
   aliases through the authority's redirect rather than mirroring the
   table. `batch` does not admit alias records. Costs: a replica cannot
   resolve aliases offline; a `@label` bound by a Bead creation cannot be
   aliased in the same atomic transaction.
2. **Aliases as history.** Each alias put or delete is an effectful
   transaction at its own Scope position whose change group carries a new
   `aliases` member (the alias path, the target, and the transition), so
   replicas mirror the alias table and a snapshot manifest carries it;
   `batch` admits `putAlias` and `deleteAlias` records (a ten-record
   union), receipts carry alias results under their operation indices, and
   a `@label` may be aliased in the transaction that creates it. Costs: a
   new group member, a snapshot member, a receipt-entry outcome for a
   non-Resource, and erasure and authorization-view rules for alias facts.
3. **Aliases as their own facts.** As option 2 for history and
   replication, but through `Event`s of new types (`aliased`,
   `unaliased`) rather than a group member. Costs: two Event Types for a
   non-Resource, contrary to "five domain-independent Event Types".

**Recommendation.** Option 1, with the `batch` membership fork recorded:
admitting alias members in `batch` is the natural extension once aliases
have a history story, and only then, because a batch's atomicity would
otherwise commit an alias transition that no group carries. Whichever
option is ruled, the sequence projection, the key namespace, and the
`alias-path-taken` and `identity-taken` rows are unaffected.

**Depends on this decision.** *Batch operation target* (the union and the
matrix's alias sentence), *Operation Directory and singleton targets* (the
deferral sentence), `batchOperation`, `transactionalOperationDirectory`
(present under T53), the fixture `discovery.json` narration, and the rows
a ruling adds (`transactional.alias.*`).

### Judgment calls at apply time (applied provisionally)

**T50 — X1 spellings on receipt entries.** Options: (a) a receipt entry's
`deleted` member is #19's `deletedIdentity` record
(`{ resourceKind, resource: { id, type, revision } }`), while `erased`
and the owned-Link `deleted` transition keep the bare lineage marker
`resourceIdentity` (`{ id, type, revision }`); (b) `erased` becomes an
identity record too; (c) the owned-Link transition becomes
`deletedIdentity`. Recommendation: (a). X1 names `deleted`; T2 ratified
the bare identity for the transition, whose kind is always a Link; and
the erasure text names the lineage marker `{ id, type, revision }`
throughout. A deleted Bead's entry rejects `source` and `sourceRevision`
as `mutationResultMembers` does after council 12. Applied provisionally.

**T51 — `alias-path-taken` in the receipt context.** Council 12's twelfth
Read+Update row postdates the packet's fold. Options: (a) add it to
`receiptProblemCode` and the receipt-context list, since a Bead creation
in a batch whose supplied `id` is a live alias path raises it whatever
T49 decides; (b) omit it until T49. Recommendation: (a). Applied
provisionally.

**T52 — Shape of `transactionalAdvertisedLimits`.** The packet composed
`allOf: [advertisedLimits]` and rejected `retention.idempotency`; the
sealed `advertisedLimits` closes without a `validation` group, so that
composition would reject the group X6 requires. Options: (a) a closed
definition of its own on the shared primitives, as
`readUpdateAdvertisedLimits` is — the six shared groups and `transaction`
copied from `advertisedLimits`, `validation` from
`readUpdateAdvertisedLimits`, and a `retention` group of `receipt`,
`maximumSnapshotLifetime`, and `replay`; (b) `allOf` over the sealed
definition plus `validation` (rejected by closure). Recommendation: (a),
with the lockstep test asserting the copied groups stay equal. Applied
provisionally.

**T53 — The alias entries in `transactionalOperationDirectory`.** The
specification's Transactional listing already carries `put-alias` and
`delete-alias` (#19: the profile inherits the targets). Options: (a) the
bundle definition pins twelve entries, `putAlias` and `deleteAlias`
included; (b) ten entries until T49. Recommendation: (a), because the
directory advertises what the Scope offers and the targets are offered;
what they return is T49. Applied provisionally.

**T54 — `binding-unavailable` as a receipt code.** The packet made
`binding-unavailable` a projection-only code while saying a dependent
member whose creator's receipt is `failed` "fails with
`binding-unavailable`, retained"; on a Transactional Scope that member
was admitted with a pending receipt and must reach a terminal one.
Options: (a) add `binding-unavailable` (`400`) to `receiptProblemCode`: the
member's own `failed` receipt carries it, and its projection is that
problem; (b) leave the member's receipt undefined; (c) not admit a
dependent until its creator terminalizes (contradicts the linearizable
admission claim of D26). Recommendation: (a). Applied provisionally.

**T55 — Transient dependents and their admitted keys.** The packet said a
member whose creator is pending or transient "claims no key", although
admission recorded a pending receipt for every unknown key before any
member ran. Options: (a) the text now says the member "holds no key": a
pending receipt recorded for it at admission is retracted and its key
unbound, as after a transient abort, which is Read+Update's released
claim in Transactional terms; (b) admit dependents lazily after their
creators terminalize. Recommendation: (a). Applied provisionally.

**T56 — T44 without #23's text on this branch.** #23 (branch
`janet-numeric-model`) carries the number model under *Revisions* and is
absent here. Options: (a) one forward-reference sentence in the protocol
section's introduction citing *Revisions* and gastownhall/bdp#23, the
erasure digest paragraph citing the number model rather than restating
I-JSON, and the pre-admission list saying "a body that is not well-formed
JSON" rather than "not an I-JSON text", since under #23 an inadmissible
number literal is `validation-failed`, not `malformed-request`; (b) paste
the packet's I-JSON paragraph (contradicts #23's failure code and
restates what #23 states). Recommendation: (a). The initial apply omitted the string and duplicate-member rules. **Amended
2026-09-08, council 13:** the protocol introduction restores those T44
rules independently of the number model: Unicode scalar strings and
member names, no duplicate names after escape decoding, string/object
violations `malformed-request`; inadmissible numbers remain
`validation-failed` under #23. Adapters map or refuse out-of-contract
stored values before serving them. This corrects the dropped portion of
ratified T44 rather than introducing a second numeric model. Ratification
of the amended T56 remains pending.

**T57 — Digest vectors without an RFC 8785 serializer.** No JCS
implementation exists in the repository or its installed `node_modules`,
and no dependency was added. Options: (a) the lockstep test recomputes
SHA-256 over each vector's recorded serialization, checks that the
serialization parses to the record with member names in UTF-16 code-unit
order at every level, and cross-checks the erasure digests the fixtures
serve against the vectors — the canonicalization step itself is not
recomputed; (b) a hand-rolled canonicalizer in the test (for I-JSON
values, `JSON.stringify` over recursively sorted members is RFC 8785);
(c) a dependency. Recommendation: (a) now, recorded as a known gap in
`STATUS.md` and section 7; (b) is the cheapest closure if the operator
wants the canonicalization recomputed. Applied provisionally.

**T58 — Where T34's duration rule lives.** T34 (ruled) decided that
exceeding `transaction.duration` is permanent, but the packet's paste set
carried it only as decision text. Options: (a) one sentence under
*Mutation Receipt responses* beside the `limit` rule, so row
`transactional.batch.duration-limit` cites the specification; (b) leave
the row citing decision text (rows cite the specification). Recommendation:
(a). Applied provisionally.

**T59 — The snapshot example's closed projection.** T30 makes a snapshot
whose Link's in-Scope endpoint is absent invalid, and the draft's example
carried `assigned-to-81` to `person-7` with no `person-7` Bead. Options:
(a) add the required `erasures: []` and a `person-7` Bead record to the
example; (b) replace the Link with the packet's `blocks-3` → `task-41`
pair. Recommendation: (a), keeping the Link the rest of the draft uses.
Applied provisionally.

**T60 — Scope of the token-profile paragraph.** The packet's sentence
listed epochs, views, positions, transaction identifiers, receipt tokens,
and keys together in a cross-cutting section Read shares. Options: (a)
scope it — "In the Transactional profile, … as idempotency keys do in
every write profile" — so Read text gains no Transactional obligation and
the row cites the scoped wording; (b) the unscoped sentence.
Recommendation: (a). Applied provisionally.

**T61 — The one-element `results` sentence.** After council 12 delimited
the singleton paragraph to the six Resource targets, "a one-element
`results` array" is exact for them. Options: (a) keep the council 12
sentence and append the set-target clause; (b) replace it as the packet
proposed. Recommendation: (a). Applied provisionally.

### Proposed and not applied

- The original T44 numeric wording (T56): a forward reference instead. Council 13 restores its string/object rules separately; see amended T56.
- The sixth receipt representation, `failed` with `detail: expired`, and
  every sentence, fixture, and row built on the epoch-lifetime law for
  failed receipts (T47 ruled (b)): rewritten — the failed receipt is
  retained for at least `retention.receipt`, forgotten whole, its URL then
  `404`, its key then unknown; `idempotency-conflict` holds for as long as
  the key is bound; the X2 rationale names both retentions; rows
  `transactional.idempotency.failed-retained` and
  `transactional.idempotency.conflict` re-titled; a `404` for a forgotten
  failed receipt joins the matrix and the non-disclosure sentence; the
  fixtures show the forgotten receipt and its key executing as new.
- The packet's `deleted: resourceIdentity` on receipt entries (X1 ruled B):
  `deletedIdentity`.
- The packet's `transactionalAdvertisedLimits` composition (T52) and its
  ten-entry directory (T53); the discovery fixture without `aliases`
  (D37 requires it).
- The T46 amendment of the Read-era `page.*` bullet: applied as the
  packet's own appended Transactional paragraph under *Advertised limits*
  instead, so the Read bullet is untouched.
- The packet's `transactional.discovery.operation-directory` title ("ten
  targets"): twelve.
- Appendix A's "125 definitions": the bundle holds 135 (83 at the merge
  base plus 52).
- Section 7's first three residuals are resolved by this apply (X1 on
  both sides, `retires`, `date-time`); the rest stand, with the additions
  recorded there.


## Council 13 — apply review and correction pass (2026-09-08)

Reviewed apply head `ce8399c785a85e30d0d7aad78c49ea76538bde45` against main
`0b7d86e7cfec47f88cd1ec22314a73f39763bcf8`. The review record and per-finding
status are in [Council 13](w1-transactional-council13.md). The council is
incomplete while a reviewer is unavailable; this section claims no clearance.
Corrections to ruled sentences carry dated council-13 markers. T49 and
T50–T61 remain open/provisional as recorded above; T56 now includes the
restored string/object admission law. New T62 below is unapplied.

### T62 — Sequence dependency identity at atomic admission (OPEN)

**Context.** D26 requires one linearizable admission that claims all unknown
member keys before execution. The Transactional text durably records every
member's normalized identity and pending receipt at that step. But the
identity of a dependent member resolves a creation label to its creator's
committed Resource identity, which does not exist yet for an authority-allocated
creation. A failed creator supplies no Resource identity at all. A singleton
retry using the dependent's key must still share the carrier-neutral namespace.
The current text cannot satisfy these rules together; green shape tests do not
prove an implementable admission state machine.

**Options and consequences.**

1. Preserve atomic reservation of all member keys, but specify a durable
   unresolved dependency form tied to the creator's key and owned execution,
   with an atomic transition to the normalized Resource identity when the
   creator terminalizes. Define how duplicate carriers are compared before
   resolution, how a failed creator terminalizes its dependent's retained
   failure, and how crash/retraction releases reservations without allowing a
   stale owner to commit. This keeps D26 but adds an explicit internal state
   and observable retry rules; no new public receipt state should be inferred.
2. Preplan creation identities during admission and normalize dependents to
   those prospective URLs. This needs a precise distinction between a planned
   URL and a durably allocated identity, failed-creator semantics, and recovery
   rules. It changes the timing described by the current allocation text.
3. Admit a dependent only after its creator terminalizes. This is simpler but
   explicitly amends D26's all-member admission law and T54/T55; it must not be
   smuggled in as a wording correction.

**Recommendation.** Work out option 1 while preserving the ruled carrier-neutral
identity and all-member reservation guarantees. This recommendation does not
select its missing duplicate-response contract. The final ruling must specify
same-template and canonical-singleton retries both before and after binding,
failed/transient creators, restart and stale-owner commits. Add observable
cases for each before any write-profile realization can claim this behavior.

**Owning destinations.** Mutation Transactions; Read+Update sequence admission
and idempotency; corresponding catalog obligations and future executable
sequence-admission tests. No wire or normative change is applied for T62 yet.


### T63 — Withheld allocation in a sequence projection (OPEN)

**Context.** A completed creation's compact receipt retains its committed
identity, including a client-supplied ID. A current view can receive that
receipt's allocated entry as `withheld: true`. The sequence projection
previously specified only `allocated: { id, type }`, leaving both its
schema and the withheld case undefined. Council 13 adds the typed disclosed
form and a Transactional sequence envelope without changing the83 inherited
Read+Update definitions; `resource-erased` member pointers are also rejected.
The withheld form and its dependent-member behavior remain unapplied.

**Options.** (a) Project `idempotency-expired` with
`allocated: { withheld: true }` when the creation identity is withheld.
The authority can still resolve a later label from its retained execution
record internally; every dependent undergoes ordinary current authorization
and exposes no hidden identity through its result. This parallels receipt
projection but adds an explicit sequence union and its authorization cases.
(b) Project `forbidden` for the creator and skip its dependents with transient
`forbidden` projections, releasing their new reservations. This is simpler
on the wire but couples replay progress to disclosure of a retained identity.

**Recommendation.** (a), preserving the distinction between retained execution
identity and what the current response may disclose. Coordinate reservation
and retry behavior with T62. The complete ruling must cover granted/revoked
views, retries from other carriers, and a dependent that is independently
unauthorized. No withheld allocation shape is applied yet.

### T64 — Erasure delivery to an already connected stream (OPEN)

**Context.** Ruled T28 expires every checkpoint/snapshot before erasure position
P. Finite reads and reconnects from older checkpoints therefore recover through
a new snapshot's permanent erasure ledger. The spec still calls the changefeed
the vehicle carrying each erasure and requires onward delivery, but does not say
how an already connected SSE stream crosses the commit at P. Correcting the
finite examples exposes this missing live-delivery contract; it does not
invalidate T28 or prove that a finite replay may include the erased group.

**Options.** (a) An already admitted, caught-up live stream delivers the complete
erasure group as the atomic publication at P and advances its stream cursor;
a stream lagging behind the immediately preceding head, any new finite read,
or any reconnect still follows T28 and resnapshots. This requires explicit
publication/fencing order and live/disconnect race tests, without serving
pre-erasure content after the fence. (b) Fence live streams too and deliver
erasure records only through snapshot manifests. This is simpler to implement
but makes every erasure restart replication, and requires narrowing the
changefeed/onward-delivery prose and reconciling the now-unobservable erasure
member of served groups.

**Recommendation.** (a), with an explicit caught-up-stream rule; no one-group
exception for a new finite request. The law and fixtures must distinguish an
existing admitted stream from a new request presenting an expired checkpoint.
This delivery choice is unapplied pending Donna's ruling.


## Council 13 — AFK correction fold (2026-09-08)

The independent Claude review of `1eef4e4` found four Medium and two Low
issues. Their dispositions are recorded in [Council 13](w1-transactional-council13.md).
This correction implements no choice from T49/T62/T63/T64, and T50–T61
remain provisional. The live-successor catalog row now matches the existing
property-versus-owned-Link delta law. The owned-Link erasure example explicitly
uses an independent hypothetical history with distinct epoch/view and opaque
position/checkpoint tokens; it does not restore or follow the acme timeline.
The main receipt's five entries fit its advertised bound and are all inline;
pagination is illustrated in a separate canonical Scope advertising a
three-entry maximum. These examples and their consistency checks are not
write runtime or conformance evidence.

**T56 integration obligation, pending ratification.** Preserve the all-profile
Unicode-scalar and decoded-member-uniqueness law. The Transactional catalog
records its obligation, but the inherited Read+Update catalog has no counterpart.
When #19 and this branch reconcile, carry a corresponding Read+Update admission
obligation into the combined catalog and cover both invalid strings and duplicate
decoded member names. This is a recorded downstream obligation, not a new row,
new catalog ruling, or an inferred change to the sealed Read catalog. T56's
ratification and integration must settle its lower-profile catalog coverage;
the all-profile normative law is not narrowed to hide the gap.


**T50 contextual validation note (2026-09-08, final council 13 review).**
The provisionally selected bare `erased` lineage marker contains no Resource
kind. A standalone schema therefore cannot infer whether its `source` and
`sourceRevision` pair is applicable. The existing receipt law still permits
that pair only for an operation on an owned Link, and the normative schema
boundary already leaves Resource kind and ownership contextual. A fixture
probe now checks the actual retained erasure response against its originating
batch and the reference domain's ownership declaration, rejecting the pair
for an erased Bead and requiring it for an erased owned Link. This does not
add a discriminator, alter the erasure shape, or ratify T50. Future receipt
realization must enforce the same context.


**Final council 13 mechanical clarifications (2026-09-08).** The independent
owned-Link erasure group now uses its own canonical Scope, not just an
independent epoch/view in acme; its two before-record digests were recomputed.
Its narrated administrative writer supplies the new versions' displayed
attribution. Existing per-version claimed semantics and Event/postimage
agreement apply to those recorded values; this is not an administrative
attribution policy or a new API/ruling. Consistent absence of attribution
remains valid. An available receipt may not end with no result entries;
the schema now rejects results [] with next null, while preserving the
unruled latitude of an empty continued prefix. This does not revise any of
T49/T62/T63/T64 or ratify T50–T61.

**Inherited RU catalog integration audit.** Claude observed title wording
differences between 77 of 78 inherited RU catalog rows and the normative
RU table. Wording inequality alone does not prove semantic disagreement.
During #19 integration, audit each cited obligation and reconcile actual
semantic drift; separately decide whether to adopt exact title equality
as the RU authoring convention. No inherited catalog, definition, or ruling
was changed by this Transactional correction.
