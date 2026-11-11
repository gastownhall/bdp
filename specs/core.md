---
status: draft
intended-status: normative
version: "0.2"
---

# Beads Protocol — Core

Working draft v0.2.

Core defines the Beads Protocol data model, six primitive operations, and everything those
six need in order to work: revisions, the execution model, callables, events, discovery and
the rules a store must keep. It defines nothing else. Richer operations are callables, and
the standard ones are specified in the core library, not here.

## 1. About this draft

### 1.1 What this document is

This is the first v0.2 text of Core. It gathers the design decisions made since v0.1 into
one place so that they can be read, challenged and ruled on as specification text.

It is a draft. It does not yet replace the v0.1 documents. Until the sections below are
ruled and the machine-readable projections are generated from them:

- the published JSON Schemas, the OpenAPI catalog and the conformance kit are generated
  from the v0.1 text under [`profiles/`](profiles/core/core.md);
- an implementation that conforms to v0.1 conforms to v0.1, not to this draft;
- where this draft is silent, it makes no claim. It does not inherit a v0.1 rule by
  silence. A v0.1 rule applies here only where a section says it is *carried*.

The v0.1 release is kept on the `release/v0.1` branch and the `spec/v0.1` tag.

### 1.2 Status markers

Every section carries one status line. A section that mixes statuses says so, and marks the
exceptions sentence by sentence.

| Marker | Meaning |
|---|---|
| **ruled** | Decided by the design authority. Changing it needs a new ruling. |
| **proposed** | Designed here and not ruled. It may change without notice. |
| **carried** | Stands as v0.1 states it. Not revisited for v0.2 yet. The v0.1 text governs the detail. |
| **open** | Named and not designed. The text states the question, not an answer. |

Requirement keywords (MUST, SHOULD, MAY) follow RFC 2119. In a *proposed* section they
describe what the proposal would require; they bind nobody until the section is ruled.

### 1.3 Section status at a glance

| Section | Subject | Status |
|---|---|---|
| 2 | Data model | mixed: carried core, ruled storage class, proposed additions |
| 3 | Revisions, provenance, history | mixed: carried, with history ruled optional |
| 4 | Execution model | ruled in outline; field detail proposed |
| 5 | The six primitives | the set is ruled; request and response shapes proposed |
| 6 | Callables | async rules ruled; declaration detail proposed |
| 7 | Events | record default and cardinality ruled; delivery detail proposed |
| 8 | Discovery and capabilities | carried; additions proposed |
| 9 | Authorization | carried |
| 10 | What a store must keep | proposed, built on ruled decisions |
| 11 | Export boundary | two rules ruled; the rest open |
| 12 | Problems | carried; new codes proposed |
| 13 | Bindings: HTTP, JSON Schema, OpenAPI | principle ruled; addressing open |
| 14 | What moved out of Core | direction given; not yet confirmed |
| 15 | Open items | open |

### 1.4 Conformance

**Status: proposed.**

Conformance cases are required for *ruled* and *carried* sections. A *proposed* section
carries no conformance case until it is ruled. When a section is ruled, its cases land with
it: the specification may run ahead of an implementation, and it may not run ahead of its
conformance suite.

### 1.5 Notation

Shapes are shown in a small informal notation:

```text
Name = { required, optional? }        a record
A | B                                 a choice between shapes
```

The notation is for reading only. It is not a schema language. The normative syntax of
every representation is its JSON Schema projection, and the normative syntax of every
primitive is its OpenAPI projection (section 13).

## 2. Data model

### 2.1 Scope

**Status: carried.**

A Scope is one addressable graph of Beads and Links at a Scope URL. Every identifier in a
Scope is the Scope URL plus a local identifier of one or more path segments. Two names are
reserved as the first segment of a local identifier: `bdp`, for the protocol's own fixed
routes, and `sys`, for in-band system Resources.

### 2.2 Resources: Bead and Link

**Status: mixed. The record members are carried. `kind` and `storageClass` in the
representation are ruled in substance (section 2.6) and proposed in spelling.**

A Resource is a Bead or a Link. A Bead is a node. A Link is a directed edge from a `source`
to a `target`.

```text
Bead = { id, kind: "bead", type, revision, storageClass,
         properties, metadata, revisionProvenance?, ownedLinks? }

Link = { id, kind: "link", type, revision, storageClass,
         source, target,
         properties, metadata, revisionProvenance? }
```

- `id` is the Resource's absolute canonical URL (section 2.3).
- `kind` says whether the record is a Bead or a Link. v0.1 carried this in a response
  header only. Here it is part of the record, so that a record read from an event or an
  export describes itself.
- `type` names the Resource's Type (section 2.4).
- `revision` is the opaque token for the Resource's current state (section 3.1).
- `storageClass` says how the Resource is kept (section 2.6).
- `properties` holds the content the Type governs. `metadata` holds content the Type does
  not govern. Both are JSON objects, and both are present on Beads and on Links.
- `source` and `target` are References (section 2.5).

Rules carried from v0.1:

- A Link MUST have at least one endpoint that is a live Bead in the same Scope.
- Two Links MAY share the same Type, source and target. Each is its own Resource with its
  own `id`, `revision` and history.
- A Link is not part of either endpoint's state, except through owned Links (section 2.8).

Open: whether a Link's `source` and `target` can change after creation (section 15).

### 2.3 Identity

**Status: carried.**

