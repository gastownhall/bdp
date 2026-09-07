# W1 Transactional packet: wire artifacts for the Transactional profile

Status: design packet, non-normative until applied. Workstream W1, second
half. Base: `gastownhall/bdp` at `0b7d86e7` (`docs/specs/bdp.md` and
`schemas/bdp-v0.schema.json` as of that commit).

This packet proposes, for the Transactional profile, the normative text, the
JSON Schema 2020-12 definitions, the fixtures, and the conformance rows that
the draft says are still missing, and it numbers every judgment call as a
DECISION (T1 through T23) for the operator to rule. Nothing here is a
conformance claim. Nothing here changes the draft until it is applied: the
packet is applied after the Read+Update wire artifacts (the first half of W1,
branch `janet-w1-read-update-wire`) land, and every rule the two halves must
share is marked **shared** and stated as a DECISION for both halves.

## How to read this packet

- "Proposed normative text" blocks are written in the specification's voice,
  ready to paste, and each names the section of `docs/specs/bdp.md` it lands
  in. RFC 2119 capitals are used only where the pasted text is normative.
- Schema blocks preceded by `<!-- bundle-defs -->` are `$defs` entries ready
  to paste into `schemas/bdp-v0.schema.json`. They follow the bundle's
  conventions: every protocol-owned envelope is closed, `properties` stays
  open, Type IDs and navigation URLs are `absoluteHttpUrl`, and the
  identifier grammar is a pattern rather than a `format` assertion.
- Fixture blocks preceded by `<!-- fixture: <definition> -->` are examples
  that validate against the named definition once the definitions are
  assembled with the current bundle. Blocks preceded by
  `<!-- fixture-invalid: <definition> -->` are examples the definition must
  reject. The packet's sanity script (kept outside the repository) assembles
  the tagged blocks, compiles them with the repository's strict Ajv settings,
  and checks both kinds; its results are in the delivery report, not here.
- Conformance rows follow the shape of
  `packages/conformance/catalog/read-v1.json` and are grouped by the coverage
  categories that open question 13 names. Every row is unclaimed. A row that
  cites this packet cites text that moves into the specification when the
  packet is applied; its anchor is re-pointed at that time.
- Vocabulary follows `CONTEXT.md`: a Reference is a URI or a Pinned
  Reference `{ uri, revision }`; the bundle is the normative schema bundle;
  protocol identifiers are compared, never dereferenced.

Alignment with the Read+Update half: at the time of writing,
`janet-w1-read-update-wire` carries no change over the base commit, so there
is no sibling text to contradict yet. Where the halves must agree, this
packet states the rule as a shared DECISION and names the member spellings it
assumes — `operationIndex` and `operationName` (already fixed by the draft's
sequence-member problem rule), `sourceRevision`, the idempotency-key grammar,
the mutation problem codes, and the operation-record definition names. If the
Read+Update half lands different spellings, the spellings in this packet are
re-pointed at apply time; the semantics are the DECISION, not the spelling.

## Summary

| Packet item | Definitions added to the bundle | Decisions |
| --- | --- | --- |
| 1. Owned-Link delta member | `wireToken`, `revision`, `dateTime`, `resourceKind`, `resourceIdentity`, `typedLinkReference`, `propertyChange`, `createdData`, `ownedLinkChange`, `updatedData`, `deletedData`, `linkDeltaData`, `eventType`, `event`, `eventPage` | T1–T4 |
| 2. Batch envelopes | `localLabel`, `suppliedIdentity`, `mutationResourceReference`, `mutationPinnedReference`, `mutationReference`, `selector`, `cardinality`, eight `*Operation` records, `batchOperation`, `batchRequest`, `transactionalOperationDirectory` | T5–T6 |
| 3. Mutation Receipts and the Transactional problem table | `idempotencyKey`, `receiptStatus`, `receiptDetail`, `receiptResult`, `receiptCore`, `mutationReceipt`, `mutationReceiptPage`, `mutationProblemCode`, `transactionalProblemCode`, `problemDiagnostic`, `problemCodeRows`, `transactionalProblem`, `receiptProblem` | T7–T11 |
| 4. Transaction-level idempotency | (text only; `idempotencyKey` is defined under item 3) | T12–T15 |
| 5. Version erasure on the changefeed | `stateChange`, `erasureDigest`, `erasureRecord`, `changeGroup`, `changefeedPage`, `snapshotManifest`, `transactionalDiscovery` | T16–T20 |
| 6. Conformance rows | 38 unclaimed Transactional rows in catalog shape | T21 |
| 7. What is still not enough | — | — |
| Shared-shape rules with Read+Update | — | T22–T23 |

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
transition, and that a source's properties change and its owned-Link change
never share an Event, because no single operation produces both.

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
  link: LinkState                // created, updated: the owned Link's complete record
      | ResourceIdentity         // deleted: id, type, and final live revision
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
operation changes both a Bead's `properties` and one of its owned Links, and every owned-Link
mutation mints its own source version, so a Mutation Transaction that
changes both — or that changes two owned Links of one source — produces one
`updated` Event per transition, each with its own `previousRevision` and
`revision`, in operation order.

`ownedLink.operation` names the transition. For `created` and `updated`,
`ownedLink.link` is the owned Link's complete record: exactly the record the
Link serves at its own URL after the transition, so its `revision` is the
Link's fresh revision and its `attribution`, when present, is the Link's
own. For `deleted`, `ownedLink.link` is the deleted Link's identity — `id`,
`type`, and its final live `revision` — because deletion mints no Link
version and a deleted Event does not retain properties. `previousRevision`
and `revision` are the source Bead's. `attribution`, when present, is the
source's new version's carried attribution. An operation that mints both a
Link version and a source version records its one attribution on both, so a
`created` or `updated` delta whose Link record carries `attribution` carries
the same value at the Event level, and a delta whose Link record carries
none carries none.

`CreatedData` and `DeletedData` carry no owned-Link data. A Bead is created
with an empty owned set for every Link Type its Type owns, and the record's
empty `ownedLinks` entries follow from the Type Descriptor rather than from
the Event. A Bead with a live owned Link cannot be deleted, so a `deleted`
Bead Event never has owned Links to report.

A source Bead's owned-Link `updated` Event is in addition to, not instead
of, the facts the Link mutation already induces: the Link's own `created`,
`updated`, or `deleted` fact, and the `linked` or `unlinked` fact at each
in-Scope endpoint, including the source itself. Within a change group, the
facts induced by one owned-Link operation are ordered: the Link's lifecycle
fact first, then the graph facts at its in-Scope endpoints, source before
target, then the source's `updated` fact last. A Bead-scoped Event Source
for an owning source therefore reports an owned Link's property change
twice, under two subjects: once as the incident Link's `updated` fact and
once as the source's own `updated` fact carrying the delta.

A no-op owned-Link property update — one whose patch yields `properties`
equal, under the RFC 6902 Section 4.6 comparison, to the value immediately
before it — retains the Link's revision and emits no Event, and it does not
version the source: there is no transition for the source's version to
cover.

Target: "Event replay and live observation". Replace the `updated` bullet
with the following.

- `updated` carries `previousRevision`, `revision`, exactly one of `change`
  and `ownedLink`, and the new version's `attribution` when one was
  recorded. `change` uses the same committed Property Change representation
  accepted by singleton DML. `ownedLink` carries one owned-Link transition
  of the source Bead: `operation` is `created`, `updated`, or `deleted`, and
  `link` is the owned Link's complete record for the first two and its
  identity — `id`, `type`, and final live `revision` — for the third.

Target: "Events and Event Sources", after the paragraph above. Applying the
delta.

A consumer that holds the source's record at `previousRevision` advances it
to `revision` by applying `ownedLink` to the entry keyed by `link.type` in
the record's `ownedLinks` member: for `created`, inserting `link` in
ascending code-unit order of `id`; for `updated`, replacing the entry whose
`id` equals `link.id`; for `deleted`, removing the entry whose `id` equals
`link.id`; then setting the record's `revision` to the Event's `revision`
and its `attribution` to the Event's `attribution`, removing the member
when the Event carries none. A consumer whose held revision is not
`previousRevision` is not positioned to apply the delta; it re-reads the
record or resumes from a snapshot. Replicas do not need the delta at all:
the containing change group's `changes` member carries the source Bead's
complete postimage, `ownedLinks` inline, beside the Link's own postimage or
tombstone.

Target: "Change groups and replication", after "Multiple operations on one
Resource normalize to its final projected postimage or tombstone."

An owned-Link mutation changes the state of two Resources, so a group's
`changes` carries both: the owned Link's postimage or tombstone, and the
source Bead's postimage at its fresh revision with the owned set inline.

### 1.2 Proposed schema

