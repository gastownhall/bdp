---
status: draft
intended-status: normative
version: "0.1"
---

# Beads Protocol — Events

Editorial draft v0.1. Events adds optional finite observation to [Core](../core/core.md)
and [Write](../write/write.md). It does not add a new base profile literal or a
Transfer capability. Core defines Resource identity, References, revisions,
authorization, shared HTTP behavior and final publication. Write defines mutations;
when Events is advertised, its published facts must also satisfy this profile.

## Contract and advertisement

> Streaming, replication and import-composition questions are preserved in the
> [informative appendix](#appendix-open-design-questions), separately from this finite contract.

Events is optional for both Core and Write. A Scope advertises support through the
capability `https://github.com/gastownhall/bdp/capabilities/events`; absence means
that clients MUST NOT assume an Event source or `view=events` is supported. Its source
sits at Core's fixed `<scope>/bdp/events` ([fixed navigation](../core/core.md#fixed-navigation)).
The advertisement is an explicit promise of
the complete finite-observation contract below, not permission to provide only a
live stream or to omit required facts. Advertising Events creates no export,
import, snapshot or replica-application capability.

A request selecting `view=events` on a Scope without Events support MUST be refused
as an unsupported view using `invalid-parameter`; it MUST NOT return an ordinary
Resource representation in its place. Clients MUST NOT read the Event source of a
Scope that does not advertise Events.

### Advertised source, truthful coverage

A Core/Write Scope advertising Events MUST expose its source at `<scope>/bdp/events`
and a Resource-scoped projection through `view=events`. A source is an observation
endpoint, not a third Resource kind, public receipt or replica log. Resource
selection uses canonical identity/kind and current disclosure; the source can
remain readable after subject deletion under its actual retention/disclosure.
Unknown subjects do not become distinguishable from forbidden subjects. Opaque
external Link endpoints do not acquire in-Scope Event sources.

An Event records a published Resource transition, a published change to the
[non-Resource state](#non-resource-facts) a source advertises, or a truthfully described external
observation. Policy declares `observation:"committed"` when it covers every relevant
published transition from the stated boundary; `observation:"observed"` when the
external mechanism can miss original intermediate mutations. Required `description`
states that mechanism and any intermediate-loss limitation. Observed coverage MUST
NOT be represented as a gap-free original mutation history. No cross-source order,
universal latency or globally latest-state guarantee follows from either mode.

A Write Scope advertising Events MUST durably produce its required facts with its own effects and terminal
outcome, regardless of how unrelated external state is observed. A crash/retry
cannot lose those facts or mint duplicate transitions. Failures/rollbacks produce
none; a semantic no-op under final publication produces none. Commit
correlation is not a receipt, public position or atomic replica-application claim.
An alias change publishes a [non-Resource fact](#non-resource-facts), not a Resource fact;
aliases acquire no Resource kind or
revision merely to make route updates into a Resource lifecycle operation.

Coverage names opaque `start`, `retainedFrom` and `through` boundaries. The first
is where this observation regime begins, the second its current replay floor,
and the last the captured upper boundary for this finite traversal. Tokens admit
no client arithmetic or cross-source comparison. Earlier unknown history is not
fabricated. Initialization may establish a baseline without emitting fake creates
for pre-existing Resources. A newly discovered record is not evidence of original
creation without a known covered absence or an actual observed creation fact.
If the producer cannot describe a transition truthfully, it must report its
coverage loss/refuse the claim rather than invent a prior revision or postimage.

Each page advertises positive `minimumRetentionSeconds` and
`minimumCursorLifetimeSeconds`, plus supported `representations` including
`postimage`. No protocol-wide number is required; zero-retention live-only sources
cannot claim this contract. Promises apply to the admitted facts/issued cursor,
not only current configuration. An ordinary upgrade or configuration change cannot
silently shorten them. The replay floor may advance according to those promises.
Issuing a cursor protects its context and remaining captured range for the promised
lifetime, including facts already older when that cursor was issued; merely setting
a duration shorter than the general Event retention is not sufficient.
Static sources can expose an empty covered interval. Source initialization,
observation restart or an unobserved interval MUST NOT be hidden by an empty page.

### HTTP selection and finite replay

Scope observation GETs the fixed `<scope>/bdp/events`. Resource observation GETs its
canonical URL with `view=events`. Requests select the existing v0.1 JSON media type
through `Accept`; response Content-Type MUST confirm it before interpretation.
The complete selected contract defines the required Event vocabulary. This contract
requires finite JSON; live consumers poll this same source. No SSE binding is required.
Usual admitted finite-read HEAD/conditional semantics remain applicable. A bodyless
HEAD/304 response supplies no Event page or successful consumer progress; it must
not be interpreted as an empty covered interval.

Parsed query `retainedEventQuery` admits:

| Parameter | Meaning |
| --- | --- |
| `from=retained` | Start at the earliest currently retained covered boundary; default |
| `from=now` | Capture current boundary; return no prior Events and a usable cursor |
| `after=TOKEN` | Resume strictly after an issued source cursor; conflicts with `from` |
| `representation=postimage` | Required common mode and default |
| `representation=delta` | Explicit optional mode; unsupported selection refuses |
| `limit=N` | Positive native page bound under actual configured limits |

Duplicate/unknown parameters and invalid/conflicting values refuse; no silent
ignoring of a new semantic selector. For a Resource, `view=events` selects this
operation and is not an extra selection field in the parsed query object. Tokens
are decoded once using normal query escaping. `from=retained` is a deliberate new
start, never a repair automatically substituted for failed continuation.

The first response confirms `selection`, `policy`, `coverage`, `source`, optional
`subject`, `events`, `cursor` and `next`. Its captured upper boundary is fixed while
following `next`. A native absolute `next` preserves source, selected contract,
representation, principal/authorization context, coverage regime, traversal bound
and issued page size. Clients follow it unchanged; ordinary collection resizing
rules do not apply. `next:null` means this captured range is drained, not no future
Events. `cursor` resumes after every fact/scanned position covered by the page;
the authority MUST NOT advance past an undisclosed gap or incompatible required
fact. A later `after=cursor` traversal can capture a new upper boundary for polling.
Pages preserve one stable source order; concurrent commit ordering is the source's
choice, fixed before publication. Paging may split a commit's facts and never
implies atomic replica application. The authority enforces finite page/byte bounds
and must support a complete single admitted fact plus its envelope. Write admission
protects required postimage production/retention before effects commit; a later
size failure cannot authorize dropping/truncating a fact. External-source bounds
must likewise be compatible with the conformance claim.
New facts append after previously captured boundaries. Late external observations
are recorded in that append order, not inserted behind an already issued cursor;
observation time never fabricates an original backend commit time.

Cursor identity is opaque and bound to this selection/context and source history.
An Event ID is not a cursor. Restoration cannot reuse a cursor namespace in a way
that makes an old ahead-of-head cursor look caught up. A service may retain enough
old context to continue safely; otherwise it must diagnose the discontinuity. No
public epoch, replica checkpoint or arithmetic position is introduced.

Ordinary read Problems cover malformed/unsupported selection (`invalid-parameter`,
400), wrong context/history (`foreign-view`,409), expired/pruned continuation
(`cursor-expired`,410), and temporary inability (`temporarily-unavailable`,503),
with their existing family/retry meanings. Missing/forbidden subjects retain normal
non-disclosure. Lost observation coverage that prevents safe continuation uses
`foreign-view`; known retention expiry uses `cursor-expired`. Neither is successful
catch-up. A read-only source unable to provide the declared mechanism cannot
advertise conformance. No new transaction/receipt Problem grammar is imported.

### Facts use the mutation vocabulary

`retainedEvent` is the union of postimage, delta and [non-Resource](#non-resource-facts)
fact shapes. Common envelope
members are source-local stable `id`, absolute `source`, observation `time` and
`origin:"write"|"observation"`. A Resource fact adds actual `revision`, selected
`representation` and `effect`. A Write-origin fact MUST have actual Scope-local `transaction` correlation;
observations may include it only when known, never infer it from a polling interval.
`time` is fact-recording time, not a total order or an invented external commit time.
Only `annotations` is a declared ignorable extension object. Unknown required
members/operations/controls are not annotations.
An ID MUST NOT be reassigned to a different fact after retention or source recovery.

`effect.operation` is exactly one of `createBead`, `updateBead`, `deleteBead`,
`createLink`, `updateLink`, `deleteLink`. Creation uses allocated absolute `id`;
update/deletion uses absolute `bead` or `link`. Alias/binding strings and relative
inputs resolve before publication. Resource kind and identity do not change.

Create carries its fresh `revision` and no `previousRevision`. Update carries actual
`previousRevision` and new `revision`, independent of whether its author supplied
a guard. Delete carries its final live `revision`, no fresh revision, and no
`previousRevision`. Deletion `effect.deleted` contains kind, recorded affiliation,
identity and final live revision; for a Link it also contains its complete recorded
source/target References. It retains no properties. Delete is not erase.
The operation target, record/deleted identity and envelope revision MUST agree.
Each Event's source, and a Resource fact's representation, MUST agree with its
selected page. These
cross-value obligations require semantic validation beyond the JSON grammar.

#### Observed predecessors and disappearance

For `origin:"observation"` under `policy.observation:"observed"`, the sequence is
the source's actual observations, not an assertion of every backend mutation.
If its complete prior observation is X@r1 and its next complete observation is
X@r4, `previousRevision:r1` and `revision:r4` link those two known states. The
backend may have passed through unobserved r2/r3; r1 MUST NOT be described as its
proven immediate mutation predecessor. The postimage is the sampled r4 record;
an offered delta transforms the known r1 record to that r4 record, not an invented
r3-to-r4 patch. No intermediate Event, revision, commit time or transaction is
inferred. A declared sampling limitation is not itself an unexpected coverage gap.

For such an observed disappearance, "final live" means the last complete live
record in **this observed sequence**, not a proven final backend version. After
X@r4 and confirmed absence, a deletion observation reports r4 and that record's
known affiliation/kind and, for a Link, endpoints. It MUST use observation origin
and the observed policy; it is not an authoritative deletion result/tombstone or
proof that no unseen retype/update occurred before backend deletion. No final
backend revision or affiliation is manufactured. Delta and postimage modes report
the same last-observed deletion context and mint no new Resource revision.

The source must possess the complete required preceding record/context and must
be able to distinguish absence from forbidden/temporary/tier-only unavailability.
A hot-tier miss is insufficient. If it cannot establish that context or absence,
it uses the existing explicit coverage-loss/refusal path; it cannot emit an
invented deletion or advance a cursor past the unresolved fact. Unexpected loss
of the observation mechanism also remains a gap, distinct from its declared
sampling interval. `committed` coverage and Write-origin facts still require
their actual published predecessor/final-live context; these observation rules
do not weaken Write durability or change final publication.

#### Postimage and delta representations

In required postimage mode, create/update `effect.resource` is the complete published
Resource at that transition, including metadata, recorded affiliation and owned
state when applicable; it has no optional incident-Link aggregate. It MUST NOT be
replaced by a later GET or reinterpreted through today's Type default. Historical
authorization/controlled-content erasure still apply; unavailable promised data
cannot be returned as an invented complete postimage. Ordinary deletion retains
its selected context rather than fetching an already deleted Link.

In optional delta mode, creation carries `type`, complete `properties`/`metadata`
and Link endpoints; update carries actual changed whole Link `source`/`target`
References, `type`, `properties` or
`propertiesChange`, and `metadata` or `metadataChange`. Each object's replacement
and patch are exclusive, exactly as in ordinary input. Patches share native
`propertyChange` items/semantics. They need not reproduce the author's edit syntax,
but applying them to the actual prior state MUST yield the recorded next state.
Unchanged fields are omitted, never silently cleared. Type-only updates need no
dummy patch. Under Types, exact resolved affiliation is recorded; Core-only
carrying does not suddenly require definition interpretation.

Delta `revisionProvenance` records the resulting version's actual carried value;
absence means no provenance recorded in that complete representation. Current
wire suppression is not offered, so absence never means an omitted display view.
It is not a replayable provenance-input override. Create/update facts with an
owned-state change carry `derived.ownedLinks`: the complete newly recorded map,
`{}` for an empty owner or `null` for no longer an owner. Omitted derived state is
unchanged. Map nominal keys, full Link records and legacy retained captures obey
[owned Links](../core/core.md#owned-links); no rebucketing from current definitions occurs.

The owner may therefore have a derived-only `updateBead` fact even though an authored
update without input is invalid. `derived` is not an accepted mutation command
field. Full-map replacement is a deliberately simple optional-delta representation,
not a minimum-byte patch promise or another ownership implementation. It handles
ownership entry/exit without pretending the Link was created/deleted. Actual Link
and owner revisions stay independent and share known commit correlation.

Facts exclude `expectedRevision`, local `name`/`@name`, execution keys and
credentials. They describe committed/observed state; submitting them to a mutation
endpoint would be new intent and is not Event consumption or replica replay.

#### Non-Resource facts

A change that mints a revision is a Resource fact. A change that mints none, but
whose state [Transfer](../transfer/transfer.md#33-required-retained-fact-families)
retains, is a non-Resource fact. No change is both.

A non-Resource fact carries `family`, `profile`, `address` and `value` with the meanings
of Transfer's [retained-fact wrapper](../transfer/transfer.md#34-retained-fact-wrapper-and-family-agreement),
and a `change` of `created`, `updated` or `deleted` saying what happened to the state
at that address. It carries the common `id`, `source`, `time` and `origin`, with
`transaction` as for any Write-origin fact. It has no `revision`, `previousRevision`,
`representation`, `revisionProvenance` or `effect`, versions nothing and reads the same
under either selected representation.

A source advertises its families in `policy.families`; absence means it publishes no
non-Resource fact, and a fact's family MUST be listed. A consumer that does not know a
fact's family or profile stops before advancing past it, rather than skipping it.

| State | `family` and `profile` | `address` | `value` |
| --- | --- | --- | --- |
| Alias put or delete that changes a binding | `alias-state`, `https://github.com/gastownhall/bdp/families/alias-state/1` | The absolute alias URL | `{target}`: the new target, or for `deleted` the removed one |
| A retained version or whole identity pruned, erased or reorganized | `identity-state`, `https://github.com/gastownhall/bdp/families/identity-state/1` | The canonical ID and, for one version, the revision | `pruned`, `erased` or `reorganized` |
| Association state a Type's semantic contract keeps outside its record, such as comments | `association-state`, under the profile that contract names | As that profile fixes | As that profile fixes |
| Type registration, withdrawal and default selection | `type-prerequisite`, under [Types](../types/types.md#70-definition-presence-and-explicit-registration) | As Types fixes | As Types fixes |

An `erased` fact discloses no removed content. Publishing a pruned, erased or
reorganized fact does not promise that any consumer's copies are reconciled. Recovery
state, allocation and nonreuse publish nothing. Events' own retention moves
`retainedFrom` and is no fact.

### Projection and compatible extension

Scope source covers authorized Resource transitions and non-Resource facts. Link source
projects its lifecycle; Bead source projects its lifecycle and lifecycle effects of
incident Links, including a Link Type-only change. Bead source also projects each
non-Resource fact for the Beads its family profile names, under the same authorization
gate: `alias-state` names the alias's former and new targets, and `identity-state` names
the addressed identity. Visibility of a new alias target does not disclose the former
one, and a fact's `value` names no former target of a repoint. For an endpoint correction, incidence
is the union of preceding and resulting published endpoints, so a departing Bead
can observe the same correction. Apply the existing authorization/disclosure gate
to this projection; visibility of a new endpoint does not grant disclosure of
former endpoint state. Keep the same Link operation/fact
vocabulary rather than adding duplicate linked/unlinked payload kinds. A self-Link
appears once per source. Incidence alone does not version an endpoint Bead. Actual
owned-state transitions are separate Resource facts under the selected commit model.
Projection preserves relative order and known correlation, not a promise that an
authorized page contains every fact/member of a transaction. No arbitrary predicate
filter or property projection is added.

Postimage/delta represent the same selected facts with the same source identity,
relative order and revision meaning; they do not select a different coverage model.
Changing representation requires a new explicit selection, not reuse of a cursor
bound to another mode. Optional detail can be omitted only at a declared extension
point while preserving all base effects. New capabilities MUST project their base
Resource effects truthfully for older subscribers. If that is impossible, they are
not transparently additive under this contract: select a different supported contract
or refuse/stop explicitly before advancing past the incompatible position. Silently
dropping an unknown required fact cannot produce a successful continuation.

Receiving bytes is not successful consumer application. Page cursors are safe
consumer progress only after every included fact has been validated/processed.
Repeated delivery preserves fact identity and does not reexecute writes.
Events do not promise consistent state bootstrap, complete application History,
durable subscriber state, reconciliation of a consumer's copies with an erasure, or
replica group application.

### Event carriers

The closed page has required `source` (absolute Event source URL), `selection`
(`{representation:"postimage"|"delta"}`), `policy`, `coverage`, `events` (ordered
array), nonempty opaque `cursor`, and `next` (absolute URL or null). `subject`, when
present, is the canonical Resource URL for a subject projection. Page and facts
must agree on source, and Resource facts on selected representation.

Policy is a closed object with required `observation`, nonempty `description`,
positive integer `minimumRetentionSeconds`, positive integer
`minimumCursorLifetimeSeconds`, and a nonempty unique `representations` array
containing `postimage` and optionally `delta`. Optional `maximumPageSize` is a
positive integer native page bound. Optional `families` is a nonempty unique array of
the source's [non-Resource families](#non-resource-facts). Coverage is exactly the nonempty opaque
`start`, `retainedFrom`, `through` tokens. None is arithmetic or global position.

A Resource fact contains required nonempty opaque `id`, absolute `source`, `time`, `origin`,
`revision`, `representation`, and `effect`; `transaction`, `previousRevision` and
an object `annotations` are present only under the conditions above. A non-Resource
fact is closed with required `id`, `source`, `time`, `origin`, `family`, `profile`,
`address`, `value` and `change`; `transaction` and `annotations` follow the same
conditions. All required
postimage/effect/deletion/derived members carry the meanings above. Create/update
postimage effects contain their complete `resource`; deletion contains `deleted`.
The closed deletion context is `{resourceKind:"bead", resource:{id,type,revision}}`
or `{resourceKind:"link", resource:{id,type,revision}, source, target}`. Its
`resource` is the closed identity object and its Link endpoints are complete
References; there are no properties or new deletion revision in this unextended
Event carrier. The optional [historical-update capability](../write/write.md#body-free-terminal-versions-and-narrow-authorized-read)
commits a separate body-free terminal version while preserving this base fact's
final-live revision meaning. It selects no implicit combined Events binding.
A provider must establish a coherent terminal/predecessor/presence correlation
before claiming that composition; private feature-aware logs do not advertise it.
Delta create carries allocated `id`, type, complete objects and Link endpoints.
Delta update identifies `bead` or `link` and carries changed fields; delete uses
that target plus deleted context. These are facts, never accepted write commands.

## Schemas

Events owns the following definitions in the shared v0.1 bundle. Edit these visible
markdown-json-schema/0.6 fragments; extraction preserves their shared reference context.

<!-- bdp-schema:start retainedEventQuery -->
### Schema: "retainedEventQuery"

Value: object

Other fields: not allowed

Required order: []

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Decoded finite Event query. From and after are mutually exclusive; selection, cursor binding and raw HTTP duplicate-parameter refusal remain semantic rules." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "after" | ref "#/$defs/wireToken" | no | — | "Opaque issued resume cursor, bound to its original source, selection and context." |
| "from" | schema | no | — | "Initial Event boundary selection, retained or now; mutually exclusive with after." |
| "limit" | schema | no | — | "Positive admitted per-page bound. It does not permit partial facts or false exhaustion." |
| "representation" | schema | no | — | "Explicit Event representation, postimage or delta." |

#### Advanced

```json-schema
{
  "not": {
    "required": [
      "from",
      "after"
    ],
    "type": "object",
    "properties": {
      "from": true,
      "after": true
    }
  },
  "properties": {
    "from": {
      "enum": [
        "retained",
        "now"
      ]
    },
    "limit": {
      "type": "integer",
      "minimum": 1
    },
    "representation": {
      "enum": [
        "postimage",
        "delta"
      ]
    }
  }
}
```
<!-- bdp-schema:end retainedEventQuery -->

<!-- bdp-schema:start retainedEventSelection -->
### Schema: "retainedEventSelection"

Value: object

Other fields: not allowed

Required order: ["representation"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete selected Event representation echoed by a finite traversal. A continuation cannot silently switch postimage and delta semantics." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "representation" | schema | yes | — | "Explicit Event representation, postimage or delta." |

#### Advanced

```json-schema
{
  "properties": {
    "representation": {
      "enum": [
        "postimage",
        "delta"
      ]
    }
  }
}
```
<!-- bdp-schema:end retainedEventSelection -->

<!-- bdp-schema:start retainedEventPolicy -->
### Schema: "retainedEventPolicy"

Value: object

Other fields: not allowed

Required order: ["observation","description","minimumRetentionSeconds","minimumCursorLifetimeSeconds","representations"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Truthful observation mechanism and positive retention/cursor promises. Postimage support is mandatory once Events is advertised; delta is optional." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "description" | schema | yes | — | "Human-readable explanation of the advertised mechanism or limitation." |
| "families" | schema | no | — | "Non-Resource families this source publishes. Absence means it publishes none." |
| "maximumPageSize" | schema | no | — | "Optional positive Event-page bound without permission to split or truncate a fact." |
| "minimumCursorLifetimeSeconds" | schema | yes | — | "Positive minimum lifetime preserving issued cursor context and its captured range." |
| "minimumRetentionSeconds" | schema | yes | — | "Positive minimum retention promise for admitted Event facts." |
| "observation" | schema | yes | — | "Truthful observation mode: committed or observed, with its complete coverage obligations." |
| "representations" | schema | yes | — | "Supported Event representations, necessarily including postimage." |

#### Advanced

```json-schema
{
  "properties": {
    "description": {
      "type": "string",
      "minLength": 1
    },
    "families": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "type": "string",
        "minLength": 1
      }
    },
    "maximumPageSize": {
      "type": "integer",
      "minimum": 1
    },
    "minimumCursorLifetimeSeconds": {
      "type": "integer",
      "minimum": 1
    },
    "minimumRetentionSeconds": {
      "type": "integer",
      "minimum": 1
    },
    "observation": {
      "enum": [
        "committed",
        "observed"
      ]
    },
    "representations": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "enum": [
          "postimage",
          "delta"
        ]
      },
      "contains": {
        "const": "postimage"
      }
    }
  }
}
```
<!-- bdp-schema:end retainedEventPolicy -->

<!-- bdp-schema:start retainedEventCoverage -->
### Schema: "retainedEventCoverage"

Value: object

Other fields: not allowed

Required order: ["start","retainedFrom","through"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Opaque start, retained replay floor and captured upper boundary for the observation regime. These fields never imply a cross-source global position." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "retainedFrom" | ref "#/$defs/wireToken" | yes | — | "Opaque current replay floor under the retention promises." |
| "start" | ref "#/$defs/wireToken" | yes | — | "Opaque boundary where the described observation regime begins." |
| "through" | ref "#/$defs/wireToken" | yes | — | "Opaque fixed upper boundary captured for this finite traversal." |
<!-- bdp-schema:end retainedEventCoverage -->

<!-- bdp-schema:start retainedEventCommon -->
### Schema: "retainedEventCommon"

Value: object

Required order: ["id","source","time","origin"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Immutable fact envelope shared by Resource and non-Resource facts. Write-origin facts carry commit correlation; observation-origin facts describe the source’s truthful observation limitations." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "annotations" | schema | no | — | "Explicit extension annotations. Unsupported required meaning cannot silently become known meaning." |
| "id" | ref "#/$defs/wireToken" | yes | — | "Opaque immutable fact identity scoped to this Event source; it is not a Resource ID or resume cursor." |
| "origin" | schema | yes | — | "Whether this fact came from Write’s own committed transition or truthful external observation." |
| "source" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute URL of the observation source that emitted this fact." |
| "time" | ref "#/$defs/dateTime" | yes | — | "Recorded Event time, not a global ordering or an authentication proof." |
| "transaction" | ref "#/$defs/wireToken" | no | — | "Opaque commit correlation for Write-origin facts. It is neither a receipt nor a public replica-log position." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "origin": {
            "const": "write"
          }
        },
        "required": [
          "origin"
        ],
        "type": "object"
      },
      "then": {
        "required": [
          "transaction"
        ],
        "type": "object",
        "properties": {
          "transaction": true
        }
      }
    }
  ],
  "properties": {
    "annotations": {
      "type": "object",
      "additionalProperties": true
    },
    "origin": {
      "enum": [
        "write",
        "observation"
      ]
    }
  }
}
```
<!-- bdp-schema:end retainedEventCommon -->

<!-- bdp-schema:start retainedResourceEventCommon -->
### Schema: "retainedResourceEventCommon"

Value: object

Required order: ["revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Revision context shared by postimage and delta Resource facts. A non-Resource fact carries none of it." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "previousRevision" | ref "#/$defs/revision" | no | — | "Actual known observed predecessor; omission never invents intermediate revisions." |
| "revision" | ref "#/$defs/revision" | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/retainedEventCommon"
    }
  ]
}
```
<!-- bdp-schema:end retainedResourceEventCommon -->

<!-- bdp-schema:start retainedEventDeleted -->
### Schema: "retainedEventDeleted"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Deleted Resource identity and recorded affiliation/revision context. Write-origin deletion uses its actual final-live context; observation-origin disappearance uses the last complete observed sample and does not claim an unseen final backend edition. This is not a live postimage or permission to reuse identity." |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "required": [
        "resourceKind",
        "resource"
      ],
      "properties": {
        "resourceKind": {
          "const": "bead"
        },
        "resource": {
          "$ref": "#/$defs/resourceIdentity"
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "resourceKind",
        "resource",
        "source",
        "target"
      ],
      "properties": {
        "resourceKind": {
          "const": "link"
        },
        "resource": {
          "$ref": "#/$defs/resourceIdentity"
        },
        "source": {
          "$ref": "#/$defs/reference"
        },
        "target": {
          "$ref": "#/$defs/reference"
        }
      },
      "additionalProperties": false
    }
  ]
}
```
<!-- bdp-schema:end retainedEventDeleted -->

<!-- bdp-schema:start retainedPostimageEffect -->
### Schema: "retainedPostimageEffect"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One published create, update or deletion effect expressed using the mutation vocabulary. Live effects contain complete final postimages, not transient staging state." |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "required": [
        "operation",
        "id",
        "resource"
      ],
      "properties": {
        "operation": {
          "const": "createBead"
        },
        "id": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "resource": {
          "allOf": [
            {
              "$ref": "#/$defs/beadRecord"
            },
            {
              "type": "object",
              "required": [
                "metadata"
              ],
              "properties": {
                "metadata": true,
                "links": false
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "bead",
        "resource"
      ],
      "properties": {
        "operation": {
          "const": "updateBead"
        },
        "bead": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "resource": {
          "allOf": [
            {
              "$ref": "#/$defs/beadRecord"
            },
            {
              "type": "object",
              "required": [
                "metadata"
              ],
              "properties": {
                "metadata": true,
                "links": false
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "bead",
        "deleted"
      ],
      "properties": {
        "operation": {
          "const": "deleteBead"
        },
        "bead": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "deleted": {
          "allOf": [
            {
              "$ref": "#/$defs/retainedEventDeleted"
            },
            {
              "type": "object",
              "properties": {
                "resourceKind": {
                  "const": "bead"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "id",
        "resource"
      ],
      "properties": {
        "operation": {
          "const": "createLink"
        },
        "id": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "resource": {
          "allOf": [
            {
              "$ref": "#/$defs/linkRecord"
            },
            {
              "type": "object",
              "required": [
                "metadata"
              ],
              "properties": {
                "metadata": true
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "link",
        "resource"
      ],
      "properties": {
        "operation": {
          "const": "updateLink"
        },
        "link": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "resource": {
          "allOf": [
            {
              "$ref": "#/$defs/linkRecord"
            },
            {
              "type": "object",
              "required": [
                "metadata"
              ],
              "properties": {
                "metadata": true
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "link",
        "deleted"
      ],
      "properties": {
        "operation": {
          "const": "deleteLink"
        },
        "link": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "deleted": {
          "allOf": [
            {
              "$ref": "#/$defs/retainedEventDeleted"
            },
            {
              "type": "object",
              "properties": {
                "resourceKind": {
                  "const": "link"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    }
  ]
}
```
<!-- bdp-schema:end retainedPostimageEffect -->

<!-- bdp-schema:start retainedDeltaEffect -->
### Schema: "retainedDeltaEffect"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One realized create, update or deletion effect in optional delta form. It records actual admitted changes and never becomes a command to execute again." |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "required": [
        "operation",
        "id",
        "type",
        "properties",
        "metadata"
      ],
      "properties": {
        "operation": {
          "const": "createBead"
        },
        "id": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "type": {
          "$ref": "#/$defs/typeReference"
        },
        "properties": {
          "$ref": "#/$defs/properties"
        },
        "metadata": {
          "$ref": "#/$defs/metadata"
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "bead"
      ],
      "properties": {
        "operation": {
          "const": "updateBead"
        },
        "bead": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "type": {
          "$ref": "#/$defs/typeReference"
        },
        "properties": {
          "$ref": "#/$defs/properties"
        },
        "metadata": {
          "$ref": "#/$defs/metadata"
        },
        "propertiesChange": {
          "$ref": "#/$defs/propertyChange"
        },
        "metadataChange": {
          "$ref": "#/$defs/propertyChange"
        }
      },
      "additionalProperties": false,
      "allOf": [
        {
          "not": {
            "required": [
              "properties",
              "propertiesChange"
            ],
            "type": "object",
            "properties": {
              "properties": true,
              "propertiesChange": true
            }
          }
        },
        {
          "not": {
            "required": [
              "metadata",
              "metadataChange"
            ],
            "type": "object",
            "properties": {
              "metadata": true,
              "metadataChange": true
            }
          }
        }
      ]
    },
    {
      "type": "object",
      "required": [
        "operation",
        "bead",
        "deleted"
      ],
      "properties": {
        "operation": {
          "const": "deleteBead"
        },
        "bead": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "deleted": {
          "allOf": [
            {
              "$ref": "#/$defs/retainedEventDeleted"
            },
            {
              "type": "object",
              "properties": {
                "resourceKind": {
                  "const": "bead"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "id",
        "type",
        "properties",
        "metadata",
        "source",
        "target"
      ],
      "properties": {
        "operation": {
          "const": "createLink"
        },
        "id": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "type": {
          "$ref": "#/$defs/typeReference"
        },
        "properties": {
          "$ref": "#/$defs/properties"
        },
        "metadata": {
          "$ref": "#/$defs/metadata"
        },
        "source": {
          "$ref": "#/$defs/reference"
        },
        "target": {
          "$ref": "#/$defs/reference"
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "link"
      ],
      "properties": {
        "operation": {
          "const": "updateLink"
        },
        "link": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "type": {
          "$ref": "#/$defs/typeReference"
        },
        "properties": {
          "$ref": "#/$defs/properties"
        },
        "metadata": {
          "$ref": "#/$defs/metadata"
        },
        "propertiesChange": {
          "$ref": "#/$defs/propertyChange"
        },
        "metadataChange": {
          "$ref": "#/$defs/propertyChange"
        },
        "source": {
          "$ref": "#/$defs/reference"
        },
        "target": {
          "$ref": "#/$defs/reference"
        }
      },
      "additionalProperties": false,
      "allOf": [
        {
          "not": {
            "required": [
              "properties",
              "propertiesChange"
            ],
            "type": "object",
            "properties": {
              "properties": true,
              "propertiesChange": true
            }
          }
        },
        {
          "not": {
            "required": [
              "metadata",
              "metadataChange"
            ],
            "type": "object",
            "properties": {
              "metadata": true,
              "metadataChange": true
            }
          }
        }
      ],
      "anyOf": [
        {
          "required": [
            "type"
          ],
          "type": "object",
          "properties": {
            "type": true
          }
        },
        {
          "required": [
            "properties"
          ],
          "type": "object",
          "properties": {
            "properties": true
          }
        },
        {
          "required": [
            "metadata"
          ],
          "type": "object",
          "properties": {
            "metadata": true
          }
        },
        {
          "required": [
            "propertiesChange"
          ],
          "type": "object",
          "properties": {
            "propertiesChange": true
          }
        },
        {
          "required": [
            "metadataChange"
          ],
          "type": "object",
          "properties": {
            "metadataChange": true
          }
        },
        {
          "required": [
            "source"
          ],
          "type": "object",
          "properties": {
            "source": true
          }
        },
        {
          "required": [
            "target"
          ],
          "type": "object",
          "properties": {
            "target": true
          }
        }
      ]
    },
    {
      "type": "object",
      "required": [
        "operation",
        "link",
        "deleted"
      ],
      "properties": {
        "operation": {
          "const": "deleteLink"
        },
        "link": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "deleted": {
          "allOf": [
            {
              "$ref": "#/$defs/retainedEventDeleted"
            },
            {
              "type": "object",
              "properties": {
                "resourceKind": {
                  "const": "link"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    }
  ]
}
```
<!-- bdp-schema:end retainedDeltaEffect -->

<!-- bdp-schema:start retainedEventDerived -->
### Schema: "retainedEventDerived"

Value: object

Other fields: not allowed

Required order: ["ownedLinks"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Realized owned-Link state for the published Bead revision. Null and an object retain their explicit meanings; omitted state is not fabricated." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "ownedLinks" | schema | yes | — | "Recorded revision-covered owned-Link capture, grouped by nominal Link-Type identity. It is derived state, not directly writable input." |

#### Advanced

```json-schema
{
  "properties": {
    "ownedLinks": {
      "oneOf": [
        {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/absoluteHttpUrl"
          },
          "additionalProperties": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/linkRecord"
            }
          }
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```
<!-- bdp-schema:end retainedEventDerived -->

<!-- bdp-schema:start retainedPostimageEvent -->
### Schema: "retainedPostimageEvent"

Value: object

Required order: ["representation","effect"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete Event carrying a postimage effect. The Event’s source, representation, revision and envelope must agree with its page and actual published transition." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "effect" | ref "#/$defs/retainedPostimageEffect" | yes | — | "Exactly one realized published mutation effect. It records final state or admitted change and is never an executable write request." |
| "representation" | schema | yes | — | "Explicit Event representation, postimage or delta." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/retainedResourceEventCommon"
    },
    {
      "if": {
        "type": "object",
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "createBead",
                  "createLink"
                ]
              }
            }
          }
        },
        "required": [
          "effect"
        ]
      },
      "then": {
        "properties": {
          "previousRevision": false
        }
      }
    },
    {
      "if": {
        "type": "object",
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "updateBead",
                  "updateLink"
                ]
              }
            }
          }
        },
        "required": [
          "effect"
        ]
      },
      "then": {
        "required": [
          "previousRevision"
        ],
        "type": "object",
        "properties": {
          "previousRevision": true
        }
      }
    },
    {
      "if": {
        "type": "object",
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "deleteBead",
                  "deleteLink"
                ]
              }
            }
          }
        },
        "required": [
          "effect"
        ]
      },
      "then": {
        "properties": {
          "previousRevision": false
        }
      }
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "representation": {
      "const": "postimage"
    }
  }
}
```
<!-- bdp-schema:end retainedPostimageEvent -->

<!-- bdp-schema:start retainedDeltaEvent -->
### Schema: "retainedDeltaEvent"

Value: object

Required order: ["representation","effect"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete Event carrying a realized delta effect. A supplied previous revision denotes the actual observed predecessor, not an invented immediate mutation." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "derived" | ref "#/$defs/retainedEventDerived" | no | — | "Recorded derived owned-Link state accompanying this published Bead revision, when required by the effect." |
| "effect" | ref "#/$defs/retainedDeltaEffect" | yes | — | "Exactly one realized published mutation effect. It records final state or admitted change and is never an executable write request." |
| "representation" | schema | yes | — | "Explicit Event representation, postimage or delta." |
| "revisionProvenance" | ref "#/$defs/revisionProvenance" | no | — | "Immutable carried attribution for this concrete version; it authenticates no principal." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/retainedResourceEventCommon"
    },
    {
      "if": {
        "type": "object",
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "createBead",
                  "createLink"
                ]
              }
            }
          }
        },
        "required": [
          "effect"
        ]
      },
      "then": {
        "properties": {
          "previousRevision": false
        }
      }
    },
    {
      "if": {
        "type": "object",
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "updateBead",
                  "updateLink"
                ]
              }
            }
          }
        },
        "required": [
          "effect"
        ]
      },
      "then": {
        "required": [
          "previousRevision"
        ],
        "type": "object",
        "properties": {
          "previousRevision": true
        }
      }
    },
    {
      "if": {
        "type": "object",
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "deleteBead",
                  "deleteLink"
                ]
              }
            }
          }
        },
        "required": [
          "effect"
        ]
      },
      "then": {
        "properties": {
          "previousRevision": false
        }
      }
    },
    {
      "if": {
        "required": [
          "derived"
        ],
        "type": "object",
        "properties": {
          "derived": true
        }
      },
      "then": {
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "createBead",
                  "updateBead"
                ]
              }
            }
          }
        }
      }
    },
    {
      "if": {
        "required": [
          "effect"
        ],
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "const": "updateBead"
              }
            }
          }
        },
        "type": "object"
      },
      "then": {
        "anyOf": [
          {
            "required": [
              "derived"
            ],
            "type": "object",
            "properties": {
              "derived": true
            }
          },
          {
            "properties": {
              "effect": {
                "type": "object",
                "anyOf": [
                  {
                    "required": [
                      "type"
                    ],
                    "type": "object",
                    "properties": {
                      "type": true
                    }
                  },
                  {
                    "required": [
                      "properties"
                    ],
                    "type": "object",
                    "properties": {
                      "properties": true
                    }
                  },
                  {
                    "required": [
                      "propertiesChange"
                    ],
                    "type": "object",
                    "properties": {
                      "propertiesChange": true
                    }
                  },
                  {
                    "required": [
                      "metadata"
                    ],
                    "type": "object",
                    "properties": {
                      "metadata": true
                    }
                  },
                  {
                    "required": [
                      "metadataChange"
                    ],
                    "type": "object",
                    "properties": {
                      "metadataChange": true
                    }
                  }
                ]
              }
            }
          }
        ]
      }
    },
    {
      "if": {
        "required": [
          "effect"
        ],
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "deleteBead",
                  "deleteLink"
                ]
              }
            }
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "revisionProvenance": false
        }
      }
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "representation": {
      "const": "delta"
    }
  }
}
```
<!-- bdp-schema:end retainedDeltaEvent -->

<!-- bdp-schema:start retainedNonResourceEvent -->
### Schema: "retainedNonResourceEvent"

Value: object

Required order: ["family","profile","address","value","change"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Fact recording a change to state Transfer retains outside Resources. It mints no revision, carries no representation or provenance, and reads the same under either selected representation." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "address" | schema | yes | — | "Stable address of the changed state, with the arity and meaning its family profile fixes." |
| "change" | schema | yes | — | "What happened to the state at address: created, updated or deleted." |
| "family" | schema | yes | — | "Retained family the source advertises in its policy. A consumer that does not know it stops rather than skips." |
| "profile" | schema | yes | — | "Exact family profile identity fixing the address, value and projected Beads." |
| "value" | schema | yes | — | "Family-defined value of the change." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/retainedEventCommon"
    },
    {
      "if": {
        "type": "object",
        "required": [
          "family"
        ],
        "properties": {
          "family": {
            "const": "alias-state"
          }
        }
      },
      "then": {
        "type": "object",
        "properties": {
          "profile": {
            "const": "https://github.com/gastownhall/bdp/families/alias-state/1"
          },
          "address": {
            "type": "array",
            "maxItems": 1
          },
          "value": {
            "type": "object",
            "required": [
              "target"
            ],
            "properties": {
              "target": {
                "$ref": "#/$defs/absoluteHttpUrl"
              }
            },
            "additionalProperties": false
          }
        }
      }
    },
    {
      "if": {
        "type": "object",
        "required": [
          "family"
        ],
        "properties": {
          "family": {
            "const": "identity-state"
          }
        }
      },
      "then": {
        "type": "object",
        "properties": {
          "profile": {
            "const": "https://github.com/gastownhall/bdp/families/identity-state/1"
          },
          "address": {
            "type": "array",
            "maxItems": 2
          },
          "value": {
            "enum": [
              "pruned",
              "erased",
              "reorganized"
            ]
          }
        }
      }
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "family": {
      "type": "string",
      "minLength": 1
    },
    "profile": {
      "type": "string",
      "minLength": 1
    },
    "address": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "string",
        "minLength": 1
      }
    },
    "value": {},
    "change": {
      "enum": [
        "created",
        "updated",
        "deleted"
      ]
    }
  }
}
```
<!-- bdp-schema:end retainedNonResourceEvent -->

