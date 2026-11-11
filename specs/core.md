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

Core is raw data access. It has the concept of a Type and carries no type system: it does
not say what a Type contains, how one is interpreted, or what a caller's data must look
like. Those rules, and the declarations of callables and event sources, are specified in
Types.

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
| 2 | Data model | mixed: carried core; storage class and the Core and Types split ruled; proposed additions |
| 3 | Revisions, provenance, history | mixed: revision carried; provenance ruled to name several principals and to record inception, its shape proposed; history ruled optional |
| 4 | Execution model | ruled in outline; context members ruled; field rules proposed |
| 5 | The six primitives | the set is ruled; a delete that only deletes, is refused while Links are attached and mints a final revision is ruled; request and response shapes proposed |
| 6 | Callables | async rules ruled; declarations ruled out of Core; result bead detail proposed |
| 7 | Events | record default and cardinality ruled; declarations ruled out of Core; delivery detail proposed |
| 8 | Discovery and capabilities | carried; additions proposed |
| 9 | Authorization | carried |
| 10 | What a store must keep | proposed, built on ruled decisions |
| 11 | Export boundary | two rules ruled; the rest open |
| 12 | Problems | carried; new codes proposed |
| 13 | Bindings: HTTP, JSON Schema, OpenAPI | principle ruled; create on the Scope ruled for now; context headers proposed; the rest of addressing open |
| 14 | What moved out of Core | to Types: ruled; to the core library: delete with controls ruled, the rest direction given and not yet confirmed |
| 15 | Open items | open |

### 1.4 Conformance

**Status: proposed.**

Conformance cases are required for *ruled* and *carried* sections. A *proposed* section
carries no conformance case until it is ruled. When a section is ruled, its cases land with
it: the specification may run ahead of an implementation, and it may not run ahead of its
conformance suite.

The suite meant here is the live conformance kit, which grows as sections are ruled. The
frozen historical catalogs stay pinned as they are and are not governed by this rule.

### 1.5 Notation

Shapes are shown in a small informal notation:

```text
Name = { required, optional? }        a record
A | B                                 a choice between shapes
```

The notation is for reading only. It is not a schema language. The normative syntax of
each of Core's own envelopes is its JSON Schema projection, and the normative syntax of
every primitive is its OpenAPI projection (section 13).

Where a shape has parameters, as in `Reply<T, E>`, the parameters stand for content Core
does not look inside.

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
  not govern. Both are JSON objects, and both are present on Beads and on Links. Core
  stores and returns both and interprets neither (section 2.4).
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

### 2.4 Types and type beads

**Status: ruled that Core has the concept of a Type and of a type bead and is silent on
how to interpret either; the type system is specified in Types. The form of `type` is
carried. The reading of "silent" set out below is proposed.**

Every Resource names a Type. A Type is itself a Bead: a **type bead**.

`type` is a Reference (section 2.5) to a type bead. It is an absolute HTTP(S) URI, or the
pinned form `{ uri, revision }` naming one revision of that bead. The type bead need not
be in the same Scope as the Resource, nor on the same host.

That is all Core says about Types. Core does not say:

- what a type bead contains;
- what a Type means, or how one is defined, refined or checked;
- what may be assumed about a Resource because of the Type it names.

All of that belongs to Types.

Proposed reading. Core still fixes the record a Resource is carried in (section 2.2): its
identifier, kind, Type, revision, storage class, and the two objects `properties` and
`metadata`. Core does not look inside those two objects. One well-known Type is the
exception, because its content is one of Core's own envelopes; section 2.7 names it, and
a possible second.

Core does not check a Resource against its Type. A layer above Core MAY refuse a write that
Core would accept. Core provides the place such a refusal is carried (section 12) and does
not define the rules that produce it.

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

### 2.7 Data beads, capability beads and well-known Types

**Status: proposed (the two families were reviewed with the design authority on
2026-11-08 and not separately ruled). That Core says nothing about what a capability
bead's declaration contains is ruled (section 2.4). The exact list of well-known Types is
proposed.**

Beads fall into two families.

- A **data bead** is an ordinary Resource. It is created, updated and deleted through the
  primitives.
- A **capability bead** stands for something the service can do. There are two kinds: a
  **Callable** (section 6), which answers `call`, and an **EventSource** (section 7),
  which answers `pull`. Both answer `get`.

A capability bead is typed and referenced by URL like any Bead. Its storage class is
`Intrinsic`. In v0.2 a capability bead is declared by the service. A client cannot bring
one into being with `create`: a declaration with nothing wired behind it would be a
promise the service cannot keep. Creating capabilities at run time is deferred
(section 15).

Core names a small set of **well-known Types**. Each is identified by a fixed type bead
URL, so that a client can recognise what a Bead is from its `type` alone.

| Well-known Type | Core uses it to | Core says about the content of its Resources |
|---|---|---|
| Type | mark a type bead | nothing; Types defines it |
| Callable | mark a Bead that answers `call` | nothing; Types defines the declaration |
| EventSource | mark a Bead that answers `pull` | nothing; Types defines the declaration |
| AsyncResult | mark the result bead of an asynchronous call | that it holds a Reply (section 6.5) |
| ResultOf (placeholder name) | mark the Link from a result bead to the Callable that was called | nothing beyond its endpoints (section 6.5) |

A Resource whose Type refines one of these is treated as one of these. What "refines"
means is defined by Types; Core relies only on the service knowing which of its Beads
answer `call` and `pull`.

AsyncResult is the exception to Core's silence about content: a result bead holds a Reply,
and Reply is one of Core's own envelopes. If the alias proposal of section 2.9 stands, the
alias Type is a second exception and a sixth well-known Type. Both exceptions are listed
in section 15.

The fixed URLs of the well-known type beads are not yet assigned (section 15).

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

This proposal makes Core read one member, `target`, inside a Bead's `properties`. That
sits badly with section 2.4, under which Core does not look inside `properties`. Whether
alias resolution stays in `get`, with the alias Type as a well-known Type whose content
Core defines, or moves to the core library with the rest of aliasing, is open
(section 15).

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
- A delete is a change of state. It mints a final revision (ruled, section 5.6).
- A Bead's revision covers its captured owned Links (section 2.8).

Proposed terms. One token appears in two roles:

- as a **guard**: a caller sends `expectedRevision` to say "apply this only if the
  Resource is still at this revision" (sections 5.5 and 5.6);
- as a **chain**: a change record carries `previousRevision` and `revision`, so a reader
  can tell whether it has seen every change in between (section 7.2).

A stream's cursor is a different thing. It marks a reader's position in a stream. It is
not a revision of any Resource.

### 3.2 Revision provenance

