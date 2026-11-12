# BDP Core

> _Generated from core.lumen. Do not edit — edit `specs/core.lumen`._

The Core profile of BDP, v0.2. This file is the source for the schemas and the six
operations. The Markdown reference, the JSON Schema and the OpenAPI document are generated
from it. Read [AGENTS.md](../AGENTS.md) before changing it.

Section references (§n) point into `core.md`. A sidebar marked **Open** names something
not decided. A sidebar marked **Todo** names work still to do in this file.

## Overview

A BDP service holds a **Scope** of Resources and answers a fixed, small protocol
over them. A Resource is a **Bead** (a node) or a **Link** (a directed edge); the
two share one identifier space and one record shape, and `kind` discriminates them
(§2.2). Everything else — Types, the typed `createBead`/`updateLink` entry points,
query, batch — is a **callable** layered above this Core, not part of it (§6, §14).

The whole surface is six primitives, uniform over resource kind. A service offers some
or all of them, and says which in its discovery document (see **Discovery**).

| primitive | method | what it does |
| --- | --- | --- |
| `get` | `GET` | safe point read of a Resource → its representation |
| `create` | `POST` | admit a new Bead or Link into a Scope |
| `update` | `PATCH` | JSON Patch a Resource's `/properties` and `/metadata` |
| `delete` | `DELETE` | retire a Resource; returns its final identity |
| `pull` | `GET` | read a page of an EventSource's events (the changefeed is one) |
| `call` | `POST` | invoke a named callable and get its `Reply` back |

## Cross-op semantics

**One record, read everywhere.** `get`, `create` and `update` all answer with a
`ResourceRepresentation` — the same Bead/Link record that rides on events and in an
export. A record describes itself: it carries its own `kind`, `id`, `revision` and
`storageClass`, so a reader who met it on a stream needs no out-of-band framing
(§2.2).

**Two failure channels, split by primitive (§4.4, §4.5).** Only `call` carries the
rich `Outcome`. A callable that runs and reaches a verdict answers `success` or
`failure` (its own declared error); anything the *protocol* reports — a refused
request, a broken-off operation, a timeout — is a `fault` carrying an RFC 9457
`Problem`. The other five primitives have **no** `failure` and no `Outcome`: each
either returns its value or faults. Over HTTP those five stay as plain as HTTP
allows — 2xx carries the bare value, a failing status carries the `Problem` (§13.2).

**Context rides beside every request (§4.3).** A caller supplies the request context
(`cause`, `provenance`, `metadata`) in request headers, the same headers on all six
primitives. The service returns the reply context (`cause`, `transaction`, `metadata`)
in response headers for the five data primitives and inside the `Reply` for `call`.
Context is never part of a value.

> **Open** — the `BDP-` header names, and one header for each member of a context, are
> proposed.

**Revisions are opaque (§3.1).** A `revision` is an equality token, not an ordering
or a timestamp. `update` and `delete` take an optional `If-Match` revision for
optimistic concurrency; a mismatch faults with `revision-mismatch`.

> **Open** — `If-Match` as the place of that guard is proposed.

**One URL, two readings.** An EventSource is a Bead, so its URL answers `get` like any
other Resource: the Bead's record. `pull` is a GET on the same URL with the query
parameter `view=events`, and answers a page of the EventSource's events. A request
without that parameter is never a `pull`.

**Events are the system's own report (§7).** Each Scope has a built-in **changefeed**
EventSource whose events are the change events `create`/`update`/`delete` produce.
`pull` reads any EventSource, the changefeed included, as finite pages over an opaque
cursor. The changefeed's events are change events; what the events of another
EventSource look like is given by its own declaration, which Types defines.

## Operations

The six primitives, documented as HTTP/REST. The shared rules — kind-uniformity, the
value-or-fault model, and the context headers — are in **Cross-op semantics** above,
not repeated here.

> **Open** — the success statuses are proposed: `201` with `Location` for `create`, and
> `200` for `get`, `update`, `delete` and `pull`.

>Eva (first-read item 17): `get` and `call` are written as `fn` and the other four as
`command`, and `call`, the one with effects, has no `fails`. Your word was that this is
wrong for an HTTP profile. I have left the six signatures alone for your pass.

### `get`

Safe point read of the Resource at the request URL. Answers the current revision, or the exact revision named by the `revision` query parameter. That parameter is the only way a request names a revision: a client that holds a pinned Reference sends its `uri` as the URL and its `revision` as the parameter. On an EventSource's URL, `get` answers the Bead's record; its events are read with `pull`. Never mutates; faults with 404/410 when the Resource is absent or erased.

**Method**

`GET` on a `resource` URL

| query parameter | schema | required |
| --- | --- | --- |
| `revision` | `Revision` | false |

**Request Headers**

| header | meaning |
| --- | --- |
| `BDP-Cause` | cause (`Reference`) |
| `BDP-Provenance` | provenance (`ProvenanceInput`) |
| `BDP-Metadata` | metadata (open object) |

**Request Entity Body**

_none_

**Response Headers**

| header | meaning |
| --- | --- |
| `BDP-Cause` | cause (`Reference`) |
| `BDP-Transaction` | transaction (`Reference`) |
| `BDP-Metadata` | metadata (open object) |

**Response Entity Body**

| status | content-type | entity body |
| --- | --- | --- |
| 200 | application/json | `ResourceRepresentation` |

**Errors**

| status | content-type | entity body |
| --- | --- | --- |
| 400, 404, 406, 410 | application/problem+json | `Problem` |

### `create`

Admit a new Bead or Link into a Scope. The body is uniform over kind; the service allocates identity unless the caller proposes one (§5.4). Returns the admitted representation and its canonical URL in `Location`.

**Method**

`POST` on a `scope` URL

**Request Headers**

| header | meaning |
| --- | --- |
| `BDP-Cause` | cause (`Reference`) |
| `BDP-Provenance` | provenance (`ProvenanceInput`) |
| `BDP-Metadata` | metadata (open object) |