- Beads and Links share one identifier space. There is no `beads/` or `links/` prefix.
- An identifier is never reused for a different Resource.
- A Resource's identifier never changes.
- An identifier is a URL. A client treats the local part as opaque.

Who allocates an identifier on `create` is covered in section 5.4.

### 2.4 Type affiliation

**Status: carried. The Type system itself is specified in the Types document.**

`type` is an absolute HTTP(S) URI, or a pinned form `{ uri, revision }` naming one revision
of the Type definition. Core requires only that every Resource names a Type. What a Type
means, how it is defined, refined and checked, belongs to Types.

### 2.5 References

**Status: carried.**

```text
Reference = URI | { uri, revision }
```

A Reference names a Resource by its canonical URL. The pinned form names one revision of
it. A Reference stored in a Resource is always durable: it never holds a request-local
name.

Request-local names (the `@name` handles a batch uses to refer to a Resource created
earlier in the same request) are not part of Core. They belong to the batch callable in the
core library.

### 2.6 Storage class

**Status: ruled that every Resource reports a storage class, that the earlier idea of
separate "planes" is gone from the model and from the wire, that the third class is named
*intrinsic*, and that a Link is as ephemeral as its most ephemeral endpoint. The exact
spelling of the classes is proposed.**

Every Bead and every Link reports how it is kept:

```text
StorageClass = Durable { versioned: boolean }
             | Ephemeral
             | Intrinsic
```

- **Durable** state is kept, is replicated wherever the Scope's state is replicated, and
  is included in an export. `versioned` says whether earlier revisions are kept
  (section 3.4).
- **Ephemeral** state is local to the service that holds it and may be discarded. It is
  not replicated and is not exported.
- **Intrinsic** Resources are not stored as data at all. They are declared or computed by
  the service: a callable, an event source, or a relationship the service derives instead
  of storing. "Intrinsic" is used in the sense of a compiler intrinsic: something the
  implementation provides.

A stored Link that touches an ephemeral endpoint is itself ephemeral. A durable Link to an
ephemeral Resource would dangle wherever the durable state is copied without the ephemeral
state. An intrinsic Link is computed, so this rule does not apply to it.

How long anything is retained is not a storage class. Retention belongs to event sources
(section 7.5).

Open: how a caller chooses a class on `create`, and whether a Resource's class can change
(section 15).

### 2.7 Data beads and capability beads

**Status: proposed (reviewed with the design authority on 2026-11-08; not separately
ruled).**

Beads fall into two families.

- A **data bead** is an ordinary Resource. It is created, updated and deleted through the
  primitives.
- A **capability bead** describes something the service can do. There are two kinds: a
  **Callable** (section 6), which answers `call`, and an **EventSource** (section 7),
  which answers `pull`. Both answer `get`, which returns their description.

A capability bead is typed, self-describing and referenced by URL like any Bead. Its
storage class is `Intrinsic`. In v0.2 a capability bead is declared by the service. A
client cannot bring one into being with `create`: a description with nothing wired behind
it would be a promise the service cannot keep. Creating capabilities at run time is
deferred (section 15).

### 2.8 Owned Links

**Status: carried, and ruled to stay for now.**

Owned Links stand as v0.1 defines them: a Bead may own certain of its outgoing Links, the
Bead's representation captures them in `ownedLinks`, and the Bead's revision covers the
captured state.

The design authority has ruled that owned Links stay until something better is found, and
that v0.2 does not close without at least a plan for what replaces them. That plan is an
exit condition of this version (section 15).

### 2.9 Aliases

**Status: proposed. The operations that create and remove aliases are not in Core; the
design authority has directed that they are specified in the core library.**

An alias is a second name for a Bead. In v0.1 an alias was not a Resource. This draft
proposes that an alias is an ordinary Bead whose content names its target:

```text
Alias = Bead of the alias Type, properties: { target: Reference }
```

An alias points at a canonical Resource, never at another alias. Resolution is one hop.

Core's only part in aliasing is what `get` does when the identifier names an alias
(section 5.3). Creating, repointing and removing aliases are core library callables.

### 2.10 Comments and annotations

**Status: proposed.**

A comment is an ordinary Bead, attached to its subject by an ordinary Link whose target
may be a Bead, a Link or another comment. Core has no separate comment concept and no
separate record for facts that are not Resources. The v0.1 "non-Resource fact" families
are not carried forward (section 14).

## 3. Revisions, provenance and history

### 3.1 Revision

**Status: carried, with one proposed clarification of terms.**

Every Resource has a `revision`: an opaque token that identifies one state of that
Resource.

- A client compares revisions for equality only. It never orders or parses them.
- The revision changes exactly when the Resource's state changes. A request that would
  leave the state as it is does not mint a new revision.
- A Bead's revision covers its captured owned Links (section 2.8).

Proposed terms. One token appears in two roles:

- as a **guard**: a caller sends `expectedRevision` to say "apply this only if the
  Resource is still at this revision" (sections 5.5 and 5.6);
- as a **chain**: a change record carries `previousRevision` and `revision`, so a reader
  can tell whether it has seen every change in between (section 7.2).

A stream's cursor is a different thing. It marks a reader's position in a stream. It is
not a revision of any Resource.

### 3.2 Revision provenance

**Status: carried.**

```text
RevisionProvenance = { actor?: { id, basis: "writer-supplied" | "unknown" },
                       committedAt?, agent?, message?, metadata? }
```