<!-- bdp-schema:start retainedEvent -->
### Schema: "retainedEvent"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Union of the supported complete postimage and delta Resource facts and the non-Resource fact. Schema acceptance does not prove truthful coverage, retention or atomic production." |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/retainedPostimageEvent"
    },
    {
      "$ref": "#/$defs/retainedDeltaEvent"
    },
    {
      "$ref": "#/$defs/retainedNonResourceEvent"
    }
  ]
}
```
<!-- bdp-schema:end retainedEvent -->

<!-- bdp-schema:start retainedEventPage -->
### Schema: "retainedEventPage"

Value: object

Other fields: not allowed

Required order: ["source","selection","policy","coverage","events","cursor","next"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Finite Event page with selected representation, truthful policy and coverage, ordered facts, a resume cursor and explicit continuation. Null next means the captured interval is exhausted." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "coverage" | ref "#/$defs/retainedEventCoverage" | yes | — | "Actual observation boundaries, not a fabricated complete mutation history." |
| "cursor" | ref "#/$defs/wireToken" | yes | — | "Opaque resume token covering the facts/scanned positions claimed by this page." |
| "events" | array of (ref "#/$defs/retainedEvent") | yes | — | "Required ordered array of the facts delivered in this finite page. An empty array alone does not establish exhaustion or uninterrupted coverage." |
| "next" | schema | yes | — | "Absolute continuation URL, or explicit null only when the admitted finite traversal is exhausted." |
| "policy" | ref "#/$defs/retainedEventPolicy" | yes | — | "Truthful observation mechanism and durable retention/cursor promises." |
| "selection" | ref "#/$defs/retainedEventSelection" | yes | — | "Complete admitted traversal/representation selection echoed by the response." |
| "source" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute URL of this observation source; each delivered fact must agree with it." |
| "subject" | ref "#/$defs/absoluteHttpUrl" | no | — | "Canonical Resource identity to which this retained page or Resource-scoped observation applies." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "selection": {
            "type": "object",
            "properties": {
              "representation": {
                "const": "postimage"
              }
            },
            "required": [
              "representation"
            ]
          }
        },
        "required": [
          "selection"
        ],
        "type": "object"
      },
      "then": {
        "properties": {
          "events": {
            "type": "array",
            "items": {
              "oneOf": [
                {
                  "$ref": "#/$defs/retainedPostimageEvent"
                },
                {
                  "$ref": "#/$defs/retainedNonResourceEvent"
                }
              ]
            }
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "selection": {
            "type": "object",
            "properties": {
              "representation": {
                "const": "delta"
              }
            },
            "required": [
              "representation"
            ]
          }
        },
        "required": [
          "selection"
        ],
        "type": "object"
      },
      "then": {
        "properties": {
          "events": {
            "type": "array",
            "items": {
              "oneOf": [
                {
                  "$ref": "#/$defs/retainedDeltaEvent"
                },
                {
                  "$ref": "#/$defs/retainedNonResourceEvent"
                }
              ]
            }
          },
          "policy": {
            "type": "object",
            "properties": {
              "representations": {
                "type": "array",
                "contains": {
                  "const": "delta"
                }
              }
            }
          }
        }
      }
    }
  ],
  "properties": {
    "next": {
      "oneOf": [
        {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```
