---
status: draft
intended-status: normative
version: "0.1"
---

# Beads Protocol — Core

Editorial draft v0.1.

Core defines the common Beads Protocol data model, discovery, authorized reads,
HTTP binding, and optional Event observation. A Scope contains Beads and Links,
which are Resources with immutable identities and independently versioned state.
Generic clients use the same carriers and operations across application domains.
Storage layout and implementation technology are not prescribed.

[Write](../write/write.md) adds mutation admission, actions, atomic effects and
durable retry outcomes. [Types](../types/types.md) is optional: it interprets definitions,
conformance, installation and property/graph constraints. Carrying a `type` field
in Core does not require that interpretation, a Type inventory or a descriptor
engine. Native endpoint, ownership, authorization and retained-address invariants
remain binding whether or not Types is supported.

## Contents

1. [Contract and conformance](#contract-and-conformance)
2. [Scopes and identity](#scopes-and-identity)
3. [Resources and References](#resources-and-references)
4. [Owned Links](#owned-links)
5. [Values and revisions](#values-and-revisions)
6. [Carried attribution](#carried-attribution)
7. [Discovery and capabilities](#discovery-and-capabilities)
8. [Resource reads and views](#resource-reads-and-views)
9. [Authorization and selection](#authorization-and-selection)
10. [Logical Resource selection and graph queries](#logical-resource-selection-and-graph-queries)
11. [Collections and pagination](#collections-and-pagination)
12. [Historical resolution](#historical-resolution)
13. [Optional Events](#optional-events)
14. [Final publication](#final-publication)
15. [Optional Resource projection](#optional-resource-projection)
16. [Optional exact Type-definition lookup](#optional-exact-type-definition-lookup)
17. [Problems and HTTP behavior](#problems-and-http-behavior)

## Contract and conformance

The uppercase requirement words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT,
SHOULD, SHOULD NOT, RECOMMENDED, NOT RECOMMENDED, MAY and OPTIONAL have their
BCP 14 meanings (RFC 2119 and RFC 8174). This document is a draft; its requirement
language specifies the intended contract and does not claim implementation or
release conformance. Examples illustrate, and must agree with, those requirements.
Example deployment URLs do not assign production Resource identities.

The complete protocol identity is
`https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json`.
Discovery uses the exact string `bdpVersion:"0.1"`. The identity names the complete
protocol meaning, including prose and schema, not an executable, Git revision,
profile, Type or mutable feature list. Once adopted, that meaning is immutable.
Identity URIs need not be dereferenceable. Unsupported or contradictory bindings
MUST refuse, never select a nearest version or infer compatibility from similar JSON.
A service MUST NOT advertise changed v0.1 semantics as unchanged version `"0"`.

The visible schema fragments in this document use the [Markdown JSON Schema DSL](../../formats/markdown-json-schema.md). Each fragment is delimited by matching HTML comments of the form `bdp-schema:start NAME` and `bdp-schema:end NAME`; the comments delimit visible definitions rather than hiding their text. These definitions are the authoring source for the Core-owned entries of the distributed JSON bundle. Edit them here, then extract mechanically; do not maintain another hand-edited Core schema. Descriptions in field tables are emitted as JSON Schema annotations. Semantic obligations that JSON Schema cannot express remain in the adjoining prose.

The generated JSON Schema 2020-12 companion is [bdp-v0.1.schema.json](bdp-v0.1.schema.json),
with the same distribution copy at
[packages/protocol/schemas/bdp-v0.1.schema.json](../../../packages/protocol/schemas/bdp-v0.1.schema.json).
Validators MUST load the complete bundle without network retrieval. Shared carriers
occur once; inherited helper definitions do not themselves expose operations.
Protocol-owned envelopes are closed except for their declared extension points;
`properties` and common `metadata` are JSON objects. Schema acceptance alone proves
neither authorization nor semantic/protocol conformance. Field meaning, operational
bounds, atomicity and all cross-value obligations below apply independently.

The only base profile literals are `core` and `write`. A Core client MUST understand
both discovery shapes, including a Write Scope's Core read behavior, even when it
implements no mutations. There is no nearest-profile ordering or implicit feature
fallback. A Core service MUST implement the mandatory reads here. Events is independently optional; advertising it commits the service to its complete observation contract.
Optional History, projection and exact-definition lookup acquire their complete
requirements only when advertised and explicitly selected as specified below.

Machine discovery and successful BDP JSON use
`application/vnd.bdp.v0.1+json`, including properties, inventories and operation
results. Clients request that type with `Accept` and verify the response binding
before interpretation. Missing Accept permits the endpoint's default. HTTP media
ranges, specificity, weights and `q=0` exclusions apply. `+json` permits decoding;
it does not equate this subtype with `application/json`. Parameters such as
`application/json; bdp=0.1` cannot select a contract.

Mutation bodies select this contract through Content-Type under Write. Missing or
generic-JSON mutation Content-Type is not selection; unsupported body media refuses
with 415 before payload interpretation, execution-key claim or effects, subject to
ordinary authentication, non-disclosure and bounds. Clients MUST NOT retry media
rejections under generic JSON to force execution. Problems use
`application/problem+json`; schema documents use `application/schema+json`.
Types may define an explicitly selected feature-owned subtype while preserving
promised base representations; see Types for that selection, not a base upgrade.
Non-JSON transports must explicitly bind the same contract; `text/event-stream`
alone establishes no Event compatibility. When Events is supported, this contract requires finite JSON Events.

## Scopes and identity

A **BDP Scope** contains Beads and Links. It is the boundary within which BDP
interprets local identifiers and evaluates selections. Every Bead and Link
belongs to exactly one Scope. URI path hierarchy does not create
nested Scopes. A Scope exists only when it is identified by its own root BDP
description, and the URI spaces owned by different Scopes do not overlap.

A local Resource ID consists of one or more safe URI-path segments forming
opaque identity within its Scope. The namespace is Scope-defined: BDP reserves
no `beads/`, `links/` or `types/` prefix for Resource identity. A Scope MAY
choose those spellings, put both kinds beneath one path, or use unrelated
paths. A client MUST NOT prepend a kind segment or infer Resource kind from
an identifier's path. The operation and resolved Resource determine kind.

Resolution against the canonical Scope URL produces one absolute canonical
Resource URL. That URL is immutable. Once committed for either kind, it is
never reassigned to an unrelated Resource in the lifetime of the logical
Scope, including after deletion or replacement of the serving authority.
An implementation preserves a compact identity tombstone, durable allocation
record or equivalent non-reuse guarantee. A restore that cannot preserve
that guarantee creates a different logical Scope and therefore uses a different canonical
Scope URL. Removing kind prefixes changes none of these identity obligations.

Segments imply neither containment nor a child Scope: `projects/alpha/task-42`
implies nothing at `projects/alpha`. Collection and operation URLs are
advertised navigation, not Resource-ID prefixes. The authority MUST keep
protocol navigation addresses from being assigned as canonical Resource or
alias URLs with a conflicting interpretation. Different Scopes' URI spaces
remain disjoint. BDP emits absolute canonical Resource URLs.

### Aliases

An **alias** is a repointable locator for one in-Scope Bead, beneath the
advertised `aliases` base. The authority chooses that base; it MAY be the
canonical Scope URL itself. BDP reserves no `alias/` spelling. A local alias
operand is a complete Scope-relative path, resolved against `scope`, not an
instruction to prepend the advertised base or strip a matching tail.
Membership in the advertised alias namespace and an actual alias binding are
established by the authority, not inferred from a path word. An alias is not
a Resource: it has no representation, no revision, and no collection membership.
It targets a canonical Bead URL only, never another alias; resolution is
one step. Unlike canonical segments, alias paths are repointable and, after
deletion, reusable: an alias is a locator and carries no identity promise.

Collision checks compare complete canonical URLs in the Scope's shared
namespace, across both Resource kinds. An alias MUST NOT occupy any URL ever
committed as a canonical Bead or Link identity, including a deleted identity.
A Resource creation MUST NOT occupy a live alias URL. Removing an alias can
release its locator; deleting a Resource never releases its canonical identity.
Equal final segments under different complete paths do not collide merely
because an implementation formerly removed kind prefixes before comparison.
An alias is not part of a Bead record or its `properties`; changing it changes
no Bead revision. Serving alias resolution is advertised through `aliases`.

Beads and Links are both **Resources**: each has identity, a representation,
and uniform operations. Authorization is separate from identity and typing.
So possessing a Resource or Type identifier does not grant permission to
read, mutate, or traverse it.

## Resources and References

A Bead is an identified node with one `type` affiliation, object `properties`,
common object `metadata`, and any applicable captured owned-Link state. A Link
is an independently identified directed edge with the same common members plus
whole `source` and `target` References. There are exactly two Resource kinds,
Bead and Link. A Link is the only graph edge; a URI-valued property creates none.

Complete records have these protocol members (question marks mean optional):

```text
Bead { id, type, revision, properties, metadata, revisionProvenance?, ownedLinks? }
Link { id, type, revision, source, target, properties, metadata, revisionProvenance? }
```

`id` is the absolute canonical HTTP(S) identity URL. Identity and Resource kind
are immutable. `revision` is a nonempty opaque string. `properties` and `metadata`
are required JSON objects; `{}` is a truthful empty object, never omitted from a
full record. Metadata is common and independent of Type-specific properties.
A retained pre-metadata version projects `metadata:{}` without rewriting stored
bytes or minting a revision; subsequent metadata editing starts from that object.
Provenance is per-version context, not mutable content or a property. Owned state
is derived and revision-covered, never directly writable.

Every Resource has one required `type`: either an absolute HTTP(S) identity URI,
or exactly `{uri: ABSOLUTE_HTTP_URL, revision: NONEMPTY_OPAQUE_STRING}`. Relative
paths, URNs, creation bindings and a separate `typeRevision` are not admitted
carriers. Type identity is its URI. Two pins of that URI are different versioned
affiliations but the same nominal Type identity. Core carries the Reference
opaquely; it neither fetches/registers a definition nor selects a Type default.
An affiliation is neither a Link nor an access grant. `properties.type` remains
ordinary authored JSON. Type-ID arrays and ownership map keys are URI strings.

Write can replace the complete affiliation and whole Link endpoints without
changing identity or kind. Omission preserves a preceding affiliation or endpoint
including its pin; replacement does not merge Reference members. Retyping is not
implicit property conversion, property dropping, endpoint repinning or hidden repair.
Mutation validation and exact resolution, where applicable, belong to Write and
optional Types. Retained versions/facts preserve their recorded affiliations,
endpoints and captures, never today's default or Type interpretation.

A Link's tuple of type/source/target describes but does not identify it. Parallel
Links with that same tuple are legal unless an applicable explicit constraint
limits them. At least one endpoint MUST identify a live Bead in the Link's own
Scope. An in-Scope endpoint uses that Bead's absolute canonical URL. A URI claiming
in-Scope identity, including an alias spelling, MUST satisfy canonical Bead identity
and kind checks; arbitrary path spelling cannot evade them.

An out-of-Scope endpoint is an opaque absolute URI. It may identify a Bead, another
kind, or nothing dereferenceable. The authority MUST NOT fetch it to establish
remote existence, kind, Type, content or immutability, infer those facts from its
URI, apply native in-Scope Bead validation or native Scope endpoint-multiplicity
policy to it, or expose in-Scope Bead operations/incident traversal for it. Its
lifecycle is outside the Scope's integrity guarantee. External URI equality is
exact; no cross-authority normalization is defined. A Link between two opaque
external endpoints is invalid.

This opacity does not prohibit supported Types constraints over the storing
Scope's own Link table, including its Links referring to the same external endpoint
identity. Such a local count validates no foreign Link table or remote resource
state. Types also permits a narrow checked endpoint-Type path when the endpoint
itself is a locally registered, accepted exact Type-definition Bead and the Reference
explicitly pins that edition. Check its affiliation/conformance from that accepted
exact state and retained dependency closure, not a network fetch. Registering the
Type of an arbitrary foreign Bead, caching its body, selecting a default, or retaining
one edition does not establish the Bead's remote affiliation/state or validate an
unpinned foreign endpoint. Scope classification and same/cross/either eligibility
still apply; no identity, authority or lifecycle guarantee transfers. [Types](../types/types.md)
defines the complete optional constraint semantics.

<a id="references"></a>

A Reference is a URI string or a closed pinned object:

```text
Reference = URI | { uri: URI, revision: NONEMPTY_OPAQUE_STRING }
```

The URI is complete identity; a pin records the revision referenced and is not a
guard. A pin is stored and echoed byte-identically and compared only for equality.
Core does not infer token syntax, resolve a latest version or validate an external
pin against another authority. Optional History provides exact historical resolution
in its own context; carrying a pin alone advertises no History. In-Scope URI
spellings follow canonical reference rules; external spellings stay byte-identical.

A whole Reference replacement/equality includes its pin. Ordinary incident traversal,
endpoint filters and endpoint multiplicity compare the URI alone: the pin adds no
Resource identity component. References contain no endpoint Type assertion. Readers
needing kind/Type use actual read metadata/records; an applicable validator checks
identified Beads rather than trusting a supplied assertion.

Only fields declared as References have these semantics. A URI or `{uri,revision}`
inside properties is authored data, not something the authority resolves,
canonicalizes or traverses. To give it graph semantics—versioning with its source,
validation at admission and view closure—represent it as an owned Link under the
applicable native or supported Types ownership rule.

### Resource records

Every successful `GET` of a Bead or Link returns one self-contained Resource
record. Both immutable and mutable state appear in the record, together with
the current opaque revision. The target URL still identifies the Resource.
But including `id` makes saved responses, logs, collection members, and
browser inspection self-describing.

A Bead record is:

```json
{
  "id": "https://beads.example/acme/beads/task-42",
  "type": "https://work.example/types/task",
  "revision": "opaque-task-revision",
  "revisionProvenance": { "actor": { "id": "agent:planner", "basis": "writer-supplied" } },
  "properties": {
    "title": "Specify BDP mutation",
    "status": "open"
  },
  "metadata": {}
}
```

A Link record is:

```json
{
  "id": "https://beads.example/acme/links/assigned-to-81",
  "type": "https://work.example/types/assigned-to",
  "revision": "opaque-link-revision",
  "source": "https://beads.example/acme/beads/task-42",
  "target": "https://beads.example/acme/beads/person-7",
  "properties": {
    "since": "2026-08-04"
  },
  "metadata": {}
}
```

`id` is an absolute canonical Resource URL. `type` is the common
Type Reference; optional Types defines its exact output requirements. A Bead with an applicable ownership rule
carries its recorded `ownedLinks` member on every record read. Newly captured
members use nonempty nominal-Type buckets with complete Link affiliations;
older retained captures keep their recorded shape. See [Owned Links](#owned-links).
The member is absent for Beads with no applicable ownership rule. Link `source` and `target` are
References as defined under [Resources and References](#resources-and-references): an in-Scope
endpoint's `uri` is the Bead's absolute canonical URL, an out-of-Scope
endpoint's `uri` is its opaque absolute URI, and either may be a Pinned
Reference. `revision` is protocol metadata rather than mutable Bead or Link
state, and so is `revisionProvenance`: when present it is the per-version
carried attribution defined under [Carried
attribution](#carried-attribution), beside `revision` and outside
`properties`. [Immutable change context](#immutable-change-context) defines
the optional History time, agent and message fields in that same envelope;
none authenticates the actor. Common `metadata` is a mutable,
Type-independent JSON object on both Resource kinds. It is distinct from
application `properties` and from per-version `revisionProvenance`.
Successful reads always expose `metadata`: `{}` means no members are set. A
retained pre-metadata version that lacks the member is projected with
`metadata: {}` on reads without rewriting stored bytes or minting a revision;
a later metadata update starts from that empty object. `id`, `type`,
`revision`, and, for Links, `source` and `target` are returned on every
successful read. That does not mean they are accepted as update targets. An
implementation may store local identifiers internally. That choice does not
alter the response spelling.

A pinned endpoint is represented the same way for both reference classes.
For example, pinning an external target:

```json
{
  "uri": "https://github.example/issues/123",
  "revision": "8f0e2b"
}
```

and pinning an in-Scope Bead:

```json
{
  "uri": "https://beads.example/acme/beads/task-42",
  "revision": "opaque-task-revision"
}
```

Collection and selection responses contain these same records directly,
rather than wrapping them in a second `href`/`value` envelope.


<!-- bdp-schema:start absoluteHttpUrl -->
### Schema: "absoluteHttpUrl"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Absolute HTTP(S) URL used for canonical in-Scope identities and discovered navigation. Equality, canonical path spelling, ownership and non-reuse are additionally governed by the Scope rules." |
| format | "uri" |
| pattern | "^https?://.+" |
| type | "string" |
<!-- bdp-schema:end absoluteHttpUrl -->

<!-- bdp-schema:start absoluteUri -->
### Schema: "absoluteUri"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Absolute URI carried for an opaque out-of-Scope Link endpoint or other explicitly URI-valued context. This syntax supplies no existence, kind, access or immutability guarantee." |
| format | "uri" |
| pattern | "^[A-Za-z][A-Za-z0-9+.-]*:" |
| type | "string" |
<!-- bdp-schema:end absoluteUri -->

<!-- bdp-schema:start reference -->
### Schema: "reference"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A floating absolute URI or an exact URI-and-revision pair. The containing field determines whether only HTTP(S) identities are admissible; a pin is never merged with another Reference." |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/absoluteUri"
    },
    {
      "$ref": "#/$defs/pinnedReference"
    }
  ]
}
```
<!-- bdp-schema:end reference -->

<!-- bdp-schema:start pinnedReference -->
### Schema: "pinnedReference"

Value: object

Other fields: not allowed

Required order: ["uri","revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete exact Reference. Both URI and nonempty opaque revision are mandatory, with no undeclared members. Its revision denotes recorded content, not an implicit current selector." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "revision" | schema | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
| "uri" | ref "#/$defs/absoluteUri" | yes | — | "Complete target identity carried by this Reference. Relative paths and partial Reference objects are not admitted." |

#### Advanced

```json-schema
{
  "properties": {
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```
<!-- bdp-schema:end pinnedReference -->

<!-- bdp-schema:start typeReference -->
### Schema: "typeReference"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A nominal Type affiliation: an absolute HTTP(S) Type identity or an exact pinned Type Reference. Carrying it does not activate Types interpretation." |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/absoluteHttpUrl"
    },
    {
      "$ref": "#/$defs/pinnedTypeReference"
    }
  ]
}
```
<!-- bdp-schema:end typeReference -->

<!-- bdp-schema:start pinnedTypeReference -->
### Schema: "pinnedTypeReference"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Exact Type affiliation using an absolute HTTP(S) Type identity and a nonempty opaque revision. Both members travel together." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/pinnedReference"
    },
    {
      "type": "object",
      "properties": {
        "uri": {
          "$ref": "#/$defs/absoluteHttpUrl"
        }
      }
    }
  ]
}
```
<!-- bdp-schema:end pinnedTypeReference -->

<!-- bdp-schema:start properties -->
### Schema: "properties"

Value: object

Other fields: allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Application-authored object state. A URI-valued property does not create a Link, and the Core carrier imposes no Type-specific property schema." |
| type | "object" |
<!-- bdp-schema:end properties -->

<!-- bdp-schema:start metadata -->
### Schema: "metadata"

Value: object

Other fields: allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Common mutable object state independent of Type-specific properties. A complete read always includes it; the empty object records no metadata members." |
| type | "object" |
<!-- bdp-schema:end metadata -->

<!-- bdp-schema:start resourceKind -->
### Schema: "resourceKind"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The two protocol Resource kinds. Kind is immutable and established by the resolved Resource, never inferred from its URL path." |
| enum | ["bead","link"] |
<!-- bdp-schema:end resourceKind -->

<!-- bdp-schema:start beadRecord -->
### Schema: "beadRecord"

Value: object

Other fields: not allowed

Required order: ["id","type","revision","properties","metadata"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete Bead representation, including identity, affiliation, revision, application properties, common metadata and optional recorded provenance or captured owned-Link state. Included incident links are a separately selected current aggregate." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute canonical immutable Resource identity URL." |
| "links" | ref "#/$defs/linkCollection" | no | — | "Separately selected current incident-Link aggregate. It is not captured owned state or an exact historical graph." |
| "metadata" | ref "#/$defs/metadata" | yes | — | "Common mutable object content, independent of Type-specific properties." |
| "ownedLinks" | schema | no | — | "Recorded revision-covered owned-Link capture, grouped by nominal Link-Type identity. It is derived state, not directly writable input." |
| "properties" | ref "#/$defs/properties" | yes | — | "Application-authored object content selected by the containing representation." |
| "revision" | schema | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
| "revisionProvenance" | ref "#/$defs/revisionProvenance" | no | — | "Immutable carried attribution for this concrete version; it authenticates no principal." |
| "type" | ref "#/$defs/typeReference" | yes | — | "Complete nominal Type affiliation, preserving an exact revision pin when present. Core carries it without fetching a definition." |

#### Advanced

```json-schema
{
  "properties": {
    "ownedLinks": {
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
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```
<!-- bdp-schema:end beadRecord -->

<!-- bdp-schema:start linkRecord -->
### Schema: "linkRecord"

Value: object

Other fields: not allowed

Required order: ["id","type","revision","source","target","properties","metadata"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete directed Link representation. Source and target are whole References; Link identity remains independent of their tuple. Current-state admission requires at least one live in-Scope Bead endpoint. Retained records and facts preserve their recorded endpoints without revalidating them against today’s live state." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute canonical immutable Resource identity URL." |
| "metadata" | ref "#/$defs/metadata" | yes | — | "Common mutable object content, independent of Type-specific properties." |
| "properties" | ref "#/$defs/properties" | yes | — | "Application-authored object content selected by the containing representation." |
| "revision" | schema | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
| "revisionProvenance" | ref "#/$defs/revisionProvenance" | no | — | "Immutable carried attribution for this concrete version; it authenticates no principal." |
| "source" | ref "#/$defs/reference" | yes | — | "Whole source Reference of this directed Link, preserving any exact revision pin." |
| "target" | ref "#/$defs/reference" | yes | — | "Whole target Reference of a Link, preserving any exact revision pin." |
| "type" | ref "#/$defs/typeReference" | yes | — | "Complete nominal Type affiliation, preserving an exact revision pin when present. Core carries it without fetching a definition." |

#### Advanced

```json-schema
{
  "properties": {
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```
<!-- bdp-schema:end linkRecord -->

<!-- bdp-schema:start currentBeadRecord -->
### Schema: "currentBeadRecord"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Current Bead read carrier. Common metadata is present and any included incident or owned Links use complete current Link carriers; this helper adds no read operation." |

#### Advanced

```json-schema
{
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
        "metadata": {
          "$ref": "#/$defs/metadata"
        },
        "links": {
          "$ref": "#/$defs/currentLinkCollection"
        },
        "ownedLinks": {
          "type": "object",
          "additionalProperties": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/currentLinkRecord"
            }
          }
        }
      }
    }
  ]
}
```
<!-- bdp-schema:end currentBeadRecord -->

<!-- bdp-schema:start currentLinkRecord -->
### Schema: "currentLinkRecord"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Current Link read carrier, including common metadata. This helper adds no identity, mutation or traversal behavior." |

#### Advanced

```json-schema
{
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
        "metadata": {
          "$ref": "#/$defs/metadata"
        }
      }
    }
  ]
}
```
<!-- bdp-schema:end currentLinkRecord -->

<!-- bdp-schema:start resourceIdentity -->
### Schema: "resourceIdentity"

Value: object

Other fields: not allowed

Required order: ["id","type","revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete identity, Type affiliation and concrete revision recorded for a Resource, including a deletion fact. It is not a live Resource postimage and carries no mutable properties." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute canonical immutable Resource identity URL." |
| "revision" | schema | yes | — | "Concrete nonempty opaque revision of the recorded Resource version." |
| "type" | ref "#/$defs/typeReference" | yes | — | "Complete recorded Type affiliation, preserving any revision pin." |

#### Advanced

```json-schema
{
  "properties": {
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```
<!-- bdp-schema:end resourceIdentity -->

## Owned Links

Ownership is an applicable native or supported Types rule of a source Bead.
Only Beads own Links, only outgoing Links can be owned, and nothing is owned by
default. A Link remains an ordinary first-class Resource with independent identity,
revision, reads and collection/incident membership. `ownedLinks` captures those same
Links; it is not a second graph or separately writable edge set. Optional Types
defines its own ownership declarations and effective interpretation.

For a new capture, union effective ownership matches and deduplicate Links.
Group full Link records by each Link's actual nominal Type URI (`type` for a URI
carrier, `type.uri` for an exact affiliation). Different definition pins share a
bucket; a refinement appears once in its own nominal bucket, never duplicated in
ancestor buckets. Sort each bucket by canonical Link `id` in ascending Unicode
code-unit order. Each bucket MUST be nonempty; no wildcard or empty selector bucket
is emitted. An owner with no selected Links carries `ownedLinks:{}`; a non-owner
omits the member. Every inline Link preserves its whole affiliation, revision,
properties, metadata, provenance when present, and endpoint References.

Captures are bounded, inline, derived versioned state. The source URI identifies
the containing Bead. Literal pins do not synchronize revision tokens: a Link whose
source is S@r1 may occur unchanged in S@r2's capture. No automatic repinning or
invented Link revision follows from owner retyping/recapture. Link and owner
revisions stay independent. A change entering/leaving ownership or changing an
owned full Link record affects the initial/final source owner state atomically;
incoming incidence alone never versions the target. A source correction can affect
two owners. Final publication below determines the one final capture/version.

A full read serves recorded capture, never today's adjacency. Retained snapshots
keep their recorded shape, affiliations and old empty buckets. Returning unchanged
state never rewrites or normalizes it to allocate a revision. The properties view
contains only authored properties, not this plane.

Owned state MUST NOT be authorization-filtered. A visible owner implies visibility
of its complete owned Links and their in-Scope target Beads. Hiding a target requires
hiding every owner that would disclose it, recursively. Latitude to hide incident
Links from a visible Bead applies to incoming and unowned Links, never its captured
owned Links. Explicit projection can omit the whole represented plane but changes
neither stored state nor authorization closure. Incident views are independently
paged and do not version anything merely by being read.

### Native Scope policy

A live Link MUST retain at least one live in-Scope Bead endpoint. Deletion is not
erasure and cannot silently leave dangling native in-Scope endpoints; Write defines
explicit Link removal and the atomic deletion admission/rollback contract.

Native Scope policies remain valid independently of optional Types. Their admission
must be consistent with the common identity, endpoint, ownership and authorization
rules. This is not a blanket prohibition on graph constraints in optional Types.

Discovery MAY advertise `maximumEndpointMultiplicity`, an unordered array of closed
objects `{linkConformsTo: ABSOLUTE_HTTP_URL, endpoint: "source"|"target", max: POSITIVE_INTEGER}`.
For each in-Scope Bead and the named endpoint, count live Links whose effective
Link Type conforms to the named identity, including conforming children; compare
endpoint URIs, not pins. The tightest applicable maximum wins. External endpoints
are not counted or constrained. Absence or an empty array means no such Scope
policies. This policy requires the applicable conformance interpretation; Core's
opaque type carrying cannot fabricate it. Administrative configuration is outside
this contract. Other graph constraints require their own supported semantics.

## Values and revisions


A Resource revision is an opaque token for one version of that Resource.
Clients compare revisions only for equality and must not derive meaning from
their spelling. A revision covers its complete Type affiliation, properties and
metadata and, for an owning Bead, its captured owned-Link state, and for a Link its
complete source and target References, including pins. HTTP entity tags may represent revisions.

JSON values compare by kind and content: null equals null, booleans and strings
compare their values, arrays compare ordered elements, and objects compare the
same member names and values independently of member order. Absent and null are
distinct; booleans are not numbers. JSON number comparison is over **exact decimal values**. Two JSON numbers are the
same value if and only if the decimal values their literals denote are
equal, whatever their spelling: `1.0`, `1`, and `1e0` are one value, and
`9007199254740993` and `9007199254740992` are two. So that no two
conforming peers can disagree about a no-op, and so that a token one peer
derives from content verifies against bytes another canonicalized, BDP
makes the interoperability rule of
[RFC 7493 Section 2.2](https://www.rfc-editor.org/rfc/rfc7493.html#section-2.2)
mandatory: a number literal is **admissible** if and only if converting
its exact decimal value to the nearest IEEE 754 binary64 value and
serializing that value back in its shortest round-trip form — the
ECMAScript `Number::toString` form that
[RFC 8785 Section 3.2.2.3](https://www.rfc-editor.org/rfc/rfc8785.html#section-3.2.2.3)
adopts — yields a literal denoting the same exact decimal value. `1e300`
and its expanded form are admissible; `-0.0` denotes zero, is admissible,
and is the same value as `0`; `9007199254740993` and a decimal of twenty
significant digits are not admissible. On every admitted value the exact-decimal model and
the binary64 model agree by construction. A revision-token scheme that
derives tokens from content MUST declare, by name, the number model it
serializes under: `sha256-jcs` means RFC 8785 serialization with numbers
as binary64 under its Section 3.2.2.3, and is exact over admitted values
by construction; a scheme over exact decimals is a different scheme with a
different name.

The protocol projection may represent revisions as HTTP entity tags.

Whenever a store retains a Resource version across restore, destructive reinitialization or
authority replacement, its existing address remains bound to exactly that state.
An advertised History resolver MUST serve the requested token unchanged when
that state is authorized and serviceable. Token-scheme changes and internal mappings MUST NOT rebind an old
address or silently return a new revision. Lack of disposition evidence means
unknown, not loss inferred from token spelling. Retained-address survival grants no current write authority.
Erased content is not eligible for successful resolution.

Allocation MUST NOT bind an existing retained address to different state. No
mandatory registry or lifetime-unique-token construction is prescribed: a
content-derived scheme may reuse a token for the same state consistently with
the existing revision laws.

### Actor attribution

BDP v0.1 does not expose an authority-attested actor in Resource records. The
authenticated principal is an input to authorization, not protocol data. An
implementation may retain private audit records, and a domain Type may define
ordinary actor-related properties. But neither is a generic BDP attribution
guarantee — and neither is the carried `revisionProvenance` member defined
next. Standardizing principal identity, delegation, impersonation, privacy,
and attestation is deferred.

<!-- bdp-schema:start revision -->
### Schema: "revision"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Nonempty opaque Resource-version token. Clients compare it for exact equality and cannot infer order, time, allocation or a special current value from its spelling." |
| minLength | 1 |
| type | "string" |
<!-- bdp-schema:end revision -->

<!-- bdp-schema:start wireToken -->
### Schema: "wireToken"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Nonempty opaque token whose scope and meaning are determined by its containing cursor, fact or correlation field. Tokens from different namespaces are not interchangeable." |
| pattern | "^[A-Za-z0-9_-]{1,256}$" |
| type | "string" |
<!-- bdp-schema:end wireToken -->

<!-- bdp-schema:start dateTime -->
### Schema: "dateTime"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "RFC 3339 date-time carrier. Emission uses a valid calendar and clock, uppercase T and Z; the prose governs accepted spellings and precision." |
| format | "date-time" |
| type | "string" |
<!-- bdp-schema:end dateTime -->

<!-- bdp-schema:start positiveInteger -->
### Schema: "positiveInteger"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Positive integral JSON number used for a declared bound or count. Implementations must preserve the specified numeric value rather than rely on a language-specific integer class." |
| minimum | 1 |
| type | "integer" |
<!-- bdp-schema:end positiveInteger -->

<!-- bdp-schema:start iso8601Duration -->
### Schema: "iso8601Duration"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "ISO 8601 duration string used for advertised lifetimes. The containing contract determines the promised interval and forbids silently shortening issued obligations." |
| pattern | "^P(?!$)" |
| type | "string" |
<!-- bdp-schema:end iso8601Duration -->

<!-- bdp-schema:start jsonPointer -->
### Schema: "jsonPointer"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "JSON Pointer carrier. Pointer evaluation, escaping and projection restrictions are defined by the selected operation; a syntactically valid pointer alone grants no access." |
| pattern | "^(/([^/~]\|~[01])*)*$" |
| type | "string" |
<!-- bdp-schema:end jsonPointer -->

## Carried attribution

Every Bead and Link record MAY carry a **`revisionProvenance`** member: a
common, generic member in a common place, so that no Type has to declare
attribution as a domain property. It is **data, not evidence**: the protocol
transports it and attests nothing, and a generic client MUST NOT treat any
value of it as an authority claim about who acted. A future
authority-attested form, if one arrives, is a distinct member with a distinct
name; `revisionProvenance` never becomes it.

```text
RevisionProvenance {
  actor?: {
    id        // nonempty opaque string naming who the version is attributed to
    basis     // "writer-supplied" | "unknown"
  }
  committedAt? // optional version time value state
  agent?       // optional agent value state
  message?     // optional message value state
}
```

`basis` records the realization's basis for the value, not a BDP guarantee,
and v0.1 defines exactly two: `writer-supplied` — the principal was supplied by
the writer of that version, as written; `unknown` — the principal is carried
from data whose relationship to this version the realization cannot establish
(an imported record; a creator recorded where the writer of the current
version was not). There is deliberately no basis that asserts authentication:
a value meaning "the authority verified this principal" would be an authority
claim, which this member never carries — that vocabulary belongs to the
future attested member. If `revisionProvenance.actor` is present, both `id`
and `basis` are required. An absent actor means no actor was recorded; time
or other provenance fields do not imply an actor. Missing `basis` inside a
present actor is invalid. The former top-level `attribution` and
`changeContext` shapes are not accepted aliases. Attribution is immutable for
the version it accompanies. It is outside `properties`, never part of the
`properties` view. The actor is absent when no attribution was recorded; the
envelope is absent when no revision provenance was recorded. Principal
identifiers SHOULD be namespaced opaque strings — for example `agent:…`,
`human:…`, `svc:…` — so agents, humans, and service accounts coexist without
a global identity system; BDP mandates no namespace and compares principals
only for byte equality.

All admitted/emitted JSON uses Unicode scalar values in strings and object names.
Unpaired surrogates, including escaped ones, and duplicate object names after escape
decoding are invalid. Invalid request string/object syntax uses `malformed-request`.
Adapters MUST map or refuse incompatible stored values before serving Resources.
Every emitted instant is an RFC 3339 date-time with uppercase T and Z and a valid
calendar/clock; clients accept lowercase forms RFC 3339 permits. JSON number kinds
are not implementation-language integer/float classes; the exact value/admission
rules above govern comparison, including count fields constrained to integers.

<!-- bdp-schema:start contextString -->
### Schema: "contextString"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Explicit immutable context value: present carries a nonempty string, absent records known absence, and undetermined records unavailable knowledge. No state authenticates an agent." |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "state": {
          "const": "present"
        },
        "value": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "state",
        "value"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "state": {
          "enum": [
            "absent",
            "undetermined"
          ]
        }
      },
      "required": [
        "state"
      ],
      "additionalProperties": false
    }
  ]
}
```
<!-- bdp-schema:end contextString -->

<!-- bdp-schema:start contextMessage -->
### Schema: "contextMessage"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Explicit immutable message context: present carries a string, including an empty message; absent and undetermined distinguish known absence from unavailable knowledge." |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "state": {
          "const": "present"
        },
        "value": {
          "type": "string"
        }
      },
      "required": [
        "state",
        "value"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "state": {
          "enum": [
            "absent",
            "undetermined"
          ]
        }
      },
      "required": [
        "state"
      ],
      "additionalProperties": false
    }
  ]
}
```
<!-- bdp-schema:end contextMessage -->

<!-- bdp-schema:start contextTime -->
### Schema: "contextTime"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Explicit immutable commit-time context: present carries a date-time and undetermined records unavailable knowledge. There is no absent time arm. This envelope is not a timestamp string or a revision-order proof." |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "state": {
          "const": "present"
        },
        "value": {
          "$ref": "#/$defs/dateTime"
        }
      },
      "required": [
        "state",
        "value"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "state": {
          "enum": [
            "undetermined"
          ]
        }
      },
      "required": [
        "state"
      ],
      "additionalProperties": false
    }
  ]
}
```
<!-- bdp-schema:end contextTime -->

<!-- bdp-schema:start revisionActor -->
### Schema: "revisionActor"

Value: object

Other fields: not allowed

Required order: ["id","basis"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Recorded principal and explicit attribution basis. Writer-supplied and unknown describe how the value was carried; neither asserts authentication." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "basis" | schema | yes | — | "How the principal value was carried: writer-supplied or unknown. Neither means authenticated." |
| "id" | schema | yes | — | "Opaque recorded principal identifier, such as agent:planner. It is not a Resource URL or an authentication assertion." |

#### Advanced

```json-schema
{
  "properties": {
    "basis": {
      "type": "string",
      "enum": [
        "writer-supplied",
        "unknown"
      ]
    },
    "id": {
      "type": "string",
      "minLength": 1
    }
  }
}
```
<!-- bdp-schema:end revisionActor -->

<!-- bdp-schema:start revisionProvenance -->
### Schema: "revisionProvenance"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| dependentRequired | {"committedAt":["agent","message"],"agent":["committedAt","message"],"message":["committedAt","agent"]} |
| description | "Optional per-version attribution envelope. Actor attribution is independent of the optional complete committedAt/agent/message tuple; omission does not invent an actor or context." |
| minProperties | 1 |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "actor" | ref "#/$defs/revisionActor" | no | — | "Carried principal attribution and explicit basis, independent of the optional History context tuple." |
| "agent" | ref "#/$defs/contextString" | no | — | "Immutable carried agent label, not an authentication result." |
| "committedAt" | ref "#/$defs/contextTime" | no | — | "Immutable recorded commit-time context, present with agent and message as one complete tuple." |
| "message" | ref "#/$defs/contextMessage" | no | — | "Immutable carried change message, present with committedAt and agent." |
<!-- bdp-schema:end revisionProvenance -->

## Discovery and capabilities

This draft does not define a separate DNS-neutral Scope ID or a Scope-relocation
contract. Those identity changes remain a separate design decision.

A Scope has one absolute canonical HTTP(S) URL ending in `/`, the base for local
identifiers and durable relative references even when reached through a redirect
or alias. GET of that URL MUST succeed and carry a registered `service-desc` Link
to its machine discovery document. The body is never machine discovery: it MAY be
absent (204) or a useful human representation (200). A human page SHOULD visibly
link discovery and advertised `service-doc` documentation. Clients do not scrape it.

A minimal discovery document is:


```json
{
  "bdpVersion": "0.1",
  "profile": "core",
  "scope": "https://beads.example/acme/",
  "beads": "https://beads.example/acme/inventory/items",
  "links": "https://beads.example/acme/inventory/relations"
}
```

Required Core members are those shown. Optional members are `events`, `aliases`, `order`,
`limits`, `maximumEndpointMultiplicity`, `historicalResolution`, and `capabilities`.
Write uses the same Core meaning with `profile:"write"` and required `operations`
and `aliases` navigation. Its operation directory belongs to Write. These discovery
objects are closed; there is no required or guessed `types` member. Unknown optional
capabilities use the declared extension map, not arbitrary discovery members.

`beads` and `links` advertise collection-read endpoints, not base URIs for Resource
identity. They tell a generic client where to list each kind; they do not divide
the Resource namespace. All Beads and Links may share one Scope-relative ID space,
such as `https://beads.example/acme/task-42` and
`https://beads.example/acme/relation-81`. No `beads/` or `links/` identity prefix is
required. Their inventory URLs are absolute HTTP(S) URLs beneath the canonical
Scope, with no fixed suffix; clients never construct a Resource URL from them. Events
and operation navigation are discovered absolute HTTP(S) URLs. Aliases navigation
is an in-Scope base, possibly the Scope itself, not authority for arbitrary paths
without a binding. Clients MUST NOT synthesize navigation or infer Resource kind
by stripping/prefixing path segments. No `order` means `canonical-uri`.

Local Resource/alias spellings contain one or more nonempty safe segments. Empty,
`.` and `..` segments, controls, backslashes, queries, fragments, scheme-relative
references, and encoded `/` or backslash separators are invalid. Decode percent
escapes exactly once and reject invalid UTF-8. Emit unreserved characters literally
and required escapes with uppercase hex. Compare decoded segments exactly, without
Unicode normalization. `task-42`, `projects/alpha/task-42` and `relations/81` can
identify either kind; hierarchy implies no parent Resource or child Scope.

Scope, Resource, Type, schema and discovery/next navigation use HTTP(S) URLs.
Only opaque external endpoint References admit arbitrary absolute URIs. Protocol
identity URIs compare exactly without requiring retrieval. Optional `service-doc`
and `describedby` retain their ordinary registered Web meanings; BDP invents no
parallel navigation link relation.

### Versioned capabilities

`capabilities` is an object mapping capability identity URI to an object mapping
exact nonempty version string to feature-owned detail object. A capability MAY
advertise multiple versions. Neither keys nor versions have ordering, range or
network-resolution semantics. Advertisement states support, not authorization or
request selection. Feature navigation/bounds belong in that version's detail.
Base clients MUST be able to ignore unfamiliar entries/versions while preserving
supported base behavior. Unknown required meaning MUST refuse, never be ignored.

Explicit selection MUST use an admission discriminator unsupported implementations
reject, rather than an ignorable header/media parameter or reinterpretation of
literal base data. Unsupported requested meaning cannot silently downgrade.
Atomic-batch version `"1"` requires Write and MUST NOT be advertised by a Core-only
Scope. Types is independently optional; exact-definition lookup alone advertises
neither Types nor application History.

Adding a feature MUST preserve base Resource/read/result meanings, revisions,
issued cursor/auth context, guards/retry meaning and required observations. New
validation can refuse new state, never reinterpret committed values, keys or retained
addresses. If base behavior cannot be preserved, select another supported contract
or refuse explicitly. A flag alone is insufficient. This is no general executable
extension mechanism or permission to add undeclared base envelope fields.

Mutation execution identity freezes selected contract, capability versions, Scope,
semantic operation, authored operands/values and key. Retry MUST NOT rebind it to
another contract, media type, feature version, fresh Type default or fresh key.
Changing advertisement cannot erase durable no-reexecution obligations. Continuations,
conditions and Event resumes likewise retain selected context. Refusal/unavailable
retained results do not prove an original write did not occur. No parallel legacy
fleet, implicit downgrade or automatic acquisition is required.

### Advertised limits

Core limits contain only `page`, `request`, `resource`, `selector`, and
`retention.maximumSnapshotLifetime` (pagination lifetime), not replica retention or
checkpoint obligations. Write defines its own additional limit groups.

The discovery document MAY contain a `limits` object. The object is optional
so that a small implementation can expose a conforming profile without
predicting every operational bound. Omission means only that the bound is not
pre-advertised; it does not mean infinite capacity and does not permit silent
truncation or a non-normative failure response.

When present, `limits` is divided into capability groups. A group is relevant
only when the advertised profile exposes that capability. Each advertised
value is a binding positive integer or ISO 8601 duration:

- `page.defaultItems` and `page.maximumItems` count Resource records;
- `request.targetBytes` counts octets in the encoded HTTP request target, and
  `request.bodyBytes` counts octets in the representation body;
- `resource.representationBytes` and `resource.propertiesBytes` count UTF-8
  bytes in the corresponding JSON serialization; metadata is covered by the
  complete representation bound, not by the properties-only bound;
- `selector.bytes` counts UTF-8 bytes of the decoded Selector string: after
  percent-decoding for query parameters, or JSON string decoding for a
  Selector in a request body, without additional URL decoding;
  `selector.depth` and `selector.nodes` count parsed Selector structure;
- `retention.maximumSnapshotLifetime` bounds the lifetime of a pagination
  continuation when advertised.

Fields and groups not advertised carry no implicit numeric value. A client
may use advertised values for request planning. Conformance tests may probe
them and require the server to enforce the advertised boundary consistently.
For example:

```json
{
  "limits": {
    "page": {
      "defaultItems": 50,
      "maximumItems": 200
    },
    "request": {
      "targetBytes": 2048,
      "bodyBytes": 65536
    }
  }
}
```

<!-- bdp-schema:start bdpVersion -->
### Schema: "bdpVersion"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| const | "0.1" |
| description | "Exact protocol-version discriminator. Version 0.1 selects this complete draft contract rather than an executable, a Git revision or a capability range." |
<!-- bdp-schema:end bdpVersion -->

<!-- bdp-schema:start capabilityAdvertisements -->
### Schema: "capabilityAdvertisements"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Map from absolute capability identity URI to explicitly supported versions. Unknown optional capabilities can be ignored without changing known base behavior; advertisement is neither request selection nor permission." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "https://github.com/gastownhall/bdp/capabilities/atomic-batch" | schema | no | — | "Supported atomic-batch versions and their admission detail. Core-only discovery separately prohibits advertising version 1." |
| "https://github.com/gastownhall/bdp/capabilities/resource-projection" | schema | no | — | "Supported projection versions and their point/exact/inventory support flags." |
| "https://github.com/gastownhall/bdp/capabilities/type-definition-read" | schema | no | — | "Supported exact-definition lookup versions and their independently advertised operation navigation." |

#### Advanced

```json-schema
{
  "propertyNames": {
    "$ref": "#/$defs/absoluteUri"
  },
  "additionalProperties": {
    "$ref": "#/$defs/capabilityVersionAdvertisements"
  },
  "properties": {
    "https://github.com/gastownhall/bdp/capabilities/atomic-batch": {
      "allOf": [
        {
          "$ref": "#/$defs/capabilityVersionAdvertisements"
        },
        {
          "type": "object",
          "properties": {
            "1": {
              "$ref": "#/$defs/atomicBatchCapabilityV1"
            }
          }
        }
      ]
    },
    "https://github.com/gastownhall/bdp/capabilities/resource-projection": {
      "allOf": [
        {
          "$ref": "#/$defs/capabilityVersionAdvertisements"
        },
        {
          "type": "object",
          "properties": {
            "1": {
              "$ref": "#/$defs/resourceProjectionCapabilityV1"
            }
          }
        }
      ]
    },
    "https://github.com/gastownhall/bdp/capabilities/type-definition-read": {
      "allOf": [
        {
          "$ref": "#/$defs/capabilityVersionAdvertisements"
        },
        {
          "type": "object",
          "properties": {
            "1": {
              "$ref": "#/$defs/typeDefinitionReadCapabilityV1"
            }
          }
        }
      ]
    }
  }
}
```
<!-- bdp-schema:end capabilityAdvertisements -->

<!-- bdp-schema:start capabilityVersionAdvertisements -->
### Schema: "capabilityVersionAdvertisements"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Map from exact nonempty version string to that version’s detail object. Versions are opaque, unordered and have no implicit compatibility range." |
| minProperties | 1 |
| type | "object" |

#### Advanced

```json-schema
{
  "propertyNames": {
    "type": "string",
    "minLength": 1
  },
  "additionalProperties": {
    "type": "object"
  }
}
```
<!-- bdp-schema:end capabilityVersionAdvertisements -->

<!-- bdp-schema:start coreDiscovery -->
### Schema: "coreDiscovery"

Value: object

Other fields: not allowed

Required order: ["bdpVersion","profile","scope","beads","links"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Closed Core discovery object. Inventory URLs navigate collections rather than reserve Resource-ID prefixes. Events, History and other capabilities are optional and bind their full obligations only when advertised." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "aliases" | ref "#/$defs/absoluteHttpUrl" | no | — | "Advertised in-Scope alias-resolution namespace, possibly the Scope itself. A spelling requires an actual alias binding." |
| "bdpVersion" | ref "#/$defs/bdpVersion" | yes | — | "Exact complete protocol discriminator, not a nearest-version negotiation." |
| "beads" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute Bead inventory URL. It is navigation, not a Resource-ID base or required path prefix." |
| "capabilities" | schema | no | — | "Independently versioned feature advertisements. Support does not select an invocation or grant permission." |
| "events" | ref "#/$defs/absoluteHttpUrl" | no | — | "Optional absolute finite Event-source URL. Presence promises the complete Event contract; absence supplies no Event support." |
| "historicalResolution" | ref "#/$defs/historyCapability" | no | — | "Explicit History support advertisement; omission carries no History obligation." |
| "limits" | ref "#/$defs/coreAdvertisedLimits" | no | — | "Optional declared operational bounds. Omitted values are not infinite and failures cannot silently truncate data." |
| "links" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute Link inventory URL; it reserves no Link Resource-ID prefix." |
| "maximumEndpointMultiplicity" | array of (ref "#/$defs/maximumEndpointMultiplicityPolicy") | no | — | "Native endpoint incidence policies enforced against the storing Scope’s authoritative in-Scope state." |
| "order" | schema | no | — | "Advertised stable collection order. Omission uses canonical-uri under Core." |
| "profile" | schema | yes | — | "Base Core/Write profile discriminator, independent of optional capabilities." |
| "scope" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Canonical HTTP(S) Scope URL used for local identity resolution and ownership navigation." |

#### Advanced

```json-schema
{
  "properties": {
    "capabilities": {
      "allOf": [
        {
          "$ref": "#/$defs/capabilityAdvertisements"
        },
        {
          "type": "object",
          "properties": {
            "https://github.com/gastownhall/bdp/capabilities/atomic-batch": {
              "type": "object",
              "properties": {
                "1": false
              }
            }
          }
        }
      ]
    },
    "order": {
      "enum": [
        "canonical-uri"
      ]
    },
    "profile": {
      "const": "core"
    }
  }
}
```
<!-- bdp-schema:end coreDiscovery -->

<!-- bdp-schema:start coreAdvertisedLimits -->
### Schema: "coreAdvertisedLimits"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Optional grouped Core read bounds. Omission means a bound is not pre-advertised, never infinite capacity or permission for silent truncation." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "page" | schema | no | — | "Positive default and maximum Resource-record page sizes, when declared." |
| "request" | schema | no | — | "Positive encoded request-target and representation-body byte limits, when declared." |
| "resource" | schema | no | — | "Positive complete-representation and properties-only UTF-8 byte bounds, when declared." |
| "retention" | schema | no | — | "Declared pagination snapshot lifetime; this group does not advertise Event or replica retention." |
| "selector" | schema | no | — | "Optional positive bounds on decoded Selector bytes, parsed depth and parsed node count." |

#### Advanced

```json-schema
{
  "properties": {
    "page": {
      "type": "object",
      "properties": {
        "defaultItems": {
          "$ref": "#/$defs/positiveInteger"
        },
        "maximumItems": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "request": {
      "type": "object",
      "properties": {
        "targetBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "bodyBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "resource": {
      "type": "object",
      "properties": {
        "representationBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "propertiesBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "retention": {
      "type": "object",
      "properties": {
        "maximumSnapshotLifetime": {
          "$ref": "#/$defs/iso8601Duration"
        }
      },
      "additionalProperties": false
    },
    "selector": {
      "type": "object",
      "properties": {
        "bytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "depth": {
          "$ref": "#/$defs/positiveInteger"
        },
        "nodes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    }
  }
}
```
<!-- bdp-schema:end coreAdvertisedLimits -->

<!-- bdp-schema:start maximumEndpointMultiplicityPolicy -->
### Schema: "maximumEndpointMultiplicityPolicy"

Value: object

Other fields: not allowed

Required order: ["linkConformsTo","endpoint","max"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Native Scope constraint over stored in-Scope Link incidence. It names the Link family, endpoint role and positive maximum; it does not inspect a foreign authority’s Link table." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "endpoint" | schema | yes | — | "Endpoint role to which the native incidence maximum applies." |
| "linkConformsTo" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Nominal Link-Type family constrained by this native policy." |
| "max" | ref "#/$defs/positiveInteger" | yes | — | "Positive maximum for the explicitly selected Scope policy." |

#### Advanced

```json-schema
{
  "properties": {
    "endpoint": {
      "enum": [
        "source",
        "target"
      ]
    }
  }
}
```
<!-- bdp-schema:end maximumEndpointMultiplicityPolicy -->

## Resource reads and views

### Point-read kind and owning-Scope navigation

Successful canonical current/retained Resource reads MUST carry exactly one lowercase
`BDP-Resource-Kind: bead` or `link`, matching actual kind. This includes full and
properties responses, incident views, aggregates, HEAD and 304. In an incident view
it identifies the Bead subject, not Link items. Authorization/non-disclosure precedes
metadata. Problems, alias redirects and inventories do not gain this field from
path resemblance. History versions metadata has its narrower rule below.

Those point responses MUST carry `service-desc` to the owning Scope's machine
discovery. Its `scope`/navigation establish mutation routing for an absolute URL;
clients MUST NOT infer ownership from path or an unrelated default. An explicitly
supplied Scope can bind an operation subject to actual membership/kind checks.
Absolute-URL reads need no configured Scope or preliminary inventory. Navigation
confers no permission and does not authorize forwarding credentials across origins.
These are HTTP fields, not JSON properties. A wrapper containing a Resource does
not thereby establish that wrapper service as owner; exact-definition lookup below
specifies its separate recorded-context behavior.

### Resource views

Optional revision-specific reads and versions pages are defined under
[Historical resolution](#historical-resolution).

The default `GET` of a Bead or Link URL returns its complete Resource record.
Explicit [Resource projection](#optional-resource-projection) changes this
representation only when its independent capability and request are selected.
BDP-owned query parameters select a derived view, or request one bounded
aggregate anchored at that same Resource URL:

```text
GET {resource}?view=properties
GET {bead}?view=links&direction=inbound|outbound|both
GET {bead}?include=links&direction=inbound|outbound|both&limit={count}
```

`view=properties` is valid for both Beads and Links and returns exactly the
complete stored `properties` object:

```http
GET /acme/beads/task-42?view=properties HTTP/1.1
Host: beads.example
Accept: application/vnd.bdp.v0.1+json

HTTP/1.1 200 OK
Content-Type: application/vnd.bdp.v0.1+json
ETag: "opaque-task-revision"

{
  "title": "Specify BDP mutation",
  "status": "open"
}
```

The properties view includes declared and undeclared properties. It is never
a schema-filtered projection. Its entity tag represents the same Resource
revision returned in the complete record. `view=links` is valid only for a
Bead and is defined under **Incident Link reads**.

#### Optional incident-Link aggregate

This aggregate is optional and outside minimum Core; no separate advertisement is invented here.

`include=links` is valid only for a Bead. It returns the ordinary complete
Bead record with a `links` member. That member contains the first paginated
page of the same result exposed by `view=links`:

```json
{
  "id": "https://beads.example/acme/beads/task-42",
  "type": "https://work.example/types/task",
  "revision": "opaque-task-revision",
  "properties": {
    "title": "Specify BDP mutation",
    "status": "open"
  },
  "metadata": {},
  "links": {
    "items": [
      {
        "id": "https://beads.example/acme/links/assigned-to-81",
        "type": "https://work.example/types/assigned-to",
        "revision": "opaque-link-revision",
        "source": "https://beads.example/acme/beads/task-42",
        "target": "https://beads.example/acme/beads/person-7",
        "properties": {
          "since": "2026-08-04"
        },
        "metadata": {}
      }
    ],
    "next": "https://beads.example/acme/beads/task-42?view=links&direction=both&cursor=opaque-cursor"
  }
}
```

The default Bead `GET` includes its required recorded owned state when applicable,
but does not include an incident-Link aggregate. The
aggregate request always embeds at most one page. A client follows `next`
into the Link view rather than requesting another aggregate page. `direction`
defaults to `both`, and `limit` bounds the embedded page. `include=links`
cannot be combined with `view` or `cursor`. The entity tag of an aggregate
response represents the entire aggregate response. It can therefore change
when its embedded Link page changes, even if the Bead's `revision` does not.

Using a query parameter avoids placing protocol-owned child names beneath a
hierarchical Resource ID. BDP reserves `view`, `include`, and the parameters
defined for each view or aggregate on Bead and Link URLs. An unsupported
view, include, or parameter that is not defined for the selected request is
an error, not an instruction to ignore that parameter.

### Alias resolution

When discovery advertises `aliases`, a `GET` or `HEAD` of an alias URL —
an admitted alias path resolved against the canonical Scope URL — returns
`307 Temporary Redirect` with `Location` set to the target's absolute
canonical Bead URL and no body. Resolution is redirect-only: an authority
MUST NOT serve a Resource representation at an alias URL, which would give
one Resource a second address. `HEAD` makes resolution a body-less
primitive. The status is temporary by design: aliases repoint.

An unknown alias, an alias URL carrying a query or fragment, and any alias
URL at an authority that does not advertise `aliases` return the same `404`
`resource-not-found` used for unknown Resources, under the same
authorization projection: aliases are not an enumeration oracle. Alias
resolution never follows chains, because an alias targets only a canonical
Bead URL. The redirect target is subject to ordinary Resource authorization
when the client follows it; resolution itself asserts nothing about the
target's readability.

### Reads after deletion

History-specific reads follow [Historical resolution](#historical-resolution).

After a Bead or Link is deleted, ordinary `GET`, `view=properties`, and, for a
Bead, `view=links` return the same `404` `resource-not-found` problem used for
an unknown or non-visible identity. BDP does not require an authority to reveal
whether the Resource once existed.

To a caller authorized for the subject's retained history — the same single
authorization that gates `410` disclosure everywhere — an authority MAY
instead disclose why a valid-shaped address has nothing behind it. Two
sibling `410` conditions are Read-profile codes in the closed problem
table: `resource-pruned` (removed by deliberate lifecycle policy) and
`resource-erased` (content that must not exist). A
`resource-pruned` problem MAY carry one `archivedAt` member — a Reference,
possibly pinned, naming where the content went — recorded and echoed like
any Reference and never validated or dereferenced by the serving authority;
its presence within an authorized disclosure is authority policy. A
`resource-erased` problem carries no condition-specific extension members
beyond its ordinary problem members: even a pointer would disclose what
erasure exists to remove. To every other caller both
conditions remain the uniform `404`; the disclosure vocabulary is
never an enumeration oracle. The non-reuse rule remains internal: a
filesystem-backed implementation may retain only a compact allocation marker
or tombstone and need not serve it as a Resource representation.

### Incident Link reads

A Bead record does not embed its incident population as an aggregate by default;
its required recorded owned state is separate. A client selects the Link
view directly on the Bead URL and supplies a direction:

```http
GET /acme/beads/task-42?view=links&direction=outbound HTTP/1.1
Host: beads.example
Accept: application/vnd.bdp.v0.1+json
```

```http
GET /acme/beads/task-42?view=links&direction=inbound HTTP/1.1
Host: beads.example
Accept: application/vnd.bdp.v0.1+json
```

```http
GET /acme/beads/task-42?view=links&direction=both HTTP/1.1
Host: beads.example
Accept: application/vnd.bdp.v0.1+json
```

`direction` is `inbound`, `outbound`, or `both`, and defaults to `both` when
omitted. `inbound` selects Links whose `target` is the Bead. `outbound`
selects Links whose `source` is the Bead. `both` selects their union. The
response is a paginated `items` array of complete Link records plus a `next`
URL. The initial request may supply `limit`. Subsequent requests follow
`next`. As with collection pagination, that continuation walks one logical
snapshot and an expired cursor is an error rather than a silent restart
against newer state. Only an in-Scope Bead has this view. An opaque
out-of-Scope endpoint does not.

 the incident population also admits the Link structural
predicates `type`, `conformsTo`, `source`, `target`, `endpoint`, and `selector`.
Direction/incidence establish the population; the predicates combine with AND
before snapshot pagination. A self-Link appears once. This does not add those
filters to the optional `include=links` aggregate. Collection-kind metadata and
continuation resizing follow [collections and pagination](#collections-and-pagination).

BDP does not append `/links` to the Bead URL. Local IDs may contain multiple
path segments, so `beads/task-42/links` could already be the ID of a different
Bead. A suffix subpath would require BDP to reserve and visibly mangle a
control segment such as `/-/` or `/.bdp/` throughout the local-ID grammar. The
`view` query parameter avoids that collision while keeping the request visibly
anchored at the Bead. The Link collection still owns Link identity. The Bead's
Link view is only a derived read.


<!-- bdp-schema:start beadCollection -->
### Schema: "beadCollection"

Value: object

Other fields: not allowed

Required order: ["items","next"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One finite page of complete Bead records and an absolute continuation URL or explicit null on observed exhaustion. Items do not acquire a separate href/value wrapper." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/beadRecord") | yes | — | "Finite ordered members of this page or bounded diagnosis. Meaning and completeness follow the containing operation." |
| "next" | schema | yes | — | "Absolute continuation URL, or explicit null only when the admitted finite traversal is exhausted." |

#### Advanced

```json-schema
{
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
<!-- bdp-schema:end beadCollection -->

<!-- bdp-schema:start linkCollection -->
### Schema: "linkCollection"

Value: object

Other fields: not allowed

Required order: ["items","next"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One finite page of complete Link records and an absolute continuation URL or explicit null. Parallel Link identities remain distinct." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/linkRecord") | yes | — | "Finite ordered members of this page or bounded diagnosis. Meaning and completeness follow the containing operation." |
| "next" | schema | yes | — | "Absolute continuation URL, or explicit null only when the admitted finite traversal is exhausted." |

#### Advanced

```json-schema
{
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
<!-- bdp-schema:end linkCollection -->

<!-- bdp-schema:start currentBeadCollection -->
### Schema: "currentBeadCollection"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Current Bead inventory page whose items use current Bead carriers. Its continuation retains the admitted selection and authorization context." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/beadCollection"
    },
    {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/currentBeadRecord"
          }
        }
      }
    }
  ]
}
```
<!-- bdp-schema:end currentBeadCollection -->

<!-- bdp-schema:start currentLinkCollection -->
### Schema: "currentLinkCollection"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Current Link inventory page whose items use current Link carriers. An empty page is not proof of exhaustion when next is nonnull." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/linkCollection"
    },
    {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/currentLinkRecord"
          }
        }
      }
    }
  ]
}
```
<!-- bdp-schema:end currentLinkCollection -->

## Authorization and selection

### Authorization views

For every request, the authority binds the authenticated principal, or an
anonymous principal, to exactly one opaque **Authorization View** of the
Scope. The client cannot name, widen, or combine views through request data.
Different principals may share a view only when the authority considers
their read projections equivalent. The canonical Scope, Bead, and Link URLs
remain identity, and they do not vary by view.

An Authorization View is a closed projection of the Scope. Every read,
Selector, incident Link view and
representation for the request observes that same projection. A Link is
visible only when the Link and every in-Scope endpoint Bead are visible. An
out-of-Scope endpoint is opaque and does not independently gate Link
visibility. A visible Bead need not expose hidden incident Links — a latitude
confined to incoming and unowned Links: a visible source's owned Links,
covered by its revision, are never withheld, and the view includes their
in-Scope targets, under [Owned Links](#owned-links). Explicit
[Resource projection](#optional-resource-projection) may omit that whole recorded plane
from a representation; this does not change the authorization view's closure or
represent omitted content as absent in storage. The authority still evaluates referential integrity, applicable Scope
constraints, deletion safety, and other Scope invariants against its
complete authoritative state. A non-disclosing constraint failure may
withhold the hidden Resources that caused it.

### Selection

BDP selection operates over exactly one collection in one Scope:

```text
Beads
Links
```

The candidate values are conceptually:

```text
{ id, type, properties, metadata }
```

and:

```text
{ id, type, source, target, properties, metadata }
```

Singular paths under `metadata` select common metadata independently of
`properties`; a property named `metadata` remains under `properties.metadata`.

A **Selector** uses a bounded profile of
[RFC 9535 JSONPath](https://www.rfc-editor.org/rfc/rfc9535.html) filter
expressions. It supports:

- singular paths relative to one candidate Resource;
- JSON literals and existence tests;
- `==`, `!=`, `<`, `<=`, `>`, and `>=`; and
- `&&`, `||`, and `!`.

It does not support joins, graph traversal, projection, aggregation,
recursive descent, nested filters, functions, regular expressions,
path-to-path comparisons, or selection of nested values. A Selector always
selects complete top-level Resources.

For example:

```text
$[?@.properties.status == "closed"]
```

The identity-bearing candidate member `id` contains an absolute canonical URL.
`type` is the actual URI-or-exact-Reference union. Raw Selectors do not flatten that union. `source` and `target` are References: a local
canonical Bead URL, an opaque external URI, or a Pinned Reference.
A Selector compares stored values exactly. BDP does not reinterpret or
normalize arbitrary JSONPath string literals as identifiers, so callers use
the stored spelling in Selector expressions; the dedicated `source`,
`target`, and `endpoint` collection filters compare by reference URI and are
the pin-transparent way to select by endpoint.

Selection returns the complete matching Resources:

```text
Select(
  scope,
  collection,
  selector
) -> Resources
```

Pagination and ordering are protocol concerns. They do not change which
Resources satisfy a Selector.

Core does not promise global latest state, cross-replica read-your-writes,
portable identity across canonical-URL relocation, or automatic target acquisition.
A hot-tier miss proves neither absence nor erasure; temporary backend failure is a
service failure. Complete authoritative state, not its disclosure projection,
determines native invariants and applicable Type constraints.

<!-- bdp-schema:start selector -->
### Schema: "selector"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Nonempty ordinary bounded Selector string. Its candidate-local grammar, limits and admitted operators are defined by Selection; it never silently becomes the structured Query AST." |
| minLength | 1 |
| type | "string" |
<!-- bdp-schema:end selector -->

## Logical Resource selection and graph queries

The JSON AST and List/Graph/Query logical semantics in this section are selected
for implementation. They do not advertise an installed operation, change existing
Core GET query parameters, or add a native POST endpoint, `readVersion` discriminator,
capability advertisement, HTTP result/error convention or request-sort binding.
Human expression syntax is deferred. Those transport integrations remain separately
proposed. The required ordinary
Selector and inventory read contracts above remain intact.

### Selected logical representation

The logical representation is a complete JSON AST. Clients
may parse surface syntax and expand conveniences. Services independently admit the
request, establish the read context, optimize, and lower it to their provider.
Provider SQL, physical plans, and trusted client type annotations are not wire
requirements. A service can evaluate residual operations where its backend does
not support equivalent pushdown.

The selected semantics are:

- List selects Beads or Links using candidate-local conditions, with nominal Type
  affiliation explicitly available. Query can acquire related Resources.
- Incoming, outgoing, and connected traversal accept one or multiple Bead roots,
  default to depth one, and return distinct traversed Link editions. Explicit
  unbounded traversal requests the complete reachable closure.
- A traversal's `through` predicate restricts the Links it can follow and collect.
  An outer `where` filters its result without pruning traversal.
- Predicates visibly declare bindings. Named outer bindings are available in
  nested predicates. Lexical shadowing is allowed; there is no implicit `item`.
- Prefix `any` and `all` are quantifier special forms. `any` may omit its test;
  `all` requires one. Empty input makes `any` false and `all` true.
- Link endpoint navigation acquires the selected Bead. Collection navigation
  returns distinct endpoint Bead editions. An explicit `resolve()` is unnecessary.
- Resource equality is edition equality. `id()` returns canonical identity and
  `rev()` the concrete selected revision. Floating inputs select current content
  within the read context; no `current` selector sentinel replaces the actual
  revision token. An opaque exact token may itself have the literal spelling
  `current`, without becoming a floating instruction.
- Ordinary results are Resource collections or explicit graphs. Exact count is
  a service result mode shared by List and Query. Scalar top-level evaluation,
  computed records, and `select` are deferred.

The current draft encoding below uses tagged JSON nodes with an `op` member.
The traversal names `incoming`, `outgoing` and `connected` are represented in
that draft by `op:"walk"` plus `direction`; `any` and `all` are separate
quantifier nodes. These are two different operations, not rival names for the
same node. This draft retains `walk` plus `direction` for traversal and separate
`any`/`all` quantifier nodes. Human expression syntax remains deferred.

This member is an AST discriminator, not a new Resource property or a replacement for Bead/Link Types.
Requests declare `ir: "bdp-query-design-1"`, a `profile`, a `selection`, and a
`result.form`. That design identifier MUST NOT be advertised as a released BDP
version. A service selecting this initial encoding binds its exact source and
supported capabilities; future representation changes require explicit version
selection rather than changing the meaning of existing requests.
Here `profile` denotes an admitted AST subset; it does not change the native
Core/Write discovery profile literal. Capability URI/version selection still
requires a separately selected native discovery/invocation binding.


### Logical AST fields


The top-level closed logical object has required `ir:"bdp-query-design-1"`,
`profile:"list"|"graph"|"query"`, `selection` (a collection expression), and
`result:{form:"resources"|"graph"|"count"}`. Optional `projection` is a nonempty
object with nonempty `include` and/or `omit` JSON Pointer arrays under the shared
mask rules; it selects no native transport by itself. `result` is closed. Each
node below is closed: the listed fields accompany its required `op` tag and
question marks identify optional fields. Binding names match
`[A-Za-z_][A-Za-z0-9_]*`. A Reference uses the shared URI or exact object carrier;
a native invocation must establish supported Scope/kind/read acquisition.


| Collection node | Fields beside `op` | Direct meaning |
| --- | --- | --- |
| `scan` | `collection:"beads"\|"links"` | Current authorized inventory |
| `refs` | `collection:"beads"\|"links"`, `references:[REFERENCE...]` | Explicit kind-asserted roots; unique input References; empty array is empty |
| `filter` | `input:COLLECTION`, `bind:NAME`, `predicate:PREDICATE` | Filter each member under its lexical binding |
| `walk` | `roots:COLLECTION_OR_RESOURCE`, `direction:"incoming"\|"outgoing"\|"connected"`, `depth?:NONNEGATIVE_INTEGER_OR_"unbounded"`, `bind?:NAME`, `through?:PREDICATE` | Collect distinct traversed Link editions; bind and through occur together |
| `endpoints` | `input:COLLECTION`, `side:"source"\|"target"` | Acquire and deduplicate selected endpoint Bead editions |

A Resource expression is `binding` with required `name`, or `endpoint` with
required `of:RESOURCE` and `side:"source"|"target"`. The latter acquires the
selected Bead, rather than merely reading stored Reference syntax.

| Value node | Fields beside `op` |
| --- | --- |
| `literal` | `value:JSON_VALUE` |
| `field` | `of:RESOURCE`, `path:[STRING_KEY_OR_NONNEGATIVE_INTEGER_INDEX...]` (nonempty) |
| `id` | `of:RESOURCE` |
| `rev` | `of:RESOURCE` |

A predicate is a JSON Boolean or one of these nodes:

| Predicate node | Fields beside `op` |
| --- | --- |
| `and`, `or` | nonempty `operands:[PREDICATE...]` |
| `not` | `predicate:PREDICATE` |
| `compare` | `operator:"eq"\|"ne"\|"lt"\|"le"\|"gt"\|"ge"`, `left:VALUE_OR_RESOURCE`, `right:VALUE_OR_RESOURCE` |
| `present` | `value:FIELD_NODE` |
| `contains` | `text:VALUE`, `substring:VALUE` |
| `member` | `value:VALUE`, `array:VALUE` |
| `typeIs` | `of:RESOURCE`, `type:UNPINNED_ABSOLUTE_HTTP_TYPE_URI`, `match:"family"\|"exact"` |
| `any` | `input:COLLECTION`, optional `bind:NAME` and `predicate:PREDICATE` together |
| `all` | `input:COLLECTION`, `bind:NAME`, `predicate:PREDICATE` |

Profile-specific structural admission further restricts these shapes as specified
below. A complete node grammar is not permission to execute unavailable acquisition,
accept proposed Batch inputs, or bypass native capability selection.

### Collections and bindings

Every collection expression denotes Resource editions. The collection nodes are:

| Node | Meaning |
| --- | --- |
| `scan` | Current Bead or Link inventory in the established Scope/read context |
| `refs` | Select explicit native References, asserting Bead or Link kind |
| `filter` | Return input members whose predicate is true under its declared binding |
| `walk` | Traverse eligible Links from Bead roots; return distinct Link editions |
| `endpoints` | Acquire source or target Beads from a Link collection; deduplicate editions |

`refs` is a logical AST collection node, not a general native multi-GET endpoint. Wire
References use the shared URI/string-or-pinned-object shape. The CLI resolves its
quoted relative Reference literals against the selected Scope and uses the
shared ordinal/token rules where those are actually supported. It MUST NOT
manufacture a revision from a string suffix or introduce an ordinal wire token.
Every supplied Reference must resolve to an authorized Resource of the asserted
kind. Missing and authorization-hidden identities use the same uniform
unknown-Resource outcome; do not drop failed roots and return partial success.
An empty supplied array is a genuinely empty selection. A pinned `refs` entry
requires actual advertised exact application History support and its retention,
body, authorization and Reference-closure checks. No capability is inferred from
the AST shape or the existence of a stored token.

A binding names one member, not its whole input collection. A `filter` binding is
visible only in its predicate. A `walk` binding is visible only in `through`.
Quantifier bindings are visible only in their test. An inner binding of the same
name shadows the outer binding in that region. Inputs and roots are evaluated in
the enclosing environment, before the new member binding is introduced. Unknown
or forward names refuse. The surface parser rejects duplicate declarations in
one scope; each AST node declares at most one name, so that case is not separately
expressible in this encoding.

CLI syntax can introduce a single alias used by both a traversal restriction and
its outer selection. Lowering may repeat that name in the separate `walk` and
`filter` binder fields. Those occurrences denote the corresponding prospective
and collected Link editions; neither creates a second alias visible alongside
the first. Alpha-renaming a bound variable preserves the answer.

#### Transaction selection from prior bindings

A later Batch List may filter a previously captured typed set,
and Query may use prior scalar identities or typed sets as explicit inputs. Those
selections see earlier staged writes under the Batch's serializable logical
execution rule. A capture fixes identity membership, not a snapshot of its bodies;
later selections inspect then-current staged content. Read-only batches are
allowed by that logical direction. Transaction List/Query require independent
capability selection; this section assigns no advertisement shape.

Standalone List is inventory-based. Transaction List can use a prior typed set
with local-only conditions; Query can use prior scalar identities or typed sets,
while walk roots must still be Beads. The exact Batch-input encoding, structural
union, conservative admission restrictions and native integration remain proposed.
No `{binding:NAME}` transaction Reference form is selected by this logical model.
Read-only batches and these logical directions do not widen Write's six-CRUD
atomic-batch version 1 or advertise a transaction List/Query operation.

This transaction selection direction is current-staged: it introduces no historical
acquisition, unpublished-revision tests or cross-Scope acquisition/mutation.
A Link may retain an opaque external Reference without acquiring it. Write owns
identity capture, lifecycle outcomes, final publication and retry outcomes; no
public edition exists for an intermediate staged state. Standalone Resource-edition
results are not transaction identity captures.

### Predicates and values

The predicate nodes are JSON booleans, `and`, `or`, `not`, `compare`,
`present`, `contains`, `member`, `typeIs`, `any`, and `all`. Boolean groups use
nonempty operand lists in this encoding; clients simplify an empty group to its
Boolean identity before emission. Admission checks the entire AST, including
branches a particular execution might short-circuit.

Value expressions are `literal`, `field`, `id`, and `rev`. Resource expressions
are `binding` and `endpoint`. A field path uses literal string object keys and
nonnegative integer array indexes; no executable path or wildcard syntax is
implied. `literal` can carry JSON comparison data. It does not construct a new
computed result record. Number/string coercion is absent.

| Test on an absent field against a literal | Result |
| --- | --- |
| Equality, including equality to null | false |
| Inequality, including inequality to null | true |
| Ordering | false |
| Literal contains or exact membership | false |
| Physical presence | false |

Present null, false, and empty values are physically present. Two absent singular
paths compare equal, following the selected JSONPath-compatible comparison rule;
List's literal right operands avoid that case. These are value semantics, not a
third Boolean or a successful answer to an unavailable read. Malformed operations,
unsupported capabilities, and required acquisition failures remain failures.

Inventory scans enumerate only the request's Authorization View. An authorized
Link may still carry a Reference whose target the caller cannot read. A required
endpoint acquisition then uses the same uniform unknown-Resource outcome as a
missing target, without disclosing whether the identity exists or is hidden.
It does not become an absent `status` field or a successful negative finding.
The selected unavailable-content rule applies whenever that content is needed
to determine the answer. This is distinct from a hidden Link never entering the
input collection in the first place.

`compare` with two Resources admits equality/inequality and compares canonical
identity plus concrete selected revision. It does not compare their JSON bodies.
Resource-to-string and Resource-to-raw-Reference comparison refuse rather than
coerce. Callers compare explicit identities or revisions when needed. Stored
Reference tests retain the shared Reference-union/pin rules; `endpoint` means
selected Resource acquisition, not inspection of how a Reference was authored.

Other comparisons preserve the shared JSONPath-compatible value rules. Arrays
and objects use structural JSON equality; ordering is admitted for comparable
numbers or strings. No implicit timestamp parser is added: temporal comparison
requires a separately declared normalization/contract. Unicode strings receive
no implicit normalization or case folding. Literal `contains` is case-sensitive
and has no SQL wildcard or regular-expression interpretation. Missing/null/non-
string operands do not satisfy contains. Exact membership tests an array element;
missing/null/non-array collections do not satisfy it. JSON null and booleans are
not numbers. Exact numeric/interoperability limits remain governed by the shared
JSON admission rules rather than host-language coercion.
`id` and `rev` both return strings, so comparing their returned values is ordinary
string comparison; they do not introduce extra implicit nominal scalar domains.

`typeIs` resolves a nominal Type identity and requests exact or family matching.
The operand is an unpinned absolute nominal Type identity. Exact matching compares
that URI to the declared affiliation URI, extracting `.uri` from a pinned Type
Reference and ignoring its definition revision. It does not select an exact
definition version. A raw `field` path to `type`, like `source` or `target`, sees
the stored Reference union rather than a flattened or dereferenced value.
Family is reflexive: it includes the named nominal Type itself and its recorded
refinements under the authoritative interpretation rules. Required family
authority is still checked; reflexivity is not an exact-only fallback. Missing family authority refuses; there is no exact-only fallback.

### Traversal

`walk` has Bead roots, a direction (`incoming`, `outgoing`, or `connected`), and
an optional depth. Absence means one. A nonnegative integer bounds Link hops;
`"unbounded"` removes that semantic bound. It does not remove work budgets.
Depth zero returns no Links. Graph result formation still retains explicit roots.
The current-only root restriction and edition-aware incidence policy are not
selected here. In particular, this logical model does not decide whether a walk
from current P@r2 excludes locally stored Links pinned to P@r1. Ordinary Core
inventory/incident URI matching remains as specified above; Resource-edition
equality alone does not select a different adjacency rule. An advertised traversal
binding must establish its supported incidence/read context explicitly. Neither a
pin nor a successful historical body read invents a historical Link population.

At each reached Bead, inspect incident Links in the requested direction. Evaluate
`through`, if supplied, on the actual prospective Link edition. False excludes
that Link from both collection and traversal. True admits the Link and permits
expansion through its opposite endpoint, subject to depth and read rules. The
authored source/target orientation never changes. For connected traversal, the
Link's source/target fields retain their ordinary meanings; this model defines
no context-dependent `neighbor` field.

Depth is measured from the nearest admitted root along eligible steps. Expand
Beads reached at fewer than the requested maximum hops. Collect admitted Links
encountered by those expansions, including back Links, self-Links, and parallel
Links. Do not add every Link between reached boundary Beads. A later shorter
route MUST permit the expansions a prematurely recorded longer route would hide.
Records deduplicate by canonical identity plus selected revision. Distinct Link
identities remain distinct for the same endpoint pair. Enumeration order is not
a path count or a statement of ownership.

A Link-only one-hop result can retain an opaque endpoint Reference without
acquiring its body, if neither `through` nor result selection needs it. Expanding
that endpoint at a deeper hop requires supported, authorized acquisition; if that
cannot be established, the operation refuses rather than treating it as
an exhausted branch. Explicit `endpoint`/`endpoints` and graph formation require
their selected Bead content and likewise refuse when it is unavailable. An opaque
stub/frontier graph representation is a possible later extension, not implicit
partial success in this model.

A Link may retain an exact endpoint Reference independently of acquiring that
endpoint body. Traversal from a selected retained edition requires explicitly
supported incidence context. It MUST NOT silently use current adjacency as a
substitute for a historical Link population. The concrete initial restriction and
edition-applicability policy remain unselected, as noted above.

Operational algorithms may use visited tables, recursive SQL, provider graph
operations, or another equivalent implementation. A finite authorized graph with
cycles does not imply infinite enumeration. Foreign-scope expansion, opaque
external endpoints, and pin resolution require explicit provider capability;
unsupported required content refuses without silently becoming an empty result.
Acquisition obeys the shared disclosure policy and MUST NOT reveal hidden
Resources through newly specific failure messages.

An outer filter applies after the logical walk. For example, traversing Requires
and returning only Links to draft Beads can pass through non-draft intermediate
Beads. A planner may push tests down only when doing so preserves that answer.

### Quantifiers and completeness

`any` returns true if at least one member passes its test; an omitted test is
true and declares no unused quantifier binding. A supplied `any` test and its
binding occur together. A traversal's separate `through` binding remains local
to that restriction. `all` returns true if every member passes its required test. The AST
contains input, binder, and test directly. It does not first filter the input and
then universally quantify the surviving Resources.

| Finding | Definitive Boolean |
| --- | --- |
| A valid witness for `any` | true |
| A valid counterexample for `all` | false |
| Exhausted input, no `any` witness | false |
| Exhausted input, no `all` counterexample | true |

A bounded traversal defines a bounded collection. `all` of that collection makes
no claim about deeper connectivity. An unbounded universal check needs complete
relevant acquisition to establish true. An execution cutoff cannot become false
for `any` or true for `all`. Required unavailable data remains a failure whenever
it prevents the answer from being established. Valid definitive short-circuit
answers do not require unrelated enumeration to finish. Services MUST NOT make
arbitrary Boolean branch-order differences into conflicting successful answers.

A concrete fail-fast execution policy—whether an evaluator may refuse upon a
runtime acquisition error before searching other branches for a decisive proof—is
not selected. Pre-execution syntax/type/capability admission and explicit root
assertions still apply to the whole request and cannot be bypassed by a later proof.

Completeness and termination belong to evaluator/response reporting. There is no
language-level unknown Boolean, `complete()` predicate, or implicit partial-count
success. Completion at depth two does not prove reachable closure; deeper
connectivity is unknown unless a remaining frontier has been established or
excluded. Exact reporting fields, cutoff response policy, response framing,
continuation and installed exit codes require a separately selected binding.
Delivery of an established selection can stop at a real page boundary without
changing the logical answer.

### Logical results and projection

`resources` returns the selected Resource collection. `count` returns its exact
distinct edition count before paging; zero is the empty answer. Both List and
Query use this result mode. The evaluator can lower it directly to storage and
need not fetch Resource bodies. Projection does not change the count. An
unfinished count MUST NOT be reported as exact.
Count, graph closure, and quantifier completeness are relative to the request's
Authorization View and admitted read context, never a count of hidden inventory
members. Failure to acquire content required by a visible member's predicate
still follows the uniform unavailable-endpoint rule above.

`graph` forms a graph from an explicit walk: preserve roots, traversed Link
editions, and selected endpoint Bead editions. Isolated roots survive. Link
References, actual Types, identities, and selected revisions retain their shared
meaning. When multiple editions of one identity occur, graph context MUST identify
the selected endpoint editions for its Links without rewriting authored floating
References into stored pins. Exact mapping/carrier fields remain response work.
The logical model admits graph result only for a direct `walk`
selection; filtered graph/path/row results require a separately defined scope.
No graph count unit is silently selected.

The [Resource projection](#optional-resource-projection) rules describe Resource
content masks; applying them to a native AST request still needs its explicit
binding. Projection never changes selected count or membership. Graph component
masks and targeted Bead/Link mask carriers remain deferred. Per-request sorting
requires an explicit protocol/discovery/carrier amendment; Core's ordinary
inventory `order` stays authority-advertised. A schema accepting an AST does not
add native sort, pagination or mask parameters to existing reads. Any admitted
continuation must be issued natively and preserve the selection/context, not be
invented by the consumer.

### List, Graph and Query subsets

These initial admission profiles are subsets of the same selected AST:

| Profile | Admitted shape |
| --- | --- |
| `list` | `scan`, optionally one local `filter`; Resource or count result |
| `graph` | `refs` Bead roots, one `walk`, optional single exact/family Link Type test, graph result |
| `query` | Composition of the admitted collection/predicate nodes; Resource, direct-walk graph, or count result |

List's filter has no endpoint acquisition, related-resource quantifiers, or
field-to-field comparisons. It admits the bounded Boolean/local predicate subset,
Type tests, local identity/revision extraction, and literal comparison operands.
Link endpoint URI flags can lower to comparisons over the stored Reference union
without acquiring Beads. List's collection remains current even if a predicate
compares its revision fields. Query reuses these exact nodes and meanings.
Exact membership admits both a literal element in a local array and a local
scalar in a literal array; field-to-field membership is outside this initial List
subset. The structured List profile is not the ordinary bounded Selector grammar.
Literal contains, array membership, and structured comparison literals may exceed
what that old carrier can express. They require the explicitly new predicate
carrier, not unadvertised functions/nested filters in `selector=`.
List `contains` requires a literal substring operand. A literal text searched for
a candidate-derived substring is outside this initial List subset; Query may
admit that richer local test. This asymmetry keeps ordinary field-search lowering
simple and does not change existing compatibility matching.

Graph-only support requires no arbitrary predicate parser or full Query support.
List and Graph are independently admitted subsets. A declared profile is checked
structurally before execution; it is not a hint allowing unsupported work to be
approximated. Native negotiation and whether Graph gets a focused operation or carrier
remain unselected. The Core minimum still includes its bounded Selector;
this design does not remove that obligation or reinterpret existing Selector text.


<!-- bdp-schema:start countResult -->
### Schema: "countResult"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Exact nonnegative integral count of the complete admitted authorized selection. A cutoff or partial scan cannot be reported as a successful count." |
| minimum | 0 |
| type | "integer" |
<!-- bdp-schema:end countResult -->

## Collections and pagination

GET of discovered Bead/Link inventories returns a closed `{items:[FULL_RECORD...],
next:ABSOLUTE_URL_OR_NULL}` object. Incident views use the same Link page shape.
Selection completes before pagination within one Authorization View. Full records
are returned directly, not href/value wrappers; explicit projection is the only
ordinary inventory exception. No Resource `view` or `include` parameters apply to
inventories and no per-Bead incident aggregate is implied.

The following once-only structural parameters apply:

| Parameter | Beads | Links | Meaning |
| --- | --- | --- | --- |
| `type` | yes | yes | Exact nominal Type URI, ignoring affiliation pin |
| `conformsTo` | yes | yes | Effective conformance under recorded exact Types authority |
| `source` | no | yes | Source Reference URI |
| `target` | no | yes | Target Reference URI |
| `endpoint` | no | yes | Source OR target Reference URI |
| `selector` | yes | yes | Bounded JSONPath candidate filter |
| `limit` | yes | yes | Positive maximum items in this page |
| `cursor` | yes | yes | Issued opaque continuation |

Predicates combine with AND; only endpoint's source/target alternatives use OR.
Type operands are unpinned absolute HTTP(S) identity URIs. `conformsTo` requires
supported exact recorded family semantics (including reflexivity); unavailable
interpretation refuses rather than treating it as nominal equality. `type` alone
never requires Type-definition acquisition. Endpoint operands admit canonical local
Bead IDs or absolute canonical/external URIs; normalize local references before
URI comparison and preserve external equality. Raw Selector literals are never
rewritten and see actual stored unions, not virtual URI-only fields. Repeated,
unknown, malformed or unsupported parameters use `invalid-parameter` (400/request/never).
Incident selection additionally requires its Bead/direction first; then applies
these Link predicates before paging. External endpoints have no anchored view.

Every selected set uses one total stable order. The baseline and supported `order`
value is `canonical-uri`: ascending lexicographic Unicode code-unit comparison of
absolute canonical `id`. No omitted order means anything else. The authority MUST
NOT serve an unadvertised order; callers cannot request relevance or another order.
The same set/order yields the same sequence across authorities.

A cursor freezes selected set, Resource revisions, ordering, authorization projection
and selected contract/representation/feature context. `next` is server-generated,
absolute and authoritative, or null after the final page. If the snapshot/context
cannot continue, use `cursor-expired` or `foreign-view` as applicable; never silently
restart on new state. Authorization changes and erasure cannot be bypassed by a
retained cursor. Paging is neither replica bootstrap nor a generic retention hold.

Top-level Bead/Link inventories and incident Link pages MUST carry exactly one
lowercase `BDP-Collection-Kind: bead` or `link` and `service-desc` identifying the
owning Scope, including continuation HEAD/304 responses. Incident pages additionally
carry `BDP-Resource-Kind: bead` for the subject. Properties views identify only their
point Resource. An aggregate is a point response, not a collection merely because
it embeds one page. Type summaries and History rows are not these collections.
Clients verify item kind from metadata, never paths, the first item or guessed
shape. Continuation navigation must remain bound to the actual owning Scope/context,
not a configured default or path stripping. Redirects confer no credential grant.

`limit` is a positive per-page upper bound, not a promised page length. Fewer or
zero items with a nonnull next can be valid, but continuation MUST make meaningful
progress or fail, not issue an endless nonadvancing chain. Clients MAY replace or
append only `limit` on an issued ordinary continuation, preserving every other
path/query encoding, ordering, cursor and semantic parameter. URL signing MUST
permit that resizing. This rule does not apply to History, Events or Type inventory.

A consumer total cap stops at a delivered page boundary and retains that boundary's
native next. It MUST NOT overfetch then return a continuation skipping undisplayed
rows, invent null exhaustion, or reconstruct a cursor. First observed exhaustion
wins over a coincident cap. If failure occurs midpage without a native resumable
boundary, omit continuation instead of skipping rows or claiming exhaustion; a
fully emitted native page boundary may be retained.

## Historical resolution


History is an optional complete capability available with Core or Write. It is
not a separate base profile. Discovery advertises it only as
`historicalResolution: { "version": 1 }`, the closed `historyCapability`
definition. Absence means it is not advertised. An authority MUST implement
all applicable requirements in this section before advertising it, for both
canonical Bead and Link URLs. A profile, a retained store, or a schema parser
alone supplies no capability claim. No advance age/count retention guarantee,
aggregate participation count/class, retention hold, or generic persistent-
consumer erasure acquisition is advertised by this member.

Here **subject-history authorization** means the same single retained-history
authorization defined under [Reads after deletion](#reads-after-deletion), evaluated
in the current request's Authorization View. “History-authorized” refers to that
same gate. It is independent of permission to disclose a complete historical record
or a whole metadata row; no second retention-disclosure permission is introduced.

### History discovery and views

Existing page limits apply to versions pages. The fixed 64-item bound on
missing-state diagnostics is defined under
[Historical diagnoses and missing state](#historical-diagnoses-and-missing-state).

History provides full-record `revision` retrieval and a separate `view=versions`
operation on canonical Bead and Link URLs. The query combinations below are
exhaustive. Neither operation adds alias query semantics or a historical
`include=links` aggregate.

```text
GET {resource}?revision={token}
GET {resource}?view=versions[&limit={count}][&cursor={cursor}]
```

### Immutable change context

`revisionProvenance` is the single immutable version envelope outside
`properties` and common `metadata`. Its optional `actor` is the carried
attribution defined above, including truthful absence and
`writer-supplied|unknown`; grouping the fields does not authenticate the
actor. Read does not require History, a timestamp, an actor, or this
envelope. Shared schemas permit absent provenance and actor-only provenance
for legacy and non-History versions.

Native versions under advertised History MUST carry `committedAt`, `agent`, and
`message` in this envelope on current/historical complete record reads and retained
history rows. No provenance is synthesized on deleted identities, aliases,
References or properties views. These requirements do not establish full Memory
compatibility.

The closed envelope permits only `actor`, `committedAt`, `agent`, and `message`.
The last three fields are an all-or-none group, independently of actor presence.
`committedAt` is `{ "state": "present", "value": <RFC 3339 date-time> }` or
`{ "state": "undetermined" }`. Agent and message are each a closed
`{ "state": "present", "value": <string> }` or `{ "state": "absent" }` or
`{ "state": "undetermined" }`; a present agent identity is nonempty, while an
intentionally empty message is valid. Absence, uncertainty and a recorded value
are distinct; never fabricate legacy metadata. Sources, source completeness,
Activity records and terminal deletion versions are not introduced here.

### Historical authorization

Historical success requires the current whole-record/owned-state permission
defined below. Missing-state refusals use subject-history authorization
independently of reconstruction. Historical identity/relationship permission
grants no target body access and does not relax the current-plane closure
under [Authorization views](#authorization-views).

### Exact historical reads

The following query and full-record clauses describe the unextended History
request. An explicit [Resource projection](#optional-resource-projection)
invocation additionally admits `projectionVersion` and `fields` and represents
that same authorized saved edition through the projected record arm. This is the
only projection exception to those clauses; historical permission, retention and
no-substitution rules remain unchanged. The unextended request
retains the literal full-read contract below.

`GET` or `HEAD canonical-resource?revision=token` selects exactly one
nonempty opaque revision. Query components follow the existing form-query
convention (`URLSearchParams`): decode percent escapes once and decode `+` as
space. A literal plus in a token MUST be encoded as `%2B`; a space may be encoded
as `%20` or `+`. Percent-encoded reserved characters and Unicode are data, not
checkpoint-token syntax. Repeated or
empty `revision`, any additional query member (including `view`, `include`,
selection or pagination), and unsupported History queries on a non-advertising
authority fail as `invalid-parameter`. Alias queries retain uniform
`resource-not-found` / 404 and gain no History semantics. Normal authentication
and non-disclosure precedence applies before condition-specific disclosure.

A successful exact read returns the ordinary complete Resource record with
exactly the requested `id` and `revision`, carried attribution and change
context when recorded, and the complete historical owned-Link state. Use
`historicalBeadRecord` or `historicalLinkRecord`; the Bead shape excludes the
`links` aggregate. Never substitute current/nearest state, load inline Links
from today's graph, fill missing values from another revision, or rewrite
bound values under an old token. A historical owned Link and its source
retain their separate revision addresses. No witness envelope, new digest
scheme or extra current-scheme mapping is part of this capability.

Success requires current permission to disclose the whole requested historical
record, including its complete owned state. Historical target closure requires
current target visibility OR explicit current permission to disclose that
historical target identity and relationship. Source access alone supplies
neither permission, and disclosure of an identity/relationship grants no target
body access. Failed success authorization returns uniform `resource-not-found`,
not a partial record or invented retention diagnosis. A deleted subject may
have authorized retained history; historical permission does not restore its
current visibility. Current-plane owned-source/hidden-target closure and the
incident-Link deletion refusal remain unchanged. The alternative Memory
surviving-citation lifecycle is deferred.

### Historical diagnoses and missing state

Ordinary non-History reads use the discretionary disclosure under
[Reads after deletion](#reads-after-deletion). History requires substantiated
Gone-with-reason for removed cited versions, the five subject-history-gated
Read diagnoses, and authorized deleted-subject versions pages. It preserves
uniform unauthorized 404 and creates no partial/current Resource success.

The five `revision-*` Read diagnoses in [Problem details](#problem-details)
apply to History requests and require current subject-history authorization.
The sole exception permits only `revision-unretained` on
[exact Type-definition lookup](#narrow-missing-state-permission),
under that operation's current whole-definition/owned-state disclosure permission.
It does not import the other diagnoses or general History obligations.
Unauthorized callers receive uniform `resource-not-found`, without evidence,
window or participation disclosure. In particular, the Bead-history gate for
`revision-unretained` MUST NOT depend on reconstructing the absent owned state.
Permission denial is never evidence of incompleteness. These gates also apply
to independent Link history under the selected complete Resource capability.

- `revision-unknown`: no retained state or substantiated disposition for this
  syntactically valid requested token. It is responder-relative uncertainty,
  not evidence of tampering, pruning or guaranteed synchronization repair.
- `revision-unretained`: positive version knowledge but missing reconstruction
  pieces. It carries required `missing`, a `historyMissing` object with `items`
  and `complete`. No Resource or partial Resource accompanies it.
- `revision-reorganized`: positive evidence that history replacement lost this
  address; authority replacement or unfamiliar token spelling alone is insufficient.
- `revision-not-tracked`: positive evidence of subject non-participation;
  absence of records or an expired participation marker is insufficient.
- `revision-unrepresentable`: positive knowledge that an existing bound BDP
  value cannot be faithfully served under its declared representation/numeric
  contract. Missing bytes, unknown provenance, private-tool limitations and
  backend outage are insufficient. No condition-specific payload is added.
  Missing reconstruction remains Unretained; erasure and non-disclosure take
  precedence; temporary I/O remains ordinary service failure. Repair may make
  the original valid representation serviceable, never change that version's
  values under the same address.

A missing item is exactly one of `{ "kind": "record" }` for an unavailable
whole record, `{ "kind": "property", "pointer": "/properties/name" }`
for a missing property location (JSON Pointer in the complete Resource record),
or `{ "kind": "owned-links", "type": "https://example.test/types/cites" }`
for a missing owned-Type set. Omitting `type` in the last form identifies the
whole unavailable owned plane. A property pointer may instead locate properties
inside a historical inline Link. Do not invent nested locations when the whole
component is unavailable. No item contains missing content values. Missing
items are unique and limited to 64 per response. `complete: false` explicitly
means a bounded or not fully established inventory; an omitted location is not
thereby present. A complete inventory must contain at least one item. An empty,
incomplete inventory is permitted when the remaining locations cannot be
established; that persistent uncertainty is not automatically a temporary error.

On this History surface, removal of a cited historical version MUST leave its
address answering Gone with its substantiated reason to a history-authorized
caller: existing `resource-pruned` / `resource-erased`, or `revision-reorganized`
for positively evidenced replacement loss. Preserve sufficient positive
disposition evidence to fulfill that duty; no expiry exception was selected.
Existing pruning/erasure status and retry rules and optional `archivedAt` remain
unchanged. Ordinary non-History Core retains [Reads after deletion](#reads-after-deletion)'s
separate discretionary disclosure. Do not derive pruning from missing evidence
or expire required Gone evidence with participation knowledge.

No History refusal carries a window or `mayChangeAfterSync`; clients use the
versions operation for a retained window. `resource-erased` retains its prohibition
on condition-specific extensions. The new diagnoses' `after-state-change` advice
requires changed state or a newly constructed request, not endless polling, a
sync promise or a promised repair mechanism. Temporary service failures remain
`temporarily-unavailable` / 503 / `after-delay`.

### Retained versions pages

 a versions metadata response supplies `BDP-Resource-Kind`
when the subject's kind is known and disclosable, including corresponding HEAD/304.
It MAY omit the field when kind is unknown or not disclosable; this is not a full
Resource/properties read and creates no permanent kind-marker promise. Never
invent a kind from URI spelling. Summary rows are not Bead/Link Resource
collections and do not acquire `BDP-Collection-Kind`; see [collections and pagination](#collections-and-pagination).

`GET canonical-resource?view=versions` returns `historyVersionsPage`. `HEAD`
has the corresponding GET status and headers without a body. Permitted query
members are one each of `view=versions`, optional positive integer `limit`, and
optional nonempty opaque `cursor`; other/repeated members are `invalid-parameter`.
Use the existing advertised `limits.page` defaults and maximum; without them the
initial default is 100 items and maximum is 1000. A requested limit above the
applicable maximum follows the existing `limit-exceeded` rule. Limits bound
pages, never retention. Continuations are absolute same-subject URLs carrying
`view=versions` and `cursor`, with any applicable `limit` preserved.

The page contains `subject` (the canonical Resource URL), `population` fixed
to `all-retained`, `participation` (`tracked`, `not-tracked`, or
`undetermined`), `window`, `items`, and `next` (an absolute continuation URL
or null). Each row contains opaque `revision`, `lineage` (`current` or
`replaced`), stored `body` state (`complete` or `incomplete`), and the actual
retained `revisionProvenance` when recorded. Rows contain no properties,
owned payload, timestamp- order claim or protocol position. Metadata absence
is truthful legacy absence, not redaction of known metadata into unknown.
Authorize the subject-history surface and every whole row's revision,
attribution and context before including it; otherwise omit that row. Row
permission grants no Resource body permission.

`window` contains `newest` and `oldest` revision bounds (both null for an empty
window) and `complete`. Bounds refer to the selected enumeration snapshot, not
merely this page. `complete: true` asserts positive knowledge that the window
covers the responder's entire authorized retained population at that snapshot;
false makes no such assertion. Every bound, completeness claim, continuation
and other metadata is authorization-relative and reveals no omitted-row count.
Positive retained state establishes `tracked`. `not-tracked` requires positive
non-participation evidence; lacking such evidence is `undetermined`. The latter
two states have no rows, null bounds and no continuation. There is no permanent
participation-marker promise; required Gone and erasure evidence is unaffected.

Enumerate every version in the selected retained window, newest authority-order
first, including retained replaced versions and positively evidenced non-erased
incomplete versions. Establish a stable authority order before the snapshot,
including restore/import cases; never derive it from token spelling, claimed
time or an exposed store ordinal. Replaced and current membership is explicit,
not ancestry inferred from display order. Omit erased versions and records that
are only pruning/reorganization disposition evidence. A complete stored record
that is unrepresentable remains a complete retained member: stored completeness
does not promise successful serviceability. Listing any version promises neither
future body availability nor permission to read its body. Authorized deleted-
subject enumeration remains available without reviving the subject.

Pagination continues one stable enumeration snapshot under the existing profile,
authorization and erasure fences. A continuation must make meaningful progress;
it cannot silently select a newer snapshot. There is no minimum cursor lifetime.
Actual expiry uses `cursor-expired`; temporary failure serving a valid unexpired
snapshot is ordinary service failure. Neither a cursor nor enumeration holds
Resource bodies in retention.

### Historical HTTP metadata

Historical responses remain `Cache-Control: private, no-store`. A successful
exact Resource response uses the authority's existing Resource-revision ETag
projection, including its collision-safe encoding for opaque tokens, rather
than assuming that every token can simply be quoted. No universal new validator
encoding is selected here. [Conditional reads and HEAD](#conditional-reads-and-head)
continues to apply; authorization precedes evaluation, and conditional responses
retain applicable navigation metadata. HEAD performs GET's complete decision and
returns no body; use GET to distinguish the typed diagnoses that share a status.
No diagnostic response headers or bulk-check endpoint are introduced.

On exact historical success, `BDP-History-Lineage` is `current` or `replaced`,
identifying this version's membership in the responder's recorded lineage.
The `version-history` Link relation targets that subject's `view=versions`
operation whose population is explicitly `all-retained`. Preserve authorized,
known direct `predecessor-version` and `successor-version` relations within each
recorded lineage, including retained replaced records. Multiple direct targets
are permitted. `latest-version` may name the authorized current authority version.
Omit any relation for which no truthful authorized target is known. Never link
r3 directly to r4 merely because r1→r2→r3 was restored to r1 and r4 was then
minted; never call the next surviving entry a direct successor through a gap.
The relations state local knowledge, not global freshness or a notification SLA.

Relation identity disclosure is authorized independently of whole-row metadata;
a truthful authorized target may be absent from the page because its whole row
cannot be shown. Relation presence implies neither membership/count nor target
body permission. No current target is invented for a deleted or undisclosable
current Resource. The History lineage header and these Link values follow the
same authorization and HEAD/conditional metadata rules. If cross-origin BDP access
is enabled, the CORS policy MUST expose `BDP-History-Lineage` when the History
capability is advertised, in addition to the fields required under
[HTTP consistency, caching, and CORS fields](#http-consistency-caching-and-cors-fields).

### History recovery, imports and assurance

Every History implementation enforces applicable erasure
decisions on every controlled retained copy before further serving and preserves
required erasure evidence across local recovery. This includes context, inline
owned content, indexes, caches and any other controlled retained copies. Retaining an old address never permits
serving erased content. A non-owning reference is not embedded target content;
no new retention propagation, target rewrite or wire hold follows.

Before importing a retained copy into visibility, positively establish its
origin/version identity and erasure status from authoritative evidence appropriate
to that origin, and apply known erasures. Unestablishable status requires rejection
or discard, not publication, identity laundering or permanent unmanaged quarantine.
Restored local copies obey the same cleanup duty. No new HTTP import endpoint or
extra import provenance fields are defined. Realizations must make their proof
mechanism reviewable and test it through controlled admission/recovery/read cases.

Plain History claims the responder's behavior, not erasure delivery to arbitrary
downloaded copies. A deployment may document and test a specific consumer
acquisition/recovery route and claim only that scoped assurance, proving controlled-
copy cleanup before further publication. This does not exempt any obligated store
or advertise generic BDP replication. Generic pre-removal administrative reports,
preview endpoints, minimum retention promises, exact-byte witnesses, sync hints,
extra scheme mappings, erased-row enumeration, bulk checks and the alternative
surviving-citation lifecycle remain deferred. Local policy/tooling is allowed;
none weakens required Gone evidence, erasure or incident-Link refusal.

<!-- bdp-schema:start historyCapability -->
### Schema: "historyCapability"

Value: object

Other fields: not allowed

Required order: ["version"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "History version-1 advertisement. It commits to the complete exact-read and retained-versions contract, not merely an event timeline or a current-record lookup." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "version" | schema | yes | — | "Exact selected feature version. No version ordering or implicit upgrade is defined." |

#### Advanced

```json-schema
{
  "properties": {
    "version": {
      "const": 1
    }
  }
}
```
<!-- bdp-schema:end historyCapability -->

<!-- bdp-schema:start historyMissingItem -->
### Schema: "historyMissingItem"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One unavailable component needed for an exact response: the subject record, a selected property path, or captured owned-Link state. The bounded diagnosis preserves known location without substituting current content." |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "kind": {
          "const": "record"
        }
      },
      "required": [
        "kind"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "kind": {
          "const": "property"
        },
        "pointer": {
          "allOf": [
            {
              "$ref": "#/$defs/jsonPointer"
            },
            {
              "type": "string",
              "pattern": "^/(properties(?:/|$)|ownedLinks/([^/~]|~[01])+/(0|[1-9][0-9]*)/properties(?:/|$))"
            }
          ]
        }
      },
      "required": [
        "kind",
        "pointer"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "kind": {
          "const": "owned-links"
        },
        "type": {
          "$ref": "#/$defs/absoluteHttpUrl"
        }
      },
      "required": [
        "kind"
      ],
      "additionalProperties": false
    }
  ]
}
```
<!-- bdp-schema:end historyMissingItem -->

<!-- bdp-schema:start historyMissing -->
### Schema: "historyMissing"

Value: object

Other fields: not allowed

Required order: ["complete","items"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Bounded missing-state diagnosis for revision-unretained. Complete states whether the item list is exhaustive; it cannot falsely certify reconstruction or erase undisclosed dependencies." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "complete" | boolean | yes | — | "Whether the stated bounded information is exhaustive under the containing contract." |
| "items" | schema | yes | — | "Finite ordered members of this page or bounded diagnosis. Meaning and completeness follow the containing operation." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "complete": {
            "const": true
          }
        },
        "required": [
          "complete"
        ]
      },
      "then": {
        "properties": {
          "items": {
            "type": "array",
            "minItems": 1
          }
        }
      }
    }
  ],
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/historyMissingItem"
      },
      "maxItems": 64,
      "uniqueItems": true
    }
  }
}
```
<!-- bdp-schema:end historyMissing -->

<!-- bdp-schema:start historyVersionRow -->
### Schema: "historyVersionRow"

Value: object

Other fields: not allowed

Required order: ["revision","lineage","body"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One retained Resource-version summary. Revision, lineage and body completeness describe actual retained version state; deletion is not represented as a synthetic version row." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "body" | schema | yes | — | "Whether the row’s retained version can currently produce its complete recorded representation, including required owned state." |
| "lineage" | schema | yes | — | "Whether the row belongs to the current or a replaced retained lineage; this is not a revision-order comparison." |
| "revision" | ref "#/$defs/revision" | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
| "revisionProvenance" | ref "#/$defs/revisionProvenance" | no | — | "Immutable carried attribution for this concrete version; it authenticates no principal." |

#### Advanced

```json-schema
{
  "properties": {
    "body": {
      "enum": [
        "complete",
        "incomplete"
      ]
    },
    "lineage": {
      "enum": [
        "current",
        "replaced"
      ]
    }
  }
}
```
<!-- bdp-schema:end historyVersionRow -->

<!-- bdp-schema:start historyWindow -->
### Schema: "historyWindow"

Value: object

Other fields: not allowed

Required order: ["newest","oldest","complete"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Known retained-version window and completeness. Null endpoints describe an empty or unavailable window under the participation rules; tokens are not ordered arithmetically." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "complete" | boolean | yes | — | "Whether the stated bounded information is exhaustive under the containing contract." |
| "newest" | (ref "#/$defs/revision") OR (null) | yes | — | "Newest known retained revision or explicit null under the stated window rules." |
| "oldest" | (ref "#/$defs/revision") OR (null) | yes | — | "Oldest known retained revision or explicit null under the stated window rules." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "newest": {
            "type": "null"
          }
        },
        "required": [
          "newest"
        ]
      },
      "then": {
        "properties": {
          "oldest": {
            "type": "null"
          }
        }
      },
      "else": {
        "properties": {
          "oldest": {
            "$ref": "#/$defs/revision"
          }
        }
      }
    }
  ]
}
```
<!-- bdp-schema:end historyWindow -->

<!-- bdp-schema:start historyVersionsPage -->
### Schema: "historyVersionsPage"

Value: object

Other fields: not allowed

Required order: ["subject","population","participation","window","items","next"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Finite all-retained History page. Subject, participation, window, items and next remain explicit, and nonparticipating/undetermined subjects do not acquire invented rows." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/historyVersionRow") | yes | — | "Finite ordered members of this page or bounded diagnosis. Meaning and completeness follow the containing operation." |
| "next" | (ref "#/$defs/absoluteHttpUrl") OR (null) | yes | — | "Absolute continuation URL, or explicit null only when the admitted finite traversal is exhausted." |
| "participation" | schema | yes | — | "Whether this subject is tracked, not tracked or cannot be determined under the History contract." |
| "population" | schema | yes | — | "Explicit retained population selector; it does not assert current live membership." |
| "subject" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Canonical Resource identity to which this retained page or Resource-scoped observation applies." |
| "window" | ref "#/$defs/historyWindow" | yes | — | "Known retained-history boundaries and completeness, never a synthetic history." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "participation": {
            "enum": [
              "not-tracked",
              "undetermined"
            ]
          }
        },
        "required": [
          "participation"
        ]
      },
      "then": {
        "properties": {
          "items": {
            "type": "array",
            "maxItems": 0
          },
          "next": {
            "type": "null"
          },
          "window": {
            "type": "object",
            "properties": {
              "newest": {
                "type": "null"
              },
              "oldest": {
                "type": "null"
              }
            }
          }
        }
      }
    }
  ],
  "properties": {
    "participation": {
      "enum": [
        "tracked",
        "not-tracked",
        "undetermined"
      ]
    },
    "population": {
      "const": "all-retained"
    }
  }
}
```
<!-- bdp-schema:end historyVersionsPage -->

<!-- bdp-schema:start historicalBeadRecord -->
### Schema: "historicalBeadRecord"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete exact Bead representation. Current incident-Link aggregates are excluded; captured owned-Link state comes from that recorded version." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/beadRecord"
    },
    {
      "type": "object",
      "properties": {
        "links": false
      }
    }
  ]
}
```
<!-- bdp-schema:end historicalBeadRecord -->

<!-- bdp-schema:start historicalLinkRecord -->
### Schema: "historicalLinkRecord"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| $ref | "#/$defs/linkRecord" |
| description | "Complete exact Link representation retaining its recorded whole source/target and Type References. Current defaults or pins cannot replace them." |
<!-- bdp-schema:end historicalLinkRecord -->

<a id="required-events"></a>

## Optional Events

Events is optional for both Core and Write. A Scope advertises support by including
its absolute `events` URL in discovery; absence means that clients MUST NOT assume
an Event source or `view=events` is supported. The member is an explicit promise of
the complete finite-observation contract below, not permission to provide only a
live stream or to omit required facts. Advertising Events creates no export,
import, snapshot or replica-application capability.

A request selecting `view=events` on a Scope without Events support MUST be refused
as an unsupported view using `invalid-parameter`; it MUST NOT return an ordinary
Resource representation in its place. Clients MUST NOT guess a Scope event URL.

### Advertised source, truthful coverage

A Core/Write Scope advertising Events MUST expose its discovered `events` source
and a Resource-scoped projection through `view=events`. A source is an observation
endpoint, not a third Resource kind, public receipt or replica log. Resource
selection uses canonical identity/kind and current disclosure; the source can
remain readable after subject deletion under its actual retention/disclosure.
Unknown subjects do not become distinguishable from forbidden subjects. Opaque
external Link endpoints do not acquire in-Scope Event sources.

An Event records a published Resource transition or a truthfully described external
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
Alias-only changes produce no Resource Event; aliases acquire no Resource kind or
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

Scope observation GETs the discovered absolute URL. Resource observation GETs its
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

`retainedEvent` is the union of postimage and delta fact shapes. Common envelope
members are source-local stable `id`, absolute `source`, observation `time`,
`origin:"write"|"observation"`, actual `revision`, selected `representation` and
`effect`. A Write-origin fact MUST have actual Scope-local `transaction` correlation;
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
Each Event's source and representation MUST agree with its selected page. These
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
[owned Links](#owned-links); no rebucketing from current definitions occurs.

The owner may therefore have a derived-only `updateBead` fact even though an authored
update without input is invalid. `derived` is not an accepted mutation command
field. Full-map replacement is a deliberately simple optional-delta representation,
not a minimum-byte patch promise or another ownership implementation. It handles
ownership entry/exit without pretending the Link was created/deleted. Actual Link
and owner revisions stay independent and share known commit correlation.

Facts exclude `expectedRevision`, local `name`/`@name`, execution keys and
credentials. They describe committed/observed state; submitting them to a mutation
endpoint would be new intent and is not Event consumption or replica replay.

### Projection and compatible extension

Scope source covers authorized Resource transitions. Link source projects its
lifecycle; Bead source projects its lifecycle and lifecycle effects of incident
Links, including a Link Type-only change. For an endpoint correction, incidence
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
durable subscriber state, erasure reconciliation or replica group application.

### Event carriers

The closed page has required `source` (absolute Event source URL), `selection`
(`{representation:"postimage"|"delta"}`), `policy`, `coverage`, `events` (ordered
array), nonempty opaque `cursor`, and `next` (absolute URL or null). `subject`, when
present, is the canonical Resource URL for a subject projection. Page and facts
must agree on source and selected representation.

Policy is a closed object with required `observation`, nonempty `description`,
positive integer `minimumRetentionSeconds`, positive integer
`minimumCursorLifetimeSeconds`, and a nonempty unique `representations` array
containing `postimage` and optionally `delta`. Optional `maximumPageSize` is a
positive integer native page bound. Coverage is exactly the nonempty opaque
`start`, `retainedFrom`, `through` tokens. None is arithmetic or global position.

A fact contains required nonempty opaque `id`, absolute `source`, `time`, `origin`,
`revision`, `representation`, and `effect`; `transaction`, `previousRevision` and
an object `annotations` are present only under the conditions above. All required
postimage/effect/deletion/derived members carry the meanings above. Create/update
postimage effects contain their complete `resource`; deletion contains `deleted`.
The closed deletion context is `{resourceKind:"bead", resource:{id,type,revision}}`
or `{resourceKind:"link", resource:{id,type,revision}, source, target}`. Its
`resource` is the closed identity object and its Link endpoints are complete
References; there are no properties or new deletion revision.
Delta create carries allocated `id`, type, complete objects and Link endpoints.
Delta update identifies `bead` or `link` and carries changed fields; delete uses
that target plus deleted context. These are facts, never accepted write commands.

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

Required order: ["id","source","time","origin","revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Shared immutable fact envelope. Write-origin facts carry commit correlation; observation-origin facts describe the source’s truthful observation limitations." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "annotations" | schema | no | — | "Explicit extension annotations. Unsupported required meaning cannot silently become known meaning." |
| "id" | ref "#/$defs/wireToken" | yes | — | "Opaque immutable fact identity scoped to this Event source; it is not a Resource ID or resume cursor." |
| "origin" | schema | yes | — | "Whether this fact came from Write’s own committed transition or truthful external observation." |
| "previousRevision" | ref "#/$defs/revision" | no | — | "Actual known observed predecessor; omission never invents intermediate revisions." |
| "revision" | ref "#/$defs/revision" | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
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
      "$ref": "#/$defs/retainedEventCommon"
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
      "$ref": "#/$defs/retainedEventCommon"
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

<!-- bdp-schema:start retainedEvent -->
### Schema: "retainedEvent"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Union of the supported complete postimage and delta Event shapes. Schema acceptance does not prove truthful coverage, retention or atomic production." |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/retainedPostimageEvent"
    },
    {
      "$ref": "#/$defs/retainedDeltaEvent"
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
              "$ref": "#/$defs/retainedPostimageEvent"
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
              "$ref": "#/$defs/retainedDeltaEvent"
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

## Final publication

Core reads, retained versions and Events describe published Resource state, never
intermediate staging. When Write publishes one atomic decision, each surviving
Resource has at most one final new revision and at most one lifecycle fact, exactly
when its final revision-covered state differs from its committed baseline. A
surviving creation has one creation revision; a deletion invents no new revision.
Core does not require mutations or atomic-batch support.

Revision-covered state comprises complete affiliation, properties, metadata,
applicable captured owned state and, for a Link, complete source/target References.
Equal final state preserves the original revision and recorded envelope, including
provenance and unchanged retained capture shape. A→B→A within one decision therefore
publishes no intermediate version or Event when all covered state is equal. Two
separately committed writes retain their separate published transitions. A no-op
cannot mint provenance or a lifecycle fact merely because valid attribution was
supplied.

A changed surviving owner captures complete final Link records once, with their
actual final revisions/affiliations and whole References. Multiple owned-Link effects
and owner edits do not create intermediate owner editions. An unchanged Link gains
no invented revision through owner retyping, and unchanged membership/capture cannot
be normalized into a new owner revision. Literal endpoint pins stay literal: L's
stored S@r1 can remain in a capture at S@r2 without repinning or changing either
retained address. Incoming incidence alone does not version a target.

Committed allocation and published Resource state are distinct. A successful
create-then-delete can consume canonical identity under nonreuse without publishing
a Resource version, fictional body/affiliation or lifecycle fact. It is not an
ordinary semantic no-op. Rollback commits no allocation or published transition.
No readable intermediate state or new reservation Resource follows.

When Events is advertised, for each final published create/update/delete its required facts describe the actual
initial-to-final transition; postimage is final state and optional delta transforms
its actual predecessor to that state. Include changed owners once and order the
Scope's facts by canonical Resource URI within their known transaction, preserving
append order between decisions. Allocation-only effects have no Resource lifecycle
fact. Realized attribution is immutable per published version, not attestation or
an instruction to repeat a write. Revision comparison remains Resource-qualified;
equal tokens across Resources prove neither common state nor transaction identity.

[Write's final atomic publication](../write/write.md#final-atomic-publication)
defines ordered staging, admission/validation, allocation outcomes, final revision
and no-op decisions, attribution-input agreement, mutation results and durable
retry bookkeeping. Its atomic decision binds final state, allocation, facts required by advertised Events
and original outcome; ordinary reads or later Type defaults cannot rewrite them.
These operational rules do not add mutation obligations to a Core-only provider.

## Optional Resource projection

### Select content, then represent it

A point request first selects its authorized Resource edition. A List request
first selects its authorized current Resource population. Projection then changes
the represented fields, never identity, revision, authorization, membership,
ordering, count, or acquisition. Required filtering/sorting uses full selected
data even if a field is omitted from the response.

The same visible edition, read context, and projection mask yield the same
Resource content in GET and a corresponding List item. This equivalence does not
equate their envelopes, errors, validators, or continuation. A failed point lookup
and a successful empty List remain different outcomes. A revision predicate on a
current List does not acquire historical editions.

For an exact historical GET, project the selected saved edition. Do not substitute
current fields, a nearest revision, or present-day Type content. Full historical
authorization and retention rules are checked before projection. A mask is not
permission to read otherwise unavailable history.

### Mask composition

- No includes or omissions returns the full selected Resource representation.
- Includes union the selected original paths, plus protected context.
- Omissions subtract from that union; omit wins and argument order has no effect.
- Root include (`""`, the empty JSON Pointer) selects the whole Resource. Root
  omission refuses. Supplied mask arrays are nonempty; omit an array member to
  request no mask of that kind. Invalid RFC 6901 escapes refuse.
  Omit an empty projection container rather than serializing `{}`.
- Protect canonical identity, actual Type, selected revision, and whole source/
  target References on Links. A mask cannot misrepresent their meaning.
- Protected context cannot be sliced with nested include paths either. Protection
  is Resource-kind-aware: an absent `/source` on a Bead is an ordinary no-op,
  whereas a Link's `/source` Reference is protected whole.
- `title` is an ordinary optional property, not protected context.
- Properties/metadata admit nested paths. Revision provenance, recorded owned
  Links (`ownedLinks`) are whole-plane only initially. Each may be omitted by a mask; omission must be declared
  as projection, not misrepresented as a full record with no recorded state.
  Nested plane slicing is deferred. References stay whole.
- A valid absent optional include adds nothing, and an absent omission changes
  nothing. An include set matching no optional fields returns protected context
  only. Do not synthesize null or fall back to a full Resource.

Every path is evaluated against the original Resource. Retained array elements
are compacted once in original order; do not fabricate null padding or reevaluate
shifted indexes. Preserve ancestor containers. For `items:["red","blue","green"]`,
including `/properties/items/1` produces `["blue"]`; omitting that path from the
full array produces `["red","green"]`. Including indexes 1 and 2 and then omitting
index 1 produces `["green"]`.

Mask paths refer to the stable logical Resource shape. Schema evolution needs an
explicit compatibility story before this shape is locked. Path syntax,
unsupported/protected omissions, and unsupported capability remain errors.
Ordinary missing optional data is nonfatal.

Missing-path warnings are advisory and deduplicated per path when supported by
useful authorized evidence. They MUST NOT require an extra full scan, infer
absence from empty/incomplete pages, expose hidden fields, or alter selection or
success. Exact diagnostic framing belongs to the common response contract.

### Shared operations and existing views

Properties-only, included-Link aggregates, Versions summaries, Events, and Type
inventories retain their own representations. A mask does not request a native
view or acquire related Resources. Versions is the subject
History GET view; summary rows do not automatically accept Resource masks.

### Discovery and native invocation

The capability identity is
`https://github.com/gastownhall/bdp/capabilities/resource-projection`, version `"1"`.
Its closed detail contains required booleans `current`, `exact` and `list`; at least
one MUST be true. Each selects support for that operation independently. `exact:true`
also requires actual complete application History. Projection never advertises
History, structured List, Graph or Query on their own behalf.

A supported Resource GET/HEAD or ordinary Bead/Link inventory GET/HEAD accepts
once-only `projectionVersion=1` and optional `fields=ENCODED_JSON_MASK`.
`fields` is a JSON object with nonempty `include` and/or `omit` arrays of RFC 6901
pointers. Apply ordinary form-query decoding once, then JSON decoding; duplicate
JSON keys refuse and a literal plus must be encoded `%2B`. `fields` requires the
version selector. A selected version without fields requests the full native
representation and has no projection header. A supplied empty mask refuses.

Current requests require `current:true`; exact `revision=TOKEN` requests require
`exact:true`; ordinary inventories require `list:true`. Inventory selectors,
`limit` and `cursor` compose under their existing meanings. Structural endpoint
filters retain canonical local Bead ID or absolute URI inputs; normalize local
references before comparison, preserving external URI equality. The parsed-query
schema carries raw filter strings; existing local-ID/URI validation still applies. Exact requests admit
only `revision`, `projectionVersion` and `fields`; no historical inventory is
introduced. Properties view, incident view, included-Link aggregate, Versions,
Events and Type inventories do not admit these parameters in version 1.

Base clients may ignore the capability and continue full reads. A client selecting
it MUST refuse locally if the necessary advertisement is absent. A receiving
service MUST refuse unsupported capability/version or operation support, never
ignore a mask, silently return full content or substitute local rendering.
Malformed, repeated or extra parameters use `invalid-parameter`. A well-formed
unsupported selection uses the feature-local 422 `capability-not-supported`
Problem with `capability` equal to this URI and `capabilityVersion` equal to the
requested version. Ordinary authentication and nondisclosure precedence applies.

### Representation and continuation

Every successful explicitly masked point or inventory response MUST carry the
outer HTTP field `BDP-Projection`, containing the compact ASCII JSON mask actually
applied. Escape non-ASCII characters as JSON Unicode escapes. Include the field on
corresponding successful HEAD and 304 responses. Full responses have no such field.
This is representation metadata, never a Resource property or a claim that omitted
content was absent in storage. Expose it under ordinary CORS rules. Refuse before
output if required request-target or response-header bounds cannot carry it intact;
never truncate the mask. Existing actual-kind and owning-Scope headers still apply.

Projected responses use `projectedBeadRecord` or `projectedLinkRecord`, and inventory
wrappers use `projectedBeadCollection` or `projectedLinkCollection`. These arms are
selected only by an explicitly masked invocation; no-mask responses use ordinary
full/current/historical arms. The projected arms retain identity, actual Type,
revision and whole Link endpoints, while allowing masked properties, metadata,
provenance and owned state to be absent. Stored/full-record requirements are not
loosened. Schema acceptance does not replace semantic protection of mask paths.

Authorization of the complete selected edition precedes masking. Exact saved data
that is unavailable remains unavailable; no current read may fill the gaps.
Validators cover the actual authorized representation, not a manufactured ETag
from a Resource revision. Conditional and HEAD decisions retain their native order
and bodyless meaning. A full representation's validator does not automatically
qualify a projected representation.

An inventory continuation freezes the mask with its selection, ordering, snapshot
and authorization context. Follow the issued `next` unchanged except for the
existing permitted `limit` replacement. Changing its native mask refuses; a
client cannot silently substitute a new selection or snapshot. Count and member
order are determined before projection. A separate client display mask cannot
recover fields the native representation omitted or alter that continuation.

<!-- bdp-schema:start resourceProjectionCapabilityV1 -->
### Schema: "resourceProjectionCapabilityV1"

Value: object

Other fields: not allowed

Required order: ["current","exact","list"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Version-1 projection support flags for current, exact and inventory reads. At least one form is supported; each true flag commits to its complete representation semantics." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "current" | boolean | yes | — | "Whether this capability supports current point reads." |
| "exact" | boolean | yes | — | "Whether this capability supports exact retained point reads." |
| "list" | boolean | yes | — | "Whether this capability supports inventory pages." |

#### Advanced

```json-schema
{
  "anyOf": [
    {
      "required": [
        "current"
      ],
      "properties": {
        "current": {
          "const": true
        }
      }
    },
    {
      "required": [
        "exact"
      ],
      "properties": {
        "exact": {
          "const": true
        }
      }
    },
    {
      "required": [
        "list"
      ],
      "properties": {
        "list": {
          "const": true
        }
      }
    }
  ]
}
```
<!-- bdp-schema:end resourceProjectionCapabilityV1 -->

<!-- bdp-schema:start resourceProjectionMask -->
### Schema: "resourceProjectionMask"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Nonempty include/omit JSON Pointer mask. Mask syntax does not allow partial mutation, implicit admission changes or a forged full record." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "include" | schema | no | — | "Nonempty paths whose selected content enters the projection." |
| "omit" | schema | no | — | "Nonempty paths removed after include selection; identity carrier rules still apply." |

#### Advanced

```json-schema
{
  "anyOf": [
    {
      "required": [
        "include"
      ],
      "properties": {
        "include": true
      }
    },
    {
      "required": [
        "omit"
      ],
      "properties": {
        "omit": true
      }
    }
  ],
  "properties": {
    "include": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/jsonPointer"
      }
    },
    "omit": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/jsonPointer"
      }
    }
  }
}
```
<!-- bdp-schema:end resourceProjectionMask -->

<!-- bdp-schema:start resourceProjectionSelection -->
### Schema: "resourceProjectionSelection"

Value: object

Required order: ["projectionVersion"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Projection-version admission discriminator. It is only a preliminary selector; complete decoded point or inventory parameters have their own closed shapes." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "projectionVersion" | schema | yes | — | "Explicit projection version selector. Missing or unsupported selection cannot be treated as version 1." |

#### Advanced

```json-schema
{
  "properties": {
    "projectionVersion": {
      "type": "string",
      "minLength": 1
    }
  }
}
```
<!-- bdp-schema:end resourceProjectionSelection -->

<!-- bdp-schema:start resourceProjectionPointQueryV1 -->
### Schema: "resourceProjectionPointQueryV1"

Value: object

Other fields: not allowed

Required order: ["projectionVersion"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete decoded version-1 point projection query, optionally selecting an exact revision. Unsupported projection must refuse rather than return an unlabelled full representation." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "fields" | ref "#/$defs/resourceProjectionMask" | no | — | "Explicit content projection mask, evaluated under the shared include/omit rules." |
| "projectionVersion" | schema | yes | — | "Explicit projection version selector. Missing or unsupported selection cannot be treated as version 1." |
| "revision" | ref "#/$defs/revision" | no | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |

#### Advanced

```json-schema
{
  "properties": {
    "projectionVersion": {
      "const": "1"
    }
  }
}
```
<!-- bdp-schema:end resourceProjectionPointQueryV1 -->

<!-- bdp-schema:start resourceProjectionInventoryQueryV1 -->
### Schema: "resourceProjectionInventoryQueryV1"

Value: object

Other fields: not allowed

Required order: ["projectionVersion"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete decoded version-1 inventory projection query. Continuations preserve the admitted mask, selection, ordering and read context." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "conformsTo" | ref "#/$defs/absoluteHttpUrl" | no | — | "Explicit nominal Type-family inventory filter. It selects membership and is not a projected Resource property." |
| "cursor" | schema | no | — | "Opaque issued inventory continuation token preserving the selected mask, filters, order and authorization context." |
| "endpoint" | schema | no | — | "Decoded incident-endpoint filter string, selecting Links at either end under the ordinary inventory rules." |
| "fields" | ref "#/$defs/resourceProjectionMask" | no | — | "Explicit content projection mask, evaluated under the shared include/omit rules." |
| "limit" | ref "#/$defs/positiveInteger" | no | — | "Positive admitted Resource-record page bound; continuation and exhaustion obey the ordinary inventory rules." |
| "projectionVersion" | schema | yes | — | "Explicit projection version selector. Missing or unsupported selection cannot be treated as version 1." |
| "selector" | schema | no | — | "Nonempty decoded ordinary Selector string, using its bounded candidate-local grammar rather than the structured Query AST." |
| "source" | schema | no | — | "Decoded source-endpoint filter string under the ordinary Link inventory rules; it is not a Link record member." |
| "target" | schema | no | — | "Decoded target-endpoint filter string under the ordinary Link inventory rules; it is not a Link record member." |
| "type" | ref "#/$defs/absoluteHttpUrl" | no | — | "Exact nominal Type-identity inventory filter. This is not a returned Resource affiliation or a version pin." |

#### Advanced

```json-schema
{
  "properties": {
    "cursor": {
      "type": "string",
      "minLength": 1
    },
    "endpoint": {
      "type": "string",
      "minLength": 1
    },
    "projectionVersion": {
      "const": "1"
    },
    "selector": {
      "type": "string",
      "minLength": 1
    },
    "source": {
      "type": "string",
      "minLength": 1
    },
    "target": {
      "type": "string",
      "minLength": 1
    }
  }
}
```
<!-- bdp-schema:end resourceProjectionInventoryQueryV1 -->

<!-- bdp-schema:start projectedBeadRecord -->
### Schema: "projectedBeadRecord"

Value: object

Other fields: not allowed

Required order: ["id","type","revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Explicitly projected Bead representation. Identity, Type affiliation and revision stay mandatory; selected content may be omitted only under the projection contract." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute canonical immutable Resource identity URL." |
| "metadata" | ref "#/$defs/metadata" | no | — | "Common mutable object content, independent of Type-specific properties." |
| "ownedLinks" | schema | no | — | "Recorded revision-covered owned-Link capture, grouped by nominal Link-Type identity. It is derived state, not directly writable input." |
| "properties" | ref "#/$defs/properties" | no | — | "Application-authored object content selected by the containing representation." |
| "revision" | schema | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
| "revisionProvenance" | ref "#/$defs/revisionProvenance" | no | — | "Immutable carried attribution for this concrete version; it authenticates no principal." |
| "type" | ref "#/$defs/typeReference" | yes | — | "Complete nominal Type affiliation, preserving an exact revision pin when present. Core carries it without fetching a definition." |

#### Advanced

```json-schema
{
  "properties": {
    "ownedLinks": {
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
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```
<!-- bdp-schema:end projectedBeadRecord -->

<!-- bdp-schema:start projectedLinkRecord -->
### Schema: "projectedLinkRecord"

Value: object

Other fields: not allowed

Required order: ["id","type","revision","source","target"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Explicitly projected Link representation. Identity, Type affiliation and revision stay mandatory and endpoint rules follow the selected projection mask." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute canonical immutable Resource identity URL." |
| "metadata" | ref "#/$defs/metadata" | no | — | "Common mutable object content, independent of Type-specific properties." |
| "properties" | ref "#/$defs/properties" | no | — | "Application-authored object content selected by the containing representation." |
| "revision" | schema | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
| "revisionProvenance" | ref "#/$defs/revisionProvenance" | no | — | "Immutable carried attribution for this concrete version; it authenticates no principal." |
| "source" | ref "#/$defs/reference" | yes | — | "Whole source Reference of this directed Link, preserving any exact revision pin." |
| "target" | ref "#/$defs/reference" | yes | — | "Whole target Reference of a Link, preserving any exact revision pin." |
| "type" | ref "#/$defs/typeReference" | yes | — | "Complete nominal Type affiliation, preserving an exact revision pin when present. Core carries it without fetching a definition." |

#### Advanced

```json-schema
{
  "properties": {
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```
<!-- bdp-schema:end projectedLinkRecord -->

<!-- bdp-schema:start projectedBeadCollection -->
### Schema: "projectedBeadCollection"

Value: object

Other fields: not allowed

Required order: ["items","next"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Finite page of explicitly projected Bead carriers. Projection changes representation, not membership or exhaustion." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/projectedBeadRecord") | yes | — | "Finite ordered members of this page or bounded diagnosis. Meaning and completeness follow the containing operation." |
| "next" | schema | yes | — | "Absolute continuation URL, or explicit null only when the admitted finite traversal is exhausted." |

#### Advanced

```json-schema
{
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
<!-- bdp-schema:end projectedBeadCollection -->

<!-- bdp-schema:start projectedLinkCollection -->
### Schema: "projectedLinkCollection"

Value: object

Other fields: not allowed

Required order: ["items","next"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Finite page of explicitly projected Link carriers. Projection does not merge parallel Links or alter endpoint identity." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/projectedLinkRecord") | yes | — | "Finite ordered members of this page or bounded diagnosis. Meaning and completeness follow the containing operation." |
| "next" | schema | yes | — | "Absolute continuation URL, or explicit null only when the admitted finite traversal is exhausted." |

#### Advanced

```json-schema
{
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
<!-- bdp-schema:end projectedLinkCollection -->

<!-- bdp-schema:start resourceProjectionCapabilityProblem -->
### Schema: "resourceProjectionCapabilityProblem"

Value: object

Other fields: not allowed

Required order: ["type","code","retry","status","capability","capabilityVersion"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Problem carrier for unsupported projection capability or version selection. Unsupported meaning cannot silently downgrade." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capability" | schema | yes | — | "Exact capability identity associated with this refusal. It does not advertise that capability as supported." |
| "capabilityVersion" | schema | yes | — | "Exact nonempty capability version selected by this request or diagnosed by this Problem. It has no implicit ordering or upgrade." |
| "code" | schema | yes | — | "Stable machine-readable Problem diagnosis, interpreted with type and retry." |
| "detail" | text | no | — | "Human-readable detail that obeys authorization and non-disclosure." |
| "instance" | ref "#/$defs/absoluteUri" | no | — | "Optional URI identifying this failure occurrence." |
| "retry" | schema | yes | — | "Required retry disposition for this exact diagnosis; it does not authorize changing intent." |
| "status" | schema | yes | — | "HTTP status associated with this Problem; protocol decision order remains binding." |
| "title" | text | no | — | "Short human-readable Problem summary." |
| "type" | schema | yes | — | "Complete nominal Type affiliation, preserving an exact revision pin when present. Core carries it without fetching a definition." |

#### Advanced

```json-schema
{
  "properties": {
    "capability": {
      "const": "https://github.com/gastownhall/bdp/capabilities/resource-projection"
    },
    "capabilityVersion": {
      "type": "string",
      "minLength": 1
    },
    "code": {
      "const": "capability-not-supported"
    },
    "retry": {
      "const": "after-state-change"
    },
    "status": {
      "const": 422
    },
    "type": {
      "const": "https://github.com/gastownhall/bdp/problems/request"
    }
  }
}
```
<!-- bdp-schema:end resourceProjectionCapabilityProblem -->

<!-- bdp-schema:start resourceProjectionProblem -->
### Schema: "resourceProjectionProblem"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Problem carrier for admitted projection reads, retaining ordinary read and History diagnoses." |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/readProblem"
    },
    {
      "$ref": "#/$defs/resourceProjectionCapabilityProblem"
    }
  ]
}
```
<!-- bdp-schema:end resourceProjectionProblem -->

## Optional exact Type-definition lookup

This optional operation serves complete exact definitions only in an explicitly
supported interpreting context. Its advertisement alone implies neither Types nor
application History. Core defines the carrier, transport and narrow diagnoses;
Types defines definition category, completeness and interpretation.

### Capability and query dispatch

Capability `https://github.com/gastownhall/bdp/capabilities/type-definition-read`,
exact version `"1"`, has closed detail `{operation:ABSOLUTE_HTTP_URL}` served by the
advertising lookup Scope. No path prefix is prescribed. Base clients can ignore
this advertisement while retaining their actual supported base behavior. Advertising
it alone does not claim Types, grant authorization or imply application History.
Optional [Types](../types/types.md) defines any required complete-definition obligation.

GET and corresponding HEAD take exactly once-only `capabilityVersion`, `uri` and
`revision`. Version 1 requires `capabilityVersion=1`, an absolute HTTP(S) canonical
Type identity and a nonempty opaque revision. The native query helper describes
decoded scalar members; the HTTP layer must separately reject repeated members.
Form-query decoding occurs once; literal plus is `%2B`, while encoded reserved
characters/Unicode remain token data. Literal `current`/`unpinned` have no special
wire instruction meaning. No alias resolution, local-name acquisition, creation
handle, inventory scan, default refresh, projection, incident view or paging.

Authenticate/apply ordinary non-disclosure and operational bounds, then read the
nonempty once-only selector before interpreting a future version's other members.
The permissive selection helper is a dispatch prefix, not request admission.
A supported version uses its complete closed query grammar. A valid unsupported
selector receives the feature-local request-family HTTP 422
`capability-not-supported`, `retry:"after-state-change"`, this `capability` URI,
requested `capabilityVersion` and `parameter:"capabilityVersion"`. No body JSON
pointer or atomic-batch capability is substituted. Missing/empty/repeated selection,
or invalid/extra version-1 members, uses existing `invalid-parameter`. No fallback
may silently change meaning. Lookup is read-only and creates no execution key,
registration/default effect or local graph membership.

### Complete wrapper, without ownership transfer

HTTP 200 uses `application/vnd.bdp.v0.1+json` and the closed result object:

```text
{ definition: COMPLETE_EXACT_DEFINITION_BEAD, originScope?: RECORDED_SCOPE_URL }
```

The definition's `id`/`revision` MUST equal the requested pair. Preserve its exact
metatype affiliation, all original properties/schema resources, metadata/provenance
presence and captured owned Links with their exact affiliations, identities,
revisions and endpoints. No incident aggregate, present-day recapture, synthetic
History provenance, current/nearest substitution or partial success. The definition
record helper requires the owned plane and pinned definition/Link affiliations;
shape validation alone cannot establish actual definition category/completeness.
Separate exact lookups follow recorded dependencies, not current adjacency. A child
read does not assert parent availability or complete closure interpretation.

`originScope` is returned whenever that original context is recorded. Never infer
it from a URI prefix or fill it with the receiver. Unknown intrinsic publication
context stays unresolved; a case requiring known original authority is not qualified
by dropping it. The received original context is not by itself a verified current
mutation binding. Authorized retained foreign definitions can be served while the
origin is offline, without fetching or renaming them.

This operation's wrapper is not a canonical Resource point response or a collection.
It MUST NOT carry `BDP-Resource-Kind` or `BDP-Collection-Kind`. If service-desc is
returned, it identifies the responding lookup service only, never the owner of
`definition.id`. The [point ownership rule](#point-read-kind-and-owning-scope-navigation)
still applies to actual canonical Resource reads, not to every operation response
containing a record. Later mutation routing needs independently verified owning
context. Do not unwrap the result and treat its transport location as that proof.

Where optional Types defines local materialization of a global definition,
lookup of the global exact pair still returns that original record/context.
Ordinary canonical reads of a real local materialization retain its actual local
identity/revision/owner. No implicit global-to-local substitution, Type alias,
URI equality or origin inference follows; Types owns any explicit correspondence.

HEAD retains selection/authorization/negotiation/status with no body. HTTP conditions
select this one native wrapper representation; auth/query/retained-state erasure
checks precede 304. GET 304 and precondition 412 are bodyless; negotiation 406 is
bodyless. Any validator is for the actual authorized lookup representation, not
an invented Resource revision, global closure or ownership witness. Applicable
private/no-store and CORS/ordinary HTTP rules remain binding.

### Narrow missing-state permission

Current whole-definition/owned-state disclosure authorization precedes existence or
reason-specific disclosure. Unknown exact pairs and nondisclosure use uniform
`resource-not-found`. This operation does not make an unfamiliar token evidence of
loss, pruning, reorganization or tampering. A temporary backend failure is ordinary
service failure, not proof that retained pieces are gone. Existing erasure and
ordinary discretionary removal disclosure take precedence; no removal lifecycle is
selected here.

For this selected lookup **only**, positive local knowledge of the exact retained
revision with missing reconstruction pieces MAY use existing `revision-unretained`
under current whole-definition/owned-state disclosure permission. This permission
MUST be decidable without reconstructing missing bytes; denial is never evidence
of loss. The required `missing` object retains [its precise bounded shape](#historical-diagnoses-and-missing-state):
unique locations, at most 64, explicit `complete`, no content values or partial
Resource. It diagnoses missing reconstruction, not authorization or backend outage.
The cap bounds diagnostics, not the definition's semantic size or Link count.

This is the sole exception here to the History-only revision-diagnosis rule.
It neither imports the other four diagnoses nor requires subject-history permission,
versions pages, History provenance, participation tracking, retention floors or an
application History advertisement. The feature-local Problem union narrows existing
Read Problems plus this operation's capability refusal; global Read code tables
and History obligations stay unchanged. Ordinary `show URI@REV` cannot silently
fall back here solely because application History is absent.

### Existing limits and admission obligations

`limits.request.targetBytes` counts the complete encoded HTTP request target,
including the three query members. Exceeding the request bound uses existing
`request-too-large`; no successful partial/decoded/truncated query is allowed.
`limits.resource.representationBytes` applies to the inner complete definition
record including captured owned state, and `propertiesBytes` to its properties,
in UTF-8 JSON bytes under the existing definitions. They are not page limits,
family maxima or a claim that wrapper overhead fits in the inner record bound.

Version 1's detail adds no response-budget field. Actual whole-wrapper capacity
(including recorded origin context) and any operational count bounds must still
be honored at admission. Omission of a pre-advertised bound does not mean infinity.
Before accepting state/configuration that creates the promised exact-read obligation,
the authority MUST ensure it can serve the complete result within those operational
bounds, or refuse that admission using the applicable existing bound diagnosis
(`request-too-large` for request bytes; `limit-exceeded` for admitted operational
work/result capacity). This states no new Type registration or public CRUD API.

Tightening configuration MUST preserve promised complete retained reads or refuse
the configuration change. A newly smaller budget cannot justify truncation, paging
owned captures, an alternate current definition or false Unretained evidence.
Authorization changes remain authoritative. Existing promises do not turn temporary
I/O into permanent loss or demand invented data. Schema-valid wrappers do not waive these admission, authorization or service obligations.

<!-- bdp-schema:start typeDefinitionReadSelection -->
### Schema: "typeDefinitionReadSelection"

Value: object

Other fields: allowed

Required order: ["capabilityVersion"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Preliminary exact-definition-lookup discriminator. A selected request must satisfy the complete version-1 query shape and advertised lookup contract." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capabilityVersion" | schema | yes | — | "Exact nonempty capability version selected by this request or diagnosed by this Problem. It has no implicit ordering or upgrade." |

#### Advanced

```json-schema
{
  "properties": {
    "capabilityVersion": {
      "type": "string",
      "minLength": 1
    }
  }
}
```
<!-- bdp-schema:end typeDefinitionReadSelection -->

<!-- bdp-schema:start typeDefinitionReadQueryV1 -->
### Schema: "typeDefinitionReadQueryV1"

Value: object

Other fields: not allowed

Required order: ["capabilityVersion","uri","revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete decoded exact-definition request: explicit version and a pinned Type Reference. It is a GET query carrier, not a new Resource write or installation command." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capabilityVersion" | schema | yes | — | "Exact nonempty capability version selected by this request or diagnosed by this Problem. It has no implicit ordering or upgrade." |
| "revision" | schema | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
| "uri" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Complete target identity carried by this Reference. Relative paths and partial Reference objects are not admitted." |

#### Advanced

```json-schema
{
  "properties": {
    "capabilityVersion": {
      "const": "1"
    },
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```
<!-- bdp-schema:end typeDefinitionReadQueryV1 -->

<!-- bdp-schema:start typeDefinitionReadCapabilityV1 -->
### Schema: "typeDefinitionReadCapabilityV1"

Value: object

Other fields: not allowed

Required order: ["operation"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Exact-definition version-1 advertisement. The service accepts complete exact-record servability obligations within its actual response and retained-dependency bounds." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operation" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Advertised absolute exact-definition lookup operation URL. It grants no permission and does not change the definition’s owner." |
<!-- bdp-schema:end typeDefinitionReadCapabilityV1 -->

<!-- bdp-schema:start exactTypeDefinitionRecord -->
### Schema: "exactTypeDefinitionRecord"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Whole exact Type-definition Bead with recorded owned closure and pinned Type affiliations. Serving a global definition never transfers ownership to the responder." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/beadRecord"
    },
    {
      "type": "object",
      "required": [
        "ownedLinks"
      ],
      "properties": {
        "type": {
          "$ref": "#/$defs/pinnedTypeReference"
        },
        "links": false,
        "ownedLinks": {
          "type": "object",
          "additionalProperties": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "type": {
                  "$ref": "#/$defs/pinnedTypeReference"
                }
              }
            }
          }
        }
      }
    }
  ]
}
```
<!-- bdp-schema:end exactTypeDefinitionRecord -->

<!-- bdp-schema:start typeDefinitionReadResult -->
### Schema: "typeDefinitionReadResult"

Value: object

Other fields: not allowed

Required order: ["definition"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Closed whole-record lookup wrapper. Optional originScope reports known owning context; the responder is not implicitly the definition owner." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "definition" | ref "#/$defs/exactTypeDefinitionRecord" | yes | — | "One complete exact Type-definition Bead including its required recorded owned closure." |
| "originScope" | ref "#/$defs/absoluteHttpUrl" | no | — | "Recorded owning-Scope context when known. The responding lookup service does not thereby become owner." |
<!-- bdp-schema:end typeDefinitionReadResult -->

<!-- bdp-schema:start typeDefinitionReadCapabilityProblem -->
### Schema: "typeDefinitionReadCapabilityProblem"

Value: object

Other fields: not allowed

Required order: ["type","status","code","retry","capability","capabilityVersion","parameter"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Problem carrier for unsupported exact-definition capability/version selection. It supplies no installation or application-History claim." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capability" | schema | yes | — | "Exact capability identity associated with this refusal. It does not advertise that capability as supported." |
| "capabilityVersion" | schema | yes | — | "Exact nonempty capability version selected by this request or diagnosed by this Problem. It has no implicit ordering or upgrade." |
| "code" | schema | yes | — | "Stable machine-readable Problem diagnosis, interpreted with type and retry." |
| "detail" | text | no | — | "Human-readable detail that obeys authorization and non-disclosure." |
| "instance" | ref "#/$defs/absoluteUri" | no | — | "Optional URI identifying this failure occurrence." |
| "parameter" | schema | yes | — | "Request parameter associated with the capability-selection diagnosis; its permitted literal is constrained here." |
| "retry" | schema | yes | — | "Required retry disposition for this exact diagnosis; it does not authorize changing intent." |
| "status" | schema | yes | — | "HTTP status associated with this Problem; protocol decision order remains binding." |
| "title" | text | no | — | "Short human-readable Problem summary." |
| "type" | schema | yes | — | "Complete nominal Type affiliation, preserving an exact revision pin when present. Core carries it without fetching a definition." |

#### Advanced

```json-schema
{
  "properties": {
    "capability": {
      "const": "https://github.com/gastownhall/bdp/capabilities/type-definition-read"
    },
    "capabilityVersion": {
      "type": "string",
      "minLength": 1
    },
    "code": {
      "const": "capability-not-supported"
    },
    "parameter": {
      "const": "capabilityVersion"
    },
    "retry": {
      "const": "after-state-change"
    },
    "status": {
      "const": 422
    },
    "type": {
      "const": "https://github.com/gastownhall/bdp/problems/request"
    }
  }
}
```
<!-- bdp-schema:end typeDefinitionReadCapabilityProblem -->

<!-- bdp-schema:start typeDefinitionReadProblem -->
### Schema: "typeDefinitionReadProblem"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Problem carrier for exact-definition reads. Narrow missing-state diagnosis never substitutes current content or silently truncates the owned capture." |

#### Advanced

```json-schema
{
  "oneOf": [
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
                "resource-pruned",
                "resource-erased",
                "request-too-large",
                "limit-exceeded",
                "rate-limited",
                "temporarily-unavailable",
                "revision-unretained"
              ]
            }
          }
        }
      ]
    },
    {
      "$ref": "#/$defs/typeDefinitionReadCapabilityProblem"
    }
  ]
}
```
<!-- bdp-schema:end typeDefinitionReadProblem -->

## Problems and HTTP behavior

### Problem details

Except for the bodyless HTTP responses defined below (including 304, 405, 406,
412 and unexpected internal 500), unsuccessful BDP responses use RFC 9457
Problem Details. BDP defines a small set of stable problem-type families. The
required `code` member identifies the exact normative condition within its
family. Each code fixes its HTTP status and retry disposition. The Core
profile uses this closed table:

| Code | Family suffix | HTTP status | Retry |
| --- | --- | --- | --- |
| `malformed-request` | `request` | 400 | `never` |
| `invalid-parameter` | `request` | 400 | `never` |
| `unauthenticated` | `authentication` | 401 | `after-state-change` |
| `forbidden` | `authorization` | 403 | `after-state-change` |
| `resource-not-found` | `not-found` | 404 | `after-state-change` |
| `resource-pruned` | `gone` | 410 | `never` |
| `resource-erased` | `gone` | 410 | `never` |
| `foreign-view` | `conflict` | 409 | `after-state-change` |
| `cursor-expired` | `gone` | 410 | `after-state-change` |
| `request-too-large` | `size` | 413 | `never` |
| `limit-exceeded` | `size` | 413 | `never` |
| `rate-limited` | `rate-limit` | 429 | `after-delay` |
| `temporarily-unavailable` | `unavailable` | 503 | `after-delay` |
| `revision-unknown` | `not-found` | 404 | `after-state-change` |
| `revision-unretained` | `conflict` | 409 | `after-state-change` |
| `revision-reorganized` | `gone` | 410 | `after-state-change` |
| `revision-not-tracked` | `conflict` | 409 | `after-state-change` |
| `revision-unrepresentable` | `conflict` | 409 | `after-state-change` |

The five History `revision-*` Read rows have the evidence, missing-state and
authorization contracts in
[Historical diagnoses and missing state](#historical-diagnoses-and-missing-state).

Problem `type` is the BDP problem-family prefix
`https://github.com/gastownhall/bdp/problems/` followed by the table's family
suffix. In addition to the RFC 9457 members, every BDP problem contains
`code` and `retry`. In the Core profile, `retry` is exactly `never`,
`after-state-change`, or `after-delay`. `after-state-change` requires the
caller to refresh state or construct a new request. `after-delay` responses
SHOULD carry `Retry-After` when the authority can state a useful delay.
`resource-pruned` and `resource-erased` are the authorization-gated
disclosure conditions defined under
[Reads after deletion](#reads-after-deletion): they are served only to
callers authorized for the subject's retained history, and a
`resource-pruned` problem MAY carry the `archivedAt` Reference defined
there. Unauthorized callers receive the uniform `404`
`resource-not-found` for the same address.

A direct problem uses its code's HTTP status. Its RFC 9457 `status` member is
optional, but when present it MUST match the HTTP status. RFC 9457 extension
members are allowed. The Read family model, required fields, status mapping, and retry table are
closed. An implementation advertising the `core`
profile MUST support `GET` and `HEAD` for application requests. It MUST NOT
assign application semantics to `OPTIONS`. When it enables cross-origin
access, it MUST answer `OPTIONS` according to the CORS rules below. It MUST
respond with `405 Method Not Allowed` to `OPTIONS` when cross-origin access
is not enabled and to every other method. Every such `405` MUST include
`Allow: GET, HEAD`, plus `OPTIONS` when cross-origin access is enabled, and
MUST NOT include a BDP Problem body. These are HTTP-native rejections rather
than members of the Read problem-code table.
Write retains GET and HEAD and defines its additional methods and Allow values. In every profile, an otherwise valid request whose `Accept` field
accepts none of the endpoint's successful response media types MUST receive
a bodyless `406 Not Acceptable`, with no BDP problem code, family, or retry
member. Existing authentication, authorization/non-disclosure, and other ordinary
failures retain their handling; negotiation MUST NOT expose a hidden target
or recursively renegotiate an error representation. Missing `Accept` permits
the endpoint's default. Ordinary HTTP media-range matching, specificity, and
quality weights apply, including `q=0` exclusions; an endpoint selects an acceptable supported
representation when one exists.
An implementation MUST respond to an unexpected
internal server fault with a body-less `500 Internal Server Error`, MUST NOT
include a BDP Problem body, and MUST keep internal fault details off the
wire. A future revision may assign a BDP Problem mapping for those faults.
This draft deliberately does not.

### HTTP consistency, caching, and CORS fields

Individual Resource responses use HTTP `ETag` for the opaque Resource
revision. Pagination continuations preserve their own stable result.

Scope-bounded representations that depend on authorization use
`Cache-Control: private, no-store`. If an implementation enables
cross-origin BDP access, its CORS policy MUST allow every BDP-defined
non-safelisted request field used by its advertised profile. It MUST also allow the applicable HTTP conditional
request fields: `If-Match`, `If-None-Match`, `If-Modified-Since`, and
`If-Unmodified-Since`. It MUST expose `Link`, `ETag`, `Retry-After`,
and `Cache-Control` when applicable. It MUST also expose `BDP-Resource-Kind`
when that response field applies. It MUST also expose
`BDP-Collection-Kind` when applicable; see [collections and pagination](#collections-and-pagination).
History response-field exposure is defined
under [Historical HTTP metadata](#historical-http-metadata). Ordinary CORS
rules still govern `Accept` and `Content-Type` values. Representations hosted outside a Scope retain their applicable HTTP caching semantics.

### Conditional reads and HEAD

No conditional response permits retaining or reusing content that the erasure
rules require removing.

GET and HEAD preconditions follow [RFC 9110 section 13.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.2).
Normal authentication, authorization/non-disclosure, query and cursor checks,
and applicable History erasure/expiry checks MUST precede any conditional not-modified shortcut. An ordinary refusal is not
replaced by `304`. A successful read whose HTTP condition selects
`304 Not Modified`, or a read whose precondition fails with
`412 Precondition Failed`, MUST be bodyless and MUST NOT carry a BDP Problem
body. Applicable cache fields remain required on these responses.

Omitting optional validators does not permit ignoring HTTP preconditions.
For an otherwise successful existing representation without an entity tag,
`If-None-Match: *` yields `304`, a specific `If-Match` entity tag fails with
`412`, and `If-Match: *` passes. A specific `If-None-Match` entity tag cannot
match an absent entity tag. Combined conditions retain HTTP precedence:
`If-Match` is evaluated before `If-None-Match`; date conditions obey their
HTTP availability, validity, and precedence rules. Omission of a
`Last-Modified` field does not itself establish whether a modification date
is available. No new modification-date or validator construction scheme is
assigned here.

HEAD retains the corresponding GET authorization, query, cursor, media
negotiation, and precondition decision and MUST send no response body. This includes canonical Resource, collection, view and pagination URLs. Ordinary HTTP
HEAD metadata rules, including permitted omissions, apply; BDP's explicitly
required context/cache fields remain required. These obligations apply to all mandatory Core reads.

<!-- bdp-schema:start retryDisposition -->
### Schema: "retryDisposition"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Protocol retry guidance. A refusal does not authorize changing semantic intent or minting a fresh execution key to evade durable no-reexecution." |
| enum | ["never","after-state-change","after-delay"] |
<!-- bdp-schema:end retryDisposition -->

<!-- bdp-schema:start readProblemCode -->
### Schema: "readProblemCode"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Closed vocabulary of Core read diagnoses, including bounded History missing-state failures. HTTP disclosure and precedence rules still govern which diagnosis can be exposed." |
| enum | ["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","revision-unknown","revision-unretained","revision-reorganized","revision-not-tracked","revision-unrepresentable"] |
<!-- bdp-schema:end readProblemCode -->

<!-- bdp-schema:start readProblem -->
### Schema: "readProblem"

Value: object

Required order: ["type","code","retry"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Core Problem Details carrier. Type/code/status/retry combinations and History-specific fields are constrained together; schema validity alone does not prove the original request was authorized." |
| title | "BDP Read Problem Details" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "code" | ref "#/$defs/readProblemCode" | yes | — | "Stable machine-readable Problem diagnosis, interpreted with type and retry." |
| "detail" | text | no | — | "Human-readable detail that obeys authorization and non-disclosure." |
| "instance" | ref "#/$defs/absoluteUri" | no | — | "Optional URI identifying this failure occurrence." |
| "retry" | ref "#/$defs/retryDisposition" | yes | — | "Required retry disposition for this exact diagnosis; it does not authorize changing intent." |
| "status" | schema | no | — | "HTTP status associated with this Problem; protocol decision order remains binding." |
| "title" | text | no | — | "Short human-readable Problem summary." |
| "type" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute stable Problem-type identity URI for this diagnosis, consistent with code/status/retry." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "code": {
            "const": "malformed-request"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/request"
          },
          "status": {
            "const": 400
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "invalid-parameter"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/request"
          },
          "status": {
            "const": 400
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "unauthenticated"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/authentication"
          },
          "status": {
            "const": 401
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "forbidden"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/authorization"
          },
          "status": {
            "const": 403
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "resource-not-found"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/not-found"
          },
          "status": {
            "const": 404
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "foreign-view"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "cursor-expired"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/gone"
          },
          "status": {
            "const": 410
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "request-too-large"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/size"
          },
          "status": {
            "const": 413
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "limit-exceeded"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/size"
          },
          "status": {
            "const": 413
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "rate-limited"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/rate-limit"
          },
          "status": {
            "const": 429
          },
          "retry": {
            "const": "after-delay"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "temporarily-unavailable"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/unavailable"
          },
          "status": {
            "const": 503
          },
          "retry": {
            "const": "after-delay"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "resource-pruned"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/gone"
          },
          "status": {
            "const": 410
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "resource-erased"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/gone"
          },
          "status": {
            "const": 410
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-unknown"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/not-found"
          },
          "status": {
            "const": 404
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-unretained"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-reorganized"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/gone"
          },
          "status": {
            "const": 410
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-not-tracked"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-unrepresentable"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "resource-pruned"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "archivedAt": {
            "$ref": "#/$defs/reference"
          }
        }
      }
    },
    {
      "if": {
        "not": {
          "properties": {
            "code": {
              "const": "resource-pruned"
            }
          },
          "required": [
            "code"
          ]
        }
      },
      "then": {
        "properties": {
          "archivedAt": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "resource-erased"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "pointer": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-unretained"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "required": [
          "missing"
        ],
        "properties": {
          "missing": {
            "$ref": "#/$defs/historyMissing"
          }
        }
      },
      "else": {
        "properties": {
          "missing": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "enum": [
              "revision-unknown",
              "revision-unretained",
              "revision-reorganized",
              "revision-not-tracked",
              "revision-unrepresentable"
            ]
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "window": false,
          "mayChangeAfterSync": false,
          "resource": false,
          "properties": false,
          "ownedLinks": false,
          "archivedAt": false,
          "pointer": false,
          "revisionProvenance": false
        }
      }
    }
  ],
  "properties": {
    "status": {
      "type": "integer",
      "enum": [
        400,
        401,
        403,
        404,
        409,
        410,
        413,
        429,
        503
      ]
    }
  }
}
```
<!-- bdp-schema:end readProblem -->