**Status: mixed. Ruled (2026-11-11): provenance names several principals, each in one or
more roles, and a caller supplies it in the request context (section 4.3); the record
says how the Resource's present period began (`inception`); a service may authenticate
the caller and use that to establish an identity, and an identity it has not established
is `writer-supplied`. The shape below is proposed. It follows the decisions recorded in
the published provenance proposal (gastownhall/beads#7510), which have not yet been
written into any adopted text. The commit time, the message and the open `metadata`
member are carried.**

Provenance records who took part in the change that made a revision, in what role, and
when the revision was committed. It also records how the Resource's present period began.
It is stored with the revision and returned in the record as `revisionProvenance`
(section 2.2).

```text
RevisionProvenance = { principals?: [ Principal ],
                       inception?: "create" | "revert" | "unknown" | ...,
                       committedAt?, message?, metadata? }

Principal = { id, displayName?, roles?: [ role ],
              basis: "writer-supplied" | "channel-authenticated" | "unknown",
              authority? }
```

This replaces v0.1's single `actor` and its optional `agent`.

Principals and roles:

- A **principal** is an identity: a person, an agent or a service account. `id` is an
  absolute URI or URN. Nothing requires that it can be looked up.
- `displayName` is a saved label. It is never identity and never a matching key.
- One principal may hold several roles, and several principals may hold the same role.
- Three roles are named to begin with: `initiator` asked for the work, `contributor`
  helped produce the change, `submitter` is the identity the change was submitted under.
- The set of roles is open. A reader keeps a role it does not know and does not guess
  its meaning.
- Every role is optional. A role that is absent was not recorded; that is not a statement
  that nobody held it. A service MUST NOT invent a principal to fill one.
- A role grants no permission. Authorization is a separate decision (section 9).
- The position of a principal in the list carries no meaning.

Basis:

- `basis` says how a principal's identity was established. It says nothing about whether
  the roles attached to that principal are true.
- Ruled: Core does not require a service to authenticate its callers, and does not
  prohibit it. A service MAY authenticate the caller and use that to establish a
  principal's identity. An identity the service has not established itself is
  `writer-supplied`.
- `writer-supplied`: the caller reported it, and the service did not establish it.
- `channel-authenticated`: the accepting service established this identity itself, by
  authenticating the caller on the connection the request arrived on. Only the service
  can assign it, and `authority` then names that service. A caller cannot supply a basis
  at all; the input shape below has no such member.
- `unknown`: not known, as for a revision that predates this record.
- Proposed: where the service authenticates the same identity the caller supplied, that
  principal is recorded as `channel-authenticated`. Its roles remain what the caller
  reported. Authentication establishes who a principal is, not the role it played.
- Proposed: where the caller reports one identity and the service authenticates another,
  both are kept, each with its own basis. One does not replace the other.

Inception:

- `inception` says how the Resource's present period began. That it is recorded is ruled.
  The values and rules here are proposed, and follow the published proposal.
- `create`: the period began with a `create`.
- `revert`: the period began when a deleted Resource was brought back (section 5.6).
- `unknown`: not recorded, as for a Resource that predates this record. A service never
  works the value out afterwards, and never fills it in for older revisions.
- The set of values is open. A reader keeps a value it does not know. The proposal also
  names values for a Resource that arrives by import. Those come with whatever defines
  import (section 11).
- The service sets it. A caller cannot supply it; the input shape below has no such
  member.
- An update of a live Resource keeps the value. The final revision of a delete keeps the
  value the Resource had while it was live. Bringing a deleted Resource back sets
  `revert`.
- It applies to Beads and Links alike.

What a caller supplies, and what the service adds:

```text
ProvenanceInput = { principals?: [ { id, displayName?, roles? } ],
                    message?, metadata? }
```

- The service sets `committedAt`, the instant it committed the revision. A caller never
  supplies the commit time.
- The service marks each supplied principal `writer-supplied`, unless it established
  that identity itself. It MAY add principals it authenticated itself.
- The service sets `inception`.
- `message` is the caller's explanation of this change. `metadata` is an open JSON object
  about this change that nothing in the protocol interprets.
- A service that cannot record a member the caller supplied refuses the request. It does
  not drop the member.

Rules, carried from v0.1:

- Provenance is data, not evidence. Core does not claim it is true.
- Provenance is saved with the revision it describes, in the same commit, and is
  immutable from then on.
- Provenance describes one change. It is not copied forward from the previous revision.
  The one exception is `inception`, which describes the Resource's present period and
  not one change.
- Provenance never causes a revision. A request that changes nothing saves none.
- One request that mints several revisions records its provenance on each.

Changed from v0.1: v0.1 said Core has no basis that asserts authentication. The ruling
above replaces that sentence.

Open: the closed schema of a principal; how a record shows that an identity was both
supplied by the caller and authenticated by the service (the published proposal keeps
the two origins apart, and this draft records one principal); and the values of
`inception` for a Resource that arrives by import (section 15).

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
primitives. Ruled (2026-11-11): the members shown below, and that the request context
carries no deadline in v0.2 (section 6.7). The field rules are proposed.**

Every primitive request and every primitive response carries a `context`. This holds even
for primitives that are never asynchronous.

```text
RequestContext = { cause?, provenance?: ProvenanceInput, metadata? }
ReplyContext   = { cause, transaction?, metadata? }
```

Proposed field rules for `cause` and `transaction`:

- `cause` in a request is absent for a fresh request. It is present only when the caller
  is itself acting inside an existing causal tree and passes that tree's token on. A
  service MAY refuse a `cause` it did not mint.
- `cause` in a reply is always present.
- `transaction` in a reply is present when the request resulted in exactly one atomic
  commit. A read, a refused request and a request that changed nothing have none.
- `transaction` is a receipt, not a handle. It is the marker of the commit the request
  made, the same marker the events of that commit carry. A request cannot name a
  transaction to join, and several requests cannot be made to commit as one. Changes that
  must commit together are one request: a callable that makes them all (section 14).

Proposed field rules for `provenance`:

- `provenance` is what the caller reports about who is behind the request and why
  (section 3.2). It is in the context, not in any primitive's input, so that it travels
  the same way on all six.
- It applies to every revision the request mints. Like `cause`, it follows the request
  through a `call`: a revision minted by a callable on the request's behalf, at once or
  later, records the provenance of the request that set it in motion.
- A request that mints no revision records none. That includes every `get` and `pull`.
- Open: whether a callable may add principals of its own to the provenance of the
  request it is handling (section 15).

Proposed field rules for `metadata`:

- `metadata` is an open JSON object, in the request context and in the reply context. The
  system does not interpret it.
- Request `metadata` is delivered to whatever handles the request. For a `call`, that is
  the callable's implementation. Core does not store it. It MUST NOT change what a
  primitive means: a request that needs different behaviour is a different request.
- Reply `metadata` is from the service, or from a callable's implementation, to the
  caller. It is kept only where the Reply is kept: in the result bead of an asynchronous
  call (section 6.5).
- Something that should be kept with a revision belongs in the provenance's own
  `metadata` (section 3.2), which is stored and immutable. Context `metadata` is not.

### 4.4 Result, Outcome and Reply

**Status: ruled in structure (items marked). The arm names follow the design authority's
stated preference and are not final. The tag spelling is open.**

```text
Result<T, E>  = ok { value: T } | err { error: E }
Outcome<T, E> = Result<T, E> | fault { problem } | ...
Reply<T, E>   = { context, outcome?: Outcome<T, E> }
```

- **Result** is closed. It is the operation's own verdict: it succeeded with a value, or
  it failed with an error of its own.
- **Outcome** is open (ruled). It is what happened to the operation. It is the Result, or
  a `fault`, or an arm added by a pack. A reader MUST tolerate an arm it does not know.
- **Reply** (ruled name) pairs the context with the outcome. It is what every caller gets
  back.

There are two levels in the types and one level on the wire: `outcome` is a single tagged
value whose arms include `ok`, `err` and `fault` side by side.

Proposed reader rule. An `outcome` that is present means the operation is settled. Only
`ok` means success. An unknown arm is settled and not successful.

`T` and `E` are parameters. For a data primitive, section 5 says what they are. For a
callable they are JSON that Core carries and does not look inside (section 6.1).

An error does not carry a reason code in Core. If an operation needs to distinguish kinds
of error, its error `E` is itself a choice of shapes.

Open: the spelling of the tag that names the arm (section 15).

### 4.5 Faults and Problems

**Status: the `fault` arm follows the design authority's stated preference and is not
final. The Problem format is carried.**

A `fault` is a failure of the system, not a verdict of the operation: the service was
unavailable, the request was malformed, the service ran out of time. A fault carries a
Problem.

A Problem is an RFC 9457 problem document with the required members v0.1 defines: `type`,
`code` and `retry` (`never`, `after-state-change` or `after-delay`). Section 12 lists the
codes.

The line between the two kinds of failure:

- `err` belongs to the operation. For a primitive, Core says what `E` is. For a callable,
  its declaration does, and declarations are specified in Types. Either way a caller can
  be written against it.
- `fault` does not belong to the operation. Any operation can meet any fault.

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
error. How the frame is carried over HTTP, and which parts ride in the URL, the
headers or the body, is the binding's business (section 13) and is open.

Provenance is not a member of any primitive's input. It is supplied in the request
context (ruled, section 4.3).

`get`, `create`, `update`, `delete` and `pull` are synchronous: the response is the
settled outcome. Only `call` may be asynchronous (section 6.4).

### 5.3 get

**Status: reading a Resource is carried. Ruled: Core does not define what `get` returns
for a type bead, a Callable or an EventSource beyond the record every Resource has, nor
what may be assumed about the Bead that comes back; Types defines those representations
and the rules. That the record itself stays Core's is the proposed reading of that ruling
(section 2.4). Alias resolution is proposed.**

```text
input = { id, revision? }
value = the Resource's record (section 2.2)
```

- `get` works on every Bead and Link, including type beads and capability beads.
- The value is the record of section 2.2: identifier, kind, Type, revision, storage
  class, `properties`, `metadata`, and for a Link its endpoints. Core defines that record
  and nothing inside `properties` or `metadata`, for any Type.
- For a type bead, a Callable and an EventSource, what `properties` holds is the
  representation Types defines. Core adds no rule of its own.
- `get` on a Callable never invokes it. `get` on an EventSource never reads its stream.
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

**Status: ruled, for now, that `create` is a request on the Scope with the Type named in
the input. The member list and the identifier rules are proposed and follow v0.1's create
operations.**

```text
input (Bead) = { type, id?, properties?, metadata? }
input (Link) = { type, id?, source, target, properties?, metadata? }
value        = the created Resource's record (section 2.2)
```

- `create` is addressed to the Scope the new Resource will live in. The Type is a member
  of the input, not the thing addressed.
- `type` is required. It is a Reference to a type bead (section 2.4).
- `id` MAY be supplied by the caller. When it is omitted the service allocates one.
- Omitted `properties` and `metadata` are empty objects.
- An identifier already in use is refused. So is an identifier that was used and retired.
- The input is closed: a member Core does not define is refused, not ignored. This is
  about the members of the input itself, not about what is inside `properties` or
  `metadata`.
- Core does not check `properties` against the Type. A layer above Core MAY refuse the
  request (section 12).

`create` makes data Beads and Links only. It does not create capability beads
(section 2.7).

Considered and set aside: creating a Resource by addressing its type bead, so that a
request sent to a Type yields a Resource of that Type. A Type has one identity wherever it
is used, so its type bead's URL may be on another host than the Scope the new Resource
belongs in, and a request sent there would not reach the service that must store the
result. Naming one revision of the Type would also need a query parameter on that URL.
The question may be reopened (section 15).

Open: whether a deleted Bead's identifier can be created again (v0.1 allows it for Beads
and not for Links), and how a caller selects a storage class (section 15).