<!-- bdp-schema:end retainedEventPage -->

<!-- bdp-schema:start retainedEventProblem -->
### Schema: "retainedEventProblem"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Event-read Problem carrier. It retains Core authentication, disclosure, bounds and cursor diagnosis rules; failure never certifies consumer progress." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/readProblem"
    },
    {
      "type": "object",
      "properties": {
        "code": {
          "enum": [
            "malformed-request",
            "invalid-parameter",
            "unauthenticated",
            "forbidden",
            "resource-not-found",
            "resource-erased",
            "foreign-view",
            "cursor-expired",
            "request-too-large",
            "limit-exceeded",
            "rate-limited",
            "temporarily-unavailable"
          ]
        }
      }
    }
  ]
}
```
<!-- bdp-schema:end retainedEventProblem -->

## OpenAPI

The following visible operation tables are the authoring source for the generated
[OpenAPI catalog](../../openapi/README.md), using the
[BDP Markdown OpenAPI notation](../../formats/markdown-openapi.md). Protocol routes
are Core's [fixed navigation](../core/core.md#fixed-navigation); Resource targets are
canonical Resource URLs. Shared media, authorization,
conditional HTTP, bodyless HEAD/status and Problem rules remain defined by Core.
Schema names resolve in the shared bundle; optional feature compositions retain
their distinct schema resources. Generation does not qualify an implementation.

<!-- bdp-operation:start beadEvents -->
### Operation: beadEvents

| Field | JSON value |
| --- | --- |
| id | `"beadEvents"` |
| navigation | `{"role":"canonical-resource","kind":"bead","query":{"view":"events"}}` |
| response | `"retainedEventPage"` |
| methods | `["get","head"]` |
| problem | `"retainedEventProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable"]` |
| continuation | `"unchanged"` |
| event | `true` |
| optional | `"Advertised Events (optional for Core and Write)"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
| view | query | yes | `{"const":"events"}` | — | — |
| from | query | no | `{"enum":["retained","now"],"default":"retained"}` | — | — |
| after | query | no | `{"type":"string","minLength":1}` | — | — |
| representation | query | no | `{"enum":["postimage","delta"],"default":"postimage"}` | — | — |
| limit | query | no | `{"$ref":"../profiles/core/bdp-v0.1.schema.json#/$defs/positiveInteger"}` | Positive per-page bound; actual advertised/default limits apply. | — |
<!-- bdp-operation:end beadEvents -->