Provenance records who a revision is attributed to and when it was committed. It is
supplied by the writer and stored with the revision. It is data, not evidence: Core does
not claim it is true, and a service MUST NOT invent it. A caller never supplies the commit
time.

### 3.3 Full and patch change encodings

**Status: proposed.**

A change to `properties` or to `metadata` can be written two ways:

- **full**: the complete new object (`properties`, `metadata`);
- **patch**: a list of changes against the current object (`propertiesChange`,
  `metadataChange`), using the `add`, `replace` and `remove` operations of RFC 6902.

For one object in one request the two are mutually exclusive. A full replacement replaces
the whole object; it is never a partial merge. The same two encodings appear in an
`update` request (section 5.5) and in an event (section 7.2).

### 3.4 History

**Status: ruled that history is optional and discoverable. The reading surface is carried
from v0.1 where a service offers it.**

A service MAY keep earlier revisions of a Resource. Whether it does is discoverable
(section 8), and a client MUST NOT assume it.

Where history is offered, reading a named revision works as v0.1 describes. Listing a
Resource's revisions is a core library callable, not a primitive (section 5.9).

Proposed: history is offered for Beads and Links alike or for neither. A service does not
offer one without the other.

## 4. Execution model

### 4.1 Transaction

**Status: ruled.**

A **transaction** is an atomic state boundary: a set of changes that take effect together
or not at all. Every change to durable state happens inside exactly one transaction, and
every transaction has an opaque marker, unique in the Scope.

Everything committed together carries the same marker: the Resources changed, and the
events that report those changes.

### 4.2 Cause

**Status: ruled.**

A **cause** is an opaque token minted by the service when a request first enters it. It
is stamped on every effect the request sets in motion, including effects that commit later
and effects of calls the service makes on the request's behalf.

There is one cause per causal tree and one or more transactions within it. The two
coincide for a simple synchronous request, which has one cause and at most one
transaction. They diverge as soon as work continues after the first commit: an
asynchronous call has one cause and several transactions.

### 4.3 Call context

**Status: ruled that call context rides in the request and in the response of all six
primitives. The fields are proposed.**

Every primitive request and every primitive response carries a `context`. This holds even
for primitives that are never asynchronous.

```text
RequestContext = { cause?, deadline? }
ReplyContext   = { cause, transaction? }
```

Proposed field rules:

- `cause` in a request is absent for a fresh request. It is present only when the caller
  is itself acting inside an existing causal tree and passes that tree's token on. A
  service MAY refuse a `cause` it did not mint.
- `cause` in a reply is always present.
- `transaction` in a reply is present when the request resulted in exactly one atomic
  commit. A read, a refused request and a request that changed nothing have none.
- `deadline` is a request to stop waiting. It is an optional capability (section 6.7).

### 4.4 Result, Outcome and Reply

**Status: ruled in structure (items marked). The arm names follow the design authority's
stated preference and are not final. The tag spelling is open.**

```text
Result<T, E>  = ok { value: T } | err { error: E }
Outcome<T, E> = Result<T, E> | fault { problem } | ...
Reply<T, E>   = { context, outcome?: Outcome<T, E> }
```

- **Result** is closed. It is the operation's own verdict: it succeeded with a value, or
  it failed with an error of the type it declared.
- **Outcome** is open (ruled). It is what happened to the operation. It is the Result, or
  a `fault`, or an arm added by a pack. A reader MUST tolerate an arm it does not know.
- **Reply** (ruled name) pairs the context with the outcome. It is what every caller gets
  back.

There are two levels in the types and one level on the wire: `outcome` is a single tagged
value whose arms include `ok`, `err` and `fault` side by side.

Proposed reader rule. An `outcome` that is present means the operation is settled. Only
`ok` means success. An unknown arm is settled and not successful.

An error does not carry a reason code in Core. If an operation needs to distinguish kinds
of error, its error type `E` is itself a choice of shapes.

Open: the spelling of the tag that names the arm (section 15).

### 4.5 Faults and Problems

**Status: the `fault` arm follows the design authority's stated preference and is not
final. The Problem format is carried.**

A `fault` is a failure of the system, not a verdict of the operation: the service was
unavailable, the request was malformed, a deadline passed. A fault carries a Problem.

A Problem is an RFC 9457 problem document with the required members v0.1 defines: `type`,
`code` and `retry` (`never`, `after-state-change` or `after-delay`). Section 12 lists the
codes.

The line between the two kinds of failure:

- `err` is declared. The operation's description says what `E` is, and a caller can be
  written against it.
- `fault` is not declared by the operation. Any operation can meet any fault.

A timeout is a fault. Cancellation is not a Core arm (section 6.7).

## 5. The six primitives

### 5.1 The set

**Status: ruled.**

Core has six primitive operations:

| Primitive | Acts on | Does |
|---|---|---|
| `get` | any Bead or Link | returns its representation |
| `create` | a data Bead or a Link | brings a new Resource into being |
| `update` | a data Bead or a Link | changes its properties or metadata |
| `delete` | a data Bead or a Link | removes it |
| `call` | a Callable | invokes it |
| `pull` | an EventSource | reads its stream |

Every service that implements Core has these six. Everything richer is a callable
(section 5.9).

The four data primitives are not callables, and are not modelled as callables (ruled). A
data primitive's request is its own record of what changed, which is what makes changes
replayable and checkable. A callable is a trigger whose effects are data changes. Treating
the first as a case of the second would make the effect layer opaque.

