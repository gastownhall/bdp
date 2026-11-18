---
title: BDP Protocol
version: "0.2.1"
status: draft
owner: lydia
normative-source: core/core.lumen
changelog: CHANGELOG.md
---

# BDP Protocol

BDP is a protocol for storing, naming, reading and changing versioned resources
over HTTP. Every resource has a stable identity, a type, and a body. A small,
fixed set of operations works the same way over every resource, whatever its
type. On top of that uniform base, a resource whose body follows a declared
schema is a **bead** — the unit a domain model is built from.

The slogan is **BDP = Beads × HTTP**. Beads give the data model; HTTP gives the
transport and the status vocabulary. This document explains the model and the
reasons behind it. It does not restate the exact shapes.

## How to read the specification

There are three layers, and each has one job.

- **The formal source** is [`core/core.lumen`](core/core.lumen). It is
  authoritative. Every shape, every operation, and every normative rule is
  written there, once, at the declaration it belongs to. When this narrative and
  the formal source disagree, the formal source is right.
- **The reference** is [`generated/core.md`](generated/core.md). It is generated
  from the formal source, never written by hand. It shows each form as its Lumen
  fragment followed by a member table, with the normative rules as labelled
  callouts.
- **This narrative** is the context. It says what the model is, how the areas fit
  together, and why the shapes are what they are. It cites a form by its id, for
  example [[core.lumen#Resource]], and leaves the exact fields to the reference.

The normative rules are not lost in this split. Each one is a `/// normative:`
line on its form in the formal source. They are the conformance points, and the
[conformance section](#11-conformance-and-the-normative-rules) below gathers the
store-wide ones.

A service may offer only part of the operation set. What it offers, it advertises
through discovery. Nothing here assumes more than a service claims.

---

## 1. Identity and scopes

A resource is named by an **id**, and the first thing to understand is how to read
one. The decoder ring is the id's `scope` ([[core.lumen#Scope]]), which has three
readings: absent (equivalently `null`) means the id is a local name in the store
you are talking to; a store URL means another BDP store, with the id relative to
it; and the literal `"uri"` means the id is itself an absolute URI, for a resource
that lives outside any store. An id is a [[core.lumen#ResourceId]] — a scope, the
id within it, and an optional revision.

Whether resources are versioned is a scope-wide trait, the scope's revision model
([[core.lumen#RevisionModel]]): a versioned scope mints a new revision on every
change (and a reference may pin
one), while an unversioned scope mints none. In a versioned scope a
[[core.lumen#Rev]] names one revision, and a [[core.lumen#Digest]] is a content
hash that also serves as a revision, so an external, verifiable pin and a local
revision satisfy the same field. A reference that carries a revision is pinned to
that exact version; one that does not floats to the current version.

There is one reference world. A resource names another only through a
[[core.lumen#ref]], and the pin, when there is one, lives in its `rev`. This
keeps "which resource" and "which version" in one place instead of two.

Two first path segments are reserved: `bdp` for the protocol's own routes, and
`sys` for in-band system resources such as the changefeed at `/sys/changes`.

## 2. The resource model

Everything a store holds is a [[core.lumen#Resource]]. The shape is small on
purpose: an id, a type, and a body are always present; a scope, metadata,
provenance, a creation time, and a storage class are optional. The type is a
path, such as `text/plain` or `issue/task`. The body is the content.

A [[core.lumen#Bead]] is a resource whose body follows a declared schema. A bead
is a **marker**, not a new envelope. Narrowing it puts the subtype's fields
under `body` — never beside the id and type. This is the firewall: domain fields
live in the body, and the envelope stays the same for every resource in the
store. That is what lets one set of operations serve every type.

Content — a `text/plain` file, an image — is a bare resource. Its type is a media
type, and its body is the raw bytes. A bead and a piece of content differ only in
what names the type: a package names a bead's type; a registry such as IANA names
a content type.

Who named the type is the [[core.lumen#Authority]]. A caller may supply it; absent
on a write, the server resolves it from the type. An installed default package of
standard types is consulted first, then a registry such as IANA, and a type that
resolves to neither is ad-hoc. A service caches the well-known media types so
resolving content does not reach out to IANA every time.

The optional parts carry the record around the record. [[core.lumen#Metadata]] is
an open sidecar the protocol does not read. [[core.lumen#Provenance]] says who
took part in a change and when; it is data, not proof — the protocol records it
and does not claim it is true.

## 3. References and representations

Two typed forms sit on top of the plain reference, and the difference between
them is by-reference versus by-value.

A [[core.lumen#ref]] is a reference: a resource's name, nothing resolved. A
[[core.lumen#rep]] is a representation: the resolved value a read returns, as of
one revision. You name a resource with a `ref` and you read it into a `rep`. The
type parameter on each is for the checker only; it is gone on the wire.

[[core.lumen#get]] resolves a `ref` to a `rep`. It is safe — it never changes
anything — and it has no declared failure: it returns a representation or it
faults with a [[core.lumen#Problem]]. A read can carry a selector that keeps only
part of the representation, and a projected read gets its own cacheable identity.

A reference either pins a revision or it does not. [[core.lumen#pinned]] carries a
`rev`; [[core.lumen#unpinned]] floats to the current one. The distinction
matters most after a delete: a pinned reference still resolves, because revisions
are immutable and history is kept, while an unpinned reference follows the
resource to its tombstone.

## 4. Types — the kind system

A type is a path, and the path is its meaning. `issue/task` is a task, which is a
kind of issue. The path is built by single refinement: `task` refines `issue`,
and the chain from the root to the leaf is the path. Only one parent is allowed,
which is what keeps the path a tree and an id unique.

The type path is also the resource's **kind**. Kind is not a stored field; it is
the type's id. A filter that asks "is this an issue?" tests the path by prefix.

Types can also be written down and published. A [[core.lumen#TypeBead]] carries a
[[core.lumen#TypeDef]], and a [[core.lumen#BeadSchema]] is a type represented as a
value — the form a package exports and the form that lowers to a JSON Schema for
consumers outside BDP. Reading, resolving and constraining type definitions is
the work of the Types layer; the core only needs the type path and the authority
that qualifies it.

## 5. Channels and the streaming model

Some resources are read as a sequence rather than a single value. A
[[core.lumen#Channel]] is such a sequence — an event stream with a declared event
schema, a direction, and delivery characteristics. The changefeed is the
built-in example.

A reader consumes a sequence as a `source` of items, in one of three transport
forms, chosen by `--format`. Windowed JSON returns one page at a time and is the
floor every service offers. Bulk JSONL returns the whole sequence, one item per
line. Live SSE follows the sequence as it grows, and is valid only on a live
source. One [[core.lumen#Cursor]] spans all three: page through in JSON, catch up
in JSONL, then hand the same cursor to SSE to go live.

[[core.lumen#pull]] reads a channel. [[core.lumen#push]] writes one — the dual of
pull, and the channel's version of bulk import. How far back a cursor can resume
is the channel's [[core.lumen#Retention]]; below the floor, a stale cursor faults
and the reader resyncs. The request bundle for any streaming read is a
[[core.lumen#ReadRequest]], and a windowed response is a [[core.lumen#Page]].

## 6. Operations — call, cancel, and the reply model

Most of BDP is data: you read and write resources, and a data operation returns
its value directly or faults with a Problem. One operation is different.

[[core.lumen#call]] invokes an [[core.lumen#Operation]] — a declared unit of work
with its own input and its own declared success and failure. This is the only
place with a rich result. A [[core.lumen#Request]] goes in; a
[[core.lumen#Reply]] comes back carrying an [[core.lumen#Outcome]]. The outcome is
either the operation's declared success, its declared failure, or a fault. The
split matters: a declared failure is a normal, expected answer (the operation ran
and said no), while a fault is the call itself going wrong. On HTTP, a declared
failure is a 409; a fault takes the Problem's status.

[[core.lumen#Result]] and [[core.lumen#Outcome]] belong to `call` alone. Data
operations never carry them — a read returns a representation, a write returns a
pinned reference, a delete returns a tombstone revision. Keeping the rich result
in one place keeps the other operations simple.

A call can run asynchronously. Then it returns at once with an
[[core.lumen#AsyncResult]] — a resource you poll or watch until it settles.
[[core.lumen#cancel]] stops a running one. The cause and frame fields
([[core.lumen#Cause]], [[core.lumen#Frame]]) tie an effect back to the request
that set it off, so work started by a call stays findable.

## 7. The resource lifecycle — the primitives

The core is a uniform set of operations over the resource store. Each one is
defined once, at the model it belongs to, and each is a primitive — not a
user-defined callable. A service advertises which it offers.

- [[core.lumen#create]] admits a new bead. The id may be proposed or left to the
  server; an id already in use, or used and retired, is refused. Its input is
  closed: an envelope field the core does not define is refused, not ignored.
- [[core.lumen#put]] is the full-state write — create-or-replace, idempotent. A
  write that changes nothing keeps the revision and records nothing.
- [[core.lumen#patch]] applies a JSON Patch to the body and metadata.
- [[core.lumen#delete]] retires a resource, minting a tombstone revision. Delete
  is not erasure: the id stays accounted for, the tombstone is kept with its
  provenance, and the id is never reused.
- [[core.lumen#get]], [[core.lumen#list]] and [[core.lumen#revisions]] are the
  reads — one resource, a scope's current resources, and one resource's history.

The write operations take an optional `ifRevision` precondition — the HTTP
`If-Match`. Absent, the write is unconditional. Present, the write applies only
if it matches the current revision; a stale value changes nothing and faults with
`revision-mismatch` (412). This is the store's optimistic-concurrency control,
and it is the whole of it: there is no revision-keyed read cursor, and a specific
revision is read with `get` under `?revision=`.

## 8. Change events and the changefeed

Every store has one built-in changefeed — a channel at `/sys/changes` whose
events are what the write operations commit. Read it with `pull`.

A [[core.lumen#ChangeEvent]] reports one committed change to one resource, sorted
by lifecycle: [[core.lumen#Created]], [[core.lumen#Updated]],
[[core.lumen#Deleted]]. The rules are strict because consumers depend on them.
One commit produces exactly one event per resource changed, however many times
the request touched it. A failed request and a no-change request produce none. An
event is durable with its change — never committed without its event, never
published for a change that did not commit. A change that arrives by replication
still appears on the feed.

An event carries the new revision, the time, and the cause, spread from a shared
[[core.lumen#ChangeEnvelope]]. An update's payload is either a full post-image or
a patch; a delete carries explicit provenance, because there is no post-image to
carry it.

## 9. Export and import

Export and the changefeed are the bulk and live faces of one thing. The feed
streams every commit as it happens; [[core.lumen#export]] serialises the same
representations as a backup.

An export is JSON Lines: a begin record, one resource per line, an end record. A
reader refuses a file that ends without the end record, so a truncated backup is
never taken for whole. By default an export is the current state; with
`--revisions` it is every revision in order — a true backup, from which the
revision chain can be rebuilt. The export reads from the authoritative revision
store, so it is a backup even when the live feed has been compacted. It is cut at
a [[core.lumen#Cursor]], so a consumer can resume the feed from where the backup
ends.

[[core.lumen#import]] is the bulk write path. It replays a history file in commit
order to rebuild the chain, or sets current state from a state file. It is not a
filter operation.

## 10. The HTTP binding

BDP is an HTTP protocol, and the binding is part of the specification, not an
afterthought. Each operation has a method, a path, query parameters, headers, a
body and a set of status codes. The only type system on the wire is the media
type.

Two bindings carry the weight of the model. A stale `If-Match` faults with 412,
which is how optimistic concurrency reaches the wire. A declared operation
failure is a 409, which is how the outcome split reaches the wire. The reference's
HTTP appendix lists the headers, the status table, and the Problem codes in full.

The context a request and reply carry — the transaction, the cause, the cursor —
rides in `BDP-*` headers, one value each, never folded into the body.

## 11. Conformance and the normative rules

A conformance suite is built from this specification, not from any
implementation. Each `/// normative:` line in the formal source is a conformance
point, and a service either meets it or does not.

The rules come in two kinds. Most sit on a single form and govern it — how
`delete` treats inbound references, when a revision changes, how a hidden
resource reads. Those travel with their form in the reference. The store-wide
guarantees — a change produces exactly one event, an id is never reused, a hidden
resource reads exactly as a missing one — are gathered in the reference's
conformance checklist.

There are no fixed tiers. The floor is `get` and a readable `/sys/capabilities`;
everything else — list, the writes, pull and push, the operation calls, and export
and import — is offered à la carte. A service advertises exactly what it offers
through discovery (its [[core.lumen#Capabilities]]): a primitive is supported if and
only if it is advertised, and a
request that needs an un-offered primitive is refused `capability-not-supported`. A
client reads the advertisement once and never has to guess.

---

*This narrative is maintained alongside `core/core.lumen`. When a form is added,
renamed or re-shaped there, its mention here is updated to match. The formal
source remains the single source of truth.*