### 5.5 update

**Status: proposed. The guard and the no-change rule are carried.**

```text
input = { id, expectedRevision?,
          properties | propertiesChange,
          metadata | metadataChange }
value = the Resource's representation after the update
```

- At least one change member is required. A guard alone is not an update, and neither is
  provenance alone (section 3.2).
- `properties` and `propertiesChange` are mutually exclusive, and so are `metadata` and
  `metadataChange` (section 3.3).
- `expectedRevision` is optional. When present and not equal to the Resource's current
  revision, the update is refused with `revision-mismatch` and has no effect.
- An update that would leave the Resource as it is succeeds, keeps the revision, records
  no provenance, and produces no event. The reply carries no `transaction`.
- An update of a deleted Resource is refused as not found, unless it starts from an
  earlier revision (section 5.6).

An update changes one Resource. It does not change the Resource's identifier or kind.

Open: whether `update` can change a Resource's Type, and whether it can change a Link's
endpoints. v0.1 allows both. Neither is decided for v0.2 (section 15).

### 5.6 delete

**Status: mixed. Ruled (2026-11-11): a delete mints a final revision, and a deleted
Resource is brought back by an update that starts from an earlier revision. Ruled
(2026-11-11): the primitive only deletes. It is refused while Links are attached, and
the fuller delete with its controls is a core library callable. The shapes and the
details of the final revision are proposed. Open points are named below.**

```text
input = { id, expectedRevision? }
value = the final revision: { id, kind, type, revision, previousRevision }
```

The final revision (ruled):