### 5.2 The common frame

**Status: proposed. The design authority has noted that the request and response formats
of the six primitives are not yet specified; this section is the first proposal.**

Every primitive has the same frame:

```text
Request  = { context: RequestContext, input }
Response = Reply<T, E>
```

`input` is specific to the primitive. `T` is the primitive's value on success and `E` its
declared error. How the frame is carried over HTTP, and which parts ride in the URL, the
headers or the body, is the binding's business (section 13) and is open.

`get`, `create`, `update`, `delete` and `pull` are synchronous: the response is the
settled outcome. Only `call` may be asynchronous (section 6.4).

### 5.3 get

**Status: reading a Resource is carried. Alias resolution is proposed.**

```text
input = { id, revision? }
value = the Resource's representation
```

- `get` works on every Bead and Link, including capability beads, for which it returns
  the description.
- `revision` asks for an earlier state. It is available only where history is offered
  (section 3.4).
- A Resource the caller is not authorized to see is reported exactly as a missing one
  (section 9).
- After deletion, a read fails as v0.1 states: not found, or pruned or erased where the
  caller is authorized to know.

Proposed alias behaviour. When `id` names an alias, `get` returns the representation of
the alias's target and states the target's canonical identifier in the response. A caller
MAY ask for the alias Bead itself instead of its target, and MAY ask to be redirected
instead of answered. Resolution is one hop.

### 5.4 create

**Status: proposed. The member list and the identifier rules follow v0.1's create
operations.**

```text
input (Bead) = { type, id?, properties?, metadata?, revisionProvenance? }
input (Link) = { type, id?, source, target, properties?, metadata?, revisionProvenance? }
value        = the created Resource's representation
```

- `type` is required.
- `id` MAY be supplied by the caller. When it is omitted the service allocates one.
- Omitted `properties` and `metadata` are empty objects.
- An identifier already in use is refused. So is an identifier that was used and retired.
- The input is closed: a member Core does not define is refused, not ignored.

`create` makes data Beads and Links only. It does not create capability beads
(section 2.7).

Open: whether a deleted Bead's identifier can be created again (v0.1 allows it for Beads
and not for Links), and how a caller selects a storage class (section 15).

### 5.5 update

**Status: proposed. The guard and the no-change rule are carried.**

```text
input = { id, expectedRevision?,
          properties | propertiesChange,
          metadata | metadataChange,
          revisionProvenance? }
value = the Resource's representation after the update
```

- At least one change member is required. A guard or provenance alone is not an update.
- `properties` and `propertiesChange` are mutually exclusive, and so are `metadata` and
  `metadataChange` (section 3.3).
- `expectedRevision` is optional. When present and not equal to the Resource's current
  revision, the update is refused with `revision-mismatch` and has no effect.
- An update that would leave the Resource as it is succeeds, keeps the revision, records
  no provenance, and produces no event. The reply carries no `transaction`.

An update changes one Resource. It does not change the Resource's identifier or kind.

Open: whether `update` can change a Resource's Type, and whether it can change a Link's
endpoints. v0.1 allows both. Neither is decided for v0.2 (section 15).

### 5.6 delete

**Status: proposed. The default refusal is carried from v0.1. Three points are open and
are named below.**

```text
input = { id, expectedRevision?, revisionProvenance? }
value = the identity of what was deleted: { id, kind, type, revision }
```

- `expectedRevision` behaves as in `update`.
- Deleting a Bead is refused with `incident-links-exist` while a live Link is attached to
  it. A Link the caller cannot see still blocks, and is not disclosed.
- Deleting a Link never requires anything of its endpoints.
- Deleting something already deleted is refused as not found.
- Delete is not erasure. Removing controlled content for good is a separate matter that
  Core does not define.

The richer forms v0.1 offered as an optional capability (deleting several Beads at once,
removing attached Links along with the Bead, cascading through Links of named Types, a dry
run) are not part of the primitive. They are core library callables (section 14).

Open:

1. Whether a delete mints a final revision. v0.1 says it does not. An event reader that
   follows revision chains is simpler if it does.
2. What happens to a Link whose endpoint on the deleted Bead is pinned to a revision. v0.1
   lets such a Link survive and not block. The design authority leans the same way.
3. Whether the primitive stays this bare, with all controls in a callable. The design
   authority has asked this question directly; it is not ruled.

### 5.7 call

**Status: ruled that `call` is the single invocation primitive and that asynchronous
invocation is layered on it, not a seventh primitive. The input shape is proposed.**

```text
input = { callable, arguments, mode?: "sync" | "async" }
value = the callable's declared result type
error = the callable's declared error type
```

`callable` names a Callable bead. `arguments` is checked against the callable's declared
parameters. `mode` is covered in section 6.4.

### 5.8 pull

**Status: ruled that `pull` is the single reading primitive for event streams. The input
shape is proposed.**

```text
input = { source, after?, from?, limit?, representation? }
value = { events, cursor, head? }
```

`source` names an EventSource bead. The rest is covered in section 7.4.

### 5.9 What is not a primitive

**Status: ruled in direction. Each item's specification belongs to the core library.**

These are callables, reached through `call`:

- listing and querying Resources;
- listing a Resource's revisions;
- atomic batches of several changes;
- creating and removing aliases;
- conditional bulk changes (update or delete every Resource matching a condition);
- delete with controls (section 5.6);
- sending a message into an event stream (section 7.6);
- export and import.