**Request Entity Body**

`application/json` → `CreateRequest`

**Response Headers**

| header | meaning |
| --- | --- |
| `BDP-Cause` | cause (`Reference`) |
| `BDP-Transaction` | transaction (`Reference`) |
| `BDP-Metadata` | metadata (open object) |
| `Location` | `AbsoluteHttpUrl` |

**Response Entity Body**

| status | content-type | entity body |
| --- | --- | --- |
| 201 | application/json | `ResourceRepresentation` |

**Errors**

| status | content-type | entity body |
| --- | --- | --- |
| 400, 409, 422 | application/problem+json | `Problem` |

> **Open** — `update`: the body, an RFC 6902 patch limited to `/properties` and
> `/metadata`, is proposed. A service need not offer `update`; that it answers `405` when
> it does not is proposed.

>Eva (item 3): a deleted Resource is brought back by an update that starts from an
earlier revision, and this operation has no place to name that revision. Two ways were
raised and neither is chosen: accept PUT as well, or leave it to a core library callable.

### `update`

Apply a JSON Patch limited to `/properties` and `/metadata` (§3.3). Optional `If-Match` gives optimistic concurrency; a stale revision faults with `revision-mismatch`. Returns the new representation.

**Method**

`PATCH` on a `resource` URL

**Request Headers**

| header | meaning |
| --- | --- |
| `BDP-Cause` | cause (`Reference`) |
| `BDP-Provenance` | provenance (`ProvenanceInput`) |
| `BDP-Metadata` | metadata (open object) |
| `If-Match` | `Revision` |

**Request Entity Body**

`application/json-patch+json` → `JsonPatch`

**Response Headers**

| header | meaning |
| --- | --- |
| `BDP-Cause` | cause (`Reference`) |
| `BDP-Transaction` | transaction (`Reference`) |
| `BDP-Metadata` | metadata (open object) |

**Response Entity Body**

| status | content-type | entity body |
| --- | --- | --- |
| 200 | application/json | `ResourceRepresentation` |

**Errors**

| status | content-type | entity body |
| --- | --- | --- |
| 400, 404, 409, 412, 422 | application/problem+json | `Problem` |

> **Open** — `delete`: the plain DELETE on the Resource's URL, and the final identity as
> its answer, are proposed.

>Eva (item 13): the text below says a second delete of the same Resource settles the same
way, and marks the operation idempotent. `core.md` proposes the opposite: refused as not
found. Neither is decided. It is on the list for the session on `delete`.

>Eva (item 14): `core.md` has `delete` return `{ id, kind, type, revision,
previousRevision }`; this file returns `ResourceIdentity`, which is `{ id, revision,
type }`. Your note was that we may be mixing up the change event and the plain record.
Left as it is.

### `delete`

Retire a Resource, minting a final revision. Idempotent — deleting an already-deleted Resource settles the same way. Faults with `incident-links-exist` when Links still attach (§5.6). Returns the final identity, not a representation.

**Method**

`DELETE` on a `resource` URL

**Request Headers**

| header | meaning |
| --- | --- |
| `BDP-Cause` | cause (`Reference`) |
| `BDP-Provenance` | provenance (`ProvenanceInput`) |
| `BDP-Metadata` | metadata (open object) |
| `If-Match` | `Revision` |

**Request Entity Body**

_none_

**Response Headers**

| header | meaning |
| --- | --- |
| `BDP-Cause` | cause (`Reference`) |
| `BDP-Transaction` | transaction (`Reference`) |
| `BDP-Metadata` | metadata (open object) |

**Response Entity Body**

| status | content-type | entity body |
| --- | --- | --- |
| 200 | application/json | `ResourceIdentity` |

**Errors**

| status | content-type | entity body |
| --- | --- | --- |
| 400, 404, 409, 412 | application/problem+json | `Problem` |

> **Todo** — EventSource is to be worked through as a whole once the rest of this file is
> settled. Held for that: `from` and `head` are typed as a Resource revision but are
> positions in a stream; a page is typed as change events only; `data` on a change event
> is typed `any`; the held-open form of `pull` is not written here.

> **Open** — `pull`: the parameters `after`, `from`, `limit` and `representation` are
> proposed, and so are the name and the value of `view=events`.

>Eva (item 6): the stream is named twice, once as the first parameter `eventSource` and
again as `PullRequest.source`. Over HTTP it is the request URL. I would drop
`PullRequest.source`; left for you to look at.

### `pull`

Read a finite page of an EventSource's events — the changefeed or a declared stream. A GET on the EventSource's URL with `view=events`; without that parameter the same URL answers `get` with the Bead's record. Resumes from an opaque cursor or a fresh start point; `head` tells a reader whether it has caught up. Safe; faults with `cursor-expired` below the retention floor (§7.5).

**Method**

`GET` on an `eventSource` URL

| query parameter | schema | required |
| --- | --- | --- |
| `view` | `ResourceView` | true |
| `after` | `Cursor` | false |
| `from` | `Revision` | false |
| `limit` | `number` | false |
| `representation` | `EventRepresentation` | false |

**Request Headers**

| header | meaning |
| --- | --- |
| `BDP-Cause` | cause (`Reference`) |
| `BDP-Provenance` | provenance (`ProvenanceInput`) |
| `BDP-Metadata` | metadata (open object) |

**Request Entity Body**

_none_

**Response Headers**

| header | meaning |
| --- | --- |
| `BDP-Cause` | cause (`Reference`) |
| `BDP-Transaction` | transaction (`Reference`) |
| `BDP-Metadata` | metadata (open object) |

**Response Entity Body**

| status | content-type | entity body |
| --- | --- | --- |
| 200 | application/json | `PullPage` |

**Errors**

| status | content-type | entity body |
| --- | --- | --- |
| 400, 410 | application/problem+json | `Problem` |

