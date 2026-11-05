---
status: editorial-draft
intended-status: type-package
version: "preview-1"
---

# Beads Protocol — Issue and Dependency Types

Editorial draft preview-1 · November 4, 2026 · replaces the draft of October 14, 2026

This document is the selected Type package for work records: the **Issue** Bead
Types and the **Dependency** Link Types that a BDP provider carries when it
projects an issue tracker onto Beads and Links. It is written for the provider
that projects an existing tracker over its existing storage, with each record
affiliated to one of the Types below and each relationship row served as a Link.
[Core](../../profiles/core/core.md) supplies identity, records, reads, selection
and HTTP; [Write](../../profiles/write/write.md) supplies the mutations;
[Types](../../profiles/types/types.md) supplies the descriptor language in which
the definitions below are written. [Callables](../../profiles/callables/callables.md)
carries the tracker's command-shaped operations, specified for this package in
[Issue and Dependency Callables](callables.md); this document carries none.

> **Status.** Editorial draft on a review branch. Its rulings await Donna's
> markers; nothing here is selected until she says so.

The definitions are authored as descriptor documents in the repository's
[Type-definition notation](../../formats/markdown-type-definitions.md), under
`descriptors/`, with their properties schemas as sibling documents in the
[Markdown JSON Schema notation](../../formats/markdown-json-schema.md):
`issue-properties.md` and `dependency-properties.md`. The prose below reads
those documents; it does not restate them as JSON.

This is the preview-1 edition selected for the friends-and-family preview pin. It
defines the wire meaning of the records; it is not evidence that a provider
implements it, and a later edition may change any rule marked **preview** below
without a compatibility promise. The October draft's Preview 2 evidence,
field-by-field audit and acceptance-case tables are retained in the history
archive and are not restated here.

## Contents