A callable can do anything the primitives can do together, with one exception: a callable
is not itself the atomic commit. A batch callable asks for a transaction; it does not
define what a transaction is.

## 6. Callables

### 6.1 Declaration

**Status: proposed. The member list follows the v0.1 callables preview.**

A Callable is a capability bead (section 2.7). Its representation is its declaration:

```text
Callable = Bead of a callable Type, properties: {
  description,
  parameters: [ { name, schema, required?, default?, description? } ],
  resultSchema?, errorSchema?,
  modes?: [ "sync" | "async" ],
  title?
}
```

- `parameters` describe the arguments, each with a JSON Schema.
- `resultSchema` is the type `T` of a successful result. `errorSchema` is the type `E` of
  a declared error.
- `modes` lists the invocation modes the callable supports (section 6.4).

`get` on a Callable returns this declaration and never invokes it.

### 6.2 What a callable can produce

**Status: proposed.**

A callable has up to three kinds of output, in any combination:

- **effects**: changes to Resources, committed by the service in one or more
  transactions;
- **result**: a value returned to the caller;
- **stream**: an event stream it opens.

A query has a result and no effects. A bulk update has effects and no result. A callable
that computes something and records it has both.

Whatever a callable does to Resources shows up as ordinary changes: the same events a
client's own `create`, `update` and `delete` would have produced, carrying the call's
`cause`.

### 6.3 Layering

**Status: ruled.**

Callables and data primitives are two layers, not peers. The data primitives are the
effect layer. A callable is a trigger whose effects are expressed in that layer. Core
never defines a built-in data operation as a callable.

### 6.4 Synchronous and asynchronous invocation

**Status: ruled, except the spelling of the request member, which is proposed and
accepted in discussion.**

- Asynchronous invocation is not a new primitive. It is a mode of `call`.
- The caller chooses the mode. The request member is `mode`, with values `sync` and
  `async`. An omitted `mode` means `sync`.
- Only `call` has a mode. The other five primitives are always synchronous.

Refusal has two levels, and a caller can tell them apart:

1. A callable advertises the modes it supports. A request for a mode the callable does
   not support is refused as unsupported by the callable.
2. A Scope MAY refuse a mode that the callable supports. That refusal is explicit and is
   distinguishable from the first.

A service never silently substitutes one mode for the other.

### 6.5 AsyncResult

**Status: ruled.**

An asynchronous `call` is admitted, not completed. The response names a result bead, and
the work continues after the response.

```text
AsyncResult<T, E> = Bead of the AsyncResult Type,
                    properties: { context, outcome?: Outcome<T, E> }
```

- AsyncResult is an intrinsic Type defined by Core. A pack MAY refine it to add its own
  members; a workflow run is the expected example.
- The result bead holds a Reply. `outcome` is absent while the call is pending and
  present once it has settled.
- `T` and `E` are inferred from the callable's declared result and error types. The shape
  of the result bead is therefore determined by the declaration. That is the only sense
  in which the projection from a call to its result bead is deterministic: it fixes the
  shape, not the content.
- The result bead shows its `cause` when read.

Proposed mechanics:

- Admission is one transaction. It creates the result bead and mints the cause.
- Settlement is an update to the result bead that writes `outcome`.
- The response to an asynchronous call carries the same Reply frame with `outcome`
  absent, and identifies the result bead.

### 6.6 Observing an asynchronous call

**Status: ruled.**

An asynchronous call has a single event channel, and it fires on the outcome.

Proposed mechanism: the channel is the result bead's own change. Settlement updates the
result bead, and that update is an ordinary event (section 7.2). A caller that prefers not
to listen reads the result bead with `get` until `outcome` is present.

### 6.7 Not in Core

**Status: ruled for retry. The rest is proposed.**

- **Retry** is tabled. Core reserves no retry key and defines no retry behaviour.
- **Cancellation and deadlines** are proposed as one optional capability. Where it is not
  offered, a `deadline` in a request is refused, not ignored.
- **Suspending and resuming** a call is not designed.
- Arms such as `canceled` and `skipped` are not Core arms. A pack that needs them adds
  them to Outcome.

## 7. Events

### 7.1 EventSource

**Status: proposed (reviewed with the design authority on 2026-11-08). Cardinality and the
absence of a close operation are ruled, in section 7.6.**

An EventSource is a capability bead (section 2.7) that describes one ordered stream of
events of one declared type.

```text
EventSource = Bead of an event source Type, properties: {
  eventSchema,          JSON Schema of one event in the stream
  eventRetention,       how long events are kept (section 7.5)
  cardinality           "single" | "broadcast" (section 7.6)
}
```

- An EventSource answers two primitives: `get`, which returns this description, and
  `pull`, which reads the stream.
- The description is not the stream. Events arriving on the stream do not change the
  EventSource bead's revision.
- An EventSource is identified by its bead's URL.
- Every EventSource is readable. Core has no write-only or two-way stream type.

Each Scope has one built-in EventSource, the **changefeed**, whose events report changes
to the Scope's Resources (section 7.3).

### 7.2 The change event

**Status: ruled that the default is the flat event record of the earliest protocol draft,
adjusted. The adjustments are proposed and listed below.**

```text
Event = { id, ordinal, type, source, subject, subjectType,
          transaction, cause, time, data }
```