- A delete mints one more revision of the Resource, its **final revision**. The
  Resource's chain of revisions does not simply stop; it ends with a revision that says
  the Resource was deleted.
- The final revision carries the provenance of the delete, from the request context
  (section 4.3): who deleted the Resource, and why.
- It is final until someone brings the Resource back. That is an update that starts from
  an earlier revision. It mints a new live revision after the final one, under the same
  identifier.

Proposed details, following what v0.1 offered as an optional capability:

- The final revision has a revision token of its own, distinct from the last live
  revision, which it names as `previousRevision`. It holds no `properties`, no `metadata`
  and no endpoints.
- This holds for Beads and Links alike. v0.1 recorded one for Beads only.
- A service keeps the final revision whether or not it offers history (section 10).
- `get` on a deleted Resource still fails as not found (section 5.3). How an authorized
  caller reads the final revision is open.
- Bringing a Resource back needs the content of an earlier revision, so it is available
  only where history is offered (section 3.4). It uses the provenance of the request
  that does it, not that of the earlier revision. It does not bring back any Link that
  was removed.
- The final revision keeps the `inception` the Resource had while it was live. The
  revision that brings the Resource back records `revert` (section 3.2).
- A second delete of a Resource that was brought back mints a new final revision.

Rules of the primitive:

- Ruled: the primitive deletes one Resource and does nothing else. It removes no Link
  along with a Bead, follows no Link to anything further, and has no dry run.
- Ruled: deleting a Bead is refused with `incident-links-exist` while a live Link is
  attached to it. A Link the caller cannot see still blocks, and is not disclosed.
- `expectedRevision` behaves as in `update`.
- Deleting a Link never requires anything of its endpoints.
- Deleting something already deleted is refused as not found.
- Delete is not erasure. Removing controlled content for good is a separate matter that
  Core does not define.

Ruled: the richer forms v0.1 offered as an optional capability (deleting several Beads at
once, removing attached Links along with the Bead, cascading through Links of named Types,
a dry run) are not part of the primitive. They are a core library callable, specified
there (section 14). That callable is built on the primitives. A caller who wants a Bead
gone together with its Links either deletes the Links first or uses the callable.

Open:

1. Where the member that names the earlier revision lives: on `update` itself, as v0.1's
   `fromRevision` was, or in a core library callable. This draft has not placed it.
2. What happens to a Link whose endpoint on the deleted Bead is pinned to a revision. v0.1
   lets such a Link survive and not block. The design authority leans the same way.

### 5.7 call

**Status: ruled that `call` is the single invocation primitive and that asynchronous
invocation is layered on it, not a seventh primitive. The input shape is proposed.**

```text
input = { callable, arguments, mode?: "sync" | "async" }
value = T, the callable's result
error = E, the callable's error
```

`callable` names a Callable bead. `arguments`, `T` and `E` are JSON that Core carries and
does not look inside. What arguments a callable takes and what it returns are stated by
its declaration, which Types specifies (section 6.1). Core does not check `arguments`
against anything; a layer above Core MAY refuse the call (section 12). `mode` is covered
in section 6.4.

### 5.8 pull

**Status: ruled that `pull` is the single reading primitive for event streams. The input
shape is proposed.**

```text
input = { source, after?, from?, limit?, representation? }
value = { events, cursor, head? }
```

`source` names an EventSource bead. The rest is covered in section 7.4.

Proposed for the HTTP binding: `pull` is a GET on the EventSource bead's own URL, with a
query parameter that selects the events instead of the bead's record, and `after` and
`limit` as further query parameters. The same URL MAY also serve the events as a held-open
stream. Section 13.2 has the detail; the binding as a whole is open.

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

**Status: ruled that the shape of a callable's declaration, and the rules about it, are
not in Core; Types specifies them. The behaviour Core keeps, listed below, is proposed.**

A Callable is a capability bead (section 2.7): a Bead whose Type is the well-known
Callable Type or refines it.

A callable has a declaration: what arguments it takes, what it returns on success, what
errors are its own, and which invocation modes it supports. Core does not define the
declaration's members, where they sit in the Bead, or what `get` on a Callable returns
beyond the record of section 2.2. Types defines all of that.

What Core keeps is behaviour:

- A Callable answers `call` (section 5.7) and `get` (section 5.3). `get` never invokes
  it.
- The arguments passed to `call`, and the value or error that comes back, are JSON that
  Core carries and does not look inside.
- Core does not check arguments or results against a declaration. A layer above Core MAY
  refuse a call on those grounds (section 12).
- A callable supports the synchronous mode, the asynchronous mode, or both
  (section 6.4).

An earlier state of this draft listed the declaration's members here, following the v0.1
callables preview: `description`, `parameters`, `resultSchema`, `errorSchema`, `modes`
and `title`. They are no longer part of Core (section 14).

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

**Status: ruled, including the spelling `mode` (confirmed 2026-11-11).**

- Asynchronous invocation is not a new primitive. It is a mode of `call`.
- The caller chooses the mode. The request member is `mode`, with values `sync` and
  `async`. An omitted `mode` means `sync`.
- Only `call` has a mode. The other five primitives are always synchronous.

Refusal has two levels, and a caller can tell them apart:

1. A callable supports one mode, the other, or both. A request for a mode the callable
   does not support is refused as unsupported by the callable.
2. A Scope MAY refuse a mode that the callable supports. That refusal is explicit and is
   distinguishable from the first.

A service never silently substitutes one mode for the other.

Where a callable advertises the modes it supports is part of its declaration, and so is
specified in Types (section 6.1). The behaviour above does not depend on where that is.

### 6.5 AsyncResult

**Status: mixed. Ruled: AsyncResult is an intrinsic Type that a pack may refine; a result
bead holds a Reply; `outcome` is absent while the call is pending; the result bead shows
its `cause`; the projection from a call to its result bead is deterministic in shape
only; a result bead names its callable; the transformation that gives a result bead its
shape is defined in Types. The design authority's stated lean, with either form accepted:
the result bead names its callable by a Link, not by a member. Proposed: the wording of
Core's own shape rule, the details of that Link, and the mechanics.**

An asynchronous `call` is admitted, not completed. The response is the result bead, and
the work continues after the response.

```text
AsyncResult<T, E> = Bead of the AsyncResult Type or a refinement of it,
                    properties: { context, outcome?: Outcome<T, E> }

ResultOf          = Link of the ResultOf Type,
                    source: the result bead,
                    target: the Callable, pinned to its revision at admission
```

Ruled:

- AsyncResult is an intrinsic Type. Core names it as a well-known Type (section 2.7). A
  pack MAY refine it to add its own members; a workflow run is the expected example.
- The result bead holds a Reply (section 4.4). `outcome` is absent while the call is
  pending and present once it has settled.