> **Open** — `call`: proposed are the statuses `200` and `202`, the `Location` header, and
> that a `fault` is sent with the status of its Problem. Under that proposal a `fault` can
> also arrive as `409`, so the arm in the `Reply` says how the call ended, and the status
> does not. Not designed: the status for an arm another specification adds.

### `call`

Invoke a named callable. The only primitive with the rich Outcome — the returned `Reply` carries `success`, `failure` (the callable's declared error) or `fault`, and the client branches on the arm, not the status. A 2xx status is sent only when the outcome is `success`; a declared `failure` is sent as `409`. May run async, returning a result bead at `Location` (§6.4/§6.5).

**Method**

`POST` on a `callable` URL

| query parameter | schema | required |
| --- | --- | --- |
| `mode` | `CallMode` | false |

**Request Headers**

| header | meaning |
| --- | --- |
| `BDP-Cause` | cause (`Reference`) |
| `BDP-Provenance` | provenance (`ProvenanceInput`) |
| `BDP-Metadata` | metadata (open object) |

**Request Entity Body**

`application/json` → `CallRequest`

**Response Headers**

| header | meaning |
| --- | --- |
| `Location` | `AbsoluteHttpUrl` |

**Response Entity Body**

| status | content-type | entity body |
| --- | --- | --- |
| 200 | application/json | `Reply` — sync — the outcome is `success` |
| 202 | application/json | `AsyncResultBead` — async — result bead at Location |

**Errors**

| status | content-type | entity body |
| --- | --- | --- |
| 409 | application/json | `Reply` — sync — the outcome is a declared `failure` |
| default | application/json | `Reply` — sync — the outcome is a `fault`, sent with the status of its Problem, or an arm another specification adds |

## Built-in bead types

Beads fall into two families (§2.7). A **data bead** is an ordinary Resource, created,
updated and deleted through the primitives. A **capability bead** stands for something
the service can do; its storage class is `Intrinsic`, it is **declared by the service**
(a client cannot `create` one), and it answers `get` plus one of the capability
primitives.

Core names a small set of **well-known Types**, each identified by a fixed type-bead URL
so a client can recognise what a Bead is from its `type` alone. Core stays silent on what
each Type *means* — that is Types' job (§2.4) — except where a Type's content is one of
Core's own envelopes.

| Well-known Type | family | Core uses it to | Core says about its content |
| --- | --- | --- | --- |
| `Type` | data | mark a type bead | nothing — Types defines it |
| `Callable` | capability | mark a Bead that answers `call` | nothing — Types defines the declaration |
| `EventSource` | capability | mark a Bead that answers `pull` | nothing — Types defines the declaration |
| `AsyncResult` | data | mark the result bead of an async `call` | that it holds a `Reply` (§6.5) — Core's own envelope |
| `ResultOf` | link | mark the Link from a result bead to the Callable it ran | nothing beyond its endpoints (§6.5) |

A Resource whose Type *refines* a well-known Type is treated as that Type; what "refines"
means is Types'. `AsyncResult` is the one exception to Core's silence about content,
because a result bead holds a `Reply`.

> **Open** — the two families and the list of well-known Types are proposed. The fixed
> URLs of the well-known type beads are not yet assigned; a sixth Type (`Alias`) is added
> if the §2.9 alias proposal stands; `ResultOf` is a placeholder name (§15).

## Primitive types

The scalar carriers the records are built from — base types plus the refinements
Lumen doesn't carry natively. Each is transparent (`schema X = T ⇒ X ≡ T`).

| type | base | refinements | description |
| --- | --- | --- | --- |
| `BdpVersion` | `"0.2"` | — | The Core profile version this document binds; a constant. |
| `ResourceKind` | `"bead"` \| `"link"` | — | Discriminates the two Resource shapes that share one identifier space. |
| `Revision` | `string` | `minLength: 1` | Nonempty opaque Resource-version token. Clients compare it for exact equality and cannot infer order, time or allocation from its spelling. |
| `DateTime` | `string` | `format: date-time` | RFC 3339 date-time; uppercase T and Z. |
| `LocalName` | `string` | `pattern: ^[A-Za-z][A-Za-z0-9_-]*$` | A short identifier token for a view or a well-known name; letters, digits, hyphen and underscore, leading letter. |
| `AbsoluteUri` | `string` | `format: uri` | Any absolute URI; the identity form for Types and causes. |
| `AbsoluteHttpUrl` | `string` | `format: uri` | A Resource's absolute canonical identity URL; the local part is opaque to clients. |
| `IdempotencyKey` | `string` | `pattern: ^[A-Za-z0-9_-]{1,256}$` | Caller-chosen key that makes a retried write safe to collapse. |
| `Ordinal` | `number` | — | An event's position in its stream; monotone within one EventSource. |
| `Cursor` | `string` | — | Opaque resume token bound to one stream and the selection it came from; refused if used elsewhere. Also the point an export is cut at. |
| `EventType` | `"created"` \| `"updated"` \| `"deleted"` | — | What a change event reports happened to its subject. |
| `EventRepresentation` | `"full"` \| `"patch"` | — | Whether `pull` returns each update's complete new state or a patch (§7.2). |
| `ResourceView` | `"events"` | — | Selects what a GET on a Resource's URL answers with, in place of the Resource's record. One value is defined: `events`, which makes the request a `pull`. |
| `CallMode` | `"sync"` \| `"async"` | — | Whether a callable is invoked synchronously or asynchronously (§6.4). |
| `IdentityBasis` | `"writer-supplied"` \| `"channel-authenticated"` \| `"unknown"` | — | How a service established a principal's identity (§3.2). |

## References and identity

A Reference is how one Resource names another: a floating URL, or a URL pinned to an
exact revision (§2.5).

>Eva: the `id@rev` forms belong to the CLI only and translate on the wire to scope, id
and revision. The shape below carries the scope and the id joined as one URL, plus the
revision. Whether the wire should carry the three apart is the first topic I would take
in the review; nothing is changed here.

### `Reference`

Either a floating absolute URL or a revision-pinned Reference. A bare URL tracks the target's current revision; a pin fixes it.

```text
AbsoluteUri | PinnedReference
```

### `PinnedReference`

_Pinned reference_

A complete exact Reference — both the target URL and a concrete revision, no other members.

```text
{
  "uri": AbsoluteUri,
  "revision": Revision
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `uri` | `AbsoluteUri` | no | The target Resource's identity URL. |
| `revision` | `Revision` | no | The concrete opaque revision of the recorded target. |

## Resource records

The self-describing Bead and Link records (§2.2). `properties` holds the content the
Resource's Type governs; `metadata` holds content the Type does not — both open JSON
objects, specified inline. Storage class and provenance are returned with the record.

> **Open** — owned Links stay in the model until something better is found, and
> `ownedLinks` stays with them.

### `BeadRepresentation`

_Bead_

A complete Bead — a node in the Scope. Carries its own identity, Type, revision and storage class so a record read from a stream or an export describes itself.

```text
{
  "id": AbsoluteHttpUrl,
  "kind": "bead",
  "type": Reference,
  "revision": Revision,
  "storageClass": StorageClass,
  "properties": { ...: any },
  "metadata": { ...: any },
  "revisionProvenance"?: RevisionProvenance,
  "ownedLinks"?: [Reference]
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `id` | `AbsoluteHttpUrl` | no | Absolute canonical immutable Resource identity URL. |
| `kind` | `"bead"` | no | Resource-kind discriminator; always `bead` here. |
| `type` | `Reference` | no | The Resource's Type (§2.4). |
| `revision` | `Revision` | no | Opaque version token of this recorded state. |
| `storageClass` | `StorageClass` | no | How this Resource is kept — durable, ephemeral or intrinsic (§2.6). |
| `properties` | `{ ...: any }` | no | Application-authored, Type-governed object state. |
| `metadata` | `{ ...: any }` | no | Common mutable state the Type does not govern. |
| `revisionProvenance` | `RevisionProvenance` | yes | Who took part in the change that made this revision, and how its period began (§3.2). |
| `ownedLinks` | `[Reference]` | yes | The Bead's owned Links, when selected as a current aggregate (§2.8). |

### `LinkRepresentation`

_Link_

A complete directed Link — an edge from `source` to `target`. Link identity is its own Resource identity, independent of the endpoint tuple; two Links may share Type, source and target.

```text
{
  "id": AbsoluteHttpUrl,
  "kind": "link",
  "type": Reference,
  "revision": Revision,
  "storageClass": StorageClass,
  "source": Reference,
  "target": Reference,
  "properties": { ...: any },
  "metadata": { ...: any },
  "revisionProvenance"?: RevisionProvenance
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `id` | `AbsoluteHttpUrl` | no | Absolute canonical immutable Resource identity URL. |
| `kind` | `"link"` | no | Resource-kind discriminator; always `link` here. |
| `type` | `Reference` | no | The Resource's Type (§2.4). |
| `revision` | `Revision` | no | Opaque version token of this recorded state. |
| `storageClass` | `StorageClass` | no | How this Resource is kept; a Link is as ephemeral as its most ephemeral endpoint (§2.6). |
| `source` | `Reference` | no | The Link's source endpoint Reference. |
| `target` | `Reference` | no | The Link's target endpoint Reference. |
| `properties` | `{ ...: any }` | no | Application-authored, Type-governed object state. |
| `metadata` | `{ ...: any }` | no | Common mutable state the Type does not govern. |
| `revisionProvenance` | `RevisionProvenance` | yes | Who took part in the change that made this revision (§3.2). |

### `ResourceRepresentation`

_Resource representation_

The generic read/create/update value — a Bead or a Link, discriminated by `kind`.

```text
BeadRepresentation | LinkRepresentation
```

### `ResourceIdentity`

_Resource identity_

The identity, Type and concrete revision recorded for a Resource — including the final revision a deletion minted. Not a live postimage; what `delete` returns.

```text
{
  "id": AbsoluteHttpUrl,
  "revision": Revision,
  "type": Reference
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `id` | `AbsoluteHttpUrl` | no | Absolute canonical immutable Resource identity URL. |
| `revision` | `Revision` | no | Concrete opaque revision of the recorded version. |
| `type` | `Reference` | no | The Resource's Type (§2.4). |

## Storage class and provenance

How a Resource is kept, and who made its current revision (§2.6, §3.2).

**Provenance has two shapes.** `RevisionProvenance` is what the service saves with a
revision and returns as `revisionProvenance`. `ProvenanceInput` is what a caller supplies
in the request context. The input is the smaller one: it leaves out every member that
only the service may set.

**Principals and roles.** A principal is a person, an agent or a service account that
took part in a change. Its `id` is an absolute URI or a URN and need not resolve. Its
`displayName` is a saved label, never the identity and never a key to match on. One
principal may hold several roles, and several principals may hold the same role. Three
roles are named to begin with:

- `initiator` — asked for the work;
- `contributor` — helped produce the change;
- `submitter` — the identity the change was submitted under.

The set of roles is open, and a reader keeps a role it does not know. Every role is
optional. An absent role means it was not recorded; a service MUST NOT invent a principal
to fill one. A role grants no permission. The position of a principal in the list has no
meaning.

**What the service sets.** A caller supplies principals, a message and metadata, and
nothing else. The service sets `committedAt` and `inception`. It marks each supplied
principal `writer-supplied`, unless it established that identity itself. Core does not
stop a service from authenticating its caller: a service MAY mark an identity it
authenticated `channel-authenticated` and name itself in `authority`. `basis` says how an
identity was established, not whether its roles are true. A service that cannot record a
member the caller supplied refuses the request.

**Inception** says how the Resource's present period began: `create`, `revert` or
`unknown`. The set is open. It is kept across updates, and by the final revision a
deletion mints. Bringing a deleted Resource back sets it to `revert`.

**Provenance is data, not evidence.** It is saved with the revision and never changes
afterward. It describes one change, except `inception`, which describes the period.
Supplying provenance never causes a revision by itself.

> **Open** — the shape is proposed. Still to decide: the names of the `basis` values and
> of the member `authority`; the three role names; the values of `inception`, which are
> to become a closed, named set; whether a service may add to `principals` an identity it
> authenticated and the caller did not supply; and what is recorded when a caller
> supplies an identity and the service authenticates the same one, or a different one.

>Eva (item 5): your word was that `committedAt` and `inception` are not input. The input
shape below also leaves out `basis` and `authority`, for the same reason. `inception` and
`roles` are still typed as plain strings; naming their values as schemas is left for your
pass.

### `StorageClass`

_Storage class_

How a Resource is kept. Durable state is replicated and exported; ephemeral state is local and never exported; intrinsic Resources are computed by the service, not stored.

```text
  { "Durable": { "versioned": boolean } }
| "Ephemeral"
| "Intrinsic"
```

| arm | carries |
| --- | --- |
| `Durable` | `"versioned": boolean` |
| `Ephemeral` | _no payload_ |
| `Intrinsic` | _no payload_ |

### `RevisionProvenance`

_Revision provenance_

Who took part in the change that made a revision, in what role, and when it was committed; also how the Resource's present period began. Saved with the revision and returned as `revisionProvenance`. Never changes once saved.

```text
{
  "principals"?: [Principal],
  "inception"?: string,
  "committedAt"?: DateTime,
  "message"?: string,
  "metadata"?: { ...: any }
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `principals` | `[Principal]` | yes | The principals who took part, each in one or more roles. The order has no meaning. |
| `inception` | `string` | yes | How the Resource's present period began — `create`, `revert` or `unknown`. Set by the service. An open set; a reader keeps a value it does not know. |
| `committedAt` | `DateTime` | yes | When this revision was committed. Set by the service. |
| `message` | `string` | yes | A human-readable note on the change. |
| `metadata` | `{ ...: any }` | yes | Open carrier for additional provenance members. |

### `Principal`

An identity that took part in a change — a person, an agent or a service account — as the service recorded it. A role grants no permission; authorization is a separate decision (§9).

```text
{
  "id": AbsoluteUri,
  "displayName"?: string,
  "roles"?: [string],
  "basis": IdentityBasis,
  "authority"?: AbsoluteUri
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `id` | `AbsoluteUri` | no | Absolute URI or URN naming the identity; need not be resolvable. |
| `displayName` | `string` | yes | A saved label; never identity and never a matching key. |
| `roles` | `[string]` | yes | The roles held — `initiator`, `contributor`, `submitter`, or another. An open set; a reader keeps one it does not know. |
| `basis` | `IdentityBasis` | no | How this identity was established. Set by the service; says nothing about whether the roles are true. |
| `authority` | `AbsoluteUri` | yes | For a channel-authenticated identity, the service that established it. Set by the service. |

### `ProvenanceInput`

_Provenance input_

The provenance a caller supplies for the revision its request makes. It has no `committedAt`, no `inception`, and no `basis` or `authority` on a principal: the service sets those.

```text
{
  "principals"?: [PrincipalInput],
  "message"?: string,
  "metadata"?: { ...: any }
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `principals` | `[PrincipalInput]` | yes | The principals the caller says took part, each in one or more roles. The order has no meaning. |
| `message` | `string` | yes | A human-readable note on the change. |
| `metadata` | `{ ...: any }` | yes | Open carrier for additional provenance members. |

### `PrincipalInput`

_Principal input_

A principal as a caller supplies it. The service records it as a `Principal`, marked `writer-supplied` unless the service established the identity itself.

```text
{
  "id": AbsoluteUri,
  "displayName"?: string,
  "roles"?: [string]
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `id` | `AbsoluteUri` | no | Absolute URI or URN naming the identity; need not be resolvable. |
| `displayName` | `string` | yes | A saved label; never identity and never a matching key. |
| `roles` | `[string]` | yes | The roles held — `initiator`, `contributor`, `submitter`, or another. An open set. |

## Execution context

The request context rides in request headers on all six primitives. The reply context
rides in response headers for the five data primitives and sits in the `Reply` body for
`call` (§4.3). Provenance is supplied here, never as an operation input and never in the
URL.

### `RequestContext`

_Request context_

What a caller supplies alongside a request — the cause it acts under, the provenance to record, and open metadata.

```text
{
  "cause"?: Reference,
  "provenance"?: ProvenanceInput,
  "metadata"?: { ...: any }
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `cause` | `Reference` | yes | The cause this request acts under (§4.2). |
| `provenance` | `ProvenanceInput` | yes | Provenance the caller supplies for the revision this request makes (§3.2). The input shape: the service adds what only it may set. |
| `metadata` | `{ ...: any }` | yes | Open caller-supplied metadata. |

### `ReplyContext`

_Reply context_

What a service returns alongside a response — the cause, the transaction the change committed in, and open metadata.

```text
{
  "cause"?: Reference,
  "transaction"?: Reference,
  "metadata"?: { ...: any }
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `cause` | `Reference` | yes | The cause the operation was recorded under (§4.2). |
| `transaction` | `Reference` | yes | The transaction this change committed in; shared by every event from one commit (§4.1). |
| `metadata` | `{ ...: any }` | yes | Open service-supplied metadata. |

## Outcome, Reply and Problem

The in-band result model for `call` (§4.4, §4.5). `Result` is the callable's own
closed verdict; `Outcome` is the open envelope the protocol wraps it in — a reader
MUST tolerate an arm it does not know.

> **Open** — how an arm's tag is spelled on the wire (§15).

### `Result`

A callable's own verdict — it succeeded with a value, or failed with its declared error. Closed; `value` and `error` are JSON Core does not look inside.

```text
  { "success": { "value": any } }
| { "failure": { "error": any } }
```

| arm | carries |
| --- | --- |
| `success` | `"value": any` |
| `failure` | `"error": any` |

### `Outcome`

What happened to an operation — the Result, or a protocol-reported `fault`, or an arm added by another specification. Open: a reader MUST tolerate an unknown arm, and every arm but `success` means the operation did not go as intended.

```text
  { "success": { "value": any } }
| { "failure": { "error": any } }
| { "fault": { "problem": Problem } }
| …
```

| arm | carries |
| --- | --- |
| `success` | `"value": any` |
| `failure` | `"error": any` |
| `fault` | `"problem": Problem` |
| `…` | _open_ |

### `Reply`

What the caller of `call` gets back — the reply context paired with the outcome. The outcome is absent only before the operation settles; a settled result bead and a synchronous response both carry one.

```text
{
  "context": ReplyContext,
  "outcome"?: Outcome
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `context` | `ReplyContext` | no | The reply context (cause, transaction, metadata). |
| `outcome` | `Outcome` | yes | The settled outcome, present once the operation is settled. |

### `Problem`

An RFC 9457 problem document — what a `fault` carries, and the body of a failing response from the five data primitives (§4.5, §13.2).

```text
{
  "type": AbsoluteUri,
  "title": string,
  "status": number,
  "code": string,
  "retry": "never" | "after-state-change" | "after-delay",
  "detail"?: string,
  "instance"?: AbsoluteUri
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `type` | `AbsoluteUri` | no | A URI identifying the problem type. |
| `title` | `string` | no | Short human-readable summary of the problem type. |
| `status` | `number` | no | HTTP status code for this occurrence. |
| `code` | `string` | no | Machine-branchable BDP problem code (§12 enumerates them). |
| `retry` | `"never" \| "after-state-change" \| "after-delay"` | no | Whether a retry can help — `never`, `after-state-change` or `after-delay`. |
| `detail` | `string` | yes | Human-readable explanation specific to this occurrence. |
| `instance` | `AbsoluteUri` | yes | A URI identifying the specific occurrence. |

`$id`: `https://github.com/gastownhall/bdp/schemas/bdp-v0.2#/$defs/problem`

## Request bodies

The inputs the write and invoke primitives carry (§5, §13).

>Eva (item 12): `AsyncResultBead` below is a plain Bead. Nothing in its shape says that
its `properties` hold a `Reply`, which is the one thing Core says about a result bead's
content.

### `CreateRequest`

_Create request_

The body of `create`, uniform over kind — one shape for a Bead or a Link, discriminated by `kind`. The typed per-kind entry points are core library callables, not Core.

```text
{
  "kind": ResourceKind,
  "type": Reference,
  "id"?: Reference,
  "source"?: Reference,
  "target"?: Reference,
  "properties"?: { ...: any },
  "metadata"?: { ...: any }
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `kind` | `ResourceKind` | no | Which Resource shape to admit. |
| `type` | `Reference` | no | The new Resource's Type (§2.4). |
| `id` | `Reference` | yes | Caller-proposed identity, when the caller allocates it (§5.4). |
| `source` | `Reference` | yes | Source endpoint; required when `kind` is `link`. |
| `target` | `Reference` | yes | Target endpoint; required when `kind` is `link`. |
| `properties` | `{ ...: any }` | yes | Initial Type-governed state. |
| `metadata` | `{ ...: any }` | yes | Initial common metadata. |

### `JsonPatchOp`

_JSON Patch operation_

One RFC 6902 operation. In `update` the paths are limited to `/properties` and `/metadata` (§3.3).

```text
{
  "op": "add" | "remove" | "replace" | "move" | "copy" | "test",
  "path": string,
  "value"?: any,
  "from"?: string
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `op` | `"add" \| "remove" \| "replace" \| "move" \| "copy" \| "test"` | no |  |
| `path` | `string` | no |  |
| `value` | `any` | yes |  |
| `from` | `string` | yes |  |

### `JsonPatch`

_JSON Patch_

The `update` body — an ordered list of JSON Patch operations.

```text
[JsonPatchOp]
```

### `CallRequest`

_Call request_

The body of `call` — the callable's arguments, JSON Core carries and does not look inside (§6.1).

```text
{
  "arguments": { ...: any }
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `arguments` | `{ ...: any }` | no | The callable's arguments. |

### `AsyncResultBead`

_Async result bead_

The result bead an asynchronous `call` returns at its Location; settled when it holds an outcome (§6.5).

```text
BeadRepresentation
```

## Events

Each Scope has a built-in **changefeed** EventSource whose events report changes to
its Resources (§7.3). The change event is Core's own wire shape for what the data
primitives did (§7.2); an EventSource's own declaration — event schema, retention,
cardinality — belongs to Types, not Core (§7.1).

A page read from the changefeed holds change events. A page read from another
EventSource holds the events its declaration describes.

> **Open** — proposed additions to the change event: `subjectKind`, `revision`,
> `previousRevision` and `revisionProvenance`.

>Eva (item 8): the prose above is fixed, and `PullPage.events` is still typed
`[ChangeEvent]`. Changing the type waits for the EventSource pass, with items 7 and 11.

### `ChangeEvent`

_Change event_

Core's report of one committed change to one Resource. Links are their own subjects. Revision and provenance ride on the event, beside `data` and not inside it (§7.2).

```text
{
  "id": AbsoluteHttpUrl,
  "ordinal": Ordinal,
  "type": EventType,
  "source": AbsoluteHttpUrl,
  "subject": AbsoluteHttpUrl,
  "subjectKind": ResourceKind,
  "subjectType": Reference,
  "revision": Revision,
  "previousRevision"?: Revision,
  "transaction"?: Reference,
  "cause"?: Reference,
  "time": DateTime,
  "revisionProvenance"?: RevisionProvenance,
  "data"?: any
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `id` | `AbsoluteHttpUrl` | no | Identifies the event. |
| `ordinal` | `Ordinal` | no | The event's position in its stream. |
| `type` | `EventType` | no | What happened — created, updated or deleted. |
| `source` | `AbsoluteHttpUrl` | no | The EventSource the event was read from. |
| `subject` | `AbsoluteHttpUrl` | no | The URL of the Resource that changed. |
| `subjectKind` | `ResourceKind` | no | The changed Resource's kind. |
| `subjectType` | `Reference` | no | The changed Resource's Type. |
| `revision` | `Revision` | no | The revision this change minted. |
| `previousRevision` | `Revision` | yes | The prior live revision, on an `updated` or a revived `deleted` subject. |
| `transaction` | `Reference` | yes | The transaction this change committed in; shared across one commit. |
| `cause` | `Reference` | yes | The cause the change was made under (§4.2). |
| `time` | `DateTime` | no | When the change was committed. |
| `revisionProvenance` | `RevisionProvenance` | yes | Provenance of the reported revision, so a reader need not read again (§7.2). |
| `data` | `any` | yes | The change itself — the complete new state or a patch; absent on a deletion. |

### `PullRequest`

_Pull request_

The input to `pull` — which stream, where to start, how much, and which representation. `after` (a cursor) and `from` (a fresh start point) are mutually exclusive (§7.4).

```text
{
  "source": Reference,
  "after"?: Cursor,
  "from"?: Revision,
  "limit"?: number,
  "representation"?: EventRepresentation
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `source` | `Reference` | no | The EventSource to read; the changefeed by default. |
| `after` | `Cursor` | yes | A cursor from an earlier `pull` to resume from. |
| `from` | `Revision` | yes | A fresh start point without a cursor — the oldest retained event, or now. |
| `limit` | `number` | yes | Caps the number of events returned. |
| `representation` | `EventRepresentation` | yes | Ask for complete states or patches. |

### `PullPage`

_Pull page_

One finite page of a stream — the floor every service offers: one request, one page, nothing held open (§7.4).

```text
{
  "events": [ChangeEvent],
  "cursor": Cursor,
  "head"?: Revision
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `events` | `[ChangeEvent]` | no | The events in this page, in stream order. Change events when the stream is the changefeed; for another EventSource, the events its declaration describes. |
| `cursor` | `Cursor` | no | Where to resume; opaque, bound to this stream and selection. |
| `head` | `Revision` | yes | The stream head, so a reader can tell whether it has caught up. |

## Export

The export **format** is defined here in Core. The operations that produce and consume
an export are core library callables, but the format they move is Core's.

**Container.** An export is **JSON Lines**: a first record, then one Resource record per
line, then a last record. Each Resource line is **literally the result of `get`** — a
complete `ResourceRepresentation` (§2.2), never a patch. For now an export carries the
**latest revision only**; exporting revision history is a named later addition, and a
patch form will likely follow delta change events. It is the current durable state the
`create`/`update`/`delete` stream adds up to, cut at a cursor a reader resumes the
changefeed from (§10 item 12, §11). Boundary (§11): no callables, no call-record, no
ephemeral or intrinsic Resources. These rules are a starting point and may be revisited.

**Framing records.** They are minimal. The first record opens the file with the protocol
version, the Scope and the cursor it was cut at; the last record closes it with a count
of the Resource records. A reader refuses a file that ends without the last record, so a
truncated export is never taken for a whole one. Each line self-describes by `kind` —
`bead` / `link` for a Resource, a framing kind for the two ends. Levels, per-family
counts and a digest stay out.

> **Open** — proposed: the names and spelling of the two framing records and of their
> `kind` values; that a reader refuses a file with no last record; and the version member
> on the first record. Not designed: whether the export format has a version of its own,
> apart from the protocol's, and what a reader does with a version it does not know.

### `ExportBegin`

_Export — begin record_

The first line of an export. Names the protocol version, the Scope and the cursor the export was cut at, so a consumer resumes the changefeed from exactly here. Told apart from a Resource line by its `kind`.

```text
{
  "kind": "export-begin",
  "bdpVersion": BdpVersion,
  "scope": AbsoluteHttpUrl,
  "cursor": Cursor
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `kind` | `"export-begin"` | no | Framing discriminator for the opening line. |
| `bdpVersion` | `BdpVersion` | no | The protocol version whose export format this file follows. |
| `scope` | `AbsoluteHttpUrl` | no | The exported Scope. |
| `cursor` | `Cursor` | no | The cursor the export was cut at; where a consumer resumes the changefeed. |

### `ExportEnd`

_Export — end record_

The last line of an export. Carries a count of the Resource records, so a truncated file — one that ends without this line — is detectable and never taken for whole.

```text
{
  "kind": "export-end",
  "count": number
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `kind` | `"export-end"` | no | Framing discriminator for the closing line. |
| `count` | `number` | no | Number of Resource records between the begin and end lines. |

## Discovery

A client learns what a Scope offers from the Scope's **discovery document**. A service
offers some or all of the six operations. The discovery document says which, and
describes each one it offers: for example, that `update` takes a JSON Patch body.

**How to get it.** A Scope has one canonical URL, ending in `/`. A GET of that URL
succeeds and carries a `Link` header with `rel="service-desc"` whose target is the
discovery document. A GET of that target answers the `Discovery` record below as
`application/json`. The body of the Scope URL itself is never the discovery document.

```http
GET /acme/ HTTP/1.1
Host: beads.example

HTTP/1.1 204 No Content
Link: <https://beads.example/acme/bdp>; rel="service-desc"
```

**The OpenAPI document.** A Scope serves an OpenAPI description of its own surface at the
fixed route `bdp/openapi` under the Scope URL, as `application/openapi+json`. The Scope
URL carries a second `service-desc` Link to it, with `type="application/openapi+json"`.
A client takes a `service-desc` Link to be the discovery document unless its `type` says
OpenAPI.

```http
Link: <https://beads.example/acme/bdp/openapi>; rel="service-desc"; type="application/openapi+json"
```

**An operation that is not offered.** An operation is offered when it has a member in
`operations`. A request for one that is not offered is refused.

> **Open** — the way of getting both documents is carried from v0.1 and has not been
> looked at again; that includes whether the OpenAPI document stays optional, as it was
> there. Every member of the discovery record beyond "which operations are offered" is
> proposed, and so is each characterization. Also proposed: `405` for an operation that is
> not offered. Not decided: whether `get` is the one operation every service offers, and
> the largest request context a service must accept. The v0.1 member `profile` is dropped
> here.

>Eva (item 2): the two fetches are written as prose and not as operations, so the count
of operations stays at six. If you want them in the generated OpenAPI document, they need
a form in this file that is not one of the six primitives.

### `Discovery`

_Discovery document_

What a Scope offers: the protocol version, the Scope, the revision of the specification the service was built to, and the operations it offers.

```text
{
  "bdpVersion": BdpVersion,
  "scope": AbsoluteHttpUrl,
  "specRevision": string,
  "operations": OperationsOffered,
  "changefeed"?: AbsoluteHttpUrl,
  "limits"?: { ...: any },
  "capabilities"?: { ...: any }
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `bdpVersion` | `BdpVersion` | no | The protocol version the service speaks. |
| `scope` | `AbsoluteHttpUrl` | no | The Scope's canonical URL. |
| `specRevision` | `string` | no | The revision of the specification source the service was built to. |
| `operations` | `OperationsOffered` | no | The operations the Scope offers, each with its characterization. |
| `changefeed` | `AbsoluteHttpUrl` | yes | The URL of the Scope's changefeed EventSource, when the Scope offers `pull`. |
| `limits` | `{ ...: any }` | yes | Limits the service applies, such as the largest page of a `pull`. |
| `capabilities` | `{ ...: any }` | yes | Open carrier for what another specification advertises. |

### `OperationsOffered`

_Operations offered_

One member for each operation the Scope offers. An absent member means the operation is not offered. The value characterizes the operation.

```text
{
  "get"?: GetOffer,
  "create"?: CreateOffer,
  "update"?: UpdateOffer,
  "delete"?: DeleteOffer,
  "pull"?: PullOffer,
  "call"?: CallOffer
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `get` | `GetOffer` | yes | `get` is offered. |
| `create` | `CreateOffer` | yes | `create` is offered. |
| `update` | `UpdateOffer` | yes | `update` is offered. |
| `delete` | `DeleteOffer` | yes | `delete` is offered. |
| `pull` | `PullOffer` | yes | `pull` is offered. |
| `call` | `CallOffer` | yes | `call` is offered. |

### `GetOffer`

_Offer of get_

How the Scope offers `get`.

```text
{
  "history"?: boolean
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `history` | `boolean` | yes | Whether a `get` can name a revision that is not the current one. |

### `CreateOffer`

_Offer of create_

How the Scope offers `create`.

```text
{
  "storageClasses"?: [string]
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `storageClasses` | `[string]` | yes | The storage classes a `create` may ask for — `durable` or `ephemeral`. |

### `UpdateOffer`

_Offer of update_

How the Scope offers `update`.

```text
{
  "patchFormats"?: [string]
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `patchFormats` | `[string]` | yes | The media types the service accepts as the body of an `update`, such as `application/json-patch+json`. |

### `DeleteOffer`

_Offer of delete_

How the Scope offers `delete`. No characterization is defined.

```text
{

}
```

| field | type | optional | description |
| --- | --- | --- | --- |

### `PullOffer`

_Offer of pull_

How the Scope offers `pull`.

```text
{
  "push"?: boolean,
  "representations"?: [EventRepresentation]
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `push` | `boolean` | yes | Whether the service also offers the held-open form of `pull`. |
| `representations` | `[EventRepresentation]` | yes | The representations a `pull` may ask for. |

### `CallOffer`

_Offer of call_

How the Scope offers `call`.

```text
{
  "modes"?: [CallMode]
}
```

| field | type | optional | description |
| --- | --- | --- | --- |
| `modes` | `[CallMode]` | yes | The modes the service accepts; a mode not listed is refused. |

## Appendix — the `///` metadata vocabulary

Metadata is **one namespaced record per backend**. A `///` field is either a plain
string (`key: text`) or a typed record / array / scalar value (`key = { … }`), read
by the v0.2 `=` value reader. The namespace is the single top-level key — `bdp`,
`openapi`, `jsonschema`, `go`, … — so there are **no dotted keys and no key-grammar
change**: the structure lives in the value.

Cross-cutting doc fields use the plain-string form: `title:` and `description:` (on a
schema, and on each field inside a record), consumed by every backend.

- **`bdp`** — protocol markers: `{ kind = "primitive", primitive = "get", id = "<uri>" }`
- **`doc`** — reference-rendering mode: `{ style = "http" }` documents an operation as
  HTTP/REST (Method · Request Headers · Request Entity Body · Response Headers · Response
  Entity Body · Errors); `{ style = "rpc" }` (the default) keeps the signature-style block
  used for Types, Callables and EventStreams.
- **`jsonschema`** — refinements Lumen's base types don't carry: `{ format = "date-time" }`
  · `{ pattern = "…" }` · `{ minLength = 1 }` · `{ closed = false }`
- **`openapi`** — projection control:
  `{ operationId, method, pathItem, tags = [ … ],`
  `  request = { contentType },`
  `  params = { <name> = { in, schema, required } },`
  `  paramGroups = [ "requestContext", "replyContext" ],`
  `  success = { status, contentType },`
  `  problem = { status = [ … ], contentType = "application/problem+json" },`
  `  responses = [ { status, contentType, schema, description } ],`
  `  responseHeaders = { Location = { schema } } }`

`paths` is empty (URLs are discovered); signatures live in `components.pathItems`.
`requestContext` → `BDP-Cause / BDP-Provenance / BDP-Metadata` request headers;
`replyContext` → `BDP-Cause / BDP-Transaction / BDP-Metadata` reply headers.