- `id` identifies the event. `ordinal` is its position in the stream.
- `type` says what happened: `created`, `updated` or `deleted`.
- `source` is the EventSource the event was read from.
- `subject` is the URL of the Resource that changed. `subjectType` is that Resource's
  Type.
- `transaction` and `cause` are the markers of section 4. Every event produced by one
  commit carries the same `transaction`.
- `time` is when the change was committed.
- `data` is the change itself.

Proposed adjustments:

1. **Links are their own subjects.** The earliest draft reported a Link's creation and
   removal as `linked` and `unlinked` events on a Bead. Here a Link is a Resource with
   its own identifier and revision, so its creation is a `created` event whose subject is
   the Link. The event states the subject's `kind`.
2. **Revisions ride on the event.** A change event carries `revision`, and an `updated`
   event carries `previousRevision`, beside `data` and not inside it.
3. **Two representations of an update.** An `updated` event carries either the complete
   new state or a patch (section 3.3). The complete form is required of every service.
   The patch form is optional. A reader that meets a patch it cannot apply reads the
   Resource again.
4. **A deletion carries identity only.** A `deleted` event names what was deleted and
   carries no content.
5. **`cause` is added**, per section 4.2.

Rules:

- A request that fails produces no event. So does a request that changes nothing.
- One commit produces one event per Resource changed, however many times the request
  touched that Resource.
- The event is durable with the change it reports. A service does not commit a change and
  lose its event, nor publish an event for a change that did not commit.

A callable's invocation is visible on events as an accompanying record that names the
call (ruled: this record rides on events only and never appears in an export).

Open: the order of several events within one commit (section 15).

### 7.3 The changefeed

**Status: proposed.**

The changefeed is the Scope's built-in EventSource. Its event type is the change event of
section 7.2. It is read-only, produced by the service, and `broadcast`.

A change that reaches the Scope by replication, and not through a request to this
service, MUST still appear on the changefeed.

A client that wants only one Resource's changes reads the changefeed and filters, or uses
a core library callable that does so. Whether each Resource also has a stream of its own
is an addressing question and is open (section 13).

### 7.4 pull: reading a stream

**Status: proposed. The cursor rules are carried from v0.1 Events.**

```text
input = { source, after?, from?, limit?, representation? }
value = { events, cursor, head? }
```

- `after` is a cursor from an earlier `pull`. `from` chooses a starting point without a
  cursor: the oldest retained event, or now. The two are mutually exclusive.
- `limit` caps the number of events returned.
- `representation` asks for complete states or patches (section 7.2).
- `cursor` in the value is where to resume. `head` tells a reader whether it has caught
  up.
- A cursor is opaque and belongs to the stream and the selection it came from. A cursor
  used elsewhere is refused.

Delivery has a required floor and an optional accelerator:

- **The floor** is a finite read: one request, one page, nothing held open. Every service
  offers it. It is never refused for lack of capacity.
- **Push** is the same events over a held-open response. A service MAY offer it and MAY
  refuse it under load, in which case the reader falls back to the floor. Both deliver
  the same events from the same cursor.

A reader stops by not asking again, or by disconnecting. There is nothing to cancel.

### 7.5 Retention and held cursors

**Status: ruled that a held cursor is protected for a stated minimum lifetime. The hard
failure for a read below the retention floor is carried from v0.1 Events. The policy shape
is proposed.**

```text
RetentionPolicy = { window, minCursorLifetime? }
window          = Floor { maxAge?, maxCount? }     keep the most recent events
                | Until { expiresAt }              keep until a fixed time
```

- A service states each EventSource's retention in its description.
- A reader whose cursor has fallen below the retained range receives a failure that says
  so. The service never silently skips ahead and never silently restarts from the
  beginning.
- A cursor that a reader holds stays usable for at least `minCursorLifetime`.

Retention applies to the stream. It is separate from the storage class of any Resource the
events describe.

### 7.6 Cardinality, close and send

**Status: ruled for cardinality and close. Send is proposed.**

- **Cardinality** (ruled) is `single` or `broadcast`. `single` means one reader, which
  receives every event in order. `broadcast` means any number of readers, each with its
  own cursor, each seeing everything. Core has no mode in which several readers compete
  for events; routing work among readers needs a policy, and that belongs to an
  application.
- **Close** (ruled) is not a Core concept. If a stream has an end, the end is an event
  the reader interprets. A final state that must outlive the stream is a member of a
  Bead, not an event.
- **Send** (proposed) is not a primitive. A stream that accepts messages has a callable
  that appends to it. Messages sent this way ride the EventSource's own stream and never
  the changefeed.

## 8. Discovery and capabilities

**Status: carried, with proposed additions.**

A client learns what a Scope offers from the Scope's discovery document, reached as v0.1
describes. The carried members are the protocol version, the Scope, the specification
revision, limits, and the list of optional capabilities.

Proposed additions for v0.2. Discovery states:

- whether history is offered (section 3.4);
- which storage classes the Scope accepts on `create`;
- whether push delivery is offered (section 7.4);
- which invocation modes the Scope refuses outright (section 6.4);
- whether cancellation and deadlines are offered (section 6.7);
- where the changefeed is.

Callables and EventSources are discovered as what they are: Beads. How a client finds the
set of them is a listing, and listing is a core library callable. How a client finds that
first callable without a listing is open (section 15).