- The result bead shows its `cause` when read. It is in `context`.
- The projection from a call to its result bead is deterministic in shape, not in
  content.
- A result bead names the Callable that was called.
- The transformation from a callable's declaration to the shape of its result bead is
  defined in Types, with the type system and the declaration formats.

How the result bead names its callable. The design authority accepts either a member on
the result bead or a Link, and leans to the Link: with Links, the pending calls on a
callable can be seen from the callable. This draft therefore uses a Link. Its details
are proposed:

- The Link's source is the result bead. Its target is the Callable, as a pinned
  Reference (section 2.5) naming the Callable's revision at admission.
- The Link's Type is a well-known Type that Core names by identity only (section 2.7).
  The name ResultOf is a placeholder.
- The Link is owned by the result bead (section 2.8).
- The Link remains after settlement. The calls pending on a callable are therefore the
  ResultOf Links that target it whose source has no `outcome`, not all of them.

Proposed wording of Core's own shape rule. `T` and `E` are parameters Core does not look
inside. Core states the rule without naming a schema:

> Once settled, a result bead holds the Reply the same call would have returned had it
> been made synchronously: the same arms, the same `T` in `ok`, the same `E` in `err`.

Core says nothing more about shape. Because a result bead names its callable, Types can
say both of these without Core mentioning a schema:

- the shape of `value` and of `error` in a result bead is the one declared by the
  callable the result bead names;
- a declaration may name a refinement of AsyncResult as the Type of its result beads.

Neither sentence is a Core rule. Both are part of the transformation that Types defines.

Proposed mechanics:

- Admission is one transaction. It creates the result bead and the ResultOf Link, and
  mints the cause. Two Resources are created, so the commit produces two change events
  with the same `transaction` and `cause` (section 7.2).
- Settlement is an update to the result bead that writes `outcome`.
- Both revisions of the result bead, the one at admission and the one at settlement,
  record the provenance of the call request (section 4.3).
- The response to an asynchronous call is the result bead itself, as `get` on it would
  return it at that moment: `context` present, `outcome` absent. That the response is the
  result bead was stated by the design authority on 2026-11-11 (section 13.2); an earlier
  state of this draft returned a Reply frame that named the bead.

Open: the storage class of the result bead, and with it that of the ResultOf Link, whose
target is an intrinsic Resource (sections 2.6 and 15).

### 6.6 Observing an asynchronous call

**Status: ruled.**

An asynchronous call has a single event channel, and it fires on the outcome.

Proposed mechanism: the channel is the result bead's own change. Settlement updates the
result bead, and that update is an ordinary event (section 7.2). A caller that prefers not
to listen reads the result bead with `get` until `outcome` is present.

### 6.7 Not in Core

**Status: ruled for retry and for deadlines. The rest is proposed.**

- **Retry** is tabled. Core reserves no retry key and defines no retry behaviour.
- **Deadlines** are not part of v0.2 (ruled, 2026-11-11). A request carries no deadline
  and no timeout. An earlier state of this draft proposed a `deadline` member in the
  request context; it is removed. One may be added in a later version, once the timeout
  models of the systems built on this protocol, and of HTTP, have been reconciled. A
  service that gives up on its own account still reports a `fault` (section 4.5).
- **Cancellation** is not designed.
- **Suspending and resuming** a call is not designed.
- Arms such as `canceled` and `skipped` are not Core arms. A pack that needs them adds
  them to Outcome.

## 7. Events

### 7.1 EventSource

**Status: proposed (reviewed with the design authority on 2026-11-08). Ruled: the shape
of an event source's declaration, and the rules about it, are not in Core; Types
specifies them. Cardinality and the absence of a close operation are ruled, in
section 7.6.**

An EventSource is a capability bead (section 2.7): a Bead whose Type is the well-known
EventSource Type or refines it. It stands for one ordered stream of events.

An event source has a declaration: what one of its events looks like, how long its events
are kept, and whether it has one reader or many. Core does not define the declaration's
members, where they sit in the Bead, or what `get` on an EventSource returns beyond the
record of section 2.2. Types defines all of that.

What Core keeps is behaviour:

- An EventSource answers two primitives: `get`, which returns its record, and `pull`,
  which reads the stream.
- The bead is not the stream. Events arriving on the stream do not change the
  EventSource bead's revision.
- An EventSource is identified by its bead's URL.
- Every EventSource is readable. Core has no write-only or two-way stream type.
- Retention behaves as section 7.5 states, and cardinality as section 7.6 states,
  wherever the declaration says which applies.
- What an event carries as its content is JSON that Core does not look inside. The one
  event whose envelope Core defines is the change event (section 7.2), because it is
  Core's own report of what the data primitives did.

An earlier state of this draft listed the declaration's members here: `eventSchema`,
`eventRetention` and `cardinality`. They are no longer part of Core (section 14).

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

This envelope is Core's own wire shape. Whatever Resource content `data` carries is as
opaque to Core there as it is in the record.

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
4. **A deletion carries no content.** A `deleted` event names what was deleted. Its
   `revision` is the final revision the delete minted and its `previousRevision` is the
   last live revision (section 5.6). A Resource that is brought back is reported by an
   `updated` event whose `previousRevision` is that final revision.
5. **`cause` is added**, per section 4.2.
6. **Provenance rides on the event.** A change event carries the `revisionProvenance` of
   the revision it reports, beside `data`. v0.1's event record carried it for creates and
   updates; here a `deleted` event carries it too, so a reader of the stream learns who
   deleted a Resource without a further read.

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

How both are carried over HTTP is proposed in section 13.2.

### 7.5 Retention and held cursors

**Status: ruled that a held cursor is protected for a stated minimum lifetime. The hard
failure for a read below the retention floor is carried from v0.1 Events. The quantities
named below are proposed. Where an EventSource states them, and in what written shape, is
part of its declaration and so belongs to Types.**

The behaviour depends on two quantities:

```text
window             Floor { maxAge?, maxCount? }     keep the most recent events
                 | Until { expiresAt }              keep until a fixed time
minCursorLifetime  how long a held cursor stays usable
```

- A service states each EventSource's retention in that EventSource's declaration
  (section 7.1).
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
  application. Which of the two an EventSource has is stated in its declaration
  (section 7.1).
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
- the largest request context the Scope accepts (section 13.2);
- where the changefeed is.

Callables and EventSources are discovered as what they are: Beads. A client recognises
one by its Type (section 2.7) and reads its declaration as Types defines it; discovery
does not repeat any part of a declaration. How a client finds the set of them is a
listing, and listing is a core library callable. How a client finds that first callable
without a listing is open (section 15).

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