These definitions add the Event surface to the bundle. `wireToken` is the
Event-ID and checkpoint character profile the draft already fixes; T15
extends it to the other history tokens. `revision` restates the bundle's
existing inline `{ "type": "string", "minLength": 1 }` so that later
definitions can reference one name; the existing record definitions keep
their inline spelling until a separate cleanup. `dateTime` is an RFC 3339
pattern rather than a `format` assertion, because the repository's schema
validator registers only the `uri` format.

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
    "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$"
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
  "propertyChange": {
    "type": "array",
    "minItems": 1,
    "items": {
      "oneOf": [
        {
          "type": "object",
          "required": ["op", "path", "value"],
          "properties": {
            "op": { "enum": ["add", "replace"] },
            "path": { "type": "string" },
            "value": true
          },
          "additionalProperties": false
        },
        {
          "type": "object",
          "required": ["op", "path"],
          "properties": {
            "op": { "const": "remove" },
            "path": { "type": "string" }
          },
          "additionalProperties": false
        }
      ]
    }
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
          "properties": { "operation": { "enum": ["created", "updated"] } },
          "required": ["operation"]
        },
        "then": {
          "properties": { "link": { "$ref": "#/$defs/linkRecord" } }
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

A finite read of the same Bead-scoped Event Source later, after the owned
Link was deleted. Deletion mints no Link version and the source's new
version carries the attribution supplied to the deletion; the delta carries
the deleted Link's identity only.

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

### 1.4 Decisions

**T1 — Shape of the owned-Link delta.**
Context: the draft requires an `updated` Event on the source with its fresh
revision but leaves the delta member undefined. Options: (a) a singular
`ownedLink { operation, link }` carrying exactly one transition, exclusive
with `change`; (b) an object keyed by owned Link Type URL mirroring the
record's `ownedLinks` member, with `created`, `updated`, and `deleted`
arrays, so one Event can carry several transitions; (c) the complete
post-transition `ownedLinks` member as a snapshot. Tradeoffs: (b) contradicts
one version per owned-Link mutation and forces consumers to reconcile
several revisions inside one Event; (c) contradicts "Event data contains
deltas rather than Resource snapshots" and grows with the owned set's `max`;
(a) is bounded, applies in one step, and needs no new ordering rule inside an
Event. Recommendation: (a).

**T2 — Payload of a `deleted` owned-Link transition.**
Options: (a) the deleted Link's identity `{ id, type, revision }`, with
`revision` the final live revision; (b) the Link's complete last record;
(c) `id` alone. Tradeoffs: (b) makes a deletion carry properties, contrary
to "Deleted Events do not retain the Resource's properties"; (c) drops the
`type` a consumer needs to find the entry without a lookup. Recommendation:
(a), which also matches the changefeed tombstone's identity shape (T17).

**T3 — Ordinal order of the facts one owned-Link operation induces.**
Options: (a) the Link's lifecycle fact, then the graph facts at in-Scope
endpoints (source before target), then the source's `updated` fact last;
(b) the source's `updated` fact first; (c) authority-chosen order.
Tradeoffs: (c) makes ordinal assertions non-portable and prevents a
cross-implementation row; (a) lets a consumer observe the Link before the
version that covers it, which is the order a reader of the record would
reconstruct. Recommendation: (a).

**T4 — No-op owned-Link updates; creation and deletion deltas.**
Options: (a) a no-op owned-Link property update versions neither the Link nor
the source, and `CreatedData`/`DeletedData` carry no owned-Link data; (b) the
source is versioned by every owned-Link request even when the Link is
unchanged. Tradeoffs: (b) contradicts the operation-local no-op rule and
would emit a source `updated` Event with nothing to carry. Recommendation:
(a).

## 2. Batch envelopes

The draft fixes the batch target, its `Idempotency-Key` field, the
transaction-local label rules, and reference normalization, and it previews
the eight-record operation union as a non-normative sketch. It leaves the
request envelope, the request-side reference grammar, the pre-admission
failure set, and the exact HTTP statuses unassigned. This section assigns
them. The failed-receipt shape that identifies the failing operation is
defined with receipts under section 3.

### 2.1 Proposed normative text

Target: "Batch operation target". Append after the paragraph ending
"Operation order, array order, member presence, and JSON values remain
semantic."

A batch request body conforms to the bundle's `batchRequest` definition:
exactly one member, `operations`, an array of one or more operation records,
each conforming to `batchOperation` — the closed eight-record union whose
`operation` discriminator selects `createBead`, `updateBeadProperties`,
`deleteBead`, `createLink`, `updateLinkProperties`, `deleteLink`,
`updateWhere`, or `deleteWhere`. Every record is closed. A body-level
`idempotencyKey`, a per-operation `idempotencyKey`, or any other undefined
member makes the request malformed. The `Idempotency-Key` HTTP field is
required and follows the grammar under
[Transaction-level idempotency](#4-transaction-level-idempotency); a request
that carries no such field, more than one, or a value outside the grammar is
malformed.

Reference members of operation records — `bead`, `link`, and the `uri` of a
Pinned Reference — accept a canonical local ID, an absolute canonical
Resource URL, or, in a batch, an `@label`; `source` and `target`
additionally accept an absolute out-of-Scope URI. A creation record's `id`
accepts a canonical local ID or an absolute canonical URL and never an
`@label`; a local ID whose first character is `@` is supplied as its
absolute URL. A Pinned Reference whose `uri` is an `@label` is accepted: the
authority resolves the `uri` to the allocated canonical URL and stores and
echoes the `revision` byte-identically, applying no semantic validation to
it, exactly as for every other pin.

Before admission, the authority validates the carrier and every record
against the bundle, resolves and kind-checks labels, and normalizes durable
references. A malformed body; an absent, repeated, or invalid
`Idempotency-Key`; a forward, unknown, or duplicate label; a label used
where the other Resource kind is required; a noncanonical local ID
spelling; or a supplied `id` beneath the wrong fixed root is rejected before
admission with a direct `400` `malformed-request` problem that creates no
receipt. The problem SHOULD carry `pointer`, an RFC 6901 JSON Pointer into
the request body naming the offending member. A request whose `operations`
count exceeds an advertised `transaction.operations` is rejected before
admission with `413` `limit-exceeded`, and a body larger than an advertised
`request.bodyBytes` with `413` `request-too-large`. An unauthenticated
request receives `401` `unauthenticated`, and a request whose principal may
not submit mutations to the Scope receives `403` `forbidden`; both are direct
problems. An `Idempotency-Key` already bound — for this Scope, epoch, and
principal — to a different normalized request is rejected with a direct
`409` `idempotency-conflict` problem, and the earlier request's outcome is
unaffected.

A request is admitted when the authority has durably recorded the key, the
normalized request identity, and a `pending` Mutation Receipt. From that
point client disconnection does not decide the outcome, every response to
that request or to an identical retry is a Mutation Receipt representation,
and every failure after admission is reported inside the receipt rather than
as a direct problem.

The batch target's responses are:

- `200 OK` with the terminal Mutation Receipt, whose `status` is `completed`
  or `failed`. A failed transaction is a successful representation of its
  receipt; the HTTP status does not repeat the embedded problem's `status`,
  exactly as a syntactically admitted sequence returns `200 OK` around
  failed members.
- `202 Accepted` with the `pending` Mutation Receipt, for any request — the
  original submission or an identical duplicate — that the authority answers
  before the transaction is terminal. The response SHOULD carry
  `Retry-After` and MAY carry `Location` equal to the receipt's `id`. The
  client waits, repeats the original request, or reads the receipt until it
  is terminal.
- A direct problem, from the list above, for a request that is never
  admitted.

Receipt representations use `Content-Type: application/json`,
`Cache-Control: private, no-store`, and the three Transactional response
fields; on a terminal receipt `BDP-Scope-Position` equals `requiredPosition`.
A batch target answers every method other than `POST` with
`405 Method Not Allowed`, `Allow: POST` — plus `OPTIONS` when cross-origin
access is enabled — and no BDP Problem body. Singleton operation targets on
a Transactional Scope use exactly these statuses and rules; their bodies
omit `operation` and `name` and cannot use `@label` references.

Target: "Operation record schema". Replace "The following non-normative
sketch previews the eight-record Transactional union. The sketch has no
independent `$id`." with: "The bundle's `batchOperation` definition is the
normative eight-record union; the sketch below is a non-normative preview of
it and carries no independent `$id`."

### 2.2 Proposed schema

Request-side references have their own definitions because the bundle's
`reference` and `pinnedReference` require an absolute URI: a request may
spell an in-Scope reference as a local ID or an `@label`, and the authority
canonicalizes it before storing it. The label grammar, the kind checks, and
the forward-reference rule are semantic and are enforced before admission;
the schema enforces closure and the `@`-free spelling of a supplied `id`.

<!-- bundle-defs -->
```json
{
  "localLabel": {
    "type": "string",
    "pattern": "^[A-Za-z][A-Za-z0-9_-]*$"
  },
  "suppliedIdentity": {
    "type": "string",
    "minLength": 1,
    "pattern": "^[^@]"
  },
  "mutationResourceReference": {
    "type": "string",
    "minLength": 1
  },
  "mutationPinnedReference": {
    "type": "object",
    "required": ["uri", "revision"],
    "properties": {
      "uri": { "$ref": "#/$defs/mutationResourceReference" },
      "revision": { "$ref": "#/$defs/revision" }
    },
    "additionalProperties": false
  },
  "mutationReference": {
    "oneOf": [
      { "$ref": "#/$defs/mutationResourceReference" },
      { "$ref": "#/$defs/mutationPinnedReference" }
    ]
  },
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
  "createBeadOperation": {
    "type": "object",
    "required": ["operation", "type"],
    "properties": {
      "operation": { "const": "createBead" },
      "name": { "$ref": "#/$defs/localLabel" },
      "id": { "$ref": "#/$defs/suppliedIdentity" },
      "type": { "$ref": "#/$defs/absoluteHttpUrl" },
      "properties": { "$ref": "#/$defs/properties" },
      "attribution": { "$ref": "#/$defs/attribution" }
    },
    "additionalProperties": false
  },
  "updateBeadPropertiesOperation": {
    "type": "object",
    "required": ["operation", "bead", "change"],
    "properties": {
      "operation": { "const": "updateBeadProperties" },
      "bead": { "$ref": "#/$defs/mutationResourceReference" },
      "change": { "$ref": "#/$defs/propertyChange" },
      "expectedRevision": { "$ref": "#/$defs/revision" },
      "attribution": { "$ref": "#/$defs/attribution" }
    },
    "additionalProperties": false
  },
  "deleteBeadOperation": {
    "type": "object",
    "required": ["operation", "bead"],
    "properties": {
      "operation": { "const": "deleteBead" },
      "bead": { "$ref": "#/$defs/mutationResourceReference" },
      "expectedRevision": { "$ref": "#/$defs/revision" }
    },
    "additionalProperties": false
  },
  "createLinkOperation": {
    "type": "object",
    "required": ["operation", "type", "source", "target"],
    "properties": {
      "operation": { "const": "createLink" },
      "name": { "$ref": "#/$defs/localLabel" },
      "id": { "$ref": "#/$defs/suppliedIdentity" },
      "type": { "$ref": "#/$defs/absoluteHttpUrl" },
      "source": { "$ref": "#/$defs/mutationReference" },
      "target": { "$ref": "#/$defs/mutationReference" },
      "properties": { "$ref": "#/$defs/properties" },
      "attribution": { "$ref": "#/$defs/attribution" }
    },
    "additionalProperties": false
  },
  "updateLinkPropertiesOperation": {
    "type": "object",
    "required": ["operation", "link", "change"],
    "properties": {
      "operation": { "const": "updateLinkProperties" },
      "link": { "$ref": "#/$defs/mutationResourceReference" },
      "change": { "$ref": "#/$defs/propertyChange" },
      "expectedRevision": { "$ref": "#/$defs/revision" },
      "attribution": { "$ref": "#/$defs/attribution" }
    },
    "additionalProperties": false
  },
  "deleteLinkOperation": {
    "type": "object",
    "required": ["operation", "link"],
    "properties": {
      "operation": { "const": "deleteLink" },
      "link": { "$ref": "#/$defs/mutationResourceReference" },
      "expectedRevision": { "$ref": "#/$defs/revision" },
      "attribution": { "$ref": "#/$defs/attribution" }
    },
    "additionalProperties": false
  },
  "updateWhereOperation": {
    "type": "object",
    "required": ["operation", "collection", "selector", "change"],
    "properties": {
      "operation": { "const": "updateWhere" },
      "collection": { "enum": ["beads", "links"] },
      "selector": { "$ref": "#/$defs/selector" },
      "change": { "$ref": "#/$defs/propertyChange" },
      "cardinality": { "$ref": "#/$defs/cardinality" },
      "attribution": { "$ref": "#/$defs/attribution" }
    },
    "additionalProperties": false
  },
  "deleteWhereOperation": {
    "type": "object",
    "required": ["operation", "collection", "selector"],
    "properties": {
      "operation": { "const": "deleteWhere" },
      "collection": { "enum": ["beads", "links"] },
      "selector": { "$ref": "#/$defs/selector" },
      "cardinality": { "$ref": "#/$defs/cardinality" },
      "attribution": { "$ref": "#/$defs/attribution" }
    },
    "additionalProperties": false
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
    "title": "BDP batch request",
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
      "createBead": { "type": "string", "minLength": 1 },
      "updateBeadProperties": { "type": "string", "minLength": 1 },
      "deleteBead": { "type": "string", "minLength": 1 },
      "createLink": { "type": "string", "minLength": 1 },
      "updateLinkProperties": { "type": "string", "minLength": 1 },
      "deleteLink": { "type": "string", "minLength": 1 },
      "sequence": { "type": "string", "minLength": 1 },
      "updateWhere": { "type": "string", "minLength": 1 },
      "deleteWhere": { "type": "string", "minLength": 1 },
      "batch": { "type": "string", "minLength": 1 }
    },
    "additionalProperties": false
  }
}
```

### 2.3 Fixtures

A three-operation batch: a creator-supplied Decision identity, an owned
`cites` Link from it to an existing Task through the `@decision` label, and a
guarded update of that Task. The batch is submitted as
`POST /acme/operations/batch` with `Idempotency-Key: client-key-0001`.

<!-- fixture: batchRequest -->
```json
{
  "operations": [
    {
      "name": "decision",
      "operation": "createBead",
      "id": "beads/dec-9",
      "type": "https://work.example/types/decision",
      "properties": { "title": "Adopt owned Links", "status": "proposed" }
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
pinned external endpoint written the request-side way.

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
rejected in a batch; so is a supplied `id` spelled with a leading `@`.

<!-- fixture-invalid: batchRequest -->
```json
{
  "operations": [
    {
      "operation": "createBead",
      "idempotencyKey": "member-key-1",
      "id": "@not-a-label",
      "type": "https://work.example/types/task"
    }
  ]
}
```

### 2.4 Decisions

**T5 — Batch envelope and request-side reference grammar.**
Context: the draft's operation sketch is non-normative, uses `format: uri`
for Type IDs where the bundle uses `absoluteHttpUrl`, and lets a Pinned
Reference's `uri` be any nonempty string, which is right for requests and
wrong for the response-side `pinnedReference`. Sub-decisions: (a) the
request envelope is the closed `batchRequest` with the single `operations`
member, so body-level and per-operation keys are schema failures rather
than semantic ones; (b) request-side references get their own definitions
(`mutationResourceReference`, `mutationPinnedReference`,
`mutationReference`) distinct from the response-side `reference`; (c) a
Pinned Reference whose `uri` is an `@label` is accepted and echoed with the
allocated URL, applying the draft's one law for every pin, rather than
rejected as a pin on a not-yet-existing version; (d) a supplied `id` is
schema-constrained to not begin with `@`, which is the draft's rule made
mechanical; (e) **shared**: operation records are named `<operation>Operation`
in the bundle, and the Read+Update half names singleton request bodies
`<operation>Request` — the same members minus `operation` and `name` —
because JSON Schema cannot subtract members from a closed definition.
Alternatives: for (c), reject pins on labels with `malformed-request`
(adds semantic pin validation the draft forbids); for (e), one open
definition shared by both carriers (loses closure). Recommendation: (a)–(e)
as stated.

**T6 — HTTP statuses for the batch target.**
Sub-decisions: (a) `200 OK` for every terminal receipt, `failed` included;
alternatives are the failing operation's would-be status with a receipt body
(mixes a problem status with a non-problem media type and breaks the
one-shape rule for retries) or a fixed `422` for failed receipts (invents a
status the embedded problem already carries); (b) `202 Accepted` for any
request answered while the receipt is `pending`, not only for a
non-waiting duplicate as the draft's sentence literally says — a client
cannot tell whether it is "the original" after a retry, and disconnect
recovery needs the authority to be allowed to answer before commit;
(c) the pre-admission direct-problem set is closed to `400`
`malformed-request`, `401`, `403`, `409` `idempotency-conflict`, `413`
`limit-exceeded`/`request-too-large`, `429`, and `503`; every other failure
is a receipt failure; (d) `405` with `Allow: POST` (plus `OPTIONS` under
CORS) for other methods on mutation targets; (e) `Retry-After` SHOULD and
`Location` MAY accompany `202`. Recommendation: (a)–(e) as stated.

## 3. Mutation Receipts and the Transactional problem table

The draft fixes what a receipt records, that it is durable, principal-bound,
re-authorized on read, paginated for large set results, retained as a
compact tombstone after its detail expires, and returned unchanged to an
identical retry. It leaves the receipt schema, the `pending` and expired
representations, the result-entry model, the failed-receipt problem shape,
the receipt problem codes, and the receipt HTTP statuses unassigned. This
section assigns them.

### 3.1 Proposed normative text

Target: "Mutation Receipt responses". Replace the last paragraph's final
sentence, "Exact HTTP statuses and receipt problem schemas are not yet
assigned in this draft.", with the following.

Every admitted mutation has one Mutation Receipt at an authority-allocated
URL beneath the discovered `receipts` root — `receipts/{token}`, where the
token is a checkpoint-profile token — and the receipt's `id` is that
absolute URL. `GET` and `HEAD` of the receipt URL return the receipt's
current representation with `200 OK`, `Cache-Control: private, no-store`,
and the Transactional response fields. A receipt URL that does not exist,
that belongs to another principal, or that was allocated in another Scope
epoch returns the uniform `404` `resource-not-found`: receipts are
principal-bound, and they are not an enumeration oracle. The `receipts` root
itself is a namespace, not a collection; BDP v0 defines no receipt listing
and no lookup by key, and a `GET` of the root returns `404`
`resource-not-found`. A client resolves a lost response by retrying the
original request with its original key, which returns the receipt.

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
`detail` `expired`. It retains the receipt — the key, the normalized request
identity, and the disposition — for the rest of the Scope epoch, and an
identical retry after that returns the `expired` receipt with `200 OK` and
never executes the mutation again.

`results` is an ordered array of result entries. Each entry carries the
zero-based `operationIndex` of the operation that produced it and, when
that operation declared one, its `name`. A singleton operation produces
exactly one entry: `created` or `updated`, carrying `resourceKind` and the
complete postimage — the Resource's state immediately after that operation,
which a later operation in the same transaction may supersede — or
`deleted`, carrying `resourceKind` and the deleted Resource's identity:
`id`, `type`, and final live `revision`. An entry for an operation on an
owned Link additionally carries `sourceRevision`, the source Bead's
resulting revision. A set operation produces one `matched` entry carrying
`count`, the number of Resources it selected, followed by one `updated` or
`deleted` entry per selected Resource in the authority's selection order.
Entries appear in operation order. When every entry fits within the
advertised bound, `results` holds them all and `next` is `null`; otherwise
`results` holds a prefix and `next` is an absolute URL whose `GET` returns a
`mutationReceiptPage` — `receipt`, the receipt's `id`; `results`, the next
entries; and `next`. Pages are immutable and never split an entry. After the
receipt's detail expires, a page URL returns `410` `cursor-expired`.

Every later read re-authorizes the detail under the caller's current view.
An entry whose Resource is no longer visible is served as a `withheld` entry
carrying only `operationIndex` and, when present, `name`; when no detail may
be served, the receipt carries `detail` `withheld` and neither `results`,
`next`, nor `problem`. The disposition, `requiredPosition`, and
`effectPosition` are never withheld.

A `failed` receipt's `problem` is a Problem Details object of the receipt
form. It carries the code's `status` — the HTTP status the failure would
have had as a direct response, required because the enclosing status is
`200 OK` — its `operationIndex`, its `operationName` when the failing
operation declared one, and, when the authority can locate the cause within
the operation record, `pointer`, an RFC 6901 JSON Pointer relative to that
record. A `limit-exceeded` problem SHOULD carry `limit`, the dotted name of
the crossed limit under `limits`. A `validation-failed` problem carries
`diagnostics`, a bounded array of `{ message, typeId?, schemaLocation?,
pointer? }` entries identifying the failing effective Type and schema
location.

### 3.2 Transactional problem table

Target: "Problem details". Append after "Mutation-only dispositions and
problem codes are defined with their profiles rather than in the Read
table."

The Transactional profile uses the Read table plus the following closed
table. A *direct* code occurs only as a direct problem response. A
*receipt* code occurs only inside a `failed` Mutation Receipt, where the
problem carries the code's `status` as the failure's would-be direct
status.

| Code | Family suffix | HTTP status | Retry | Where |
| --- | --- | --- | --- | --- |
| `idempotency-conflict` | `conflict` | 409 | `never` | direct |
| `revision-mismatch` | `conflict` | 409 | `after-state-change` | receipt |
| `identity-conflict` | `conflict` | 409 | `never` | receipt |
| `incident-links-exist` | `conflict` | 409 | `after-state-change` | receipt |
| `cardinality-violated` | `conflict` | 409 | `after-state-change` | receipt |
| `constraint-violated` | `conflict` | 409 | `after-state-change` | receipt |
| `validation-failed` | `validation` | 422 | `never` | receipt |
| `patch-failed` | `validation` | 422 | `after-state-change` | receipt |
| `type-not-installed` | `validation` | 422 | `after-state-change` | receipt |
| `event-history-expired` | `gone` | 410 | `never` | direct |
| `catch-up-timeout` | `unavailable` | 503 | `after-delay` | direct |

The codes mean:

- `idempotency-conflict` — the `Idempotency-Key` is bound, for this Scope,
  epoch, and principal, to a different normalized request;
- `revision-mismatch` — `expectedRevision` differs from the Resource's
  revision when the operation is reached;
- `identity-conflict` — a supplied `id` was previously committed in the
  logical Scope;
- `incident-links-exist` — `deleteBead` was reached while a live Link is
  incident upon the Bead;
- `cardinality-violated` — a set operation's matched count is outside its
  `cardinality`;
- `constraint-violated` — a Scope aggregate constraint, an owned set's
  `max`, or another Scope invariant would be violated; the problem may be
  non-disclosing when hidden state caused it;
- `validation-failed` — the resulting `properties` or an in-Scope endpoint
  fails an effective Type contract, or an out-of-Scope endpoint violates
  the Link Type's external-endpoint policy;
- `patch-failed` — the Property Change cannot be applied: a `replace` or
  `remove` target does not exist, a pointer cannot be evaluated, or the
  result is not a JSON object;
- `type-not-installed` — the named Type's contract closure is not
  installed;
- `event-history-expired` — an Event Source's history aged out of the
  retention window, disclosed only to a principal authorized for that
  subject's retained history, under
  [Reads after deletion](../specs/bdp.md#reads-after-deletion);
- `catch-up-timeout` — a read carrying `BDP-Minimum-Scope-Position` could
  not be served at or after that position within the authority's wait
  bound.

Inside a `failed` receipt, four Read codes also occur, with these meanings:
`forbidden` — operation-local authorization denied the operation when it
was reached, including a selected Resource that is not writable;
`resource-not-found` — `bead`, `link`, or an in-Scope endpoint does not
identify a live Resource visible in the request's Authorization View;
`limit-exceeded` — an advertised or enforced transaction limit — examined,
matched, or mutated Resources, induced Events, or duration — was crossed
after admission; `temporarily-unavailable` — the authority aborted the
transaction for a serialization conflict it did not retry. A `failed`
receipt never carries `malformed-request`, `invalid-parameter`,
`unauthenticated`, `request-too-large`, `rate-limited`, `foreign-view`,
`cursor-expired`, `resource-pruned`, or `resource-erased`: those conditions
are decided before admission or belong to reads.

Problem `type` for the `validation` family is
`https://github.com/gastownhall/bdp/problems/validation`. This draft still
assigns no BDP problem code for unsupported request media types or
unacceptable response media types on mutation targets.

### 3.3 Proposed schema

`receiptCore` types every member once; `mutationReceipt` closes the four
representations — `pending`, `completed` with detail, `failed` with detail,
and terminal without detail — over it. `problemCodeRows` carries every code
row the Transactional profile can serve, Read rows included, so that one
definition fixes family, status, and retry for direct and receipt problems
alike; T11 (c) records how it should replace the rows now inlined in
`readProblem`. `transactionalProblem` is the direct form with optional
`status`; `receiptProblem` requires `status` and `operationIndex`.

<!-- bundle-defs -->
```json
{
  "idempotencyKey": {
    "$ref": "#/$defs/wireToken"
  },
  "receiptStatus": {
    "enum": ["pending", "completed", "failed"]
  },
  "receiptDetail": {
    "enum": ["available", "expired", "withheld"]
  },
  "receiptResult": {
    "type": "object",
    "required": ["operationIndex", "outcome"],
    "properties": {
      "operationIndex": { "type": "integer", "minimum": 0 },
      "name": { "$ref": "#/$defs/localLabel" },
      "outcome": { "enum": ["created", "updated", "deleted", "matched", "withheld"] },
      "resourceKind": { "$ref": "#/$defs/resourceKind" },
      "resource": { "type": "object" },
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
          "type": "object",
          "required": ["resourceKind", "resource"],
          "properties": { "resourceKind": true, "resource": true, "count": false },
          "allOf": [
            {
              "if": {
                "properties": { "resourceKind": { "const": "bead" } },
                "required": ["resourceKind"]
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
                "properties": { "resourceKind": { "const": "link" } },
                "required": ["resourceKind"]
              },
              "then": {
                "properties": { "resource": { "$ref": "#/$defs/linkRecord" } }
              }
            }
          ]
        }
      },
      {
        "if": {
          "properties": { "outcome": { "const": "deleted" } },
          "required": ["outcome"]
        },
        "then": {
          "type": "object",
          "required": ["resourceKind", "resource"],
          "properties": {
            "resourceKind": true,
            "resource": { "$ref": "#/$defs/resourceIdentity" },
            "count": false
          }
        }
      },
      {
        "if": {
          "properties": { "outcome": { "const": "matched" } },
          "required": ["outcome"]
        },
        "then": {
          "type": "object",
          "required": ["count"],
          "properties": {
            "count": true,
            "name": false,
            "resourceKind": false,
            "resource": false,
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
          "type": "object",
          "properties": {
            "count": false,
            "resourceKind": false,
            "resource": false,
            "sourceRevision": false
          }
        }
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
          "next": false
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
          "status": { "enum": ["completed", "failed"] },
          "detail": { "enum": ["expired", "withheld"] },
          "idempotencyKey": true,
          "scopeEpoch": true,
          "authorizationView": true,
          "transaction": true,
          "requiredPosition": true,
          "effectPosition": true,
          "results": false,
          "next": false,
          "problem": false,
          "expiresAt": false
        }
      }
    ]
  },
  "mutationReceiptPage": {
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
  "mutationProblemCode": {
    "enum": [
      "idempotency-conflict",
      "revision-mismatch",
      "identity-conflict",
      "incident-links-exist",
      "cardinality-violated",
      "constraint-violated",
      "validation-failed",
      "patch-failed",
      "type-not-installed",
      "event-history-expired",
      "catch-up-timeout"
    ]
  },
  "transactionalProblemCode": {
    "anyOf": [{ "$ref": "#/$defs/readProblemCode" }, { "$ref": "#/$defs/mutationProblemCode" }]
  },
  "problemDiagnostic": {
    "type": "object",
    "required": ["message"],
    "properties": {
      "message": { "type": "string", "minLength": 1 },
      "typeId": { "$ref": "#/$defs/absoluteHttpUrl" },
      "schemaLocation": { "type": "string", "minLength": 1 },
      "pointer": { "type": "string" }
    },
    "additionalProperties": false
  },
  "problemCodeRows": {
    "type": "object",
    "allOf": [
      { "if": { "properties": { "code": { "const": "malformed-request" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/request" }, "status": { "const": 400 }, "retry": { "const": "never" } } } },
      { "if": { "properties": { "code": { "const": "invalid-parameter" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/request" }, "status": { "const": 400 }, "retry": { "const": "never" } } } },
      { "if": { "properties": { "code": { "const": "unauthenticated" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/authentication" }, "status": { "const": 401 }, "retry": { "const": "after-state-change" } } } },
      { "if": { "properties": { "code": { "const": "forbidden" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/authorization" }, "status": { "const": 403 }, "retry": { "const": "after-state-change" } } } },
      { "if": { "properties": { "code": { "const": "resource-not-found" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/not-found" }, "status": { "const": 404 }, "retry": { "const": "after-state-change" } } } },
      { "if": { "properties": { "code": { "const": "resource-pruned" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/gone" }, "status": { "const": 410 }, "retry": { "const": "never" } } } },
      { "if": { "properties": { "code": { "const": "resource-erased" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/gone" }, "status": { "const": 410 }, "retry": { "const": "never" } } } },
      { "if": { "properties": { "code": { "const": "foreign-view" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/conflict" }, "status": { "const": 409 }, "retry": { "const": "after-state-change" } } } },
      { "if": { "properties": { "code": { "const": "cursor-expired" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/gone" }, "status": { "const": 410 }, "retry": { "const": "after-state-change" } } } },
      { "if": { "properties": { "code": { "const": "request-too-large" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/size" }, "status": { "const": 413 }, "retry": { "const": "never" } } } },
      { "if": { "properties": { "code": { "const": "limit-exceeded" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/size" }, "status": { "const": 413 }, "retry": { "const": "never" } } } },
      { "if": { "properties": { "code": { "const": "rate-limited" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/rate-limit" }, "status": { "const": 429 }, "retry": { "const": "after-delay" } } } },
      { "if": { "properties": { "code": { "const": "temporarily-unavailable" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/unavailable" }, "status": { "const": 503 }, "retry": { "const": "after-delay" } } } },
      { "if": { "properties": { "code": { "const": "idempotency-conflict" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/conflict" }, "status": { "const": 409 }, "retry": { "const": "never" } } } },
      { "if": { "properties": { "code": { "const": "revision-mismatch" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/conflict" }, "status": { "const": 409 }, "retry": { "const": "after-state-change" } } } },
      { "if": { "properties": { "code": { "const": "identity-conflict" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/conflict" }, "status": { "const": 409 }, "retry": { "const": "never" } } } },
      { "if": { "properties": { "code": { "const": "incident-links-exist" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/conflict" }, "status": { "const": 409 }, "retry": { "const": "after-state-change" } } } },
      { "if": { "properties": { "code": { "const": "cardinality-violated" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/conflict" }, "status": { "const": 409 }, "retry": { "const": "after-state-change" } } } },
      { "if": { "properties": { "code": { "const": "constraint-violated" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/conflict" }, "status": { "const": 409 }, "retry": { "const": "after-state-change" } } } },
      { "if": { "properties": { "code": { "const": "validation-failed" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/validation" }, "status": { "const": 422 }, "retry": { "const": "never" } } } },
      { "if": { "properties": { "code": { "const": "patch-failed" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/validation" }, "status": { "const": 422 }, "retry": { "const": "after-state-change" } } } },
      { "if": { "properties": { "code": { "const": "type-not-installed" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/validation" }, "status": { "const": 422 }, "retry": { "const": "after-state-change" } } } },
      { "if": { "properties": { "code": { "const": "event-history-expired" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/gone" }, "status": { "const": 410 }, "retry": { "const": "never" } } } },
      { "if": { "properties": { "code": { "const": "catch-up-timeout" } }, "required": ["code"] },
        "then": { "properties": { "type": { "const": "https://github.com/gastownhall/bdp/problems/unavailable" }, "status": { "const": 503 }, "retry": { "const": "after-delay" } } } },
      { "if": { "not": { "properties": { "code": { "const": "resource-pruned" } }, "required": ["code"] } },
        "then": { "properties": { "archivedAt": false } } },
      { "if": { "not": { "properties": { "code": { "const": "validation-failed" } }, "required": ["code"] } },
        "then": { "properties": { "diagnostics": false } } },
      { "if": { "not": { "properties": { "code": { "const": "limit-exceeded" } }, "required": ["code"] } },
        "then": { "properties": { "limit": false } } }
    ]
  },
  "transactionalProblem": {
    "title": "BDP Transactional Problem Details",
    "type": "object",
    "required": ["type", "code", "retry"],
    "properties": {
      "type": { "$ref": "#/$defs/absoluteHttpUrl" },
      "title": { "type": "string" },
      "status": { "type": "integer", "enum": [400, 401, 403, 404, 409, 410, 413, 422, 429, 503] },
      "detail": { "type": "string" },
      "instance": { "$ref": "#/$defs/absoluteUri" },
      "code": { "$ref": "#/$defs/transactionalProblemCode" },
      "retry": { "$ref": "#/$defs/retryDisposition" },
      "operationIndex": { "type": "integer", "minimum": 0 },
      "operationName": { "$ref": "#/$defs/localLabel" },
      "pointer": { "type": "string" },
      "limit": { "type": "string", "pattern": "^[a-z]+\\.[A-Za-z]+$" },
      "diagnostics": {
        "type": "array",
        "minItems": 1,
        "items": { "$ref": "#/$defs/problemDiagnostic" }
      },
      "archivedAt": { "$ref": "#/$defs/reference" }
    },
    "allOf": [{ "$ref": "#/$defs/problemCodeRows" }]
  },
  "receiptProblem": {
    "type": "object",
    "allOf": [
      { "$ref": "#/$defs/transactionalProblem" },
      {
        "type": "object",
        "required": ["status", "operationIndex"],
        "properties": { "status": true, "operationIndex": true }
      }
    ]
  }
}
```

### 3.4 Fixtures

The completed receipt for the first batch under section 2.3. The Decision's
result shows its state immediately after its own operation — revision
`dec-9-r1`, empty owned set — while the Link's result carries
`sourceRevision` `dec-9-r2`, the source's revision after the owned Link was
created. The final Decision state is in the change group under section 5.3,
not restated here.

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
      "name": "decision",
      "outcome": "created",
      "resourceKind": "bead",
      "resource": {
        "id": "https://beads.example/acme/beads/dec-9",
        "type": "https://work.example/types/decision",
        "revision": "dec-9-r1",
        "properties": { "title": "Adopt owned Links", "status": "proposed" },
        "ownedLinks": { "https://work.example/types/cites": [] }
      }
    },
    {
      "operationIndex": 1,
      "name": "cite",
      "outcome": "created",
      "resourceKind": "link",
      "sourceRevision": "dec-9-r2",
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
      "operationIndex": 2,
      "outcome": "updated",
      "resourceKind": "bead",
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

A failed receipt: the same batch resubmitted under a new key after the
Decision identity was committed. Nothing was committed; the problem carries
the would-be `409`, the failing index and name, and a pointer into the
operation record.

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
    "code": "identity-conflict",
    "retry": "never",
    "operationIndex": 0,
    "operationName": "decision",
    "pointer": "/id"
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

The same completed receipt after its detail expired, as returned to an
identical retry with `200 OK`: the disposition and positions remain, the
results are gone, and the mutation is never executed again.

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
  "effectPosition": "pos-43"
}
```

The receipt for the second batch under section 2.3: a set deletion that
matched two Links — one of them the owned `cites` Link, whose entry carries
the source's fresh revision — followed by the Bead deletion. The entries did
not fit in one page.

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
      "resourceKind": "link",
      "resource": {
        "id": "https://beads.example/acme/links/9c1e",
        "type": "https://work.example/types/cites",
        "revision": "9c1e-r1"
      },
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
      "resourceKind": "link",
      "resource": {
        "id": "https://beads.example/acme/links/blocks-3",
        "type": "https://work.example/types/blocks",
        "revision": "blocks-3-r1"
      }
    },
    {
      "operationIndex": 1,
      "outcome": "deleted",
      "resourceKind": "bead",
      "resource": {
        "id": "https://beads.example/acme/beads/task-42",
        "type": "https://work.example/types/task",
        "revision": "task-42-r9"
      }
    },
    {
      "operationIndex": 2,
      "outcome": "created",
      "resourceKind": "link",
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

A completed receipt read later by the same principal after a grant change
hid the Task: the Task's entry is withheld and the rest is served.

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
      "name": "decision",
      "outcome": "created",
      "resourceKind": "bead",
      "resource": {
        "id": "https://beads.example/acme/beads/dec-9",
        "type": "https://work.example/types/decision",
        "revision": "dec-9-r1",
        "properties": { "title": "Adopt owned Links", "status": "proposed" },
        "ownedLinks": { "https://work.example/types/cites": [] }
      }
    },
    { "operationIndex": 1, "name": "cite", "outcome": "withheld" },
    { "operationIndex": 2, "outcome": "withheld" }
  ],
  "next": null,
  "expiresAt": "2026-09-14T18:04:12Z"
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

A receipt problem for a validation failure, with its diagnostics.

<!-- fixture: receiptProblem -->
```json
{
  "type": "https://github.com/gastownhall/bdp/problems/validation",
  "title": "Resulting properties violate an effective Type contract",
  "status": 422,
  "code": "validation-failed",
  "retry": "never",
  "operationIndex": 2,
  "pointer": "/change/0",
  "diagnostics": [
    {
      "message": "status must be one of open, closed",
      "typeId": "https://work.example/types/work-item",
      "schemaLocation": "#/properties/status/enum",
      "pointer": "/status"
    }
  ]
}
```

A `completed` receipt with `detail` `available` but no `results` is
rejected: the four representations are closed.

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

A receipt problem without the failure's would-be `status` is rejected.

<!-- fixture-invalid: receiptProblem -->
```json
{
  "type": "https://github.com/gastownhall/bdp/problems/conflict",
  "code": "revision-mismatch",
  "retry": "after-state-change",
  "operationIndex": 2
}
```

### 3.5 Decisions

**T7 — Result-entry model and pagination unit.**
Context: the draft says a successful batch "contains one result per
operation in declaration order" and that "Large set-operation results
continue through immutable pages of that same receipt"; both cannot hold
if a set operation's result is one nested array. Options: (a) flat entries,
each stamped with `operationIndex`, where a set operation contributes a
leading `matched` entry plus one entry per selected Resource, and pages cut
between entries; (b) one nested result per operation whose `resources` array
is split across pages; (c) one result per operation with no pagination of
set results, which the prohibition on truncation rules out. Tradeoffs: (b)
needs a rule for reassembling a split array and a second continuation
inside the result; (a) keeps one pagination unit, keeps zero-match
operations visible through their `matched` entry, and gives every entry an
independent authorization decision, which the `withheld` entry relies on.
Also decided here: a postimage is the state immediately after its
operation; the receipt does not restate final states, because the change
group already normalizes them. Recommendation: (a).

**T8 — Receipt lifecycle representation.**
Options: (a) `status` ∈ {`pending`, `completed`, `failed`} as the
immutable disposition plus `detail` ∈ {`available`, `expired`,
`withheld`} on terminal receipts; (b) a fourth `status` value `expired`
plus a `disposition` member carrying the original outcome; (c) a boolean
`resultsRetained`. Tradeoffs: (b) changes `status` after the draft says the
disposition never changes and cannot express `withheld`; (c) cannot express
three states. Also decided: `transaction` is present on every receipt,
`pending` included, because the draft's receipt records "the transaction
identity" and the identity is assigned at admission; a retry after
retention expiry receives the `expired` receipt with `200 OK`, not a `410`
problem, so that a retry always has one response shape. Recommendation:
(a).

**T9 — Receipt addressing and access.**
Sub-decisions: (a) receipts live at `receipts/{token}`, token in the
checkpoint character profile, and `id` is the absolute URL; (b) unknown,
foreign-principal, and prior-epoch receipt URLs return `404`
`resource-not-found`; (c) no listing and no lookup by key: the retry is the
lookup, and a client must persist its request to retry at all; (d) a `GET`
of the `receipts` root returns `404`; (e) page URLs after detail expiry
return `410` `cursor-expired`, treating a `next` URL as the continuation
cursor it is. Alternatives: for (c), `GET receipts/?idempotencyKey=` (new
surface, and it leaks whether a key exists to any holder of the principal's
credentials); for (e), `404`. Recommendation: (a)–(e) as stated.

**T10 — Receipt problem form.**
Options: (a) the direct problem shape plus required `status` and
`operationIndex`, optional `operationName`, `pointer`, `limit`, and
`diagnostics`, reusing the `operationIndex`/`operationName` spellings the
draft already fixes for sequence members (**shared**); (b) a
receipt-specific taxonomy. Tradeoffs: (b) is the "separate sequence-only
taxonomy" the draft refused for sequences. Recommendation: (a).

**T11 — Transactional problem table.**
Sub-decisions: (a) the eleven codes, families, statuses, and retry
dispositions tabled under section 3.2, including the new `validation`
family and the `422` status, and the meanings of the four Read codes
reused inside receipts; (b) **shared**: `idempotency-conflict`,
`revision-mismatch`, `identity-conflict`, `incident-links-exist`,
`constraint-violated`, `validation-failed`, `patch-failed`, and
`type-not-installed` are the same codes, families, statuses, and
dispositions on Read+Update singletons and sequence members, where they are
direct problems or sequence-member problems; the Read+Update half defines
them once and this packet extends the table with `cardinality-violated`,
`event-history-expired`, and `catch-up-timeout`; (c) **shared**: the
bundle composes profile tables from one `problemCodeRows` definition —
the rows now inlined in `readProblem.allOf` move there, and `readProblem`
references it — so that no row is stated twice; until that move lands,
the `problemCodeRows` in this packet duplicates the Read rows and the
existing `readProblem` stays untouched. Alternatives: for (a), fold
`patch-failed` into `validation-failed` (loses the distinct client action)
or reuse `409` for validation (misreports a content failure as a state
race); for (b), separate per-profile code sets (the same failure would have
two names). Recommendation: (a)–(c) as stated.

## 4. Transaction-level idempotency

The draft qualifies a Mutation Transaction's key by Scope, epoch, and
principal, defines the normalized comparison, duplicate joining, conflict,
and the epoch-long tombstone, and it says the Read+Update sequence's "key
syntax and qualification, duplicate-join behavior, and the finite
outcome-retention rules" are still pending. The two halves must not define
two key grammars or two namespaces for the same Scope. This section states
the rules both halves share and the rules that are Transactional-only.

### 4.1 Proposed normative text

Target: "Mutation Transactions". Append after "Retrying returns that same
outcome, including authority-allocated IDs."

An idempotency key — the `Idempotency-Key` HTTP field of a batch or
singleton request, and the `idempotencyKey` member of a sequence member — is
a case-sensitive ASCII token matching `[A-Za-z0-9_-]{1,256}`, the same
profile as Event IDs and checkpoints, compared exactly. The HTTP field
carries the bare token, unquoted. A request whose key is absent, repeated,
or outside the profile is malformed.

On a Transactional Scope every mutation carrier feeds one key namespace: a
singleton request, a `batch`, and each member of a `sequence` is a Mutation
Transaction, and the carrier is delivery-only metadata that the semantic
comparison excludes. A one-operation `batch` and the equivalent singleton
are therefore the same semantic request, and a sequence member is the
one-operation Mutation Transaction of its record under the member's own
key. Every such transaction has a durable Mutation Receipt, produces its
change group and Events when it has effect, and is retrievable by
resubmitting the same semantic operation with the same key to any carrier.
The sequence response envelope is unchanged by the Transactional profile:
it projects each member's disposition inline and adds no receipt member.

Concurrent identical requests join one execution and receive the same
receipt identity, pending or terminal. A later identical request returns
the retained receipt — with its detail available, expired, or withheld —
and never executes again. A request with the same key and a different
normalized request is refused before admission with `409`
`idempotency-conflict` for the rest of the Scope epoch, whether or not the
earlier outcome's detail has expired. A new epoch is a new namespace: a key
first used under a prior epoch is unbound, and a retry under the new epoch
executes as a new mutation. Authorization View changes do not create a new
namespace.

Target: "Advertised limits". Append after the `retention` bullet.

On a Transactional Scope, receipts retain a key's disposition for the rest
of the epoch, so a Transactional discovery document MUST NOT advertise
`retention.idempotency`; `retention.receipt` bounds how long detailed
outcomes remain. `retention.idempotency` is the Read+Update advertisement
for its retained member outcomes.

Target: "Event-ID and checkpoint character profile". Append.

Scope epochs, Authorization View tokens, Scope positions, transaction
identifiers, receipt tokens, and idempotency keys use this same profile, so
that every history token is safe in a JSON value, a URL query, and an HTTP
field. Resource revisions do not: a revision is also an entity tag, and its
grammar is the entity-tag grammar's.

### 4.2 Decisions

**T12 — Key grammar and HTTP field form (shared).**
Options: (a) the checkpoint character profile, bare token in the HTTP field;
(b) the IETF `Idempotency-Key` draft's quoted `sf-string`; (c) any
nonempty string up to an advertised byte bound. Tradeoffs: (b) makes the
draft's own example (`Idempotency-Key: client-generated-opaque-key`)
invalid and adds a structured-field parser; (c) admits characters that need
escaping in a header and gives the sequence member and the header different
effective grammars; (a) reuses a profile the draft already fixes and keeps
both carriers byte-identical. Recommendation: (a).

**T13 — One key namespace across carriers on a Transactional Scope
(shared).**
Options: (a) a singleton, a batch, and each sequence member is a Mutation
Transaction in one namespace; the carrier is excluded from the semantic
comparison; every one has a receipt; the sequence envelope is unchanged and
a member's receipt is reached by resubmitting the member as a singleton
with the same key; (b) sequence members keep Read+Update semantics only
(retained inline outcome, no receipt) with a namespace separate from the
batch/singleton keys; (c) as (a) but with an optional `receipt` URL member
added to sequence member results. Tradeoffs: (b) leaves the same key on two
carriers undefined and makes "identical allocation, patch, validation,
authorization, idempotency ... semantics" false for one carrier; (c)
changes an envelope owned by the Read+Update half for a convenience (a) already
provides. Recommendation: (a).

**T14 — `retention.idempotency` on a Transactional Scope.**
Options: (a) prohibited, because the epoch-long receipt tombstone makes any
finite value false; (b) allowed as a lower bound; (c) allowed and binding.
Tradeoffs: (c) contradicts the draft's tombstone rule; (b) advertises a
number that means nothing to a client. Recommendation: (a).

**T15 — Character profile for the other history tokens.**
Options: (a) extend the Event-ID and checkpoint profile to epochs, view
tokens, positions, transaction identifiers, receipt tokens, and keys;
(b) leave them opaque nonempty strings. Tradeoffs: (b) leaves the three
`BDP-*` HTTP fields carrying values with no header-safe grammar.
Recommendation: (a).

### 4.3 Shared result-shape rules

**T22 — Owned-source secondary revision and the deleted-identity shape
(shared).**
Context: the draft says the member carrying the source Bead's resulting
revision "is defined with the write profiles" and that deletes return "the
canonical deleted identity", without fixing either spelling. Options:
(a) `sourceRevision`, a revision string beside the Link's own postimage or
identity, in receipt entries and in Read+Update inline results alike; and
the deleted identity as `{ resourceKind, resource: { id, type, revision } }`
with `revision` the final live revision, matching the changefeed tombstone;
(b) an embedded `source: { id, revision }` object (collides with the Link's
`source` Reference member); (c) `id` alone for deletions (loses the `type`
and final revision that tombstones and `DeletedData` carry). Recommendation:
(a).

**T23 — Bundle naming and validator conventions (shared).**
Options: (a) operation records are `<operation>Operation`, Read+Update
singleton bodies are `<operation>Request`, RFC 3339 instants are the
`dateTime` pattern definition rather than a `format` assertion (the
repository validator registers only `uri`), and profile problem rows live in
`problemCodeRows`; (b) register `date-time` in the schema validator and use
`format`. Tradeoffs: (b) touches `packages/conformance/src/schema-validator.ts`
and `packages/protocol` in the same change as the bundle. Recommendation:
(a), with (b) as a later cleanup if the validator gains formats.

## 5. Version erasure on the changefeed

bdp#12 and bdp#16 ruled that erasure propagates and retention does not, and
the draft's "Version erasure" section fixes the erasure record's three
members, its per-view projection, its position, and the atomic correction
case. What remains unassigned is the wire form of the change group that
carries it — the draft's `ChangeGroup` model has `erasures` and the
changefeed examples do not — the tombstone entry's `operation` name, the
digest discipline and encoding, what happens when the erased version is the
live one, how inline owned-Link copies are reached, and what a replica must
do. This section assigns them.

### 5.1 Proposed normative text

Target: "Scope changefeed". Insert before "When a transaction has no
visible effect, the group is instead a projection advance".

On the wire, a change group carries `scopeEpoch`, `authorizationView`,
`checkpoint`, `position`, `previousPosition`, `projectionAdvance`,
`transaction`, `eventCount`, `changes`, `erasures`, and `events`. `changes`,
`erasures`, and `events` are always present, and each is empty when the
group carries nothing of its kind. A `changes` entry is either an
`upsert` — `operation` `upsert`, `resourceKind`, and `resource`, the
complete canonical Bead or Link record at its final projected revision,
without the `links` aggregate — or a `tombstone` — `operation`
`tombstone`, `resourceKind`, and `resource` carrying the `id`, the
immutable `type`, and the last visible `revision`. A tombstone has the same
shape whether the Resource was deleted or merely left the view, because an
authorization-projection tombstone does not assert underlying deletion. A
projection advance carries `projectionAdvance` `true`, no `transaction`,
`eventCount` `0`, and three empty arrays. A finite read's `after` is the
exclusive checkpoint the page continues from: the requested `after`, or,
for `start=now`, the head checkpoint the authority observed when it
admitted the request.

Target: "Version erasure". Append.

Each `erasures` entry carries `subject`, the canonical Resource URL;
`revision`, the erased version's token; and `digest`, an object with
`scheme` and `value`. BDP v0 defines exactly one scheme, `sha-256-jcs`:
`value` is the lowercase hexadecimal SHA-256 of the RFC 8785 (JCS)
serialization of the erased version's complete Resource record — the
record the authority served for that revision, `attribution` and
`ownedLinks` included and the `links` aggregate excluded. An erasure group
is an ordinary visible group at its own position — `projectionAdvance`
`false`, `transaction` present and minted by the authority for the
administrative act, which has no Mutation Receipt because erasure is not a
BDP operation — with `events` empty unless the same group also commits a
successor.

An authority MUST NOT commit an erasure of a Resource's live version
without, in the same group, either the successor's `upsert` postimage or the
Resource's `tombstone`; a replica never holds a live Resource without
content. Erasing a historical version needs no state change, and the
group's `changes` is empty. Because a source Bead's version record inlines
its owned Links' records, erasing an owned Link's version erases every
source version that inlined it: the authority emits one erasure record per
erased version, and each is applied on its own.

A store, cache, or replica that processes an erasure record MUST, for the
named subject and revision:

1. discard the version's content wherever it holds it — the retained
   record, stored change-group postimages, retained Events that carry the
   version's content, caches, and derived indexes — before it makes any
   further state visible;
2. retain the subject URL, the revision token, and the digest as the
   version's lineage marker, so that an audit can prove which version once
   stood at that point without recovering it;
3. answer reads of that version with the `resource-erased` disclosure to
   callers authorized for the subject's retained history and with the
   uniform `404` `resource-not-found` to every other caller;
4. withhold, from every Event Source it serves, the Events that carry the
   erased content — the `created` or `updated` Event that minted the erased
   revision and, for a source Bead, the `updated` Event whose `ownedLink`
   delta carries an erased Link version — leaving their ordinals as gaps
   exactly as hidden facts do, while continuing to serve the content-free
   `deleted`, `linked`, and `unlinked` facts and the successor's own Event;
   and
5. carry the record onward on any changefeed it serves.

A replica SHOULD verify the digest against its held copy before discarding
it and report a mismatch out of band; a mismatch never suspends the
obligation. A replica that has not yet processed the record is behind, in
exactly the strict-read sense.

### 5.2 Proposed schema

`changeGroup` closes the group; its conditional makes a projection advance
carry nothing but positions. `snapshotManifest` and `transactionalDiscovery`
are transcribed from the draft's examples and its discovery table, with the
`retention.idempotency` prohibition from T14 expressed on the discovery
definition.

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
          "properties": { "transaction": true }
        }
      }
    ],
    "additionalProperties": false
  },
  "changefeedPage": {
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
    "type": "object",
    "required": [
      "id",
      "scope",
      "scopeEpoch",
      "authorizationView",
      "scopePosition",
      "checkpoint",
      "expiresAt",
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
  "transactionalDiscovery": {
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
      "limits": {
        "allOf": [
          { "$ref": "#/$defs/advertisedLimits" },
          {
            "type": "object",
            "properties": {
              "retention": { "type": "object", "properties": { "idempotency": false } }
            }
          }
        ]
      },
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

The change group for the first batch under section 2.3, projected for the
view that saw everything. `changes` carries three postimages — the Decision
at `dec-9-r2` with its owned set inline, the Link, and the Task — and
`events` carries six facts in the order T3 fixes: the Decision's creation,
then the Link's creation, its two graph facts, and the source's owned-Link
`updated` fact, then the Task's update.

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
        "properties": { "title": "Adopt owned Links", "status": "proposed" }
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
needed and no Event is induced.

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
            "value": "3b7e0d1c9a5f4e2b8c6d1a0f7e9b2c4d5a6e8f1b3c7d9e0a2b4c6d8e1f3a5b7c"
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
corrected successor `task-42-r9` is committed in the same group, so the
group carries the erasure record, the successor's postimage, and the
successor's own `updated` Event.

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
        "properties": { "title": "Specify BDP mutation", "status": "cited" }
      }
    }
  ],
  "erasures": [
    {
      "subject": "https://beads.example/acme/beads/task-42",
      "revision": "task-42-r8",
      "digest": {
        "scheme": "sha-256-jcs",
        "value": "9e0a2b4c6d8e1f3a5b7c3b7e0d1c9a5f4e2b8c6d1a0f7e9b2c4d5a6e8f1b3c7d"
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
        "change": [{ "op": "replace", "path": "/title", "value": "Specify BDP mutation" }]
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

The draft's snapshot manifest and Transactional discovery examples, as
they validate against the transcribed definitions.

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
  "beads": {
    "items": [
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
    "transaction": { "operations": 200, "inducedEvents": 10000, "duration": "PT30S" },
    "retention": { "receipt": "P7D", "maximumSnapshotLifetime": "PT300S", "replay": "P30D" }
  }
}
```

A projection advance that names a transaction is rejected, and so is a
Transactional discovery document that advertises `retention.idempotency`.

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

### 5.4 Decisions

**T16 — Change-group wire form.**
Sub-decisions: (a) `erasures` is required and possibly empty, like
`changes` and `events`, so the draft's two changefeed examples gain an
empty `erasures` array; (b) `checkpoint` is a group member on the wire, as
the draft's examples already show, although the model block omits it;
(c) an erasure-only group carries `transaction`, minted by the authority
for the administrative act, because it is a visible group and the draft
makes `transaction` present on every visible group; (d) a page's `after`
for `start=now` is the head checkpoint observed at admission. Alternatives:
for (a), optional `erasures` (a consumer cannot tell "no erasures" from "a
producer that predates erasure"); for (c), omit `transaction` (breaks the
visible-group invariant and the schema's conditional). Recommendation:
(a)–(d) as stated.

**T17 — Tombstone entry.**
Options: (a) `operation` `tombstone` with `resource` `{ id, type,
revision }`, one shape for deletion and for projection removal; (b)
`operation` `delete`; (c) distinct `deleted` and `hidden` operations.
Tradeoffs: (b) asserts deletion where the draft says a projection tombstone
does not; (c) discloses whether a Resource still exists to a view that lost
it. Recommendation: (a).

**T18 — Erasure digest discipline and encoding.**
Options: (a) one registered scheme, `sha-256-jcs`, SHA-256 over the RFC
8785 canonical serialization of the served version record, `value` as 64
lowercase hexadecimal characters, `scheme` schema-closed to that value;
(b) base64url `value`; (c) an open `scheme` string with implementation-
defined disciplines. Tradeoffs: (c) makes the digest unverifiable across
implementations, which defeats "version lineage remains verifiable"; (b)
carries padding and case questions hex does not; (a) is computable by any
implementation from the record it already serves and is extensible by a
later scheme value. Recommendation: (a).

**T19 — Erasing the live version and inline owned-Link copies.**
Options: (a) an erasure of the live version MUST be accompanied in the same
group by the successor's `upsert` or the Resource's `tombstone`, and an
owned Link's erased version yields one erasure record per source version
that inlined it; (b) permit an "erased but live" state served as
`resource-erased`; (c) require replicas to scrub inline copies without a
record. Tradeoffs: (b) leaves a replica's live set containing a Resource
with no content and no way to represent it in `changes`; (c) is an implicit
obligation no digest covers. Recommendation: (a).

**T20 — Event Sources after erasure and the replica obligation list.**
Options: (a) withhold the content-bearing Events, leaving ordinal gaps as
hidden facts already do, and make the five obligations under section 5.1
normative; (b) serve those Events with `data` replaced by an erasure
marker; (c) leave Event-Source behavior to authority policy. Tradeoffs: (b)
invents an Event shape and keeps a pointer where the draft says even a
pointer discloses; (c) lets one implementation leak what another erases.
Recommendation: (a).

## 6. Conformance rows

### 6.1 Conventions

Rows use the catalog shape (`id`, `title`, `kind`, `requiredProfile`,
`requirements`) with `requiredProfile` `transactional`, so that a
Transactional run inherits every Read and Read+Update row and adds these.
The coverage category open question 13 names — positive, negative,
concurrency, disconnect, expiry, restore, authorization-view — is the
grouping below and the second segment of each `id`; it is not a catalog
member (T21). Every row is unclaimed: no manifest plan, fixture, or evidence
exists for any of them, and the evidence law in
`packages/conformance/matrices/README.md` governs when one may be claimed.
Citations name the draft where the text exists today and this packet where
the text is proposed; a packet citation is re-pointed to the draft when the
packet is applied.

Fixture capabilities the rows will need, proposed here and defined nowhere
yet: `transactional-v1` (a reference realization with the Decision/`cites`
owning pair, Tasks with `blocks` Links, and one external endpoint);
`controlled-transactional-concurrency-v1` (two-client races with
deterministic serialization); `controlled-transactional-disconnect-v1`
(admission-then-disconnect and SSE reconnect controls);
`controlled-transactional-retention-v1` (clock control across
`retention.receipt`, snapshot expiry, and `minimumReplayPosition`);
`controlled-transactional-restore-v1` (epoch rotation at the same canonical
Scope); `controlled-transactional-view-v1` (view token rotation and per-view
projection); `controlled-transactional-erasure-v1` (administrative erasure
trigger); `controlled-transactional-problem-table-v1` (injection of every
Transactional code through a public route). `bdpbd` is expected to record
every row as honestly not-applicable until `bd` can preserve Transactional
guarantees (BDBD-003).

**T21 — Category tagging and capability names.**
Options: (a) no catalog change: the category is the second `id` segment
and the packet grouping, and the capability names above are proposed for
the fixtures; (b) add a `category` member to the catalog (changes
`SCENARIO_KEYS` and the validator); (c) encode the category in `kind`
(conflates claim eligibility with coverage). Recommendation: (a).

### 6.2 Positive rows

<!-- catalog-rows -->
```json
[
  {
    "id": "transactional.positive.discovery-document",
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
    "id": "transactional.positive.operation-directory",
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
    "id": "transactional.positive.batch-atomic-commit",
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
    "id": "transactional.positive.batch-local-references",
    "title": "Batch-local labels bind staged identity, including as Link endpoints",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#batch-operation-target",
        "selectedText": "In a Resource-reference member, a string beginning with `@` refers to the Resource created by the preceding operation with that name."
      }
    ]
  },
  {
    "id": "transactional.positive.set-mutation",
    "title": "Set mutation mutates the complete matched set and reports flat result entries",
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
        "selectedText": "A set operation produces one `matched` entry carrying `count`, the number of Resources it selected, followed by one `updated` or `deleted` entry per selected Resource in the authority's selection order."
      }
    ]
  },
  {
    "id": "transactional.positive.no-effect-mutation",
    "title": "A no-op mutation completes without a group, position, revision, or Event",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#change-groups-and-replication",
        "selectedText": "A failed or admitted no-effect mutation produces no group and no new position. Its receipt reports the current `requiredPosition` and omits `effectPosition`."
      }
    ]
  },
  {
    "id": "transactional.positive.singleton-receipt",
    "title": "Singleton targets execute one-operation transactions and return receipts",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#operation-directory-and-singleton-targets",
        "selectedText": "The request executes as a one-operation Mutation Transaction. It returns the same Mutation Receipt shape with a one-element `results` array."
      }
    ]
  },
  {
    "id": "transactional.positive.receipt-readable",
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
    "id": "transactional.positive.receipt-pagination",
    "title": "Large set results continue through immutable receipt pages",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-receipt-responses",
        "selectedText": "Otherwise the response contains the first page and an absolute `next` URL for another immutable page of the same receipt."
      }
    ]
  },
  {
    "id": "transactional.positive.owned-link-delta",
    "title": "Owned-Link mutations emit source updated Events carrying the ownedLink delta",
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
    "id": "transactional.positive.graph-facts",
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
    "id": "transactional.positive.changefeed-group",
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
    "id": "transactional.positive.changefeed-sse",
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
    "id": "transactional.positive.snapshot-rendezvous",
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
    "id": "transactional.positive.erasure-propagation",
    "title": "Erasure records propagate with a verifiable digest and no Events",
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
    "id": "transactional.positive.consistency-fields",
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
  }
]
```

### 6.3 Negative rows

<!-- catalog-rows -->
```json
[
  {
    "id": "transactional.negative.batch-rollback",
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
    "id": "transactional.negative.label-errors",
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
    "id": "transactional.negative.envelope-errors",
    "title": "A batch without exactly one header key, or with a body key, is malformed",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#batch-operation-target",
        "selectedText": "A batch request carries exactly one required `Idempotency-Key` HTTP field; the JSON body does not repeat it."
      }
    ]
  },
  {
    "id": "transactional.negative.method-405",
    "title": "Mutation targets answer non-POST methods with 405 and Allow: POST",
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
        "selectedText": "A batch target answers every method other than `POST` with `405 Method Not Allowed`, `Allow: POST`"
      }
    ]
  },
  {
    "id": "transactional.negative.problem-table",
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
        "selectedText": "The Transactional profile uses the Read table plus the following closed table."
      }
    ]
  },
  {
    "id": "transactional.negative.receipt-nondisclosure",
    "title": "Foreign-principal and unknown receipt URLs share one 404",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-receipts",
        "selectedText": "Receipt access is principal-bound: possessing its URL does not grant access."
      }
    ]
  },
  {
    "id": "transactional.negative.changefeed-start-intent",
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
    "id": "transactional.negative.transaction-limits",
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
    "id": "transactional.negative.deletion-safety",
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
  }
]
```

### 6.4 Concurrency rows

<!-- catalog-rows -->
```json
[
  {
    "id": "transactional.concurrency.idempotent-join",
    "title": "Concurrent identical requests join one execution and one receipt",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-transactions",
        "selectedText": "Concurrent requests with the same key and the same semantic request join one execution. A duplicate may wait for the terminal response or receive the same pending receipt. Either way, it never executes again."
      },
      {
        "source": "docs/design/w1-transactional-packet.md",
        "anchor": "#21-proposed-normative-text",
        "selectedText": "`202 Accepted` with the `pending` Mutation Receipt, for any request — the original submission or an identical duplicate — that the authority answers before the transaction is terminal."
      }
    ]
  },
  {
    "id": "transactional.concurrency.idempotency-conflict",
    "title": "A reused key with different semantics is refused without execution",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-transactions",
        "selectedText": "Reusing the key for a different semantic request is an idempotency conflict."
      }
    ]
  },
  {
    "id": "transactional.concurrency.revision-guard",
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
    "id": "transactional.concurrency.aggregate-constraint",
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
  }
]
```

### 6.5 Disconnect rows

<!-- catalog-rows -->
```json
[
  {
    "id": "transactional.disconnect.admitted-mutation",
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
    "id": "transactional.disconnect.sse-reconnect",
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
  }
]
```

### 6.6 Expiry rows

<!-- catalog-rows -->
```json
[
  {
    "id": "transactional.expiry.receipt-detail",
    "title": "An expired receipt keeps its disposition and never re-executes",
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
        "selectedText": "an identical retry after that returns the `expired` receipt with `200 OK` and never executes the mutation again."
      }
    ]
  },
  {
    "id": "transactional.expiry.replay-window",
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
  }
]
```

### 6.7 Restore rows

<!-- catalog-rows -->
```json
[
  {
    "id": "transactional.restore.epoch-fence",
    "title": "A restore keeps canonical URLs and fences every prior-epoch token and key",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#scope-history",
        "selectedText": "Restoring the same logical Scope therefore preserves its canonical Scope and Resource URLs while rejecting every history-dependent token from the prior epoch."
      }
    ]
  }
]
```

### 6.8 Authorization-view rows

<!-- catalog-rows -->
```json
[
  {
    "id": "transactional.authorization-view.receipt-reauthorization",
    "title": "A view change withholds receipt detail without changing the disposition",
    "kind": "normative",
    "requiredProfile": "transactional",
    "requirements": [
      {
        "source": "docs/specs/bdp.md",
        "anchor": "#mutation-receipt-responses",
        "selectedText": "Reading the receipt after such a change returns its unchanged identity and disposition, but the detailed `results` and problem information are re-authorized under the caller's current view."
      }
    ]
  },
  {
    "id": "transactional.authorization-view.projection-advance",
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
    "id": "transactional.authorization-view.erasure-projection",
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
    "id": "transactional.authorization-view.owned-closure-feed",
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
  }
]
```

## 7. What is still not enough

An implementer who has this packet, ruled, still lacks:

- **The Read+Update wire artifacts.** A Transactional Scope inherits the
  sequence envelope, the singleton request bodies, and the member
  idempotency rules from the first half of W1; this packet assumes their
  spellings (T5 (e), T10, T11 (b), T12, T13, T22, T23) and cannot be applied
  before them.
- **Snapshot stream continuation.** The manifest is transcribed, but the
  grammar of the per-stream `next` URLs, which `410` a snapshot page returns
  after `expiresAt`, and whether the manifest `id` is itself addressable are
  unwritten.
- **Snapshot streams and inline owned Links.** A snapshot's `beads` stream
  inlines owned Links that its `links` stream also carries; which stream a
  replica treats as authoritative when a page boundary makes them disagree
  is unwritten (Appendix B, item 13).
- **Minimum-position reads.** How long an authority waits before
  `catch-up-timeout`, whether `Retry-After` is required on it, and how
  `BDP-Minimum-Scope-Position` relates to a receipt's `requiredPosition`
  after a view rotation are unwritten; the packet only assigns the code.
- **Scope-level Event Source cursors.** `eventPage` fixes the shape; the
  `after` semantics of the Scope-wide `events/` source and a test that Event
  IDs are stable across projections are unwritten.
- **An administrative erasure surface.** Erasure is not a BDP operation, so
  `controlled-transactional-erasure-v1` needs a test-only trigger, and the
  correction transaction's `transaction` identity is minted by a mechanism
  no specification describes.
- **Receipt page URL grammar and lifetime.** Pages expire with the receipt's
  detail (T9 (e)); whether a page URL is stable across authority restarts is
  unwritten.
- **Digest computation details.** `sha-256-jcs` names RFC 8785; implementers
  need a conforming JCS serializer, and the packet does not restate the
  ES6 number serialization rule that makes two serializers agree.
- **Owned Links and Selectors.** Selector candidates are `{ id, type,
  properties }`, so `ownedLinks` is not selectable and a set mutation cannot
  target Beads by their owned Links; deliberate, but the draft does not say
  it.
- **Cross-implementation rows.** `bdpbd` cannot be Transactional
  (BDBD-003), so the cross-implementation coverage category has no
  realizable row until a second Transactional server exists.
- **Test-only controls for `bdptest`.** View rotation, epoch rotation, clock
  control, and the erasure trigger are not BDP request fields; the Read
  cohort's self-certified lifecycle rows show the packaged-versus-in-process
  provenance question these rows will inherit.
- **Media-type problem codes.** Unsupported request and unacceptable
  response media types remain unassigned, as in the draft.
- **`ETag` and conditional requests on receipts and groups;** `HEAD` on
  `changes/` and `events/`.
- **`pointer` for set operations.** A `constraint-violated` or
  `validation-failed` problem raised by `updateWhere` locates the operation
  but not the selected Resource; whether `diagnostics.pointer` may name a
  Resource is unwritten.
- **Discovery `ETag` and `limits` change semantics** for the
  `retention.receipt` value while receipts are outstanding.

## 8. Decision index

| Decision | One line |
| --- | --- |
| T1 | Owned-Link delta is a singular `ownedLink { operation, link }`, exclusive with `change`; recommend. |
| T2 | A `deleted` owned-Link transition carries the identity `{ id, type, revision }`; recommend. |
| T3 | Facts of one owned-Link operation are ordered lifecycle, graph (source, target), source `updated` last; recommend. |
| T4 | A no-op owned-Link update versions neither Resource; `CreatedData`/`DeletedData` carry no owned data; recommend. |
| T5 | Closed `batchRequest`, request-side reference definitions, pins on labels accepted, `@`-free supplied `id`, `<op>Operation`/`<op>Request` naming (shared); recommend. |
| T6 | Batch statuses: `200` for every terminal receipt, `202` for any pending answer, closed pre-admission direct set, `405 Allow: POST`; recommend. |
| T7 | Flat result entries with `operationIndex`, `matched` summary entries, entry-granular pages, postimage as state after its operation; recommend. |
| T8 | `status` ∈ pending/completed/failed plus `detail` ∈ available/expired/withheld; `transaction` on every receipt; expired retry is `200`; recommend. |
| T9 | `receipts/{token}` addressing, `404` nondisclosure, no listing or key lookup, pages expire with `410 cursor-expired`; recommend. |
| T10 | Receipt problem = direct shape + required `status`/`operationIndex`, optional `operationName`/`pointer`/`limit`/`diagnostics` (shared spellings); recommend. |
| T11 | Eleven Transactional codes with `validation` family and `422`; eight shared with Read+Update; one `problemCodeRows` definition (shared); recommend. |
| T12 | Idempotency key = checkpoint character profile, bare header token (shared); recommend. |
| T13 | One key namespace across singleton, batch, and sequence members on Transactional; member = one-operation transaction; envelope unchanged (shared); recommend. |
| T14 | `retention.idempotency` prohibited on Transactional discovery; recommend. |
| T15 | Epochs, view tokens, positions, transaction ids, receipt tokens, keys share the checkpoint character profile; recommend. |
| T16 | Group wire form: `erasures` required, `checkpoint` on the wire, `transaction` on erasure-only groups, `after` for `start=now`; recommend. |
| T17 | Tombstone entry is `operation: tombstone` with `{ id, type, revision }`, one shape for deletion and projection removal; recommend. |
| T18 | Single digest scheme `sha-256-jcs`, 64 lowercase hex characters over the served version record; recommend. |
| T19 | Erasing a live version requires a same-group successor or tombstone; inline owned copies get their own erasure records; recommend. |
| T20 | Content-bearing Events are withheld after erasure (ordinal gaps); the five replica obligations are normative; recommend. |
| T21 | No catalog change for categories; proposed fixture capability names; rows unclaimed; recommend. |
| T22 | `sourceRevision` member and `{ resourceKind, resource: { id, type, revision } }` deleted-identity shape (shared); recommend. |
| T23 | `<op>Operation`/`<op>Request` naming, `dateTime` pattern over `format`, shared `problemCodeRows` (shared); recommend. |

## Appendix A. Paste set

The `$defs` to paste into `schemas/bdp-v0.schema.json` are exactly the
blocks tagged `<!-- bundle-defs -->` in sections 1.2, 2.2, 3.3, and 5.2, in
that order. Assembled with the base bundle they add 53 definitions:

`wireToken`, `revision`, `dateTime`, `resourceKind`, `resourceIdentity`,
`typedLinkReference`, `propertyChange`, `createdData`, `ownedLinkChange`,
`updatedData`, `deletedData`, `linkDeltaData`, `eventType`, `event`,
`eventPage`, `localLabel`, `suppliedIdentity`, `mutationResourceReference`,
`mutationPinnedReference`, `mutationReference`, `selector`, `cardinality`,
`createBeadOperation`, `updateBeadPropertiesOperation`,
`deleteBeadOperation`, `createLinkOperation`,
`updateLinkPropertiesOperation`, `deleteLinkOperation`,
`updateWhereOperation`, `deleteWhereOperation`, `batchOperation`,
`batchRequest`, `transactionalOperationDirectory`, `idempotencyKey`,
`receiptStatus`, `receiptDetail`, `receiptResult`, `receiptCore`,
`mutationReceipt`, `mutationReceiptPage`, `mutationProblemCode`,
`transactionalProblemCode`, `problemDiagnostic`, `problemCodeRows`,
`transactionalProblem`, `receiptProblem`, `stateChange`, `erasureDigest`,
`erasureRecord`, `changeGroup`, `changefeedPage`, `snapshotManifest`,
`transactionalDiscovery`.

No existing definition is modified. Two follow-ups belong to the apply
step, not to this packet: the bundle's top-level `description` still says
the bundle covers "the BDP v0 discovery and Read surface"; and, under
T11 (c), the Read rows inlined in `readProblem.allOf` move into
`problemCodeRows` so that they are stated once. Until that move,
`problemCodeRows` duplicates them, and the packet's sanity check confirms
that every Read-code problem fixture validates identically against
`readProblem` and `transactionalProblem`.

## Appendix B. Contradictions and gaps found in the draft

1. **`ChangeGroup` model versus wire.** The model block under "Change groups
   and replication" has `erasures` and no `checkpoint`; every changefeed
   example has `checkpoint` and no `erasures`. T16 aligns them.
2. **One result per operation versus paged set results.** "A successful
   batch contains one result per operation in declaration order" and "Large
   set-operation results continue through immutable pages of that same
   receipt" cannot both hold for a nested per-operation result. T7 resolves
   it with flat entries.
3. **Operation sketch versus bundle conventions.** The non-normative sketch
   types `typeId` as `format: uri` where the bundle uses `absoluteHttpUrl`,
   and its `pinnedReference.uri` accepts any nonempty string where the
   bundle's requires an absolute URI; the draft does not say that the
   request side differs from the response side. T5 (b) makes the difference
   explicit.
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
   Events, and key namespace on a Transactional Scope undefined. T13
   resolves it.
6. **`retention.idempotency` versus the epoch-long tombstone.** Advertised
   limits define `retention.idempotency` for any profile, while receipts
   retain the key's disposition "for the rest of the Scope epoch". T14
   resolves it.
7. **`catch-up-timeout` is named but not defined.** "HTTP consistency,
   caching, and CORS fields" refers to "the normative foreign-view,
   cursor-expired, or catch-up-timeout problem"; no table assigns
   `catch-up-timeout`. T11 assigns it.
8. **`event-history-expired` has no table.** "Reads after deletion" says it
   "remains an Event-Source condition, not a Read-table code"; no other table
   exists. T11 assigns it.
9. **`Idempotency-Key` example versus the IETF draft.** The example is a bare
   token; the IETF `Idempotency-Key` draft quotes the value. T12 chooses the
   bare token deliberately.
10. **Batch statuses partly assigned.** "Batch operation target" assigns
    `200` and `202`, while "Mutation Receipt responses" says exact HTTP
    statuses are not yet assigned. T6 completes the assignment consistently
    with the first.
11. **Double reporting in an owning source's Event Source.** The
    Bead-scoped Event Source reports an incident Link's `updated` fact and,
    once the delta exists, the source's own `updated` fact for the same
    property change; the draft's Event Source rules and the owned-Link rule
    each require one of them. Section 1.1 states the consequence rather
    than removing either.
12. **Erasure-only groups and `transaction`.** "For an ordinary visible
    group, `projectionAdvance` is false and `transaction` is present", yet
    erasure is administrative — the draft keeps its mechanism outside BDP
    and it has no receipt — and the draft never says what `transaction` an
    erasure group carries. T16 (c) resolves it.
13. **A snapshot's inline owned Links appear twice.** A snapshot's `beads`
    stream inlines owned Links and its `links` stream carries the same
    Links; the draft says they are one graph but not which stream a replica
    treats as authoritative for Link identity when they disagree. Section 7
    lists it; the packet takes the `links` stream and the group's Link
    `upsert` as authoritative for the Link and the Bead postimage as
    authoritative for the source's revision, and it does not rule further.