A request that needs a capability the Scope does not offer is refused with
`capability-not-supported`. An optional feature is never half-present.

## 9. Authorization

**Status: carried.**

Each caller sees the Scope through an authorization view. A Resource outside the caller's
view is reported exactly as a missing one, in every operation and on every stream. A
service never reveals that a hidden Resource exists, including through an error that only
a hidden Resource could have caused.

How a caller is authenticated, and how a view is decided, are outside Core.

## 10. What a store must keep

**Status: proposed. Items marked (ruled) restate a ruling; the rest follow from the model
above.**

This section states what any store behind a Scope must be able to do. It says nothing
about how. A store that keeps these promises is acceptable whatever its design.

1. A `type`, `properties` and `metadata` for every Bead and every Link.
2. For every Link, its own identifier, revision and history, with parallel Links allowed.
3. One identifier space for Beads and Links, in which an identifier is never given to a
   second Resource.
4. A storage class for every Resource (ruled).
5. A revision per Resource that changes exactly when the Resource's state changes.
6. Where history is offered, earlier revisions of Beads and of Links alike, including the
   fact that a Resource was deleted (ruled: history is optional and discoverable).
7. A transaction marker shared by everything committed together (ruled).
8. A cause token, minted once per incoming request and recorded on everything that
   request changes (ruled).
9. A durable record of each change, written with the change: one record per Resource per
   commit, none for a failed request and none for a request that changed nothing.
10. Changes that arrive by replication made visible to event readers.
11. A hard failure for a read below the retention floor, and a minimum lifetime for a
    held cursor (the minimum lifetime is ruled).
12. An export that is consistent with itself, together with the cursor that matches it.
13. Provenance for each revision as supplied, never invented.
14. Deletion that does not erase: a deleted Resource's identifier stays accounted for.

A Link's storage class is at most that of its most ephemeral endpoint (ruled,
section 2.6).

## 11. Export boundary

**Status: two rules ruled. The rest is open.**

An export is a copy of a Scope's durable state that another service can take in.

Ruled:

- A callable never appears in an export. An export carries state, not behaviour and not
  invocations.
- The record that names a call rides on events only (section 7.2). It is not exported.

Following from section 2.6: ephemeral and intrinsic Resources are not exported.

Open: the format of an export, what levels of history it may carry, and the operations
that produce and consume one. The operations are expected to be core library callables.
The v0.1 Transfer proposal is not carried forward as a separate document (section 14).

## 12. Problems

**Status: carried. Codes marked (proposed) are new in this draft.**

A Problem is an RFC 9457 document with `type`, `code` and `retry`.

Codes carried from v0.1 Core: `malformed-request`, `invalid-parameter`,
`unauthenticated`, `forbidden`, `resource-not-found`, `resource-pruned`,
`resource-erased`, `foreign-view`, `cursor-expired`, `request-too-large`,
`limit-exceeded`, `rate-limited`, `temporarily-unavailable`, `capability-not-supported`,
and the `revision-*` family for reads of history.

Codes carried from the v0.1 write operations, now needed by the primitives:
`validation-failed`, `type-not-installed`, `identity-taken`, `revision-mismatch`,
`incident-links-exist`.

Codes carried from the v0.1 callables preview: `callable-not-found`,
`callable-unavailable`.

New (proposed):

- `mode-not-supported`: the callable does not support the requested mode.
- `mode-refused`: the Scope refuses the requested mode for a callable that supports it.

A problem response to a synchronous request carries the reply `context` as an extension
member (proposed), so that a failed request can still be traced by its cause.

How the `err` arm of a Result is carried over HTTP is a binding question (section 13).
v0.1 carried a callable's declared error as a Problem with code `callable-error`.

## 13. Bindings: HTTP, JSON Schema, OpenAPI

### 13.1 Syntax and semantics

**Status: ruled.**

This document is semantics: what a representation means and what each primitive does.
Syntax is two projections onto languages that already exist:

- the only syntax for a representation is **JSON Schema**;
- the only syntax for a primitive is an **OpenAPI** operation.

Core defines no description language of its own.

### 13.2 The HTTP binding

**Status: open. The v0.1 binding is described for reference. It is not carried.**

In v0.1:

- a read goes to the Resource's own URL, with variations as query parameters;
- a change goes by POST to a fixed command URL named for the operation, with the target
  Resource named in the body;
- a callable is invoked by POST to a fixed route that includes its name, deliberately not
  the declaration Bead's own URL;
- events are read at a fixed route for the Scope, and at the Resource's own URL with a
  query parameter for one Resource.

The design authority has asked three questions that this section must answer before it
can be written:

1. Should `delete` be the plain HTTP DELETE on the Resource's URL, refusing when Links
   are attached, with every richer control in a callable?
2. Should `update` likewise map onto the HTTP methods for replacing and patching a
   Resource? This is expected to be a harder fit and may be deferred.
3. Should the four data primitives address the Resource's identifier directly instead of
   a table of command URLs, and should `call` and `pull` do the same for the Callable and
   the EventSource they act on?

Also open here: how the common frame (section 5.2) maps onto HTTP, in particular where
the context travels, how the `err` arm is carried, and how an admitted asynchronous call
is answered.

### 13.3 The projections

**Status: open.**

The JSON Schema and OpenAPI projections for v0.2 are not yet generated. They follow the
sections above as each is ruled.

## 14. What moved out of Core