1. A `type`, `properties` and `metadata` for every Bead and every Link. The store keeps
   `properties` and `metadata` as given. It is not required to understand either, or to
   resolve the Type.
2. For every Link, its own identifier, revision and history, with parallel Links allowed.
3. One identifier space for Beads and Links, in which an identifier is never given to a
   second Resource.
4. A storage class for every Resource (ruled).
5. A revision per Resource that changes exactly when the Resource's state changes.
6. Where history is offered, earlier revisions of Beads and of Links alike (ruled:
   history is optional and discoverable).
7. A transaction marker shared by everything committed together (ruled).
8. A cause token, minted once per incoming request and recorded on everything that
   request changes (ruled).
9. A durable record of each change, written with the change: one record per Resource per
   commit, none for a failed request and none for a request that changed nothing.
10. Changes that arrive by replication made visible to event readers.
11. A hard failure for a read below the retention floor, and a minimum lifetime for a
    held cursor (the minimum lifetime is ruled).
12. An export that is consistent with itself, together with the cursor that matches it.
13. Provenance for each revision: the principals as supplied, each with its roles and
    basis, never invented, and how the Resource's present period began.
14. Deletion that does not erase: a deleted Resource's identifier stays accounted for,
    and its final revision is kept with the provenance of the delete (ruled that a delete
    mints one, section 5.6). This holds whether or not history is offered.

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

`validation-failed` and `type-not-installed` are the place a refusal by a layer above
Core is reported. Core does not check a Resource against its Type, or a call's arguments
against a declaration, and defines no rule that produces either code. Core keeps the
codes and the carrier so that such a layer can refuse a write or a call that Core alone
would accept. The rules are in Types. Whether Core itself requires anything of a `type`
it cannot resolve is open (section 15).

Codes carried from the v0.1 callables preview: `callable-not-found`,
`callable-unavailable`.

New (proposed):

- `mode-not-supported`: the callable does not support the requested mode.
- `mode-refused`: the Scope refuses the requested mode for a callable that supports it.

A problem response to a synchronous request carries the reply `context` as an extension
member (proposed), so that a failed request can still be traced by its cause.

How the `err` arm of a Result is carried over HTTP is a binding question (section 13).
v0.1 carried a callable's own error as a Problem with code `callable-error`.

## 13. Bindings: HTTP, JSON Schema, OpenAPI

### 13.1 Syntax and semantics

**Status: ruled. The list of Core's own envelopes is proposed.**

This document is semantics: what a representation means and what each primitive does.
Syntax is two projections onto languages that already exist:

- the only syntax for a representation is **JSON Schema**;
- the only syntax for a primitive is an **OpenAPI** operation.

Core defines no description language of its own.

The representations Core itself defines are envelopes, and they are still written in JSON
Schema:

- the Bead and Link record (section 2.2);
- Result, Outcome and Reply (section 4.4);
- the change event (section 7.2);
- the Problem (section 12).

That is wire shape, not a type system. Each of these schemas fixes the envelope and
leaves what it carries unconstrained: `properties`, `metadata`, a callable's arguments,
value and error, and the content of an event on any stream other than the changefeed.
Schemas for those are the business of Types.

### 13.2 The HTTP binding

**Status: open, with two points settled. Ruled for now: `create` is a request on the
Scope. Ruled: the form of `call` below, except the status codes and the `Location`
header, which are proposed. The form of `pull` is proposed. The v0.1 binding is described
for reference. It is not carried.**

Ruled for now: `create` is sent to the Scope, with the Type named in the body
(section 5.4). Sending it to the type bead's URL was considered and set aside.

In v0.1:

- a read goes to the Resource's own URL, with variations as query parameters;
- a change goes by POST to a fixed command URL named for the operation, with the target
  Resource named in the body;
- a callable is invoked by POST to a fixed route that includes its name, deliberately not
  the declaration Bead's own URL;
- events are read at a fixed route for the Scope, and at the Resource's own URL with a
  query parameter for one Resource.

The design authority asked three questions that this section must answer before it can
be written:

1. Should `delete` be the plain HTTP DELETE on the Resource's URL, refusing when Links
   are attached, with every richer control in a callable?
2. Should `update` likewise map onto the HTTP methods for replacing and patching a
   Resource? This is expected to be a harder fit and may be deferred.
3. Should the four data primitives address the Resource's identifier directly instead of
   a table of command URLs, and should `call` and `pull` do the same for the Callable and
   the EventSource they act on?

The first is answered in its substance (ruled 2026-11-11, section 5.6): `delete` only
deletes, is refused while Links are attached, and leaves every richer control to a
callable. The plain HTTP DELETE on the Resource's URL is the form that follows from
that. It is proposed here, not ruled. A DELETE has no body, so the guard
`expectedRevision` needs another place. The standard `If-Match` request header is the
natural one. That too is proposed. The second and third questions stand.

Also open here: how the common frame (section 5.2) maps onto HTTP, in particular how the
`err` arm is carried and where the reply context travels for the primitives other than
`call`.

Proposed: carrying the request context. The request context (section 4.3) travels in
HTTP request headers, one header for each member, the same headers on all six
primitives. It does not travel in the URL.

```text
DELETE <Resource URL>
BDP-Cause: <cause token>
BDP-Provenance: {"principals":[{"id":"urn:example:ada","roles":["submitter"]}]}
BDP-Metadata: {"ticket":"example-17"}
```

Where it goes:

- Not in the URL. Provenance names people and carries a free-text message. URLs are
  written to logs, kept by caches and passed on by intermediaries, and their usable
  length is small.
- Not in the body, because three of the six primitives have none to put it in. A GET has
  no request body, which covers `get` and `pull`, and a body on an HTTP DELETE has no
  defined meaning. Headers are the one place that is the same for all six. They also
  leave each body as the input alone: the arguments of a `call`, a patch for an `update`.
- One header for each member, not one for the whole context. Servers and intermediaries
  limit the length of a single header line as well as the size of all headers together,
  and one long line is the first thing to meet a limit. Separate headers keep each line
  short, let a service or an intermediary read the cause without parsing the rest, and
  let a caller send only the members it uses.
- Each header appears at most once in a request. HTTP allows an intermediary to join
  repeated lines of one header into a single comma-separated line, which a JSON value
  would not survive unchanged.
- `BDP-Cause` is the bare token. The other two values are JSON, written in ASCII with
  every other character escaped. The header names and this encoding are placeholders.

Size:

- Splitting shortens each line. It does not raise the limit on all headers together,
  which the context shares with everything else the request carries.
- Every Scope accepts a request context up to a stated floor, measured across the three
  headers together. Proposed floor: 4096 bytes. The number is open.
- A Scope states the largest request context it accepts in discovery (section 8). That
  is never less than the floor.