<!-- bdp-operation:start linkEvents -->
### Operation: linkEvents

| Field | JSON value |
| --- | --- |
| id | `"linkEvents"` |
| navigation | `{"role":"canonical-resource","kind":"link","query":{"view":"events"}}` |
| response | `"retainedEventPage"` |
| methods | `["get","head"]` |
| problem | `"retainedEventProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable"]` |
| continuation | `"unchanged"` |
| event | `true` |
| optional | `"Advertised Events (optional for Core and Write)"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
| view | query | yes | `{"const":"events"}` | — | — |
| from | query | no | `{"enum":["retained","now"],"default":"retained"}` | — | — |
| after | query | no | `{"type":"string","minLength":1}` | — | — |
| representation | query | no | `{"enum":["postimage","delta"],"default":"postimage"}` | — | — |
| limit | query | no | `{"$ref":"../profiles/core/bdp-v0.1.schema.json#/$defs/positiveInteger"}` | Positive per-page bound; actual advertised/default limits apply. | — |
<!-- bdp-operation:end linkEvents -->

<!-- bdp-operation:start scopeEvents -->
### Operation: scopeEvents

| Field | JSON value |
| --- | --- |
| id | `"scopeEvents"` |
| navigation | `{"role":"fixed-scope-path","path":"bdp/events"}` |
| response | `"retainedEventPage"` |
| methods | `["get","head"]` |
| problem | `"retainedEventProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable"]` |
| continuation | `"unchanged"` |
| event | `true` |
| optional | `"Advertised Events (optional for Core and Write)"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
| from | query | no | `{"enum":["retained","now"],"default":"retained"}` | — | — |
| after | query | no | `{"type":"string","minLength":1}` | — | — |
| representation | query | no | `{"enum":["postimage","delta"],"default":"postimage"}` | — | — |
| limit | query | no | `{"$ref":"../profiles/core/bdp-v0.1.schema.json#/$defs/positiveInteger"}` | Positive per-page bound; actual advertised/default limits apply. | — |
<!-- bdp-operation:end scopeEvents -->

## Appendix: open design questions

This informative appendix distinguishes the selected finite observation contract from future composition. Streaming and replica/changefeed application require their own delivery, coverage, gap, ordering and recovery contract; finite Events advertisement supplies none of them. Feature-specific ordering remains until equivalence is established. Revisit explicitly during Transfer design: [XFER-OBS](../../deferred.md#xfer-obs--replication-streaming-and-cross-feature-order).

Historical import Events, presence/Inception context and source correlation remain unadopted residuals of PR164/165, rather than permission to replay an old log or add a Core field. An import may need new effects under its actual current transition; the exact conditional Events binding must be reviewed. See [IMPORT-CONTEXT](../../deferred.md#import-context--historical-import-lifecycle-and-source-correlation) and Transfer G5. Snapshot/retention and erasure/publication races return during Transfer review under [XFER-RETAIN](../../deferred.md#xfer-retain--snapshot-minima-continuity-and-erasurepublication-races); current durable Event production, coverage and erasure requirements remain intact.