**Status: direction given by the design authority; not yet confirmed. Nothing is removed
by this draft.**

The direction given is that Core defines the six primitives and what they need, that the
separate Write, Events and Transfer documents go away, and that all further surface is
specified in the core library. Until that is confirmed the v0.1 documents stay where they
are.

| v0.1 item | Proposed home |
|---|---|
| Create, update and delete of Beads and Links (Write) | Core, sections 5.4 to 5.6 |
| Alias creation, repointing and removal (Write) | core library |
| Atomic batch and request-local names (Write) | core library |
| Delete of several Beads, with attached Links, by cascade, as a dry run (Write) | core library |
| Rooted identifier allocation (Write) | core library |
| Update from an earlier revision, and recovery of a deleted Bead (Write) | core library, with history |
| Idempotency keys (Write) | open; tabled with retry (section 6.7) |
| Retyping and Link endpoint correction (Write) | open (section 15) |
| Collections, selectors and query (Core) | core library |
| Listing a Resource's revisions (Core) | core library, with history |
| Event records, cursors, retention (Events) | Core, section 7 |
| Facts that are not Resources: alias, identity, association state (Events, Transfer) | not carried; an alias is a Bead (section 2.9) |
| Export packages and admission (Transfer) | boundary in Core section 11; operations in core library |
| Callable declaration and invocation (Callables preview) | Core, section 6 |
| Callable registration and command-line mapping (Callables preview) | core library and the CLI specification |
| Type definitions and checking (Types) | stays in Types, which also moves to v0.2 |

## 15. Open items

**Status: open.**

Exit conditions for v0.2:

1. A plan for what replaces owned Links (section 2.8).

Data model:

2. Whether a Link's endpoints can change after creation.
3. Whether a Resource's Type can change after creation.
4. How a caller chooses a storage class on `create`, and whether a class can change.
5. Whether a deleted Bead's identifier can be created again.
6. Creating capability beads at run time.

Primitives:

7. The request and response formats of the six primitives (section 5.2 is a first
   proposal).
8. Whether delete mints a final revision.
9. What a delete does about Links pinned to a revision of the deleted Bead.
10. Whether `delete` and `update` stay bare, with controls in callables.
11. The HTTP binding, and whether primitives address the Resource directly
    (section 13.2).

Execution:

12. The call context fields (section 4.3).
13. The spelling of the tag that names an Outcome arm, and whether arms are open
    records.
14. Cancellation, deadlines, suspend and resume.
15. Retry and idempotency.
16. The storage class and lifetime of a result bead.

Events:

17. The order of several events within one commit.
18. Whether each Resource has an event stream of its own.
19. Whether a complete-state baseline event is needed for recovery, beside create and
    update.

Discovery and export:

20. How a client finds the first callable.
21. The export format and its history levels.

History:

22. Where history is offered, the full reading surface for Links.

## Appendix A. Decisions folded into this text

Rulings by the design authority, by date, with the section that carries each.

2026-11-08

- The operations every service has are called primitives. "Intrinsic" names the storage
  class. (2.6, 5.1)
- Built-in data operations are not callables. (5.1, 6.3)
- Callables never appear in an export; the record naming a call rides on events only.
  (7.2, 11)
- `transaction` and `cause` are two separate base markers. (4.1, 4.2)
- Change events default to the flat record of the earliest protocol draft, adjusted.
  (7.2)
- A held cursor is protected for a stated minimum lifetime. (7.5)
- Event stream cardinality is single or broadcast only. (7.6)
- Close is not a protocol concept. (7.6)

2026-11-09

- Specification syntax is JSON Schema for representations and OpenAPI for primitives; no
  new description languages. (13.1)
- Asynchronous invocation is layered on `call`; it is not a new primitive. (5.7, 6.4)
- The caller chooses the mode; a Scope may refuse either mode, explicitly. (6.4)
- Mode refusal has two levels: the callable's advertised modes, and the Scope's refusal
  of an advertised mode. (6.4)
- The projection from a call to its result bead is deterministic in shape only. (6.5)
- Retry is tabled; no key is reserved. (6.7)
- Outcome and AsyncResult are defined in Core. (4.4, 6.5)
- Call context rides in the request and response of all six primitives. (4.3)
- Outcome is an open choice; packs may add arms. (4.4)
- An AsyncResult carries one tagged `outcome`, absent while pending. (6.5)
- An AsyncResult's value and error types are inferred from the callable's declaration.
  (6.5)
- An AsyncResult shows its `cause` when read. (6.5)
- AsyncResult is an intrinsic Type that packs may refine. (6.5)
- An asynchronous call has a single event channel that fires on the outcome. (6.6)
- The pairing of context and outcome is named Reply. (4.4)

2026-11-10

- Every Resource reports a storage class; separate planes are gone from the model and the
  wire. (2.6)
- A transaction is an atomic state boundary, with a marker per transaction. (4.1)
- A Link is as ephemeral as its most ephemeral endpoint. (2.6)
- History is optional and discoverable. (3.4)
- Owned Links stay until something better is found; v0.2 does not close without a plan
  for the replacement. (2.8)
- Core defines the six primitives and what they need; further surface, such as creating
  and removing aliases, is specified in the core library. (5.9, 14)

Stated preferences, not final: the arm names `ok` and `err`; a closed Result inside an
open Outcome; `fault` as the system arm carrying a Problem; no reason code in Core. (4.4,
4.5)