- A larger context is refused with `request-too-large`. It is never truncated, and no
  member is dropped to make it fit. An intermediary in front of the service may refuse
  an oversized request first, with a plain HTTP error and no Problem.
- A context is for small things. Anything large belongs in a Bead.

Through intermediaries:

- HTTP requires a proxy to pass on a header it does not recognise (RFC 9110,
  section 5.1), so these headers travel through proxies, gateways and load balancers
  unless one has been set up to remove them.
- Header names use hyphens and never underscores. Some servers drop a header whose name
  contains an underscore.
- A browser page that sends these headers to another origin makes a preflight request
  first, and the service must allow the headers by name.
- A browser's built-in reader for event streams cannot set request headers. A reader
  that uses it for a pushed `pull` sends no request context. That is allowed, because
  every member of the request context is optional.

Considered and not taken:

- A body that wraps the input together with the context. That has no size limit worth
  the name, but it serves only `create`, `update` and `call`, it rules out the plain HTTP
  DELETE above, and it means a `call` body is no longer the arguments alone.
- A single header holding the whole context as one JSON value. It is one line where
  three would do, and it is the form an earlier state of this draft proposed.

Open: whether provenance may be spread further, one principal to a line; and whether the
reply context of the primitives other than `call` travels in response headers of the
same names.

Form of `call`. The design authority stated it on 2026-11-11 as two requests: a POST on
the Callable's URL that returns the result, and the same POST marked asynchronous that
returns the AsyncResult bead. That answers the third question for `call`. Filled in:

```text
POST <Callable URL>                 body: the arguments
200  the Reply: { context, outcome }

POST <Callable URL>?mode=async      body: the arguments
202  Location: <result bead URL>
     body: the result bead, with no outcome yet
```

- The request body is the arguments and nothing else. The Callable is named by the URL
  and the mode by a query parameter. The request context is in the headers proposed
  above.
- The synchronous response body is the Reply, not the bare result (ruled). It is exactly
  what the result bead's `properties` hold once the same call, made asynchronously, has
  settled (section 6.5).
- The mode is the query parameter `mode` (ruled). `mode=async` asks for an asynchronous
  call. A request with no `mode`, or with `mode=sync`, is synchronous (section 6.4).
- Proposed: the status codes `200` and `202`, and the `Location` header on the
  asynchronous response.

Proposed form of `pull`. It answers the third question for `pull` only, and only as a
proposal:

- A finite read is a GET on the EventSource bead's own URL. A query parameter selects the
  events instead of the bead's record; v0.1 used `view=events` on a Resource's URL for
  the same purpose.
- `after` and `limit` are query parameters, and so are `from` and `representation`.
- The response body is the value of section 7.4: one page of events, a cursor, and
  `head`.
- Push, where offered, is the same URL and the same query, requested with
  `Accept: text/event-stream`. Each event in the stream carries an identifier that is the
  cursor for resuming after that event, so a reader that reconnects with the standard
  `Last-Event-ID` header resumes exactly as it would with `after`.
- A service that does not offer push answers the same request with the finite read.

### 13.3 The projections

**Status: open.**

The JSON Schema and OpenAPI projections for v0.2 are not yet generated. They follow the
sections above as each is ruled.

## 14. What moved out of Core

**Status: two moves with different standing. To the core library: direction given by the
design authority; not yet confirmed. To Types: ruled. Nothing is removed from v0.1 by this
draft.**

#### To the core library

The direction given is that Core defines the six primitives and what they need, that the
separate Write, Events and Transfer documents go away, and that all further surface is
specified in the core library. Until that is confirmed the v0.1 documents stay where they
are.

| v0.1 item | Proposed home |
|---|---|
| Create, update and delete of Beads and Links (Write) | Core, sections 5.4 to 5.6 |
| Alias creation, repointing and removal (Write) | core library |
| Atomic batch and request-local names (Write) | core library |
| Delete of several Beads, with attached Links, by cascade, as a dry run (Write) | core library (ruled, section 5.6) |
| Rooted identifier allocation (Write) | core library |
| Update from an earlier revision, and recovery of a deleted Bead (Write) | open: recovery by such an update is ruled (section 5.6); whether the member is on `update` or in the core library is not. Either way it needs history |
| Idempotency keys (Write) | open; tabled with retry (section 6.7) |
| Retyping and Link endpoint correction (Write) | open (section 15) |
| Collections, selectors and query (Core) | core library |
| Listing a Resource's revisions (Core) | core library, with history |
| Event records, cursors, retention (Events) | Core, section 7 |
| Facts that are not Resources: alias, identity, association state (Events, Transfer) | not carried; an alias is a Bead (section 2.9) |
| Export packages and admission (Transfer) | boundary in Core section 11; operations in core library |
| Callable invocation (Callables preview) | Core, section 6 |
| Callable declaration (Callables preview) | Types (see below) |
| Callable registration and command-line mapping (Callables preview) | core library and the CLI specification |
| Type definitions and checking (Types) | stays in Types, which also moves to v0.2 |

#### To Types

Ruled: Core carries no type system and no declarations. Types defines the type system,
the declaration formats, the representation `get` returns for a type bead, a Callable and
an EventSource, and the transformation that gives an asynchronous result bead its shape.

Each row below was in an earlier state of this draft or in the v0.1 callables preview.
The last column is what stays in Core beside it.

| Item | Was in | Moves to | Core keeps |
|---|---|---|---|
| What a type bead contains; how a Type is defined, refined and checked | Types already | Types | the concept of a Type and a type bead; `type` as a Reference (section 2.4) |
| What `get` returns for a type bead, a Callable and an EventSource, inside `properties` | draft sections 5.3, 6.1, 7.1 | Types | the record every Resource has (sections 2.2, 5.3) |
| Callable declaration members: `description`, `parameters`, `resultSchema`, `errorSchema`, `modes`, `title` | draft section 6.1 | Types | `call`; arguments, value and error as opaque JSON (sections 5.7, 6.1) |
| Where a callable advertises its modes | draft sections 6.1, 6.4 | Types | the caller's choice of mode and the two distinguishable refusals (section 6.4) |
| Checking arguments against declared parameters | draft section 5.7 | Types | the place a refusal is carried (section 12) |
| The shape of `value` and `error` in a result bead, derived from the callable's declaration | draft section 6.5 | Types | the shape rule in Core's own words, and the Link from a result bead to its callable (section 6.5) |
| Naming a refinement of AsyncResult as the Type of a callable's result beads | draft section 6.5 | Types | AsyncResult as a well-known, refinable Type (sections 2.7, 6.5) |
| EventSource declaration members: `eventSchema`, `eventRetention`, `cardinality` | draft section 7.1 | Types | `pull`; the retention and cardinality behaviour (sections 7.4 to 7.6) |
| Where retention is stated and its written shape | draft section 7.5 | Types | the hard failure below the floor and the held-cursor minimum (section 7.5) |
| The rules that produce `validation-failed` and `type-not-installed` | draft sections 5.4, 12 | Types | the codes and the carrier (section 12) |
| What it means for one Type to refine another, including a well-known Type | draft sections 2.7, 6.5 | Types | the identities of the well-known Types (section 2.7) |

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
8. The final revision of a delete (ruled that there is one): what it holds, how it is
   read, what `delete` returns, and whether the update that brings a Resource back is a
   member of `update` or a core library callable (section 5.6).