1. [Selection and boundary](#1-selection-and-boundary)
2. [Identities](#2-identities)
3. [Issue Bead Types](#3-issue-bead-types)
4. [Dependency Link Types](#4-dependency-link-types)
5. [Link identity, uniqueness and the remove-and-add cycle](#5-link-identity-uniqueness-and-the-remove-and-add-cycle)
6. [Ownership](#6-ownership)
7. [Revisions and attribution](#7-revisions-and-attribution)
8. [Reads and selection](#8-reads-and-selection)
9. [Comments and other native records](#9-comments-and-other-native-records)
10. [Conformance rows for preview-1](#10-conformance-rows-for-preview-1)
11. [Carried open items](#11-carried-open-items)
12. [Companions and obsolescence](#12-companions-and-obsolescence)

## 1. Selection and boundary

`issue` is an abstract Bead Type; `task`, `bug` and the other work
classifications are concrete Types refining it. `dependency` is an abstract Link
Type; `blocks`, `parent-child` and the other relationship classifications are
concrete Types refining it. Neither base admits direct instance affiliation. A
native classification value is carried only as the record's `type` affiliation;
`issue_type` and `dep_type` are not properties, and a record carrying either is
refused.

The package is carried under Core alone. A provider serving these Types affiliates
every record with the exact identities of §2 and MAY, but need not, advertise
Types1. The descriptors are written in the Types descriptor language so that a
provider which later advertises Types1 serves them unchanged as definition
Beads; until then they are published text, and Core's rule that an affiliation
carrier requires no definition retrieval applies. A provider that does not
advertise Types1 still enforces every constraint this document states, as its
native Scope policy under Core's [native Scope policy](../../profiles/core/core.md#native-scope-policy);
Types §1 already admits a fixed supplied catalog enforced without advertising the
profile.

The native tracker's scheduler, lifecycle commands and configuration remain the
behavioral baseline. This document does not restate readiness, blocking,
claiming or closure; those are operations and ride the Callables profile. It
states what a record means, what a Link means, and what a provider refuses.

## 2. Identities

The shared protocol identities are assigned under
`https://github.com/gastownhall/bdp/types/issue/` for Bead Types and
`https://github.com/gastownhall/bdp/types/dependency/` for Link Types, following
the intrinsic publication's namespace rule. Each identity has one exact
publication revision for this edition, spelled `NAME-preview-1`. Every suffix in
the tables below abbreviates its namespace. URI spelling creates no live Resource
service or fetch obligation.

| Native classification | Bead Type identity | Exact revision | Type of the definition | Refines |
| --- | --- | --- | --- | --- |
| — (abstract) | `issue/issue` | `issue-preview-1` | `type-system/bead-type` | none |
| `task` (native default) | `issue/task` | `task-preview-1` | `type-system/bead-type` | `issue/issue` at `issue-preview-1` |
| `bug` | `issue/bug` | `bug-preview-1` | same | same |
| `feature` | `issue/feature` | `feature-preview-1` | same | same |
| `epic` | `issue/epic` | `epic-preview-1` | same | same |
| `chore` | `issue/chore` | `chore-preview-1` | same | same |
| `decision` | `issue/decision` | `decision-preview-1` | same | same |
| `message` | `issue/message` | `message-preview-1` | same | same |
| `molecule` | `issue/molecule` | `molecule-preview-1` | same | same |
| `gate` | `issue/gate` | `gate-preview-1` | same | same |
| `spike` | `issue/spike` | `spike-preview-1` | same | same |
| `story` | `issue/story` | `story-preview-1` | same | same |
| `milestone` | `issue/milestone` | `milestone-preview-1` | same | same |
| `event` (internal) | `issue/event` | `event-preview-1` | same | same |

| Native kind | Link Type identity | Exact revision | Type of the definition | Refines |
| --- | --- | --- | --- | --- |
| — (abstract) | `dependency/dependency` | `dependency-preview-1` | `type-system/link-type` | none |
| `blocks` (native default) | `dependency/blocks` | `blocks-preview-1` | `type-system/link-type` | `dependency/dependency` at `dependency-preview-1` |
| `parent-child` | `dependency/parent-child` | `parent-child-preview-1` | same | same |
| `conditional-blocks` | `dependency/conditional-blocks` | `conditional-blocks-preview-1` | same | same |
| `waits-for` | `dependency/waits-for` | `waits-for-preview-1` | same | same |
| `related` | `dependency/related` | `related-preview-1` | same | same |
| `discovered-from` | `dependency/discovered-from` | `discovered-from-preview-1` | same | same |
| `replies-to` | `dependency/replies-to` | `replies-to-preview-1` | same | same |
| `relates-to` | `dependency/relates-to` | `relates-to-preview-1` | same | same |
| `duplicates` | `dependency/duplicates` | `duplicates-preview-1` | same | same |
| `supersedes` | `dependency/supersedes` | `supersedes-preview-1` | same | same |
| `authored-by` | `dependency/authored-by` | `authored-by-preview-1` | same | same |
| `assigned-to` | `dependency/assigned-to` | `assigned-to-preview-1` | same | same |
| `approved-by` | `dependency/approved-by` | `approved-by-preview-1` | same | same |
| `attests` | `dependency/attests` | `attests-preview-1` | same | same |
| `tracks` | `dependency/tracks` | `tracks-preview-1` | same | same |
| `until` | `dependency/until` | `until-preview-1` | same | same |
| `caused-by` | `dependency/caused-by` | `caused-by-preview-1` | same | same |
| `validates` | `dependency/validates` | `validates-preview-1` | same | same |
| `delegated-from` | `dependency/delegated-from` | `delegated-from-preview-1` | same | same |

The mapping from a native classification to its identity is one fixed table in
the provider. Authoring conveniences of the native CLI (`enhancement` and `feat`
for `feature`, for example) are normalized before the table is consulted and
create no identity.

**Configured custom classifications.** A native tracker admits additional Issue
classifications and relationship kinds by configuration. Each configured name is
given a Scope-local identity allocated by the provider as a canonical Bead identity
of that Scope, conventionally `<scope>/types/issue/NAME` or
`<scope>/types/dependency/NAME`, which the provider reserves under Core's lifetime
non-reuse rule whether or not it serves a definition Bead there. A custom identity
is never derived from a shared-namespace suffix, never guessed from a label, and
never silently mapped to the abstract base. A record whose native classification
has no identity in the provider's table is not served; the provider repairs its
table or refuses the read with `temporarily-unavailable` rather than inventing an
identity. Removing a configuration entry does not release its identity.

## 3. Issue Bead Types

### 3.1 The `issue` definition

The definition is [`descriptors/issue.md`](descriptors/issue.md), an authoring-mode
document in the Type-definition notation; [`descriptors/task.md`](descriptors/task.md)
is the pattern every concrete child follows. In summary:

| Descriptor field | `issue` | each concrete child |
| --- | --- | --- |
| `description` | "A unit of work in an issue tracker." | the native classification's meaning |
| `abstract` | `true` | absent (concrete) |
| Properties schema | `issue-properties.md` (§3.2) | none of its own; the base schema is the whole structural contract |
| Property access | the map of §3.3 | inherited |
| `incoming`, `outgoing`, `ownsOutgoing` | absent (§6) | absent |
| Refines | none | one declaration to `issue` at `issue-preview-1`, empty properties |

### 3.2 Properties

The properties object of every Issue record is an open object. The schema
document [`issue-properties.md`](issue-properties.md) states the common
structural checks; the provider's native validators remain in force for
everything the schema does not express, and refuse with `validation-failed`
carrying the field name in its diagnostic. As it reads:

Other fields: allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "acceptance_criteria" | text | no | — | "Existing acceptance text." |
| "assignee" | text | no | — | "The actor currently holding the Issue, if any; empty and unset follow native assignment behavior; at most 255 characters." |
| "close_reason" | text | no | — | "Why the Issue was closed; set by the close operation." |
| "closed_at" | instant OR null | no | — | "When the Issue was closed; required by native validation exactly when status is the literal closed." |
| "created_at" | instant | no | — | "Creation time, set by the provider." |
| "created_by" | text | no | — | "Native creator string; not a BDP attribution." |
| "defer_until" | instant OR null | no | — | "Scheduling exclusion until this time; not deletion." |
| "description" | text | no | — | "Main work description." |
| "design" | text | no | — | "Existing design text." |
| "due_at" | instant OR null | no | — | "Intended completion time; not a command to close." |
| "estimated_minutes" | integer OR null | no | — | "Optional nonnegative estimate; zero is a real estimate and null clears it." |
| "external_ref" | text OR null | no | — | "Literal integration reference; neither a URI nor a BDP Reference by itself." |
| "labels" | array of text | no | — | "Distinct nonempty label strings on the record; edits are ordinary property patches and version the record." |
| "notes" | text | no | — | "Existing notes text; append and replacement are distinct native operations." |
| "owner" | text | no | — | "Human owner; not the revision writer or the authenticated principal; at most 255 characters." |
| "priority" | integer | yes | — | "0 to 4; 0 is P0, never absence." |
| "spec_id" | text | no | — | "Literal specification reference; no URI coercion." |
| "started_at" | instant OR null | no | — | "When work started; set by the claim operation." |
| "status" | text | yes | — | "Nonempty workflow status: a built-in value or a configured custom value, admitted by the provider's configuration, never by this schema." |
| "title" | text | yes | — | "Nonempty title; the provider's native byte bound is a native admission rule." |
| "updated_at" | instant | no | — | "Last change time, set by the provider on every committed change." |

The schema additionally refuses a member named `issue_type`, so that no second
classification authority can enter the record.

Rules the schema does not carry:

- **Identity.** A record's native identifier (`bd-1a2b`, for example) is its
  local Resource ID, one or more safe segments under Core's grammar, so the
  canonical URL is `<scope>/bd-1a2b`; it is not a property. A native identifier
  outside that grammar cannot be served, and the shared CLI reserves `@` for
  revision syntax; the provider's identifier policy is bound to both for any
  Scope it exposes over BDP. (**preview**)
- **Title.** Nonempty; the provider's native byte bound (500 bytes of UTF-8 in
  the reference tracker) is a native admission rule, refused as
  `validation-failed`, not a `maxLength`.
- **Status.** An open string. The built-in values are `open`, `in_progress`,
  `blocked`, `deferred`, `closed`, `pinned` and `hooked`; a configured custom
  status is admitted by the provider's configuration at admission time and is
  not expressible in the immutable schema. `closed_at` is required exactly when
  `status` is the literal `closed`, by native validation. No closed enumeration
  is published; the policy-versioning question stays open (§11). (**preview**)
- **Priority.** `0` is P0, never absence. Omitted on creation, it is refused:
  this package publishes no creation defaults, and the client supplies `status`
  and `priority` (the native CLI's own defaults of `open` and its configured
  default priority). (**preview**)
- **Labels.** An array of distinct nonempty strings on the record. Label edits
  are ordinary `updateBead` property patches and version the record (§7).
- **Timestamps.** Every instant is an RFC 3339 date-time with uppercase `T` and `Z`.
- **Unknown members.** Additional properties are admitted on reads so that every
  durable native field survives the projection. Which additional members a
  provider admits on writes is its native write boundary, refused as
  `validation-failed`; this package does not promise that an arbitrary new
  property persists.

### 3.3 Property access

`propertyAccess` designates the members a client may not author:

| Pointer | Mode | Reason |
| --- | --- | --- |
| `/created_at`, `/created_by`, `/updated_at` | `service-managed` | Set by the provider at creation and on every committed change |
| `/started_at`, `/closed_at`, `/close_reason` | `service-managed` | Set by the lifecycle operations (claim, close, reopen), which are Callables, not by property patches |
| `/arrival_seq`, `/closed_by_session`, `/compaction_level`, `/compacted_at`, `/compacted_at_commit`, `/original_size` | `service-managed` | Native bookkeeping carried on reads |
| every other member | `writable` | Ordinary authored data, subject to the native write boundary |

A patch that touches a `service-managed` member is refused with
`validation-failed`. `status` is `writable`: a direct status edit over
`updateBead` is admitted and is validated natively (a direct edit to `closed`
without `closed_at` is refused; the close operation is the Callable that sets
both). Whether direct status edits remain admitted after the preview is an open
item (§11).

### 3.4 Native fields that are not properties

| Native field group | Treatment in preview-1 |
| --- | --- |
| `metadata` (application JSON) | The record's common `metadata` member, never `properties.metadata` |
| `dependencies`, `comments`, counts, `parent`, epic progress | Relation projections and view results; dependencies are Links (§4), comments are not modeled (§9), the rest are served by the tracker's detail Callable |
| `lease_expires_at`, `heartbeat_at`, `lease_granted_node`, `is_blocked` | Operational observations. They are **not** properties and do not appear in Bead records, because a heartbeat changes them without changing the record's state and Core binds a revision to the complete record. They are served by the tracker's Callables (the detail read, claim and heartbeat results). Their portable placement is an open item (§11). (**preview**) |
| `ephemeral`, `no_history`, `storage_class`, `wisp_type`, `pinned`, `is_template`, `bonded_from`, `mol_type`, `work_type`, `await_type`, `await_id`, `timeout`, `waiters`, `source_system`, `sender`, `source_formula`, `source_location`, `event_kind`, `actor`, `target`, `payload` | Carried as additional properties when the native record has them, with their native meanings; none is reinterpreted, promoted to a Type or made a BDP attribution. `actor` and `target` here are the event-shaped Issue's own members, not the revision actor or a Link endpoint |

## 4. Dependency Link Types

### 4.1 The `dependency` definition

The definition is [`descriptors/dependency.md`](descriptors/dependency.md);
[`descriptors/blocks.md`](descriptors/blocks.md) is the pattern every concrete
child follows. In summary:

| Descriptor field | `dependency` | each concrete child |
| --- | --- | --- |
| `description` | "A relationship between two work records." | the native kind's meaning |
| `abstract` | `true` | absent (concrete) |
| Properties schema | `dependency-properties.md` (§4.2) | none of its own |
| Endpoint pairs | two alternatives: a same-Scope Bead conforming to `issue` to another such Bead; or such a Bead to an opaque external Resource | the same two |
| Link constraints | `unique: true`, `allowSelf: false`; `acyclic`, `sourceMax`, `targetMax` absent (§4.4) | inherited |
| Refines | none | one declaration to `dependency` at `dependency-preview-1`, empty properties |

The source is always a live in-Scope Bead conforming to `issue`, directly or
through a concrete child; a Memory or any Issue-shaped Bead of another Type is
not eligible. The target is either such a Bead or an opaque external Resource:
the native tracker admits `external:<project>:<capability>` targets and
identifiers belonging to another repository, stores them apart, resolves them
through its external-dependency policy and reports them among blockers, so the
second alternative serves those rows as Links whose `target` is an opaque
absolute URI. The `external:` form is already such a URI; the spelling of a
cross-repository identifier as a URI is the provider's declaration (**preview**).
`parent-child` refuses an external target, as the native path does. Pinned
endpoints are outside preview-1 and are refused as `validation-failed`.
(**preview**)

### 4.2 Properties and metadata

The schema document is [`dependency-properties.md`](dependency-properties.md).
As it reads:

Other fields: allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "created_at" | instant | no | — | "Row creation time, set by the provider." |
| "created_by" | text | no | — | "Native creator string; not a BDP attribution." |
| "thread_id" | text | no | — | "Conversation grouping field carried from the native row; writable." |

The schema additionally refuses a member named `dep_type`. `created_at` and
`created_by` are `service-managed`; `thread_id` is `writable`.

The native edge metadata is carried as the Link's common `metadata` member: when
the native value is a JSON object it is served as that object, and a write of
`metadata` or `metadataChange` is stored natively. A native value that is not a
JSON object (the reference tracker stores metadata as a string and does not
validate it) is served as `{}`, and the provider keeps the native bytes until a
write replaces them; it does not refuse the read. (**preview**) The codified
`waits-for` members `gate`, `spawner_id` and `also_blocks` stay in metadata in
preview-1; their promotion to declared properties of `waits-for` is carried as an
open item (§11).

### 4.3 Direction

A native row `(issue_id, depends_on_id, kind)` is served as a Link whose `source`
is the Bead of `issue_id` and whose `target` is the Bead of `depends_on_id`,
affiliated with the kind's identity. For `blocks`, **A→B means A depends on B: B
blocks A**. For `parent-child`, the source is the child and the target the
parent. A client convenience that reverses operands (`--blocks`) is resolved by
the client; the stored convention never reverses.

### 4.4 Graph constraints and behavior

Pair uniqueness is family-wide: at most one live Link of any Type conforming to
`dependency` exists for an ordered source/target pair, so a pair holding `blocks`
refuses `parent-child` until the first Link is removed. A→B and B→A are different
pairs. The constraint is validated at commit under Write; a violation is refused
as `validation-failed` with a diagnostic naming the occupying Link. Types §5.6
names no refusal code of its own. (**preview**)

Self-Links are refused.

No `acyclic` constraint is declared on the base or on any child, because the
native rule is a combined check over several kinds (`blocks`,
`conditional-blocks` and `parent-child` in the reference tracker) which the
per-family promise cannot express. The provider enforces its combined cycle and
hierarchy rules natively at commit and refuses with `validation-failed`, whose
diagnostic carries `reason: "dependency-cycle"`. (**preview**)

The behavioral differences between children are the native ones and are stated
here only so that no reader infers them from a spelling: `blocks`,
`parent-child`, `conditional-blocks` and `waits-for` affect ready work; `blocks`,
`conditional-blocks` and `waits-for` are blocking edges; `parent-child` is
structural. Conformance to `dependency` does not make a child a blocker, and
creating a `supersedes` Link closes nothing. Readiness and blocking are
computed by the tracker and exposed through its Callables.

## 5. Link identity, uniqueness and the remove-and-add cycle

A Dependency Link's canonical identity is **opaque and is read from records**;
clients never compute it. Removing a Link consumes its identity under Write's
lifetime non-reuse rule, and the pair's next Link has a new identity with its
own lineage. When `createLink` omits `id`, the provider allocates one opaque
segment, as Write requires. A provider MAY derive that segment from the ordered
pair and a generation, for example as a name-based hash, where the generation
is 1 for the pair's first Link in the Scope's lifetime and advances each time
the pair acquires a Link again after a removal. The derivation is the
provider's own and means nothing to a client. A provider MAY refuse a supplied
`id` under its native allocation policy, as Write permits; a supplied identity
ever committed is `identity-taken`. (**preview**)

A removed Link does not return at its old identity because Write's historical
update and same-identity recovery cover Beads only in their first edition.
[Extending them to Links](https://github.com/gastownhall/bdp/issues/363) is open
(§11). Selecting it can change how a provider derives an identity without
changing the wire, because clients do not parse one.

The native remove-and-add idiom carries over unchanged. The native way to
change a relationship's metadata is to remove the row and add it again with the
same endpoints and new metadata; over BDP that is the removal of the live Link
followed by the creation of a new one with the new metadata, whether a client
spells it as `remove-dependency` and `add-dependencies` or as `deleteLink` and
`createLink`.

`add-dependencies`, in the [Issue and Dependency Callables](callables.md), is an
**upsert over the live Link**: a pair with no live Link gets a new Link with the
given Type and metadata; a live Link of the same Type has its metadata and
thread updated in place as a new revision, or nothing is written when nothing
differs; a live Link of another Type fails with `callable-error` and the reason
`dependency-exists`, as the native path refuses it. A relationship's kind changes with `updateLink`
carrying `type`, validated against the pair, cycle and hierarchy rules as a
whole, or by remove and add. A BDP-aware client MAY use `createLink` (refused on
an occupied pair by pair uniqueness), `updateLink` with `metadata` or
`metadataChange`, and `deleteLink` directly; the provider translates neither
path into the other.

To remove a relationship given only its endpoints, a client uses
`remove-dependency`, or reads the one live Link of the pair,
`GET <source>?view=links&direction=outbound&target=<target>` (at most one item,
by pair uniqueness), and deletes it by its `id`.

Deleting an Issue Bead with live incident Dependency Links is refused with
`incident-links-exist`, as Write requires; the native cascade delete is the
`delete-issues` Callable, which removes the Links and the Bead in one native
transaction.

A native local rename of an Issue identifier, which no HTTP surface offers,
would change every pair-derived identity it touches, which Core forbids; a
Scope exposed over BDP does not rename identifiers. This is a product note, not
a protocol rule.

## 6. Ownership

Preview-1 declares no ownership: `issue` carries no `ownsOutgoing`, Issue records
carry no `ownedLinks` member, and a Dependency mutation versions neither
endpoint. The native tracker's practice of touching the source Issue's
`updated_at` on a relationship change is not carried as a Bead revision.
(**preview**) A later edition may declare that `issue` owns its outgoing
`dependency` family, with the capture, revision and authorization consequences
Core defines; the October draft's reasoning for that design is retained in
history.

## 7. Revisions and attribution

Every committed change to an Issue or Dependency record's affiliation, properties
or metadata mints a new opaque revision, as Core requires. A provider whose
native row version does not advance on some writes (label-only edits in the
reference tracker) MUST mint the revision itself; the preview does not relax
Core's revision coverage. A revision is an opaque token compared for equality;
a provider MAY spell it from a native counter but makes no promise about the
spelling. `expectedRevision` guards every `updateBead`, `deleteBead`,
`updateLink` and `deleteLink` as Write defines.

The native tracker's caller-asserted `actor` is carried as
`revisionProvenance.actor` with `basis: "writer-supplied"` and the actor string
as `id`, unchanged and unnamespaced; it is data, not evidence, exactly as Core
says. `created_by` and `closed_by_session` stay native properties; neither is a
BDP attribution.

## 8. Reads and selection

Point reads, incident Link views and the fixed inventories serve these records
with no addition. The inventories' `type` parameter selects one exact
classification. The `conformsTo` parameter with `issue/issue` or
`dependency/dependency` selects the whole family; a provider that enforces this
fixed catalog natively supports `conformsTo` for these two identities and their
children without advertising Types1, because the family is its own fixed
configuration, not an interpreted definition graph. (**preview**)

The bounded Selector carries the structural filters of a native list: `status`,
exact `type`, `assignee`, `priority` bounds and timestamp bounds, by comparison
on singular paths. It does not carry label membership, text search, relation
filters (`parent`) or ordering by priority, and no inventory read computes a
native list's per-item counts. A native list command that needs any of those
rides the tracker's list Callable; a generic BDP client uses the inventory and
the Selector. Both are the same records.

## 9. Comments and other native records

Comments are not modeled in preview-1. A comment is neither a Bead nor a Link
nor a property; it is read and added through the tracker's Callables, and an
Issue record does not embed its comments. Modeling comments as Beads with a
`replies-to`-style Link is an open item (§11). (**preview**)

Memories, settings and the events journal of the native tracker are outside
this package.

## 10. Conformance rows for preview-1

A provider claiming this package at preview-1 satisfies the following, measured
against a running Scope:

| Row | Expectation |
| --- | --- |
| IT-1 | Every Issue record's `type` is one identity of §2's Bead table; no `issue_type` member; `metadata` is an object |
| IT-2 | Every Dependency record's `type` is one identity of §2's Link table; no `dep_type` member; `source` is an in-Scope Bead URL and `target` an in-Scope Bead URL or an opaque external URI |
| IT-3 | `createBead` with `type` of `issue/issue` or `dependency/dependency` as a Link Type is refused as `validation-failed` (abstract) |
| IT-4 | `createBead` with `type` of `issue/task` and properties lacking `title`, `status` or `priority` is refused as `validation-failed` |
| IT-5 | A property patch to a `service-managed` member is refused as `validation-failed` |
| IT-6 | `createLink` whose endpoints are the same Bead is refused |
| IT-7 | `createLink` on an occupied ordered pair, with any Dependency Type, is refused; the diagnostic names the occupying Link |
| IT-8 | `createLink` for `blocks` A→B serves a Link with `source` A and `target` B |
| IT-9 | `deleteLink` of a pair's live Link then `createLink` (or `add-dependencies`) with the same endpoints, Type and new metadata succeeds and serves a Link with a new `id`; a read of the first `id` answers `resource-not-found`; `createLink` supplying the first `id` is refused as `identity-taken` |
| IT-10 | `updateLink` with `metadataChange` on a live Link keeps its `id` and serves a new `revision` |
| IT-11 | `updateBead` that changes only `labels` serves a new `revision` |
| IT-12 | `deleteBead` on an Issue with a live incident Link is refused as `incident-links-exist` |
| IT-13 | The Bead inventory with `conformsTo` of `issue/issue` returns every Issue record of every concrete classification; with `type` of `issue/task` only tasks |
| IT-14 | Issue records never carry `lease_expires_at`, `heartbeat_at`, `lease_granted_node` or `is_blocked` |
| IT-15 | A Dependency whose native target is `external:<project>:<capability>` is served as a Link whose `target` is that opaque URI, and appears in `?view=links&direction=outbound` of its source |

## 11. Carried open items

These are deliberately not selected in preview-1 and are indexed here so that no
reader infers a rule from their absence:

- P01, policy-dependent meaning: how configured status categories and custom
  classifications relate to immutable Type revisions, and whether direct status
  edits over `updateBead` remain admitted beside the lifecycle Callables.
- Operational observations: the portable placement of lease, heartbeat and
  blocked-state fields (a separate view, explicit observation members, or
  revisions).
- Codified metadata: promotion of `waits-for`'s `gate`, `spawner_id` and
  `also_blocks` to declared properties.
- Ownership: whether `issue` owns its outgoing `dependency` family.
- Endpoints: pinned endpoints for workflow Links, what a pin means for
  readiness, and the URI spelling of cross-repository identifiers as opaque
  targets.
- Link recovery ([issue 363](https://github.com/gastownhall/bdp/issues/363)):
  extending Write's historical update and same-identity recovery to Links, so
  that a removed Dependency can return as a later version of the same identity
  and a provider need not derive a new one.
- Properties replacement: the boundary between whole-properties replacement and
  the native writable projection.
- Comments as Beads; the native deterministic row identifier of a Dependency,
  if it is ever to be carried.
- Custom classification lifecycle: serving definition Beads for configured names,
  and Types1 activation for this package.

## 12. Companions and obsolescence

The package's companions, all beside this document: `descriptors/issue.md`,
`descriptors/task.md`, `descriptors/dependency.md`, `descriptors/blocks.md` and
one document per remaining concrete child, in the Type-definition notation
(authoring mode),
`issue-properties.md` and `dependency-properties.md` in the Markdown JSON Schema
notation, and [`callables.md`](callables.md), the operations half of the
package. Being descriptor companions, the properties schemas are not members of
a protocol bundle; the Types profile's intrinsic companions set the pattern.

This edition replaces the draft "Issue and Dependency Types" of October 14, 2026
in full; that draft's Preview 2 evidence, native field audit, worked cases and
the lessons for the shared Type system are retained under the history archive
and are cited as provenance, never as rules. Its two JSON schema files are
replaced by the two schema documents above. The informative `definitions.json`
example in the Types profile, which carries task/issue and blocks/dependency
with placeholder identities, is to be realigned to §2's identities or marked
historical.