9. What a delete does about Links pinned to a revision of the deleted Bead.
10. Whether `update` stays bare, with controls in callables. For `delete` this is ruled:
    it does (section 5.6).
11. The HTTP binding, and whether primitives address the Resource directly
    (section 13.2). `create` on the Scope is ruled for now. `delete` as the plain HTTP
    DELETE, with its guard in `If-Match`, is proposed. The rest is open.

Execution:

12. The rules of the call context's members (the members themselves are ruled), and
    whether a callable may add principals to the provenance of the request it is handling
    (section 4.3).
13. The spelling of the tag that names an Outcome arm, and whether arms are open
    records.
14. Cancellation, suspend and resume. Deadlines are deferred to a later version (ruled,
    section 6.7).
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

Core and Types:

23. The exact list of well-known Types Core names, and their fixed URLs (section 2.7).
24. Whether the record of section 2.2 stays Core's. The ruling is that Core does not
    define what comes back from a `get`; this draft reads that as silence about what is
    inside `properties` and `metadata`, with the record itself kept (sections 2.4, 5.3).
    The reading awaits the design authority.
25. Alias resolution in `get` reads a member inside `properties` (section 2.9). Either
    the alias Type becomes a well-known Type whose content Core defines, or resolution
    moves to the core library.
26. AsyncResult: the wording of Core's own shape rule, and the details of the Link from
    a result bead to its callable: its well-known Type and that Type's name, ownership by
    the result bead, and that it remains after settlement (section 6.5). These await the
    design authority.
27. The storage class of the Link from a result bead to its callable, whose target is an
    intrinsic Resource, and what an export does with it (sections 2.6, 6.5, 11). This
    goes with item 16.
28. Creating a Resource by addressing its type bead. Considered and set aside for now
    (section 5.4).
29. The HTTP form of `pull` (section 13.2).
30. What Core requires of a `type` Reference the service cannot resolve: nothing, or a
    refusal (sections 2.4, 12).
31. Whether the quantities of a retention policy are named by Core, as section 7.5 does,
    or only by Types.
32. The HTTP form of `call` beyond what is ruled: the status codes and the `Location`
    header on the asynchronous response (section 13.2).

Provenance and context:

33. The shape of provenance (section 3.2). Ruled: it names several principals in roles;
    it records how a Resource's present period began; a service may authenticate the
    caller, and an identity it has not established is `writer-supplied`. Open: the closed
    schema of a principal; how a record shows an identity that was both supplied and
    authenticated; and the values of `inception` for a Resource that arrives by import.
34. How the request context is carried over HTTP. One request header for each member is
    proposed. The names, the encoding, the floor every Scope accepts and whether
    provenance may be spread over several lines are open, and so is where the reply
    context travels for the primitives other than `call` (section 13.2).
35. Whether a request can name a transaction to join, so that several requests commit as
    one. Proposed: no (section 4.3).
36. Whether every change event carries the provenance of the revision it reports
    (section 7.2).

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
  (6.5; since 2026-11-11 the inference itself is stated by Types)
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
- Core carries no type system. First stated on this date and confirmed on 2026-11-11: "So
  Core is absent ANY schematization or type system whatsoever. It's raw data access."
  and "Then types can define the declaration shapes and UDTs." (2.4, 6.1, 7.1, 14)

2026-11-11

- Core has the concept of a Type and of a type bead and does not say how to interpret
  either: "core includes the CONCEPT of a type and type bead, but is silent on how to
  interpret it. Core does NOT define what comes back from a get, nor what one can assume
  about the resultant bead. Same for callables." This was offered as a thought and
  confirmed the same day, when the rework of this document on that basis was approved.
  (2.4, 2.7, 5.3, 6.1)
- Types defines the `get` representation "for callables, streams, and types. And the
  rules." (5.3, 6.1, 7.1, 14)
- `create` stays a request on the Scope, for now: "We can live to fight another day on
  create. For now it's fine and yes it's on the scope itself." (5.4, 13.2)
- An asynchronous result names its callable: "Yes on the link". On whether that is a
  member or a Link: "Either will work. Links allow you to easily see how many pending
  calls there are on a given callable." The Link form is therefore a stated lean, not a
  ruling. (6.5)
- Types defines the type system, the declaration formats, and the transformation that
  gives an asynchronous result its shape. (6.5, 14)
- `call` is a POST on the Callable's own URL. Made synchronously it returns the Reply,
  not the bare result; made asynchronously it returns the AsyncResult bead. The mode is
  spelled `mode=async` on the URL. (6.4, 6.5, 13.2)
- The request context carries `cause`. The reply context carries `cause`, and
  `transaction` where the request made one commit. (4.3)
- Provenance is supplied in the request context, not in each primitive's input. (3.2,
  4.3, 5.2)
- The request context and the reply context each carry a `metadata` member that the
  system does not interpret. (4.3)
- Provenance names several principals, each in one or more roles. (3.2)
- A delete mints a final revision. A deleted Resource is brought back by an update that
  starts from an earlier revision. (3.1, 5.6)
- Deadlines are not part of v0.2. They may be added in a later version. (4.3, 6.7)
- Provenance records how a Resource's present period began. (3.2)
- Core does not prohibit a service from authenticating the caller and using that to
  establish the acting identity. An identity the service has not established is recorded
  as supplied by the writer. (3.2)
- `delete` only deletes. It is refused while Links are attached. The fuller delete, with
  its controls, is a core library callable. (5.6, 14)

Stated preferences, not final: the arm names `ok` and `err`; a closed Result inside an
open Outcome; `fault` as the system arm carrying a Problem; no reason code in Core. (4.4,
4.5)

Not ruled, though it follows the rulings of 2026-11-11: that the Bead and Link record
stays Core's; the list of well-known Types; Core's own wording of the shape rule for a
result bead; the details of the Link from a result bead to its callable; the HTTP form of
`pull`; the shape of a principal; the values of `inception`; what the final revision of a
delete holds; `delete` as the plain HTTP DELETE; the headers that carry the request
context; that a request cannot join a transaction. Each is marked proposed where it
appears and listed in section 15.
