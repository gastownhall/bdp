---
status: editorial-draft
intended-status: type-package-operations
version: "preview-1"
---

# Beads Protocol — Issue and Dependency Callables

Editorial draft preview-1 · November 4, 2026 · generated from the v0 HTTP contract of OSS beads at 6d713a74 under the conventions in §2

This document is the operations half of the [Issue and Dependency Types](issue.md)
package: the named operations a tracker exposes over the [Callables](../../profiles/callables/callables.md)
profile so that its command surface runs the right way over BDP while its
implementation stays its own. Every operation below is a Callable definition Bead
bound in the Scope's callable directory to a service-side implementation; the
definitions, their arguments and their results are specified here, the
implementation is the tracker's `issueops` role the extern names.

The reads a BDP client can make natively (point reads, the inventories, incident
Link views) and the six native mutations (`createBead`, `updateBead`, `deleteBead`,
`createLink`, `updateLink`, `deleteLink`) are not Callables and are not restated;
§1 lists which native tracker operations ride them instead. This is the preview-1
edition for the friends-and-family preview pin; rules marked **preview** may change
in a later edition without a compatibility promise.

## Contents

1. [Selection and boundary](#1-selection-and-boundary)
2. [Conventions](#2-conventions)
3. [Shared shapes](#3-shared-shapes)
4. [Queries](#4-queries)
5. [Batches](#5-batches)
6. [Problems and reasons](#6-problems-and-reasons)
7. [Conformance rows for preview-1](#7-conformance-rows-for-preview-1)
8. [Appendix: tracker callables outside the package](#8-appendix-tracker-callables-outside-the-package)
9. [Schemas](#9-schemas)
10. [Obsolescence](#10-obsolescence)

## 1. Selection and boundary

Thirty Issue and Dependency Callables are selected at preview depth: thirteen
CallableQuery definitions and seventeen CallableBatch definitions, named by the v0
operation identifiers so that the native client's one door maps each role to one
directory entry. A Scope serving the Issue and Dependency Types package and
advertising Callables1 lists them in its directory under these names. The
Dependency pair is both a native verb and a Callable: `createLink` and
`deleteLink` for generic clients, `addDependencies` and `removeDependency` for
the native upsert idiom by endpoints.

Native operations that are **not** Callables because Core or Write already
carries them the right way:

| Native v0 operation | BDP form |
| --- | --- |
| `getContext` | Core discovery, the capability advertisements and the callable directory |
| `createIssue` | `createBead` with the Issue Type and properties, then `createLink` for `parent_id` and each declared dependency; not one transaction until atomic batch is advertised, an exception the sprint documents |
| `updateIssue` | `updateBead` with a properties patch and `expectedRevision`; labels through the patch; `parent_id` through `createLink` and `deleteLink`; the `claim` flag through `claimIssue`; the native policy refusals (close policy on a status that crosses into done, notes overwrite, assignee transfer) apply as native invalidity |
| `listDependencies` | the Link inventory with endpoint selection, or `?view=links` on the Bead |
| `batchGetIssues` | the Bead inventory selected by identity |
| `health`, `watchEvents` | outside BDP: transport liveness and a server-sent stream |

The appendix carries the nine tracker Callables that are outside the Issue and
Dependency package (settings, memories, the events journal), specified the same way
so the native client is complete.

## 2. Conventions

- **K-1 Views over records.** Wherever v0 returned a flat native issue struct, a
  Callable returns an `issueView`: the Issue's complete Bead record exactly as Core
  serves it, beside the operational observations (`is_blocked`, the lease) that the
  Types package keeps out of the record, and the cardinalities the native listings
  carry. A client reconstructs the native struct from the record's properties and the
  observations; a generic client reads the record. Neighbors are `neighborView`,
  the Link record plus the far Issue's view.
- **K-2 Names.** Argument and result member names keep their native spellings
  (`has_more`, `dependency_count`), because they are the tracker's application
  vocabulary; members of Bead and Link records keep Core's spellings. Identities of
  Issues in results are absolute canonical URLs (`issueUrl`); identities in
  arguments are `locator`s, resolved as Write resolves a mutation subject.
- **K-3 Types.** Every classification or kind argument (`type`, `exclude_type`,
  `issue_type`, `edge_from_parent`) is the absolute identity URI of a Type from the
  Issue and Dependency Types package or of a configured custom classification. The
  native shorthand aliases (`feat`, `mr`) are the client's to expand before
  invocation; the wire carries no alias.
- **K-4 The actor rides the envelope.** The caller-asserted `actor` of every v0
  mutation is not a parameter: a CallableBatch invocation carries it as
  `revisionProvenance.actor` with `basis: "writer-supplied"`, and the tracker
  refuses a batch invocation without one as `validation-failed`. `author` on
  `addComment` stays a parameter because it is content, not attribution.
- **K-5 Guards.** `expected_version` becomes `expected_revision`, the Bead's opaque
  revision token as served; a miss is Write's `revision-mismatch` and nothing is
  written. Separate `revision` members of v0 results are dropped where the result
  carries the record; `reclaimedLease.revision` stays because that result carries no
  record.
- **K-12 Link identity and the Dependency pair.** A Dependency Link's identity is
  opaque, as [Issue and Dependency Types](issue.md) §5 states. A removed identity
  stays consumed, as Core requires; `addDependencies` is an upsert over the pair's
  live Link; `removeDependency` removes it. Clients never compute the identity;
  records carry it.
- **K-6 Pagination and bounds.** `limit`, `cursor`, `has_more` and `next_cursor`
  keep their native meanings; `limit: 0` means unbounded only where v0 admitted it.
  The item caps v0 enforced (one hundred anchors, a thousand identifiers) are the
  tracker's advertised limits and refuse as `limit-exceeded`.
- **K-7 Definitions from argument schemas.** Each Callable's definition Bead is
  derived from its arguments schema: every property becomes one parameter with that
  property's schema, its `required` flag and, when the schema carries one, its
  `default`; the `description` is the Meaning cell. The invocation's `arguments`
  object is therefore exactly an instance of the arguments schema, and Callables §5
  admits it. The `result` schema of the definition is the result fragment named for
  the Callable.
- **K-8 Problems.** Each Callable maps its native refusals to Core and Write codes
  where one applies (`resource-not-found`, `validation-failed`, `revision-mismatch`,
  `identity-taken`, `incident-links-exist`, `limit-exceeded`) and otherwise to
  `callable-refused` with the `reason` tokens of §6, carrying the same extension
  members v0 carried (`assignee`, `issue_status`, `blockers`, `open_children`).
- **K-9 Destructive operations.** `sweepIssues` and `deleteIssues` erase; nothing
  they remove comes back through BDP, and Write's lifetime non-reuse of identity
  applies to every identity they consume, including identities retired with
  `retain_ids`, which afterwards answer `identity-taken` to a supplied id.
- **K-10 Brief views.** `brief` and `brief_deps` omit the free-text properties from
  the views they qualify; the Bead records inside such a view are then projections,
  not complete records, and carry no `revision` guarantee beyond equality.
  (**preview**)
- **K-11 Observations.** `heartbeatIssue` writes only the lease and mints no
  revision; its result carries the lease, not a record. A view's `observations`
  member is current at the read and may change under an unchanged `bead.revision`.

## 3. Shared shapes

The shapes below are shown as they read; the exact fragments with their residual constraints are the Schemas appendix (§9), one per shape, in the bundle `issue-callables`.


**`issueUrl`** — Absolute canonical URL of an Issue Bead, as Core spells identities in records. (ref `common:absoluteHttpUrl`)

**`typeUri`** — Absolute identity URI of an Issue or Dependency Type from the Issue and Dependency Types package, or of a configured custom classification. (ref `common:absoluteHttpUrl`)

**`locator`** — A Scope-relative local path or absolute canonical URL naming one Issue Bead, resolved as Write resolves a mutation subject; never a fuzzy or prefix match. (string, nonempty)

**`instant`** — An RFC 3339 date-time with uppercase T and Z. (ref `common:dateTime`)

**`metadataValue`** — Any JSON value, including null; typed values persist as entered.

**`issueObservations`** — Operational observations about an Issue that change without minting a revision and therefore never appear inside the Bead record: the readiness projection and the claim lease.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "heartbeat_at" | ref "#/$defs/instant" | no | — | "The last heartbeat the lease holder sent." |
| "is_blocked" | boolean | no | — | "The persisted, transitive readiness projection: true while an open blocking Dependency keeps the Issue out of the ready set." |
| "lease_expires_at" | ref "#/$defs/instant" | no | — | "Expiry of the current claim's lease, when one is active." |
| "lease_granted_node" | text | no | — | "The replica that granted the lease; empty means unknown, treated as local." |

**`issueView`** — An Issue as a callable returns it: the complete Bead record, the operational observations beside it, and the relationship cardinalities the native listings carry. The record is the one Core serves at the Issue's URL.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bead" | ref "common:beadRecord" | yes | — | "The Issue's complete Bead record: identity, Type affiliation, revision, properties, metadata." |
| "comment_count" | integer | yes | — | "Number of comments on the Issue." |
| "comments_omitted" | boolean | no | — | "True when comment_count is nonzero and the view carries no comments." |
| "dependency_count" | integer | yes | — | "Number of Issues this one depends on." |
| "dependent_count" | integer | yes | — | "Number of Issues that depend on this one." |
| "observations" | ref "#/$defs/issueObservations" | yes | — | "Lease and readiness observations; an empty object when none apply." |
| "parent" | ref "#/$defs/issueUrl" | no | — | "The parent Issue, computed from the parent-child Dependency, when there is one." |

**`neighborView`** — An Issue on the far end of one Dependency, with the Link that leads to it.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue" | ref "#/$defs/issueView" | yes | — | "The neighbor." |
| "link" | ref "common:linkRecord" | yes | — | "The Dependency Link record whose Type says why the neighbor is related." |

**`commentRecord`** — One comment on an Issue. Comments are not Beads in preview-1.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "author" | text | yes | — | "Caller-asserted author." |
| "created_at" | ref "#/$defs/instant" | yes | — | "Stored creation time." |
| "id" | text | yes | — | "The comment's native identifier." |
| "issue" | ref "#/$defs/issueUrl" | yes | — | "The Issue the comment belongs to." |
| "text" | text | yes | — | "The comment body, verbatim." |

**`gateRef`** — One gate actively blocking an Issue.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/issueUrl" | yes | — | "The gate Issue." |
| "reason" | text | no | — | "Why the gate blocks, in the provider's words." |
| "type" | ref "#/$defs/typeUri" | yes | — | "The Dependency Type of the edge that reaches the gate." |

**`issueDetails`** — The detail view behind the native show command: an issueView plus its neighbors, comments, gates and epic progress.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "comments" | array of (ref "#/$defs/commentRecord") | no | — | "The comment bodies; present only when include_comments was set." |
| "dependencies" | array of (ref "#/$defs/neighborView") | yes | — | "Issues this one depends on, each with its Link; reduced to identity fields when brief_deps was set." |
| "dependents" | array of (ref "#/$defs/neighborView") | no | — | "Issues that depend on this one; present only when include_dependents was set." |
| "epic_closeable" | boolean | no | — | "For an epic, whether every child is closed." |
| "epic_closed_children" | integer | no | — | "For an epic, its closed child count." |
| "epic_total_children" | integer | no | — | "For an epic, its child count." |
| "gated_by" | array of (ref "#/$defs/gateRef") | no | — | "The gates actively blocking this Issue." |
| "issue" | ref "#/$defs/issueView" | yes | — | "The Issue itself." |
| "unresolvable_dependencies" | integer | no | — | "Outgoing edges whose far end has no record in this Scope." |
| "unresolvable_dependents" | integer | no | — | "Incoming edges whose far end has no record in this Scope; present only with include_dependents." |

**`blockedIssueView`** — An Issue the native blocked listing names, with its blockers.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "blocked_by" | array of (ref "#/$defs/issueUrl") | yes | — | "The Issues named as blockers: active blocking targets, else the parent; external references appear as opaque URIs." |
| "blocked_by_count" | integer | yes | — | "The length of blocked_by." |
| "issue" | ref "#/$defs/issueView" | yes | — | "The blocked Issue." |

**`treeNode`** — One node of a walked Dependency tree: the Issue and where the walk reached it. The tree is flat; depth and parent rebuild it in depth-first pre-order.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "deduped" | boolean | no | — | "True on a stub recording only the edge into an Issue already expanded earlier in the answer." |
| "depth" | integer | yes | — | "Distance from the root; the root is 0." |
| "edge_from_parent" | ref "#/$defs/typeUri" | no | — | "The Dependency Type of the edge that led here; absent on the root." |
| "issue" | ref "#/$defs/issueView" | yes | — | "The node." |
| "parent" | ref "#/$defs/issueUrl" | no | — | "The node this one was reached from; absent on the root." |
| "truncated" | boolean | yes | — | "Always false in preview-1: a node beyond max_depth is absent, never flagged." |

**`bondRef`** — A constituent of a compound molecule.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bond_point" | text | no | — | "Where the bond attaches." |
| "bond_type" | text | yes | — | "The bond kind." |
| "source_id" | ref "#/$defs/issueUrl" | yes | — | "The constituent." |

**`dependencyEdge`** — One directed Dependency as a request names it: source, target and Type.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "source" | ref "#/$defs/locator" | yes | — | "The depending Issue." |
| "target" | ref "#/$defs/locator" | yes | — | "The Issue depended upon; an opaque external URI is admitted where the provider admits external references." |
| "type" | ref "#/$defs/typeUri" | yes | — | "The Dependency Type." |

**`applyRef`** — Names one Issue inside an applyBatch invocation: either a locator of an existing Issue or the key a create item earlier in the same invocation gave itself. Exactly one member is set.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | no | — | "The key of a create item in this invocation." |
| "locator" | ref "#/$defs/locator" | no | — | "An existing Issue." |


The following shapes are projected from the v0 contract under §2.

**`statistics`** — Workspace summary counts. Two of them are DEPENDENCY-AWARE and two are structurally always zero; both facts are stated on the properties themselves, because every number here is the same JSON type and nothing else on the wire […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "average_lead_time_hours" | number | yes | — | "ALWAYS 0, for the reason above." |
| "blocked_issues" | integer OR null | yes | — | "Rows the dependency graph blocks — the transitive is_blocked flag, NOT the count of rows whose status is `blocked`. An open row with an unfinished blocker is counted […]; null clears it." |
| "closed_issues" | integer | yes | — | — |
| "deferred_issues" | integer | yes | — | — |
| "epics_eligible_for_closure" | integer | yes | — | "ALWAYS 0. No implementation computes it, on any backend or either surface. It is documented rather than dropped because this schema is pinned to the struct both […]" |
| "gate_issues" | integer | no | — | "Gate rows, which the default `bd list` suppresses on account of what they are rather than on any filter the caller passed. ALREADY INCLUDED in `total_issues`, which […]" |
| "in_progress_issues" | integer | yes | — | — |
| "open_issues" | integer | yes | — | — |
| "pinned_issues" | integer | yes | — | "Rows carrying the pinned flag, overlapping every status bucket. Always 0 when `assignee` is set: that answer tallies the five statuses and nothing else." |
| "ready_issues" | integer OR null | yes | — | "ARITHMETIC, not a query: `open_issues` minus `blocked_issues`, clamped at zero. It is NOT the cardinality of `GET /v0/beads/ready`, which applies type exclusions, the […]; null clears it." |
| "template_issues" | integer | no | — | "Template rows, suppressed by the default `bd list` on the same terms as `gate_issues` and likewise already counted in `total_issues`. Do not sum the two: a row can be […]" |
| "total_issues" | integer | yes | — | "Every row in the workspace-wide answer's scan, INCLUDING closed and pinned ones. The status counts below do not sum to it: a row whose status is none of the four […]" |

**`cycle`** — One circular blocking dependency: its members in EDGE ORDER, so `members[i]` blocks on `members[i+1]` and the last member blocks on the first. The closing edge is implied and is not repeated as a final member. The rotation is canonical […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "members" | array of (ref "#/$defs/cycleMember") | yes | — | "The nodes, in edge order, starting at the lowest id. Never empty." |
| "partial" | boolean | yes | — | "True when at least one member has no `issue`. It is always present, including when false: a consumer must be able to read \\"this path is complete\\" from the answer […]" |

**`cycleMember`** — One node on a dependency cycle. `id` is always present, and its presence is what proves the node is on the cycle. `issue` is the row behind it, and is ABSENT — never null — when this workspace holds no record for that id: a target in […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/issueUrl" | yes | — | — |
| "issue" | ref "#/$defs/issueView" | no | — | — |

**`edgeCount`** — One anchor's edge cardinality, or the report that it is not there.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "count" | integer | yes | — | "How many stored edges match, in the requested direction, after the type and status filters. Never negative. It SPANS BOTH DEPENDENCY PLANES and is a SUM over them […]" |
| "id" | ref "#/$defs/issueUrl" | yes | — | "The anchor, spelled exactly as the request spelled it. It is not re-canonicalized: there is no fuzzy, prefix or substring resolution on this surface, so what comes […]" |
| "missing" | boolean | yes | — | "True when no issue and no wisp carries this id. ALWAYS PRESENT, including as `false`. It is the member that keeps this from being a question a caller cannot tell it […]" |

**`blockingAnnotation`** — One issue's derived blocking decoration. `blocked_by` and `blocks` are ASCENDING BY ID with repeats collapsed, and both are always present — an empty array, never null and never absent, so a client reads "nothing blocks this" from the […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "blocked_by" | array of (ref "#/$defs/issueUrl") | yes | — | "The OPEN issues this one is blocked by: the targets of its `blocks` edges whose own status is not closed." |
| "blocks" | array of (ref "#/$defs/issueUrl") | yes | — | "The issues this one blocks. Empty when this issue is itself closed, which is the same rule `blocked_by` applies from the other end." |
| "id" | ref "#/$defs/issueUrl" | yes | — | "The annotated id, spelled exactly as the request spelled it." |
| "is_blocked" | boolean | no | — | "The issue's stored, transitive is_blocked flag — present only when the request carried `is_blocked=true` (capability `dependencies.blocking.isBlocked`) and the id […]" |
| "parent" | ref "#/$defs/issueUrl" | no | — | "This issue's parent id. AT MOST ONE is reported; where an issue carries several `parent-child` edges, which one appears here is not specified. A client that needs […]" |

**`closeOutcome`** — What happened to ONE requested item. `code` IS THE DISCRIMINATOR. Present means the item REFUSED and nothing was written for it; absent means it succeeded, and `issue`, `already_closed` and `open_children` are all present. A client […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "already_closed" | boolean | no | — | "True when the issue was already closed and this item changed nothing — the idempotent re-close, spelled the way `CloseIssueResponse.already_closed` spells it. Present […]" |
| "assignee" | text | no | — | "With `not_assignee`: the issue's assignee the refusing transaction observed, exactly as `Problem.assignee` carries it for the single close. Absent on a successful […]" |
| "auto_closed_molecule" | ref "#/$defs/issueView" | no | — | — |
| "blockers" | array of (ref "#/$defs/blocker") | no | — | "With `not_closable` on the live-blocker refusal: the blockers that refused THIS item, exactly as `Problem.blockers` carries them for the single close, and optional […]" |
| "issue" | ref "#/$defs/issueView" | no | — | — |
| "issue_id" | ref "#/$defs/issueUrl" | yes | — | "The id the caller asked for, echoed verbatim so an outcome can be read without indexing back into the request." |
| "molecule_auto_close_refusal" | text | no | — | "`CloseIssueResponse.molecule_auto_close_refusal` for this item, under `issues.close.autoCloseMolecule`; `auto_closed_molecule` beside it is […]" |
| "open_children" | integer | no | — | "How many open children the transaction observed for this item. ITS MEANING FOLLOWS `code`, and both readings are the ones the single close already publishes. On a […]" |
| "reason" | text | no | — | "This item's refusal as a reason token of §6, or not-found; present means the item refused and nothing was written for it, absent means it succeeded and issue is present." |

**`blocker`** — One live blocker named by a blocked-issue refusal.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/issueUrl" | yes | — | "The blocker: a local issue id, or the full `external:<project>:<capability>` reference." |
| "kind" | text | yes | — | "`local` for an issue this database holds, which clears when it closes; `external` for an `external:` reference, which clears when the named project ships the […]" |
| "type" | ref "#/$defs/typeUri" | no | — | "The blocking edge's dependency type (`blocks`, `waits-for`, `conditional-blocks`). ABSENT when the refusal did not report it, which is the case for an `external:` […]" |

**`batchCloseItem`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/locator" | yes | — | "Exact canonical issue id, resolved across BOTH planes. No fuzzy, prefix or substring resolution — `IssueID`'s rule. A DUPLICATE is admissible; see the operation […]" |
| "reason" | text | no | — | "Why THIS issue is closed. It is per item rather than per request because `bd close a b c --reason x --reason y --reason z` has always mapped them positionally, and […]; at most 255 characters." |

**`reclaimedLease`** — One row a lease sweep reverted.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/issueUrl" | yes | — | "The reverted issue's id." |
| "previous_owner" | text | yes | — | "The assignee the stale lease was taken from; empty when the row carried none." |
| "revision" | text | yes | — | "The row's NEW revision, minted by the revert: the optimistic-concurrency token a guarded write after the reclaim needs. A decimal string, like every `revision` on […]" |

**`sweepSkips`** — The candidates a sweep declined to delete, bucketed by WHY. They are separate counters rather than one number because they mean different things: `pinned`, `referenced`, `live_dependent` and `retention_required` are PROTECTIONS, and the […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "closed_at_or_after_cutoff" | integer | yes | — | "Candidates whose close timestamp did not satisfy `closed_before`. See `not_closed`." |
| "live_dependent" | integer | no | — | "Candidates protected by `protect_live_dependents`. Always 0 when that member is false or absent. Present only behind the `issues.sweep.liveDependents` behavior token." |
| "not_closed" | integer | yes | — | "Candidates the tier query returned that the recheck found were not closed. A NON-ZERO VALUE HERE IS A DEFENSE FIRING, not a normal outcome: the query asked for […]" |
| "pinned" | integer | yes | — | "Candidates protected by the pinned flag. No request member overrides it — a caller who wants a pinned bead gone unpins it first." |
| "referenced" | integer | yes | — | "Candidates protected by `protect_referenced`. Always 0 when that member is false or absent, so a 0 read without having asked says nothing about whether beads are cited." |
| "retention_required" | integer | no | — | "Candidates held back because their issue type is named in the workspace's `types.retained` setting and the request did not set `retain_ids`: such a bead's id is an […]" |
| "unknown_closed_at" | integer | yes | — | "Closed candidates carrying no close timestamp. See `not_closed`." |
| "unreadable" | integer | yes | — | "Rows the tier query returned as nothing at all. A defense of the same kind, on a shape rather than a value." |

**`batchCreateItem`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "acceptance_criteria" | text | no | — | — |
| "assignee" | text | no | — | "At most 255 characters." |
| "dependencies" | array of (ref "#/$defs/batchCreateDependency") | no | — | "The edges this issue is created carrying. They are written in the same transaction as the issue, so this operation never publishes an issue whose declared […]" |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "labels" | array of text | no | — | "Each at most 255 characters." |
| "priority" | integer | no | — | "0 is P0/critical. Absent means the create default, P2 (`2`), on a server advertising `issues.create.defaultPriority`; such a server never reads an absent member as […]; 0 to 4." |
| "title" | text | yes | — | "Nonempty; at most 255 characters." |
| "type" | ref "#/$defs/typeUri" | no | — | "Issue type. Spelled `issue_type` rather than `type`, matching the member `Issue` carries, and validated against the built-ins plus the workspace's configured custom […]" |

**`batchCreateDependency`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "target" | ref "#/$defs/locator" | yes | — | "The far end of the edge: an issue this workspace holds, an `external:` reference, or an id whose prefix belongs to another repository. Anything else is a `400` and […]" |
| "type" | ref "#/$defs/typeUri" | yes | — | "The edge type, from the same OPEN vocabulary `Dependency.type` carries. It is spelled `type` because that is the member an edge carries everywhere else on this surface." |

**`applyItem`** — One item of a plan: a `kind` naming what it does, plus exactly one payload member matching it. IT IS A TAGGED SINGLE-SHAPE OBJECT rather than a polymorphic one, and the spelling is deliberate. This document uses no `oneOf`, `anyOf` or […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "close" | ref "#/$defs/applyCloseItem" | no | — | — |
| "create" | ref "#/$defs/applyCreateItem" | no | — | — |
| "dep_add" | ref "#/$defs/applyDepAddItem" | no | — | — |
| "kind" | text | yes | — | "Which member below is read. A CLOSED set, unlike a dependency `type`: every value here is a verb this operation implements, and an unknown one is a request the server […]; one of create, update, close, dep_add." |
| "update" | ref "#/$defs/applyUpdateItem" | no | — | — |

**`applyCreateItem`** — Creates one issue and optionally NAMES it, so later items can reach the row without knowing an id the request has not minted yet. It publishes the whole create vocabulary rather than `POST /v0/beads/issues:batchCreate`'s narrow one, and […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "acceptance_criteria" | text | no | — | — |
| "assignee" | text | no | — | "At most 255 characters." |
| "await_id" | text | no | — | "The gate's condition identifier (a run id, a PR number, a `bead:<id>`). Opaque here; at most 255 characters, the stored column's width, and a longer value is a `400` […]; at most 255 characters." |
| "await_type" | text | no | — | "The gate's await condition type (`gh:run`, `gh:pr`, `timer`, `human`, `bead`, or a formula-defined type). Free-form: there is no vocabulary, and any issue type may […]; at most 32 characters." |
| "defer_until" | ref "#/$defs/instant" | no | — | "RFC 3339. The issue is hidden from ready work until then." |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "due_at" | ref "#/$defs/instant" | no | — | "RFC 3339." |
| "ephemeral" | boolean | no | — | "Creates the issue on the EPHEMERAL plane rather than the durable one. Per item, exactly as it is for `POST /v0/beads/issues:batchCreate`, so one request may create […]; default false." |
| "estimated_minutes" | integer | no | — | "An estimate in minutes. Absent leaves it unset." |
| "external_ref" | text | no | — | "At most 255 characters." |
| "id" | ref "#/$defs/locator" | no | — | "An explicit id for the new row, CREATE-ONLY: an id that already names a stored row is a `409` `already_exists` and the whole request is refused — never an adoption […]" |
| "key" | text | no | — | "This item's name inside the request. OPTIONAL — an item nothing refers to needs no name — and unique across the request's create items; a repeat is a `400`. It is […]; nonempty; at most 255 characters." |
| "labels" | array of text | no | — | "The complete label set the issue is created with. Authoritative, not a patch — a create has nothing to add to; each at most 255 characters." |
| "metadata" | ref "#/$defs/metadataValue" | no | — | — |
| "no_history" | boolean | no | — | "Creates the issue on the ephemeral plane WITHOUT history, and without the garbage collection an ordinary ephemeral row is eligible for. Mutually exclusive with […]; default false." |
| "notes" | text | no | — | — |
| "owner" | text | no | — | "The human owner, which is a different member from `assignee`: the assignee is who is working it now, the owner is who it is attributed to; at most 255 characters." |
| "priority" | integer | no | — | "0 is P0/critical. Absent means the create default, P2 (`2`), on a server advertising `issues.create.defaultPriority`; such a server never reads an absent member as […]; 0 to 4." |
| "sender" | text | no | — | "Who sent this, for the message-shaped rows a plan creates. Stored verbatim and interpreted by nothing on this surface; at most 255 characters." |
| "status" | text | no | — | "The status the issue is created in, from this workspace's own configured vocabulary. Absent means the workspace default; at most 255 characters." |
| "timeout" | integer | no | — | "The gate's timeout in NANOSECONDS, the encoding `Issue.timeout` reads back. A negative value is a `400` naming this member. Requires the behavior token […]; at least 0." |
| "title" | text | yes | — | "Nonempty; at most 255 characters." |
| "type" | ref "#/$defs/typeUri" | no | — | "Issue type. Spelled `issue_type` rather than `type`, matching the member `Issue` carries, and validated against the built-ins plus the workspace's configured custom […]" |
| "waiters" | array of text | no | — | "The addresses woken when the gate clears, stored as sent: duplicates are kept and nothing is trimmed, as a local create stores them. The list's JSON encoding must fit […]" |

**`applyUpdateItem`** — Patches one existing issue, under `PATCH /v0/beads/issues/{id}`'s rules. The two carry the same preconditions and the same force flags; what is this operation's alone is that its guards evaluate AS-MODIFIED — against the row as earlier […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "expected_assignee" | text | no | — | "Requires the issue's assignee to equal this value, evaluated as-modified. A match AUTHORIZES the requested `patch.assignee` transfer: this compare-and-set replaces […]; at most 255 characters." |
| "expected_revision" | text | no | — | "Requires the subject's current revision to equal this opaque token before anything is written; a miss is revision-mismatch and nothing is written." |
| "expected_status" | text | no | — | "Requires the issue's status to equal this value, evaluated AS-MODIFIED — against the row as this request has already changed it at this item's position. A miss […]; at most 255 characters." |
| "force_assignee_transfer" | boolean | no | — | "Bypasses ONLY a genuine transfer away from a live foreign in-progress owner. Reasserting the exact current assignee is idempotent and needs no force. It requires […]; default false." |
| "force_close_policy" | boolean | no | — | "Bypasses ONLY close policy — the open-children refusal and the live blocker refusal — for a `patch.status` that crosses into the workspace's done category. It has no […]; default false." |
| "force_notes_overwrite" | boolean | no | — | "Bypasses ONLY the refusal on a `patch.notes` that would replace existing non-empty notes with different non-empty content (an explicit clear is not fenced). It […]; default false." |
| "patch" | ref "#/$defs/applyPatch" | yes | — | — |
| "target" | ref "#/$defs/applyRef" | yes | — | — |

**`applyPatch`** — The fields an `update` item writes. Every member is optional and PRESENCE is the signal: a member present is written, a member absent is untouched. An empty object is a `400` — a write that writes nothing is a client bug. It mirrors […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "acceptance_criteria" | text | no | — | — |
| "append_notes" | text | no | — | "Appends to the notes rather than replacing them. Mutually exclusive with `notes`." |
| "assignee" | text | no | — | "The assignee. A transfer away from a live foreign in-progress owner is refused with `409 already_claimed` unless `force_assignee_transfer` is set or […]; at most 255 characters." |
| "await_id" | text | no | — | "Replaces the gate's condition identifier; the empty string clears it. Not nullable. At most 255 characters, the stored column's width; a longer value is a `400` […]; at most 255 characters." |
| "defer_until" | ref "#/$defs/instant" | no | — | "RFC 3339. Explicit `null` CLEARS the deferral." |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "due_at" | ref "#/$defs/instant" | no | — | "RFC 3339. Explicit `null` CLEARS the due date." |
| "estimated_minutes" | integer OR null | no | — | "Explicit `null` CLEARS the estimate; null clears it." |
| "external_ref" | text OR null | no | — | "Explicit `null` CLEARS the reference; null clears it; at most 255 characters." |
| "labels" | ref "#/$defs/labelPatch" | no | — | — |
| "metadata" | ref "#/$defs/metadataPatch" | no | — | — |
| "notes" | text | no | — | "Replaces the notes. Mutually exclusive with `append_notes`; sending both is a `400`. Replacing EXISTING non-empty notes with different non-empty content is refused […]" |
| "owner" | text | no | — | "At most 255 characters." |
| "priority" | integer | no | — | "0 to 4." |
| "status" | text | no | — | "The issue's status, from this workspace's own configured vocabulary. A STATUS THAT CROSSES INTO THE DONE CATEGORY ANSWERS TO CLOSE POLICY: the item is refused with […]; at most 255 characters." |
| "title" | text | no | — | "Must not be blank after trimming; the length bound is what the column holds; nonempty; at most 255 characters." |
| "type" | ref "#/$defs/typeUri" | no | — | "The issue type, from this workspace's own configured vocabulary. A type outside it is refused by the ROLE and reaches the client as a `400`." |
| "waiters" | array of text | no | — | "A WHOLE-VALUE replacement of the gate's waiter list; `[]` clears it. Not nullable. Stored as sent (duplicates kept: deduplicating is the caller's, as `bd gate add- […]" |

**`labelPatch`** — An ordered label edit: `replace` first, then `add`, then `remove`, so REMOVAL WINS when the same label appears in more than one member. It is the full patch rather than `IssuePatchBody.labels`' complete replacement because a plan edits […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "add" | array of text | no | — | "Labels to add after any replacement; each at most 255 characters." |
| "remove" | array of text | no | — | "Labels to remove after replacement and addition; each at most 255 characters." |
| "replace" | array of text | no | — | "The complete starting label set. An empty array CLEARS every label; omitting the member leaves the current set as the starting point; each at most 255 characters." |

**`metadataPatch`** — A metadata edit. `replace` is mutually exclusive with the other three; without it the edits apply as `merge`, then `set` in key order, then `unset`, so UNSETTING A KEY WINS over setting or merging it. Sending `replace` beside any of the […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "merge" | ref "#/$defs/metadataValue" | no | — | — |
| "replace" | ref "#/$defs/metadataValue" | no | — | — |
| "set" | object | no | — | "Individual top-level keys to write, in deterministic key order. A value present holding `null` writes JSON null; a key is removed with `unset`, never by sending a […]" |
| "unset" | array of text | no | — | "Top-level keys to remove, applied after every other edit; each at most 255 characters." |

**`applyCloseItem`** — Closes one existing issue, under `POST /v0/beads/issues/{id}:close`'s rules including first-close-wins.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "expected_revision" | text | no | — | "Requires the subject's current revision to equal this opaque token before anything is written; a miss is revision-mismatch and nothing is written." |
| "force" | boolean | no | — | "Bypasses close policy — the open-children refusal and the live-blocker refusal — and the pin and the assignee guard, and nothing else: never the template guard. CLOSE […]; default false." |
| "reason" | text | no | — | "Why the issue is closed, stored and read back as `close_reason`. THE FIRST CLOSE WINS: an idempotent re-close writes neither this nor `session`; at most 255 characters." |
| "session" | text | no | — | "The working session that closed the issue, stored and read back as `closed_by_session`, under the same first-close-wins rule; at most 255 characters." |
| "target" | ref "#/$defs/applyRef" | yes | — | — |

**`applyDepAddItem`** — Asserts ONE dependency edge, under `POST /v0/beads/dependencies:add`'s rules. An edge from a row to itself is a `400`. A TARGET NEED NOT BE A ROW THIS DATABASE HOLDS: an `external:` reference and an id belonging to another repository […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_spawner" | boolean | no | — | "Gated by `issues.batchApply.depAddLineage`. Ignored for every `type` but `waits-for`: on a `waits-for` edge, `true` stamps `metadata.spawner_id` with this item's […]" |
| "metadata" | ref "#/$defs/metadataValue" | no | — | — |
| "source" | ref "#/$defs/applyRef" | yes | — | — |
| "target" | ref "#/$defs/applyRef" | yes | — | — |
| "thread_id" | text | no | — | "Gated by `issues.batchApply.depAddLineage`. A plain column on the stored edge, separate from `metadata`'s blob — the graph-plan thread this edge belongs to, for a […]; nonempty; at most 255 characters." |
| "type" | ref "#/$defs/typeUri" | yes | — | "The edge type, from the same OPEN vocabulary `Dependency.type` carries: checked for BEING a storable value, never for membership of a known-types list, so a […]" |

**`applyItemResult`** — What ONE item did, at the index the item occupied. IT IS LEAN, AND CARRIES NO ISSUE. Every other write on this surface answers with the stored row; this one answers with ids and a revision, and a client that wants the rows reads them […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "changed" | boolean | yes | — | "Whether this item persisted a semantic mutation. A `create` is always true. An `update` and a `close` follow their own operations' `changed`/`already_closed` answers, […]" |
| "depends_on" | ref "#/$defs/issueUrl" | no | — | "The target of a dep_add; absent for every other kind." |
| "issue" | ref "#/$defs/issueUrl" | yes | — | "The Issue the item acted on: the minted or explicit identity for a create, the resolved target for an update or a close, the source for a dep_add." |
| "kind" | text | yes | — | "Echoes the item's kind, so a caller walking the results does not have to walk the request alongside them; one of create, update, close, dep_add." |
| "revision" | text | yes | — | "The row's optimistic-concurrency token AFTER the item, and the value an `expected_version` guard is composed from. The same member the CLI's detail view publishes […]" |

**`setting`** — One entry of the workspace's stored settings plane. THIS SCHEMA IS DELIBERATELY NOT `x-go-type`-PINNED, and it is one of the two ROW schemas on this surface that is not — `Memory` is the other. (Envelopes and page wrappers are unpinned […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The setting's key, echoed verbatim." |
| "redacted" | boolean | yes | — | "True when `value` is withheld because the KEY marks the setting as credential-bearing — the name contains `token`, `secret`, `password`, or an API-key spelling. It is […]" |
| "value" | text | no | — | "The stored value, verbatim. ABSENT MEANS ONE OF TWO THINGS, and `redacted` says which. With `redacted: false` the workspace stores nothing for this key OR stores the […]" |

**`memory`** — One entry of the workspace's persistent memory plane. NOT `x-go-type`-PINNED, for the reason `Setting` is not: the CLI marshals an ad-hoc map per verb, so there is no canonical Go struct whose JSON encoding is this contract, and minting […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The memory's key, echoed verbatim." |
| "value" | text | yes | — | "The stored content, verbatim: newlines, surrounding space and unicode as stored, never truncated and never withheld. Always present. It is the empty string only where […]" |

**`rememberedMemory`** — One stored memory, plus whether storing it overwrote a previous value. It is `Memory`'s shape with `replaced` added rather than a composition of it, because this document repeats property lists instead of using `allOf` (see the note at […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key the memory now lives under: the one the request supplied, or the one derived from `content`. Recall it under exactly these bytes." |
| "replaced" | boolean | yes | — | "True when a previous value existed under `key` and this request overwrote it; false when the key was new. It is observed in the same transaction as the write, so it […]" |
| "value" | text | yes | — | "The stored content, echoed verbatim. Always present, and never withheld — this plane has no redaction; see the operation description." |

**`removedSetting`** — The outcome of removing one setting. IT CARRIES THE KEY AND NOTHING ELSE, and the absence is the contract rather than an unfinished shape. There is no `removed` flag because the storage seam discards the affected-row count on every […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key that now holds nothing, echoed verbatim." |

**`eventRecord`** — One record of the durable events journal: a single committed issue mutation, as a replaying consumer receives it. THIS IS THE CLI'S RECORD. It is pinned to the same Go struct `bd events tail` and `bd events export` marshal one per line, […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "comment" | object | no | — | "On `comment` only: `{\\"id\\",\\"author\\",\\"text\\",\\"created_at\\",\\"source\\"}`. Absent on every other op." |
| "dep" | object | no | — | "On `dep_add` and `dep_remove` only: `{\\"kind\\",\\"target\\",\\"metadata\\"}` for the edge. Absent on every other op. `metadata` differs in PROVENANCE between the two: on […]" |
| "issue" | object | yes | — | "The full issue state after the mutation — the same object shape `Issue` describes — or `null` on a delete. Always present. A post-image of a wisp-plane record carries […]" |
| "issue_id" | ref "#/$defs/issueUrl" | yes | — | "The mutated issue's canonical id." |
| "op" | text | yes | — | "What was done: `create`, `update`, `close`, `delete`, `dep_add`, `dep_remove` or `comment`. The set is closed in v0; a client MUST default-branch on an unknown value […]" |
| "seq" | integer | yes | — | "Counter-assigned inside the mutation's own transaction: gapless, strictly increasing in commit order, never reused and never reset. This is the value to pass back as […]" |
| "ts" | text | yes | — | "UTC insert time, stamped inside the committing transaction and normalized to RFC 3339. It is NOT monotone in `seq`: two writers against one SQL server, or a clock […]" |

## 4. Queries

### listReadyWork (CallableQuery)

Extern: `issueops.Reader (ready)`. Unblocked open work, ordered by the requested sort policy, with the native default type exclusions. The result is always restricted to open Issues; there is no cursor, so a client narrows the filters or raises the limit.

**`listReadyWorkArguments`** — Arguments of listReadyWork.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "assignee" | text | no | — | "Only issues assigned to this actor." |
| "brief" | boolean | no | — | "Omit the free-form text from every item: `description`, `design`, `acceptance_criteria`, `notes`, `payload` and `waiters` are not selected. Filtering is unaffected, […]; default false." |
| "exclude_label" | array of text | no | — | "Labels that must not be present." |
| "exclude_type" | array of (ref "#/$defs/typeUri") | no | — | "Issue types to exclude. Repeat the parameter, or pass a comma-separated list. Ignored when `type` is set." |
| "has_metadata_key" | text | no | — | "Only issues carrying this top-level metadata key." |
| "include_deferred" | boolean | no | — | "Include issues whose `defer_until` is still in the future; default false." |
| "include_ephemeral" | boolean | no | — | "Include ephemeral (non-synced) rows; default false." |
| "label" | array of text | no | — | "Labels that must ALL be present (AND)." |
| "label_any" | array of text | no | — | "Labels of which at least one must be present (OR)." |
| "label_pattern" | text | no | — | "Glob matched against labels." |
| "label_regex" | text | no | — | "Regular expression matched against labels, compiled by the database in its own dialect. A pattern it cannot compile is a 400 `invalid_value` on this parameter." |
| "limit" | integer | no | — | "Maximum number of items to return. `0` means unlimited, exactly as `bd ready --limit 0` does — the two surfaces read the same shared default and the same zero […]; at least 0; default 100." |
| "metadata_field" | array of text | no | — | "Top-level metadata equality filter as `key=value`, split on the first `=`. Repeatable. An invalid key is a 400." |
| "parent" | ref "#/$defs/locator" | no | — | "Restrict to recursive descendants of this issue." |
| "priority" | integer | no | — | "Exact priority (0 is a real value, not \\"unset\\")." |
| "sort" | text | no | — | "Ready-work ordering. `priority` is priority-first; `hybrid` orders recent issues by priority and older ones by age; `oldest` is creation order. An unrecognized value […]; one of hybrid, priority, oldest; default \\"priority\\"." |
| "type" | ref "#/$defs/typeUri" | no | — | "Issue type. The only normalization is shorthand ALIAS expansion, exactly what `bd ready --type` does: `mr` → `merge-request`, `feat` → `feature`, `mol` → `molecule`, […]" |
| "unassigned" | boolean | no | — | "Only issues with no assignee." |

**`readyPage`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | "True when the limit truncated the result. There is no cursor on this operation; narrow the filters or raise the limit." |
| "items" | array of (ref "#/$defs/issueView") | yes | — | "Empty array (never null) when nothing is ready." |

### countReadyWork (CallableQuery)

Extern: `issueops.ReadyCounter`. How many Issues listReadyWork would return for the same filters with limit 0, from the same predicate; an identity, not an estimate.

**`countReadyWorkArguments`** — Arguments of countReadyWork.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "assignee" | text | no | — | "Only issues assigned to this actor." |
| "exclude_label" | array of text | no | — | "Labels that must not be present." |
| "exclude_type" | array of (ref "#/$defs/typeUri") | no | — | "Issue types to exclude. Repeat the parameter, or pass a comma-separated list. Ignored when `type` is set." |
| "has_metadata_key" | text | no | — | "Only issues carrying this top-level metadata key." |
| "include_deferred" | boolean | no | — | "Include issues whose `defer_until` is still in the future; default false." |
| "include_ephemeral" | boolean | no | — | "Include ephemeral (non-synced) rows, which the count merges exactly as the listing lists them; default false." |
| "label" | array of text | no | — | "Labels that must ALL be present (AND)." |
| "label_any" | array of text | no | — | "Labels of which at least one must be present (OR)." |
| "label_pattern" | text | no | — | "Glob matched against labels." |
| "label_regex" | text | no | — | "Regular expression matched against labels, compiled by the database in its own dialect. A pattern it cannot compile is a 400 `invalid_value` on this parameter." |
| "metadata_field" | array of text | no | — | "Top-level metadata equality filter as `key=value`, split on the first `=`. Repeatable. An invalid key is a 400." |
| "parent" | ref "#/$defs/locator" | no | — | "Restrict to recursive descendants of this issue." |
| "priority" | integer | no | — | "Exact priority (0 is a real value, not \\"unset\\")." |
| "type" | ref "#/$defs/typeUri" | no | — | "Issue type, with the shorthand alias expansion and the match-nothing-rather-than-fail treatment `GET /v0/beads/ready` documents. Setting it drops the default type […]" |
| "unassigned" | boolean | no | — | "Only issues with no assignee." |

**`readyCount`** — The size of a ready set. It carries no items, no `has_more` and no cursor: this is a number about a set, and the operation that returns rows is `GET /v0/beads/ready`. It is NOT `x-go-type`-pinned, unlike the seven schemas above, and […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "total" | integer | yes | — | "How many items `GET /v0/beads/ready` would return for these filters with `limit=0`. Never negative; 0 when nothing is ready, which is a 200 rather than a 404 — a […]" |

### listBlockedIssues (CallableQuery)

Extern: `issueops.BlockedLister`. The blocked Issues and the blockers the tracker names for each, seeded from the stored transitive readiness flag with closed and pinned rows excluded.

**`listBlockedIssuesArguments`** — Arguments of listBlockedIssues.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "exclude_label" | array of text | no | — | "Labels that must all be absent." |
| "label" | array of text | no | — | "Labels that must ALL be present (AND). Each value is trimmed, and blank and repeated values are dropped, as `bd blocked --label` does." |
| "label_any" | array of text | no | — | "Labels of which at least one must be present (OR)." |
| "parent" | ref "#/$defs/locator" | no | — | "Only the parent's direct children (a parent-child edge) and ids under it in the dotted hierarchy, as `bd blocked --parent` narrows." |

**`blockedPage`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | "Always false in v0: this operation takes no limit, so the listing is never truncated. Present so that adding a bound later is additive." |
| "items" | array of (ref "#/$defs/blockedIssueView") | yes | — | "Empty array (never null) when nothing is blocked." |

### getStats (CallableQuery)

Extern: `issueops.StatsReporter`. The workspace summary the native status command prints: rows by status plus the two dependency-aware numbers, the blocked count and the readiness derived from it.

**`getStatsArguments`** — Arguments of getStats.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "assignee" | text | no | — | "Answer for ONE ACTOR instead of the workspace. Used as written: no trimming, no case folding, no alias expansion. An empty value is a 400 — the workspace-wide […]" |
| "skip_blocked" | boolean | no | — | "Ask for the answer WITHOUT the blocked-set scan, which is the expensive half of this query on a large workspace — the same request `bd status --no-blocked` makes. IT […]; default false." |

**`statsResult`** — The same envelope `bd status --json` prints, minus one member: the CLI also carries `recent_activity`, which every shipped code path leaves absent, so it is not published here.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "blocked_count_skipped" | boolean | yes | — | "True when the summary came back without the blocked-set scan, which is exactly `summary.blocked_issues == null`. It is DERIVED from the answer rather than echoed from […]" |
| "summary" | ref "#/$defs/statistics" | yes | — | — |

### listIssues (CallableQuery)

Extern: `issueops.Reader (list)`. Issues under the native default exclusions, each with its cardinalities, in one of two served total orders, paged by an opaque cursor. This is the listing the native list and search commands ride; the Core inventory and Selector serve generic clients over the same records.

**`listIssuesArguments`** — Arguments of listIssues.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "all" | boolean | no | — | "Drop the default status exclusions (closed plus any custom statuses in the done/frozen categories). Redundant when `status` is set, which drops them already; default false." |
| "assignee" | text | no | — | "Only issues assigned to this actor." |
| "brief" | boolean | no | — | "Omit the free-form text from every item: `description`, `design`, `acceptance_criteria`, `notes`, `payload` and `waiters` are not selected. Filtering is unaffected, […]; default false." |
| "closed_after" | ref "#/$defs/instant" | no | — | "Only issues closed strictly after this instant: `bd list --closed-after`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the […]" |
| "closed_before" | ref "#/$defs/instant" | no | — | "Only issues closed strictly before this instant: `bd list --closed-before`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the […]" |
| "created_after" | ref "#/$defs/instant" | no | — | "Only issues created strictly after this instant. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second before it is […]" |
| "created_before" | ref "#/$defs/instant" | no | — | "Only issues created strictly before this instant. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second before it is […]" |
| "cursor" | text | no | — | "Opaque keyset position, taken verbatim from a previous response's `next_cursor`. Clients MUST NOT construct, parse or mutate it: its encoding is server-private and […]" |
| "defer_after" | ref "#/$defs/instant" | no | — | "Only issues deferred until strictly after this instant: `bd list --defer-after`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to […]" |
| "defer_before" | ref "#/$defs/instant" | no | — | "Only issues deferred until strictly before this instant: `bd list --defer-before`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated […]" |
| "deferred" | boolean | no | — | "Only deferred issues: `bd list --deferred`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with […]; default false." |
| "desc_contains" | text | no | — | "Case-insensitive substring match on the description: `bd list --desc-contains`. Behind the `issues.list.filters` behavior token: an older server answers […]" |
| "due_after" | ref "#/$defs/instant" | no | — | "Only issues due strictly after this instant: `bd list --due-after`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second […]" |
| "due_before" | ref "#/$defs/instant" | no | — | "Only issues due strictly before this instant: `bd list --due-before`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second […]" |
| "empty_description" | boolean | no | — | "Only issues with an empty description: `bd list --empty-description`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for […]; default false." |
| "exclude_label" | array of text | no | — | "Labels that must not be present." |
| "exclude_status" | array of text | no | — | "Statuses to leave out (repeat the parameter; a value may also be comma-separated), on top of what `status` or the default exclusions select; it never re-admits a row […]" |
| "exclude_type" | array of (ref "#/$defs/typeUri") | no | — | "Issue types to leave out (repeat the parameter; a value may also be comma-separated): `bd list --exclude-type`. Normalized by the role as the local listing normalizes […]" |
| "external_contains" | text | no | — | "Substring match on the external reference: `bd list --external-contains`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` […]" |
| "external_ref" | text | no | — | "Exact match on the external reference: `bd list --external-ref`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this […]" |
| "has_metadata_key" | text | no | — | "Only issues carrying this top-level metadata key." |
| "id" | array of (ref "#/$defs/locator") | no | — | "Restrict to these canonical ids (repeat the parameter). AND-ed with every other filter, including the default exclusions, so a caller addressing rows regardless of […]" |
| "include_ephemeral" | boolean | no | — | "Include the ephemeral tier — ephemeral rows and the non-synced rows stored beside them — merged into the same order as the durable ones, whichever order `sort` named. […]; default false." |
| "include_gates" | boolean | no | — | "Include gate issues; default false." |
| "include_infra" | boolean | no | — | "Include the workspace's configured infrastructure issue types. This also admits the ephemeral plane those types live in, so it is strictly wider than `include_ephemeral`; default false." |
| "include_templates" | boolean | no | — | "Include template molecules; default false." |
| "label" | array of text | no | — | "Labels that must ALL be present (AND)." |
| "label_any" | array of text | no | — | "Labels of which at least one must be present (OR)." |
| "label_pattern" | text | no | — | "Glob label filter: `bd list --label-pattern`, with `GET /v0/beads/ready`'s spelling. Behind the `issues.list.filters` behavior token: an older server answers […]" |
| "label_regex" | text | no | — | "Regular-expression label filter: `bd list --label-regex`, with `GET /v0/beads/ready`'s spelling. A pattern the database cannot compile is a 400 `invalid_value` on […]" |
| "limit" | integer | no | — | "Maximum number of items to return. `0` means unlimited, exactly as `bd list --limit 0` does — the two surfaces read the same shared default and the same zero […]; at least 0; default 50." |
| "metadata_field" | array of text | no | — | "Top-level metadata equality filter as `key=value`, split on the first `=`. Repeatable. An invalid key is a 400." |
| "mol_type" | text | no | — | "Only molecules of this type: `bd list --mol-type`. Any other value, including an empty one, is a 400 naming the parameter. Behind the `issues.list.filters` behavior […]; one of swarm, patrol, work." |
| "no_assignee" | boolean | no | — | "Only issues with no assignee: `bd list --no-assignee`, handed to the role as written beside the other filters. Behind the `issues.list.noAssignee` behavior token: an […]; default false." |
| "no_labels" | boolean | no | — | "Only issues carrying no label: `bd list --no-labels`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A […]; default false." |
| "no_parent" | boolean | no | — | "Only top-level issues, those with no parent: `bd list --no-parent`. Sending it with `parent` is a 400 on `no_parent`, as on `GET /v0/beads/issues:count`. Behind the […]; default false." |
| "no_pinned" | boolean | no | — | "Only issues without the pinned flag, held in place where `all` or a pinned/hooked `status` would otherwise drop that predicate: `bd list --no-pinned`. Sending it with […]; default false." |
| "notes_contains" | text | no | — | "Case-insensitive substring match on the notes: `bd list --notes-contains`. Behind the `issues.list.filters` behavior token: an older server answers […]" |
| "overdue" | boolean | no | — | "Only overdue issues, those whose due time is before now: `bd list --overdue`. Now is the SERVER's clock when the query runs, not the client's. Behind the […]; default false." |
| "parent" | ref "#/$defs/locator" | no | — | "Restrict to recursive descendants of this issue." |
| "pinned" | boolean | no | — | "Only issues carrying the pinned FLAG, at any status: `bd list --pinned`. The pinned STATUS is `status`; the flag is a separate predicate. Sending it with `no_pinned` […]; default false." |
| "priority" | integer | no | — | "Exact priority: `bd list --priority`. Absent means unfiltered; `0` is a real priority. Behind the `issues.list.filters` behavior token: an older server answers […]" |
| "priority_max" | integer | no | — | "Highest priority to list, inclusive: `bd list --priority-max`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this […]" |
| "priority_min" | integer | no | — | "Lowest priority to list, inclusive: `bd list --priority-min`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this […]" |
| "q" | text | no | — | "`bd search`'s free text. A row matches when its title or its id contains the text, case-insensitively; a text shaped like an issue id also matches that exact id, an […]" |
| "sort" | text | no | — | "Which of the two served total orders this page is in. `created` is `(created_at DESC, id ASC)`; `priority` is `(priority ASC, created_at DESC, id ASC)` — `bd list`'s […]; one of created, priority; default \\"created\\"." |
| "spec" | text | no | — | "Only issues whose spec id starts with this prefix: `bd list --spec`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for […]" |
| "status" | array of text | no | — | "Status filter. Repeat the parameter, or pass a comma-separated list. Custom statuses configured for the workspace are honored. Setting this REPLACES the default […]" |
| "title" | text | no | — | "Case-insensitive substring match on the title: `bd list --title`. It narrows the listing and lifts none of its default exclusions. Behind the `issues.list.title` […]" |
| "title_contains" | text | no | — | "Case-insensitive substring match on the title: `bd list --title-contains`, spelled as `GET /v0/beads/issues:count` spells it. It overlaps `title` deliberately: both […]" |
| "type" | ref "#/$defs/typeUri" | no | — | "Issue type. Shorthand aliases are expanded exactly as `bd list --type` expands them (`mr`, `feat`, `mol`, `enhancement`, `dec`, `adr`); there is no plural folding. […]" |
| "updated_after" | ref "#/$defs/instant" | no | — | "Only issues last updated strictly after this instant: `bd list --updated-after`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to […]" |
| "updated_before" | ref "#/$defs/instant" | no | — | "Only issues last updated strictly before this instant: `bd list --updated-before`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated […]" |
| "wisp_type" | text | no | — | "Only rows of this wisp type (a predicate on the column, not a plane selector): `bd list --wisp-type`. Any other value, including an empty one, is a 400 naming the […]; one of heartbeat, ping, patrol, gc_report, recovery, error, escalation." |

**`issuesPage`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | — |
| "items" | array of (ref "#/$defs/issueView") | yes | — | "Empty array (never null) when nothing matches." |
| "next_cursor" | text | no | — | "Present if and only if `has_more` is true. Pass it back verbatim as `cursor` to fetch the next page. Opaque and server-private." |

### queryIssues (CallableQuery)

Extern: `issueops.Querier`. The native query expression language: field comparisons combined with AND, OR, NOT and parentheses. The one operation that takes a disjunction; not a passthrough to storage.

**`queryIssuesArguments`** — Arguments of queryIssues.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "all" | boolean | no | — | "Include closed issues. Without it closed issues are excluded — unless the expression itself compares `status`, in which case the expression's own opinion stands and […]; default false." |
| "limit" | integer | no | — | "Maximum number of items to return. `0` means unlimited, exactly as `bd query --limit 0` does — the two surfaces read the same shared default […]; at least 0; default 50." |
| "q" | text | yes | — | "The query expression, e.g. `status=open AND priority>1` or `type=bug OR label=urgent`. Blank, unparseable, or naming a field or operator the language does not have is […]" |
| "reverse" | boolean | no | — | "Invert the display order. Ignored when `sort` is absent; default false." |
| "sort" | text | no | — | "Display order for the page. Absent leaves the rows in the order the query returned them, which is the same thing `bd query` without `--sort` does. WHAT IT ORDERS is […]; one of priority, created, updated, closed, status, id, title, type, assignee." |

**`queryPage`** — A page of query results. It is `ReadyPage`'s shape rather than `IssuesPage`'s, and the missing member is the point: a page of this operation carries no `next_cursor`, because a cursor is a keyset position in a database order and a […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | "True when `limit` truncated the result. It is exact for every expression, including the ones evaluated outside the database: those are matched against every candidate […]" |
| "items" | array of (ref "#/$defs/issueView") | yes | — | "Empty array (never null) when the expression matched nothing." |

### countIssues (CallableQuery)

Extern: `issueops.Counter`. How many Issues match a predicate, and with group_by how many in each bucket. It answers about every status by default, unlike the listing.

**`countIssuesArguments`** — Arguments of countIssues.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "assignee" | text | no | — | "Only issues assigned to this actor. Sending it beside `no_assignee` is not refused: the two are handed to the filter as written and answer with the empty […]" |
| "closed_after" | ref "#/$defs/instant" | no | — | "RFC 3339. Only issues closed strictly after this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and […]" |
| "closed_before" | ref "#/$defs/instant" | no | — | "RFC 3339. Only issues closed strictly before this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and […]" |
| "created_after" | ref "#/$defs/instant" | no | — | "RFC 3339. Only issues created strictly after this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and […]" |
| "created_before" | ref "#/$defs/instant" | no | — | "RFC 3339. Only issues created strictly before this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and […]" |
| "desc_contains" | text | no | — | "Substring match on the description." |
| "empty_description" | boolean | no | — | "Only issues with no description; default false." |
| "exclude_status" | array of text | no | — | "Statuses to exclude from the count. Repeat the parameter, or pass a comma-separated list; entries are taken as written (no normalization) but — UNLIKE `status` and […]" |
| "exclude_type" | array of (ref "#/$defs/typeUri") | no | — | "Issue types to exclude from the count. Repeat the parameter, or pass a comma-separated list; entries are split and trimmed inside the role and are NOT validated […]" |
| "group_by" | text | no | — | "Bucket the count by one dimension and return `groups` beside `total`. Absent, the response carries `total` alone. The set is CLOSED, and a value outside it is a `400` […]; one of status, priority, type, assignee, label." |
| "has_metadata_key" | text | no | — | "Only issues carrying this top-level metadata key." |
| "id" | array of (ref "#/$defs/locator") | no | — | "The Issues to count among, as a list rather than the native comma-separated string." |
| "include_ephemeral" | boolean | no | — | "Admit the EPHEMERAL PLANE — the wisps table — and nothing else. Exactly the first of `include_infra`'s four changes, with none of the other three: no type exclusion […]; default false." |
| "include_infra" | boolean | no | — | "Count the cardinality of `bd list --include-infra --all` instead of the durable plane. IT CHANGES FOUR THINGS AT ONCE, and they are listed rather than summarized […]; default false." |
| "label" | array of text | no | — | "Labels that must ALL be present. Repeat the parameter. Entries are trimmed and de-duplicated inside the role, and a set whose entries are all blank is the same as an […]" |
| "label_any" | array of text | no | — | "Labels of which at least ONE must be present. Repeat the parameter; same normalization as `label`." |
| "metadata_field" | array of text | no | — | "Top-level metadata equality filter as `key=value`, split on the first `=`. Repeatable. An invalid key is a 400." |
| "no_assignee" | boolean | no | — | "Only issues with no assignee; default false." |
| "no_labels" | boolean | no | — | "Only issues carrying no label; default false." |
| "no_parent" | boolean | no | — | "Only issues carrying NO parent-child dependency edge. Unlike `parent`, this does NOT consult the dotted-id convention — an issue named `X.1` with no edge to `X` is […]; default false." |
| "notes_contains" | text | no | — | "Substring match on the notes." |
| "parent" | ref "#/$defs/locator" | no | — | "Restrict to one issue's children through one predicate with two arms: a parent-child dependency edge onto `parent`, OR — for an issue carrying no parent-child edge at […]" |
| "priority" | integer | no | — | "Exact priority. Absent means unfiltered — the distinction matters because `0` is a real priority, which is why the role models this as a pointer." |
| "priority_max" | integer | no | — | "Highest priority to count, inclusive." |
| "priority_min" | integer | no | — | "Lowest priority to count, inclusive." |
| "status" | text | no | — | "One stored status. The empty value and the literal `all` both mean EVERY status, which is what makes a bare count answer for closed rows as well as open ones. IT IS […]" |
| "title" | text | no | — | "Case-insensitive substring match on the title." |
| "title_contains" | text | no | — | "Substring match on the title, spelled as `GET /v0/beads/issues:query` spells it. It overlaps `title` deliberately: both reach the filter, and the two names exist […]" |
| "type" | ref "#/$defs/typeUri" | no | — | "One issue type, with `status`'s match-nothing-rather-than-fail treatment and NO shorthand alias expansion at all — unlike `GET /v0/beads/ready`'s `type`, which […]" |
| "updated_after" | ref "#/$defs/instant" | no | — | "RFC 3339. Only issues last updated strictly after this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and […]" |
| "updated_before" | ref "#/$defs/instant" | no | — | "RFC 3339. Only issues last updated strictly before this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and […]" |

**`issueCount`** — The size of a matching set, and its buckets when `group_by` asked for them. It carries no items and no cursor: this is a number about a set, and the operations that return rows are `GET /v0/beads/issues` and `GET […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "groups" | object | no | — | "Bucket key to cardinality, PRESENT exactly when the request carried `group_by` and ABSENT otherwise. That absence is the answer to \\"you did not ask for buckets\\"; an […]" |
| "total" | integer | yes | — | "How many issues match. Never negative; `0` when nothing matches, which is a 200 rather than a 404 — a question about a set has an answer even when the set is empty, […]" |

### getIssue (CallableQuery)

Extern: `issueops.Reader (details)`. One Issue with its labels, Dependencies and cardinalities: the detail view behind the native show command. Comment bodies and dependents are asked for, never volunteered. The Core point read of the Issue's URL serves the record alone.

**`getIssueArguments`** — Arguments of getIssue.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "brief_deps" | boolean | no | — | "Reduce each row in `dependencies` to its identity-and-shape fields (`id`, `title`, `status`, `issue_type`, `priority`, `dependency_type`), dropping `description`, […]; default false." |
| "include_comments" | boolean | no | — | "Populate `comments` with the issue's full comment bodies. When it is honored `comments_omitted` is false, so a client is never left to guess whether an absent list […]; default false." |
| "include_dependents" | boolean | no | — | "Populate `dependents` with the issues that depend on this one, each carrying its edge type — the shape `dependencies` already carries. Default false, for […]; default false." |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |

Result: `issueDetails` (§3).

### listRelatedIssues (CallableQuery)

Extern: `issueops.Relations`. The Issues on the far end of one Issue's Dependencies in a named direction, each with the Link that leads to it.

**`listRelatedIssuesArguments`** — Arguments of listRelatedIssues.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "direction" | text | yes | — | "Which way this issue's edges are walked. `out` answers the issues it DEPENDS ON — the `dependencies` member of `GET /v0/beads/issues/{id}`. `in` answers the issues […]; one of out, in." |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |
| "type" | array of (ref "#/$defs/typeUri") | no | — | "Edge types to include. Repeat the parameter. Empty means every type. `GET /v0/beads/dependencies`'s `type` exactly: the vocabulary is OPEN, so an unrecognized value […]" |

**`relatedIssues`** — One issue's neighbors — the body of `GET /v0/beads/issues/{id}/related`. It is NOT a page: this operation has no limit and no cursor, and it names ONE anchor, so there is nothing for a `has_more` to be about. There is no `missing` […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/neighborView") | yes | — | "The neighbors, ascending by id with the edge type breaking a tie. Empty array (never null) when this issue has none in the requested direction, or when the `type` […]" |

### listDependencyCycles (CallableQuery)

Extern: `issueops.CycleDetector`. Every circular blocking Dependency, canonically ordered so two reads of an unchanged workspace return the same bytes; the walk follows blocks and conditional-blocks only.

**`listDependencyCyclesArguments`** — Arguments of listDependencyCycles.

**`cyclesPage`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | "Always false in v0: this operation takes no limit, so the report is never truncated. Present so that adding a bound later is additive." |
| "items" | array of (ref "#/$defs/cycle") | yes | — | "Empty array (never null) when the workspace has no cycles. Its LENGTH is the total: a cycle whose members this workspace cannot describe is still counted here, so the […]" |

### getDependencyTree (CallableQuery)

Extern: `issueops.TreeWalker`. The Dependency graph walked from one root, flat, in depth-first pre-order; each node is expanded at most once and a cycle terminates the walk rather than failing it.

**`getDependencyTreeArguments`** — Arguments of getDependencyTree.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "direction" | text | no | — | "Which way to follow edges. `down` (the default) walks what the root DEPENDS ON; `up` walks what depends ON it; `both` walks each way and returns one list. For `both` […]; one of down, up, both; default \\"down\\"." |
| "max_depth" | integer | no | — | "How many LEVELS to descend, counting the root as level one: `max_depth=1` is the root alone. A node beyond the bound is ABSENT rather than present and flagged. Zero […]; at least 1; default 50." |
| "root" | ref "#/$defs/locator" | yes | — | "The issue to walk from. It must be an EXACT canonical issue id: there is no fuzzy, prefix or substring resolution on this surface, for the reason `GET […]" |
| "status" | text | no | — | "Prune the walked tree to the nodes carrying this status AND the ancestor chain of each survivor, so the answer is still a tree. It is a POST-WALK PRUNE, not a filter […]" |

**`dependencyTreePage`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | "Always false in v0: this operation takes no limit, so the walk is bounded by `max_depth` rather than truncated after the fact. Present so that adding a bound later is […]" |
| "items" | array of (ref "#/$defs/treeNode") | yes | — | "The walked nodes in DEPTH-FIRST PRE-ORDER: a node appears before every node it led to, and a subtree is contiguous. Never null. It is empty only when a `status` […]" |

### countDependencyEdges (CallableQuery)

Extern: `issueops.GraphCounter`. How many Dependencies each named Issue has in one direction after the Type and status filters, without materializing them.

**`countDependencyEdgesArguments`** — Arguments of countDependencyEdges.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "direction" | text | yes | — | "Which end of the edge the anchors sit on. `out` counts what each anchor DEPENDS ON — the direction `bd dep list` reads and the number `bd show` prints as the […]; one of out, in." |
| "issue" | array of (ref "#/$defs/locator") | yes | — | "The anchors to count around. Repeat the parameter; at least one is required and at most 100 are accepted, and either bound is a 400 `invalid_argument` with `param: […]" |
| "status" | text | no | — | "Count only edges whose DEPENDENT — the issue at the source end, the one doing the depending — is in this stored status. Empty means every status. IT IS LEGAL ONLY […]" |
| "type" | array of (ref "#/$defs/typeUri") | no | — | "Edge types to include. Repeat the parameter. Empty means every type. `GET /v0/beads/dependencies`'s `type` exactly: the vocabulary is OPEN, so an unrecognized value […]" |

**`edgeCounts`** — Each anchor's edge cardinality — the body of `GET /v0/beads/dependencies:count`. It is NOT a page and carries no total: the answer is per anchor, and a sum across anchors would double-count every edge whose two ends were both named. It […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "anchors" | array of (ref "#/$defs/edgeCount") | yes | — | "One entry per DISTINCT requested `issue_id`, in the order the request first named it. Empty array (never null) when the request named no anchors this server accepted […]" |

### listBlockingAnnotations (CallableQuery)

Extern: `issueops.BlockingAnnotator`. The derived blocking decoration the native listing prints beside each row: open blockers, the Issues blocked, the parent, and optionally the stored readiness flag.

**`listBlockingAnnotationsArguments`** — Arguments of listBlockingAnnotations.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "is_blocked" | boolean | no | — | "`true` adds each item's `is_blocked`: the issue's stored, TRANSITIVE readiness flag — the column the ready set filters on, which a child inherits from a blocked […]; default false." |
| "issue" | array of (ref "#/$defs/locator") | yes | — | "The issues to annotate. Repeat the parameter; at least one is required and at most 100 are accepted, and either bound is a 400 `invalid_argument` with `param: […]" |

**`blockingAnnotations`** — The blocking decoration of the named issues. It is NOT a page: this operation has no limit and no cursor, because the number of issues asked about is what bounds it.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/blockingAnnotation") | yes | — | "One entry per DISTINCT requested id, in the order the request first named it — so a client can zip this against the ids it sent. Empty array (never null) when the […]" |

## 5. Batches

### addDependencies (CallableBatch)

Extern: `issueops.DependencyEditor`. Asserts Dependencies by endpoints as an upsert, all edges or none. For a pair with no live Dependency a new Link is created with the given Type and metadata; for a live Dependency of the same Type the metadata and thread are updated in place as a new revision, or nothing is written when nothing differs; for a live Dependency of another Type the call is refused with reason dependency-exists, as the native path refuses it, and the kind is changed with updateLink or by remove and add. The whole set is cycle-checked at the end. A generic client may use createLink instead; this callable is the native idiom.

**`addDependenciesArguments`** — Arguments of addDependencies.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "edges" | array of (ref "#/$defs/dependencyEdge") | yes | — | "The edges to assert, in the caller's order. An empty array is a `400` rather than a successful no-op: a write request that writes nothing is a client bug, and […]" |

**`addDependenciesResult`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "added" | array of (ref "#/$defs/dependencyEdge") | yes | — | "The request's edges, in REQUEST ORDER. It echoes the request because all-or-nothing means it is either every edge or the call failed, so a caller reporting what […]" |

### claimIssue (CallableBatch)

Extern: `issueops.Claimer`. Compare-and-set claim for the invocation's actor. A re-claim by the current holder is idempotent and reports already_claimed; a claim held by another actor refuses with reason already-claimed and the holder in assignee; a non-claimable state refuses with reason not-claimable and the status in issue_status.

**`claimIssueArguments`** — Arguments of claimIssue.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |

**`claimResult`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "already_claimed" | boolean | yes | — | "True when the caller already held the issue and this call changed nothing — the idempotent re-claim. A claim held by a DIFFERENT actor is a 409, not a 200 with this flag." |
| "issue" | ref "#/$defs/issueView" | yes | — | — |

### claimNextIssue (CallableBatch)

Extern: `issueops.ReadyClaimer`. Takes one ready Issue under the given filters and returns it claimed for the actor, in one transaction; an empty answer means nothing was eligible, and claimed is absent rather than null.

**`claimNextIssueArguments`** — Arguments of claimNextIssue.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "assignee" | text | no | — | "Only issues assigned to this actor." |
| "exclude_label" | array of text | no | — | "Labels that must not be present." |
| "exclude_type" | array of (ref "#/$defs/typeUri") | no | — | "Issue types to exclude. Repeat the parameter, or pass a comma-separated list. Ignored when `type` is set." |
| "has_metadata_key" | text | no | — | "Only issues carrying this top-level metadata key." |
| "include_deferred" | boolean | no | — | "Include issues whose `defer_until` is still in the future; default false." |
| "include_ephemeral" | boolean | no | — | "Include ephemeral (non-synced) rows; default false." |
| "label" | array of text | no | — | "Labels that must ALL be present (AND)." |
| "label_any" | array of text | no | — | "Labels of which at least one must be present (OR)." |
| "label_pattern" | text | no | — | "Glob matched against labels." |
| "label_regex" | text | no | — | "Regular expression matched against labels, compiled by the database in its own dialect. A pattern it cannot compile is a 400 `invalid_value` on this parameter." |
| "metadata_field" | array of text | no | — | "Top-level metadata equality filter as `key=value`, split on the first `=`. Repeatable. An invalid key is a 400." |
| "parent" | ref "#/$defs/locator" | no | — | "Restrict to recursive descendants of this issue." |
| "priority" | integer | no | — | "Exact priority (0 is a real value, not \\"unset\\")." |
| "sort" | text | no | — | "Ready-work ordering. `priority` is priority-first; `hybrid` orders recent issues by priority and older ones by age; `oldest` is creation order. An unrecognized value […]; one of hybrid, priority, oldest; default \\"priority\\"." |
| "type" | ref "#/$defs/typeUri" | no | — | "Issue type. The only normalization is shorthand ALIAS expansion, exactly what `bd ready --type` does: `mr` → `merge-request`, `feat` → `feature`, `mol` → `molecule`, […]" |
| "unassigned" | boolean | no | — | "Only issues with no assignee." |

**`claimNextResult`** — The outcome of one atomic take of ready work. `claimed` IS ABSENT WHEN NOTHING WAS ELIGIBLE, and its absence is the whole signal — there is no boolean beside it, because a second member carrying the same fact is a second member that can […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "claimed" | ref "#/$defs/issueView" | no | — | — |

### releaseIssue (CallableBatch)

Extern: `issueops.Releaser`. Gives back the claim: the assignee is cleared, the status becomes the literal open, started_at is cleared, the lease is dropped and the record is reversioned. Refuses with reason not-releasable or not-assignee as the native guards decide, in the native order.

**`releaseIssueArguments`** — Arguments of releaseIssue.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "expected_assignee" | text | no | — | "Compare-and-set on the holder: the release proceeds only while the issue is still assigned to this actor, and otherwise refuses with `409` / `precondition_failed` […]" |
| "force" | boolean | no | — | "Bypass the ownership fence, so an actor that is not the holder may release the claim. It is the escape hatch `bd unclaim --force` spells, for an abandoned claim whose […]; default false." |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |

**`releaseResult`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "changed" | boolean | yes | — | "Whether the release WROTE the row. It is TRUE on every 200 this operation returns, because every shape that would not write is refused above it — an unheld row is a […]" |
| "issue" | ref "#/$defs/issueView" | yes | — | — |

### heartbeatIssue (CallableBatch)

Extern: `issueops.Heartbeater`. Refreshes the actor's lease on an Issue it holds and stamps heartbeat_at; it writes only the lease, mints no revision and records no Event. Refuses with reason already-claimed when another actor holds the lease, or lease-not-held.

**`heartbeatIssueArguments`** — Arguments of heartbeatIssue.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |

**`heartbeatResult`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "heartbeat_at" | ref "#/$defs/instant" | yes | — | "The server clock, in UTC, the refresh stamped on the lease." |
| "holder" | text | yes | — | "The lease holder after the refresh (the request's `actor`)." |
| "id" | ref "#/$defs/issueUrl" | yes | — | "The issue whose lease was refreshed." |
| "lease_expires_at" | ref "#/$defs/instant" | yes | — | "`heartbeat_at` plus the server's lease TTL: the deadline the next heartbeat must beat before a reclaim may revert the claim." |
| "rearmed" | boolean | yes | — | "True when the actor held the claim but no lease row existed for it (a claim hand-doled through `updateIssue`), so the heartbeat granted a fresh lease instead of […]" |

### closeIssue (CallableBatch)

Extern: `issueops.Lifecycle (close)`. Closes one Issue to the literal closed status, including from a configured done status, recording reason and session under first-close-wins; a re-close is idempotent and reports already_closed. Close policy refuses with reason not-closable and names the blockers; the assignee guard with reason not-assignee.

**`closeIssueArguments`** — Arguments of closeIssue.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "auto_close_molecule" | boolean | no | — | "Behind the `issues.close.autoCloseMolecule` behavior token: an older server answers `unknown_parameter` for this name, and a client checks the token before sending […]; default false." |
| "expected_revision" | text | no | — | "Requires the subject's current revision to equal this opaque token before anything is written; a miss is revision-mismatch and nothing is written." |
| "force" | boolean | no | — | "Bypass close policy — the open-children refusal and the live-blocker refusal — and the pin and the assignee guard, and nothing else: never the template guard (see […]; default false." |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |
| "reason" | text | no | — | "Why the issue is closed. Stored on the issue and read back as `close_reason`. THE FIRST CLOSE WINS: an idempotent re-close writes neither this nor `session`, so a […]; at most 255 characters." |
| "session" | text | no | — | "The working session that closed the issue, stored and read back as `closed_by_session`, under the same first-close-wins rule and the same bounds as `reason`; at most 255 characters." |

**`closeResult`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "already_closed" | boolean | yes | — | "True when the issue was already closed and this call changed nothing — the idempotent re-close, mirroring `ClaimResponse.already_claimed`. The response still carries […]" |
| "auto_closed_molecule" | ref "#/$defs/issueView" | no | — | — |
| "issue" | ref "#/$defs/issueView" | yes | — | — |
| "molecule_auto_close_refusal" | text | no | — | "With `issues.close.autoCloseMolecule` and `auto_close_molecule`: why the molecule root this close completed stayed open — the root's own close policy refused it (a […]" |
| "open_children" | integer | yes | — | "How many open children the close observed. Reported by a FORCED close — including an idempotent re-close — because a caller that bypassed the guard is exactly the […]" |

### batchCloseIssues (CallableBatch)

Extern: `issueops.BatchCloser`. Closes every item it can and commits them together, with one outcome per item in request order; an item's refusal is carried in its outcome's reason and writes nothing for that item.

**`batchCloseIssuesArguments`** — Arguments of batchCloseIssues.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "auto_close_molecule" | boolean | no | — | "Behind the `issues.close.autoCloseMolecule` behavior token: an older server answers `unknown_parameter` for this name. Close each item's molecule root when the batch […]; default false." |
| "force" | boolean | no | — | "Bypass close policy — the open-children refusal and the live-blocker refusal — and the pin and the assignee guard for EVERY item, and nothing else. It never bypasses […]; default false." |
| "items" | array of (ref "#/$defs/batchCloseItem") | yes | — | "The issues to close, in the order the caller asked for them. Every item appears in `outcomes` at the same index. An EMPTY array is a `400` rather than an empty […]" |
| "session" | text | no | — | "The working session, recorded against every item that closes, under `CloseIssueRequest.session`'s first-close-wins rule and bounds; at most 255 characters." |

**`batchCloseResult`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "outcomes" | array of (ref "#/$defs/closeOutcome") | yes | — | "Exactly one entry per requested item, in REQUEST ORDER — including for items that refused, so a client walks this against its own argument list without matching ids […]" |

### reopenIssue (CallableBatch)

Extern: `issueops.Lifecycle (reopen)`. Moves a closed or done-status Issue back to open; a reopen of an Issue that is not done changes nothing and reports already_open.

**`reopenIssueArguments`** — Arguments of reopenIssue.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "expected_revision" | text | no | — | "Requires the subject's current revision to equal this opaque token before anything is written; a miss is revision-mismatch and nothing is written." |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |
| "reason" | text | no | — | "Why the issue is being reopened. Recorded on the `reopened` EVENT this move records — not on a field of the issue, and not carried in the response, so a caller that […]; at most 255 characters." |

**`reopenResult`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "already_open" | boolean | yes | — | "True when the issue was not in a done status and this call changed nothing — idempotent, mirroring `CloseIssueResponse.already_closed` and […]" |
| "issue" | ref "#/$defs/issueView" | yes | — | — |

### compareAndSetMetadata (CallableBatch)

Extern: `issueops.MetadataCAS`. Sets one metadata key if and only if it currently holds the expected value, and reports the current value either way; omitting expected or value means the key is absent before or after. A lost race is swapped false, an answer rather than a refusal.

**`compareAndSetMetadataArguments`** — Arguments of compareAndSetMetadata.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "expected" | ref "#/$defs/metadataValue" | no | — | — |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |
| "key" | text | yes | — | "The single metadata key to read and write. It must match the workspace's metadata-key syntax — a letter or underscore, then letters, digits, underscores, dots and […]; nonempty; at most 255 characters." |
| "value" | ref "#/$defs/metadataValue" | no | — | — |

**`compareAndSetMetadataResult`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "current" | ref "#/$defs/metadataValue" | no | — | — |
| "swapped" | boolean | yes | — | "Whether the precondition held and the transition applied. THIS IS THE VERDICT and the only member to dispatch on. False is a lost race — an answer, not a failure — […]" |

### advanceMolecule (CallableBatch)

Extern: `issueops.MoleculeStepper`. After the named step closed, finds where its molecule stands and, with auto_claim, claims the next ready step for the actor.

**`advanceMoleculeArguments`** — Arguments of advanceMolecule.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "auto_claim" | boolean | no | — | "Claim the next ready step for `actor`. Without it the operation writes nothing and only names the step; default false." |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |

**`advanceMoleculeResult`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "claimed" | boolean | yes | — | "`next_step` was claimed for `actor`, and is the post-claim row." |
| "closed_step" | ref "#/$defs/issueView" | yes | — | — |
| "complete" | boolean | yes | — | "Every step of the molecule is closed; `next_step` is then absent." |
| "molecule_id" | ref "#/$defs/issueUrl" | no | — | "The step's molecule root. ABSENT when the step belongs to no molecule, and then nothing else below is set." |
| "next_step" | ref "#/$defs/issueView" | no | — | — |

### reclaimIssues (CallableBatch)

Extern: `issueops.LeaseReclaimer`. Reverts every in-progress Issue whose lease went stale back to open, clearing the assignee and started_at and recording a recovery Event naming the former holder; every scope member narrows the sweep.

**`reclaimIssuesArguments`** — Arguments of reclaimIssues.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "any_replica" | boolean | no | — | "Also revert leases another replica granted. The one member that WIDENS the sweep; see the operation. Absent means `false`." |
| "assignees" | array of text | no | — | "Only leases held by one of these owners are eligible." |
| "exclude_labels" | array of text | no | — | "An issue carrying ANY of these labels is never eligible." |
| "ids" | array of (ref "#/$defs/locator") | no | — | "Only these issues are eligible. An id that is not currently a stale lease is absent from the answer rather than refused. The cap is on the REQUEST, counted before […]" |
| "labels" | array of text | no | — | "Only issues carrying ALL of these labels are eligible." |
| "labels_any" | array of text | no | — | "Only issues carrying AT LEAST ONE of these labels are eligible." |
| "older_than_seconds" | number | no | — | "The grace window past a lease's own expiry, in seconds (fractions allowed): only a lease that expired more than this long ago is eligible. Absent means `0`, every […]; at least 0." |

**`reclaimResult`** — Every row the sweep reverted, in the order the sweep found them.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "reclaimed" | array of (ref "#/$defs/reclaimedLease") | yes | — | "One entry per reverted row. Empty array (never null) when nothing was stale in scope." |

### sweepIssues (CallableBatch)

Extern: `issueops.Sweeper`. Bulk clearance of closed Issues from one tier, the operation behind the native purge and prune commands; destructive, with the counts of what went and what was protected.

**`sweepIssuesArguments`** — Arguments of sweepIssues.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "closed_before" | ref "#/$defs/instant" | no | — | "Keep only beads closed STRICTLY BEFORE this instant (RFC 3339). A bead closed exactly at it is kept, which is the half-open interval every other time bound on this […]" |
| "dry_run" | boolean | no | — | "Report what the sweep WOULD do and delete nothing. The counts, the skips and the refusals are the same ones the real sweep would produce, computed against the same […]; default false." |
| "limit" | integer | no | — | "Cap how many beads this sweep deletes, OLDEST-CLOSED-FIRST. Absent or zero means unbounded. A negative value is a `400` invalid_argument, the same as the role's own […]" |
| "pattern" | text | no | — | "Keep only beads whose id matches this shell glob (`*`, `?`, `[...]`, `\\\\` escapes; `*` also crosses `-` and `.`, since an id is not a path). Absent matches every bead […]" |
| "protect_live_dependents" | boolean | no | — | "Skip a closed candidate that a LIVE (not-done) bead depends on through a parent/child, tracks, or blocks edge, so closing a dependent's dependency does not erase the […]; default false." |
| "protect_referenced" | boolean | no | — | "Skip candidates whose id is CITED — as a literal, at word boundaries — in the description, notes or comments of any bead that is not done, so a decision trail a live […]; default true." |
| "retain_ids" | boolean | no | — | "RETIRE every id this sweep deletes. In the same transaction as the delete, the server writes one permanent tombstone per deleted bead — its id and its `closed_at`, […]; default false." |
| "tier" | text | yes | — | "Which plane to clear. `ephemeral` is the wisp tier (`bd purge`) and `durable` is the issue tier (`bd prune`). The two are DISJOINT: a sweep of one can never touch a […]; one of ephemeral, durable, wisps-plane." |

**`sweepResult`** — What one sweep did. Every number describes the SAME snapshot, because the selection and the deletion ran in one transaction. It is NOT `x-go-type`-pinned, for the reason `ReadyCount` is not: there is no canonical Go struct whose JSON […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "dependencies" | integer | yes | — | "Dependency edge rows removed with them. Reported because a sweep's visible effect is much larger than its bead count." |
| "dry_run" | boolean | yes | — | "Echoes the request, so a result carries whether its numbers describe beads that are gone or beads that would go." |
| "events" | integer | yes | — | "Event rows removed with the swept beads." |
| "labels" | integer | yes | — | "Label rows removed with the swept beads." |
| "referenced_ids" | array of (ref "#/$defs/issueUrl") | no | — | "A BOUNDED SAMPLE of the ids `skipped.referenced` counts — at most 100, in the order the candidate query returned them. It is a sample, not the set: compare its length […]" |
| "remaining" | integer | no | — | "How many beads this sweep's own selection left unswept because `limit` cut it off, oldest-closed-first. Always 0 when `limit` was absent, zero, or at least as large […]" |
| "retain_ids" | boolean | no | — | "Echoes the request's `retain_ids`: `true` means every bead `swept` counts is now a retired id (under `dry_run`, would be). Present only behind the […]" |
| "skipped" | ref "#/$defs/sweepSkips" | yes | — | — |
| "swept" | integer | yes | — | "How many beads were deleted, or under `dry_run` would be." |

### deleteIssues (CallableBatch)

Extern: `issueops.Deleter`. Erases the Issues named and, under cascade, their parent-child descendants, in one transaction with the reference rewrite; the plain single delete rides the native deleteBead instead.

**`deleteIssuesArguments`** — Arguments of deleteIssues.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "cascade" | boolean | no | — | "Also delete the named beads' parent-child descendants, at every depth. Every other dependent of the deleted set — a bead joined by any edge type other than parent- […]; default false." |
| "dry_run" | boolean | no | — | "Report what the deletion WOULD do and change nothing. The counts and BOTH refusals are the ones the real request would produce, computed against the same snapshot, […]; default false." |
| "expected_revision" | text | no | — | "Requires the subject's current revision to equal this opaque token before anything is written; a miss is revision-mismatch and nothing is written." |
| "force" | boolean | no | — | "Delete the named beads and leave their dependents ORPHANED, reported in `orphaned`. Without it and without `cascade`, a named bead with a dependent the request did […]; default false." |
| "ids" | array of (ref "#/$defs/locator") | yes | — | "The beads to delete, exact ids, in either plane. DUPLICATES COLLAPSE. An empty array is a `400` rather than a no-op — a caller whose id list came out empty because […]" |

**`deleteResult`** — What one delete did. Every number describes the SAME snapshot, because the guard, the deletion and the reference rewrite ran in one transaction. It is NOT `x-go-type`-pinned, for the reason `SweepResult` is not: there is no canonical Go […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "deleted" | integer | yes | — | "How many beads were deleted, or under `dry_run` would be. Under `cascade` this counts the whole closure, so it is normally larger than `ids` and it — not the request […]" |
| "deleted_ids" | array of (ref "#/$defs/issueUrl") | no | — | "The beads `deleted` counts, in ascending id order without duplicates: under `cascade`, the whole parent-child closure. Under `dry_run` it names the beads that would […]" |
| "dependencies" | integer | yes | — | "Dependency edge rows removed with them, in either direction. Reported because a delete's visible effect is much larger than its bead count." |
| "dry_run" | boolean | yes | — | "Echoes the request, so a result carries whether its numbers describe beads that are gone or beads that would go." |
| "events" | integer | yes | — | "Event rows removed with the deleted beads." |
| "labels" | integer | yes | — | "Label rows removed with the deleted beads." |
| "orphaned" | array of (ref "#/$defs/issueUrl") | no | — | "The surviving beads that depended on something this request deleted, in ascending id order. Present when the request carried `cascade` (a cascade follows parent-child […]" |
| "references_updated" | integer | yes | — | "How many SURVIVING beads had their text rewritten — beads, not occurrences. Always 0 under `dry_run`, because a preview rewrites nothing." |

### batchCreateIssues (CallableBatch)

Extern: `issueops.BatchCreator`. Creates every item or none of them, each item carrying the Dependencies it is created with, in one transaction.

**`batchCreateIssuesArguments`** — Arguments of batchCreateIssues.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/batchCreateItem") | yes | — | "The issues to create, in order. An empty array is a `400` rather than a successful no-op: a write request that writes nothing is a client bug, and answering it with a […]" |

**`batchCreateResult`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/issueView") | yes | — | "One entry per requested item, in REQUEST ORDER, each the stored issue with its generated id and its labels. Never null and never shorter than the request: a partial […]" |

### applyBatch (CallableBatch)

Extern: `issueops.BatchApplier`. Applies an ordered plan of creates, updates, closes and Dependency additions as one transaction or none of it; a create item may name itself with a key that later items reference.

**`applyBatchArguments`** — Arguments of applyBatch.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "force_id_prefix" | boolean | no | — | "Permits an explicit `create.id` outside the workspace's configured issue prefix, for EVERY create item in the request. Without it such an id is refused by the role […]; default false." |
| "items" | array of (ref "#/$defs/applyItem") | yes | — | "The items to apply, IN THE ORDER THEY ARE TO BE APPLIED. An empty array is a `400` rather than a successful no-op: a write request that writes nothing is a client […]" |
| "provenance" | text | no | — | "Labels the version-control history entry this request records, under `updateIssue`'s rule: it changes how the entry READS, never whether one is recorded. Empty […]; at most 255 characters." |
| "skip_per_edge_cycle_check" | boolean | no | — | "Drops the PER-EDGE cycle probe for a caller wiring a large graph, exactly as it does on `POST /v0/beads/dependencies:add`. IT NEVER DROPS THE END GATE, which runs […]; default false." |

**`applyBatchResult`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/applyItemResult") | yes | — | "One entry per requested item, in REQUEST ORDER. Never null and never shorter than the request: a batch that could not apply every item applied none, so there is no […]" |
| "keys" | object | yes | — | "Each create item's `key` mapped to the id it was bound to. It is the one fact the request cannot carry and every caller needs. It carries only the keys the request […]" |

### addComment (CallableBatch)

Extern: `issueops.Commenter`. Appends one comment to an Issue's thread as one atomic mutation, leaving every field of the Issue untouched.

**`addCommentArguments`** — Arguments of addComment.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "author" | text | yes | — | "Who is signing the comment. CALLER-ASSERTED, and not the authenticated principal — see the operation description. Trimmed of surrounding space, then refused when the […]; nonempty; at most 256 characters." |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |
| "text" | text | yes | — | "The comment body, stored VERBATIM: newlines, surrounding space and unicode all survive, and nothing trims the value that lands in the row. NO LENGTH BOUND AND NO […]" |

Result: `commentRecord` (§3).

### removeDependency (CallableBatch)

Extern: `issueops.DependencyEditor`. Removes the live Dependency between the named source and target, by endpoints: its Link identity is consumed for good, and a later addDependencies of the same pair creates a Link with a new identity. removed false is a success, not a refusal, so a replayed teardown needs no error handling. The native deleteLink by identity is the generic way to the same effect.

**`removeDependencyArguments`** — Arguments of removeDependency.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "depends_on" | ref "#/$defs/locator" | yes | — | "The edge's TARGET — the issue depended upon. An exact canonical id, under `issue_id`'s rule." |
| "issue" | ref "#/$defs/locator" | yes | — | "The edge's SOURCE — the issue that depends on the other end. An EXACT canonical id: there is no fuzzy, prefix or substring resolution on this surface." |

**`removeDependencyResult`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "removed" | boolean | yes | — | "True when an edge was there and is now gone. FALSE IS A SUCCESS, not a refusal: it says this pair carried no such edge, which is the same graph a second removal […]" |

## 6. Problems and reasons

A Callable's refusal is a Core or Write code when one applies (§2, K-8). The
remaining native refusals are `callable-refused` with these `reason` tokens:

| Reason | Raised by | Condition |
| --- | --- | --- |

| `already-claimed` | claimIssue, heartbeatIssue, applyBatch (assignee transfer) | Another actor holds the Issue; the assignee and issue_status extension members carry the holder and the status. |
| `not-claimable` | claimIssue, claimNextIssue | The Issue is in a state that cannot be claimed; issue_status carries it. |
| `not-releasable` | releaseIssue | The Issue is not in a releasable state. |
| `not-assignee` | releaseIssue, closeIssue, batchCloseIssues (per item) | The actor is not the holder and did not force; assignee carries the holder. |
| `lease-not-held` | heartbeatIssue | The actor holds no lease on the Issue. |
| `not-closable` | closeIssue, batchCloseIssues (per item), applyBatch | Close policy refused: open children or live blockers; blockers and open_children carry them. |
| `notes-overwrite-refused` | applyBatch | A notes replacement would overwrite existing non-empty notes without force_notes_overwrite. |
| `template-read-only` | closeIssue, applyBatch | The Issue is a template. |
| `issue-pinned` | closeIssue, deleteIssues, sweepIssues | The Issue carries the pinned flag. |
| `dependency-cycle` | applyBatch, batchCreateIssues | The requested edges can never make progress. |
| `dependency-exists` | applyBatch, batchCreateIssues | The ordered pair already carries a Dependency. |
| `journal-disabled` | listEvents | The durable events journal is not enabled on this Scope. |
| `journal-truncated` | listEvents | The checkpoint fell below the retained window; retrying the same since cannot succeed. |

Native `not_found` is `resource-not-found`; `precondition_failed` is
`revision-mismatch`; `already_exists` on an explicit create identity and
`idempotency_expired` on a retired identity are both `identity-taken`; argument
faults are `validation-failed` naming the parameter; over-cap item lists are
`limit-exceeded`. A per-item outcome inside `batchCloseResult` carries its reason in
the item, never as a Problem, because the invocation succeeded.

## 7. Conformance rows for preview-1

| Row | Expectation |
| --- | --- |
| IC-1 | The directory lists the twenty-nine names of §§4–5, each bound to a definition Bead whose properties derive from the arguments schema (K-7) |
| IC-2 | `listReadyWork` with no arguments returns a `readyPage` whose items are `issueView`s with complete Bead records and the observations member |
| IC-3 | `getIssue` on an Issue URL returns an `issueDetails` whose `issue.bead` equals the Core point read of the same URL |
| IC-4 | `claimIssue` without `revisionProvenance.actor` is refused as `validation-failed`; with it, the Issue's record gains a new revision and `assignee` |
| IC-5 | `claimIssue` by a second actor is `callable-refused` with reason `already-claimed` and the `assignee` member |
| IC-6 | `closeIssue` with a stale `expected_revision` is `revision-mismatch` and the record is unchanged |
| IC-7 | `removeDependency` on a pair with no Dependency returns `removed: false` with HTTP 200 |
| IC-8 | `heartbeatIssue` by the holder leaves the Issue's `bead.revision` unchanged and changes `observations.heartbeat_at` on the next view |
| IC-9 | `deleteIssues` of an Issue with a live incident Dependency and neither `cascade` nor `force` is refused; with `cascade` the descendants are erased and their identities answer `identity-taken` to a supplied id |
| IC-10 | Under `idempotency`, a replay of any CallableBatch under the same `Idempotency-Key` returns the original result and commits nothing |

## 8. Appendix: tracker callables outside the package

Settings, memories and the events journal are not Issues or Dependencies; their
nine Callables are specified here so the native client is complete, under the
same conventions. Memories are the native key and value plane in preview-1; their
modeling as Beads is the Memory package's work, not this document's.

### listSettings (CallableQuery)

Extern: `issueops.WorkspaceConfig`. The settings stored in the workspace database, by key.

**`listSettingsArguments`** — Arguments of listSettings.

**`settingsPage`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | "Always false in v0: the whole plane is returned in one page. It is present so that a later revision can page this collection without changing the response shape." |
| "items" | array of (ref "#/$defs/setting") | yes | — | "The stored settings, ordered by key. Empty array (never null) when the workspace stores none." |
| "next_cursor" | text | no | — | "Present if and only if `has_more` is true, which is never in v0." |

### getSetting (CallableQuery)

Extern: `issueops.WorkspaceConfig`. The value stored under one key, verbatim; a key nothing stored and a key stored empty are the same answer.

**`getSettingArguments`** — Arguments of getSetting.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key, used verbatim." |

Result: `setting` (§3).

### setSetting (CallableBatch)

Extern: `issueops.WorkspaceConfig`. Stores one setting, replacing any value already there.

**`setSettingArguments`** — Arguments of setSetting.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key, used verbatim." |
| "value" | text | yes | — | "The value to store, VERBATIM. It is not trimmed and not character-filtered: two of the keys this plane holds carry structured configuration a filter would corrupt. IT […]" |

Result: `setting` (§3).

### unsetSetting (CallableBatch)

Extern: `issueops.WorkspaceConfig`. Removes the setting stored under one key; removing a key nothing set succeeds.

**`unsetSettingArguments`** — Arguments of unsetSetting.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key, used verbatim." |

Result: `removedSetting` (§3).

### listMemories (CallableQuery)

Extern: `memoryops.Memories`. Every memory the workspace holds, optionally narrowed by search.

**`listMemoriesArguments`** — Arguments of listMemories.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "search" | text | no | — | "Narrows the answer to memories that MATCH: a memory matches when the lowercase of its key, or the lowercase of its value, contains the lowercase of this term. Absent […]" |

**`memoriesPage`**

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | "Always false in v0: the whole plane is returned in one page. It is present so that a later revision can page this collection without changing the response shape." |
| "items" | array of (ref "#/$defs/memory") | yes | — | "The stored memories, ordered by key. Empty array (never null) when the workspace holds none, or when `q` matched none." |
| "next_cursor" | text | no | — | "Present if and only if `has_more` is true, which is never in v0." |

### getMemory (CallableQuery)

Extern: `memoryops.Memories`. The memory stored under one key; a missing key is resource-not-found.

**`getMemoryArguments`** — Arguments of getMemory.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key, used verbatim." |

Result: `memory` (§3).

### rememberMemory (CallableBatch)

Extern: `memoryops.Memories`. Stores one memory, upserting by key; the key is derived from the content when omitted.

**`rememberMemoryArguments`** — Arguments of rememberMemory.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "content" | text | yes | — | "The memory itself, stored VERBATIM: newlines, surrounding space and unicode all survive. Flattening it to one line is what a front door does when it prints, not what […]" |
| "key" | text | no | — | "The key to store under. OMIT IT to have the server derive one from `content`; the response's `key` is then how the caller learns where the memory landed. Supplied, it […]" |

Result: `rememberedMemory` (§3).

### forgetMemory (CallableBatch)

Extern: `memoryops.Memories`. Removes the memory stored under one key and returns what it held.

**`forgetMemoryArguments`** — Arguments of forgetMemory.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key, used verbatim." |

Result: `memory` (§3).

### listEvents (CallableQuery)

Extern: `storage.EventsJournalCursor`. The durable events journal paged from a caller-held checkpoint; the records are the native journal's records.

**`listEventsArguments`** — Arguments of listEvents.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "limit" | integer | no | — | "Maximum number of records to return, from 1 to 10000. A value outside that range — `0` included — is a 400 `invalid_argument`. THERE IS NO UNLIMITED READ HERE, and […]; 1 to 10000; default 1000." |
| "since" | integer | yes | — | "Return records with `seq` strictly greater than this value. Pass `0` to read from the beginning of the retained journal. REQUIRED, and deliberately not defaulted to […]; at least 0." |

**`eventsPage`** — One page of the journal plus the position of its end. THERE IS NO `has_more`, and that is deliberate rather than an omission. Every other page on this surface reports truncation with a boolean because its ordering is a query's; here the […]

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "head" | integer | yes | — | "The highest `seq` this journal has ever assigned, read in the same transaction as the records above. It is the journal's HISTORY, not its contents: pruning deletes […]" |
| "records" | array of (ref "#/$defs/eventRecord") | yes | — | "Records with `seq` strictly greater than the requested `since`, in ASCENDING `seq` order and contiguous — a gap in the retained window is a 410, never a quietly […]" |

## 9. Schemas

The following markdown-json-schema/0.6 fragments, bundle `issue-callables`, are the exact shapes the prose tables above read from; `scripts/spec-schema-fragments.mjs` extracts them into `issue-callables-preview-1.schema.json`. References into the common bundle use its full schema identity.

<!-- bdp-schema:start issueUrl bundle=issue-callables -->
### Schema: "issueUrl"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| $ref | "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/absoluteHttpUrl" |
| description | "Absolute canonical URL of an Issue Bead, as Core spells identities in records." |
<!-- bdp-schema:end issueUrl bundle=issue-callables -->

<!-- bdp-schema:start typeUri bundle=issue-callables -->
### Schema: "typeUri"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| $ref | "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/absoluteHttpUrl" |
| description | "Absolute identity URI of an Issue or Dependency Type from the Issue and Dependency Types package, or of a configured custom classification." |
<!-- bdp-schema:end typeUri bundle=issue-callables -->

<!-- bdp-schema:start locator bundle=issue-callables -->
### Schema: "locator"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A Scope-relative local path or absolute canonical URL naming one Issue Bead, resolved as Write resolves a mutation subject; never a fuzzy or prefix match." |
| minLength | 1 |
| type | "string" |
<!-- bdp-schema:end locator bundle=issue-callables -->

<!-- bdp-schema:start instant bundle=issue-callables -->
### Schema: "instant"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| $ref | "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/dateTime" |
| description | "An RFC 3339 date-time with uppercase T and Z." |
<!-- bdp-schema:end instant bundle=issue-callables -->

<!-- bdp-schema:start metadataValue bundle=issue-callables -->
### Schema: "metadataValue"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Any JSON value, including null; typed values persist as entered." |
<!-- bdp-schema:end metadataValue bundle=issue-callables -->

<!-- bdp-schema:start issueObservations bundle=issue-callables -->
### Schema: "issueObservations"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Operational observations about an Issue that change without minting a revision and therefore never appear inside the Bead record: the readiness projection and the claim lease." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "heartbeat_at" | ref "#/$defs/instant" | no | — | "The last heartbeat the lease holder sent." |
| "is_blocked" | boolean | no | — | "The persisted, transitive readiness projection: true while an open blocking Dependency keeps the Issue out of the ready set." |
| "lease_expires_at" | ref "#/$defs/instant" | no | — | "Expiry of the current claim's lease, when one is active." |
| "lease_granted_node" | text | no | — | "The replica that granted the lease; empty means unknown, treated as local." |
<!-- bdp-schema:end issueObservations bundle=issue-callables -->

<!-- bdp-schema:start issueView bundle=issue-callables -->
### Schema: "issueView"

Value: object

Other fields: not allowed

Required order: ["bead", "observations", "dependency_count", "dependent_count", "comment_count"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "An Issue as a callable returns it: the complete Bead record, the operational observations beside it, and the relationship cardinalities the native listings carry. The record is the one Core serves at the Issue's URL." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bead" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/beadRecord" | yes | — | "The Issue's complete Bead record: identity, Type affiliation, revision, properties, metadata." |
| "comment_count" | integer | yes | — | "Number of comments on the Issue." |
| "comments_omitted" | boolean | no | — | "True when comment_count is nonzero and the view carries no comments." |
| "dependency_count" | integer | yes | — | "Number of Issues this one depends on." |
| "dependent_count" | integer | yes | — | "Number of Issues that depend on this one." |
| "observations" | ref "#/$defs/issueObservations" | yes | — | "Lease and readiness observations; an empty object when none apply." |
| "parent" | ref "#/$defs/issueUrl" | no | — | "The parent Issue, computed from the parent-child Dependency, when there is one." |
<!-- bdp-schema:end issueView bundle=issue-callables -->

<!-- bdp-schema:start neighborView bundle=issue-callables -->
### Schema: "neighborView"

Value: object

Other fields: not allowed

Required order: ["link", "issue"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "An Issue on the far end of one Dependency, with the Link that leads to it." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue" | ref "#/$defs/issueView" | yes | — | "The neighbor." |
| "link" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/linkRecord" | yes | — | "The Dependency Link record whose Type says why the neighbor is related." |
<!-- bdp-schema:end neighborView bundle=issue-callables -->

<!-- bdp-schema:start commentRecord bundle=issue-callables -->
### Schema: "commentRecord"

Value: object

Other fields: not allowed

Required order: ["id", "issue", "author", "text", "created_at"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One comment on an Issue. Comments are not Beads in preview-1." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "author" | text | yes | — | "Caller-asserted author." |
| "created_at" | ref "#/$defs/instant" | yes | — | "Stored creation time." |
| "id" | text | yes | — | "The comment's native identifier." |
| "issue" | ref "#/$defs/issueUrl" | yes | — | "The Issue the comment belongs to." |
| "text" | text | yes | — | "The comment body, verbatim." |
<!-- bdp-schema:end commentRecord bundle=issue-callables -->

<!-- bdp-schema:start gateRef bundle=issue-callables -->
### Schema: "gateRef"

Value: object

Other fields: not allowed

Required order: ["id", "type"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One gate actively blocking an Issue." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/issueUrl" | yes | — | "The gate Issue." |
| "reason" | text | no | — | "Why the gate blocks, in the provider's words." |
| "type" | ref "#/$defs/typeUri" | yes | — | "The Dependency Type of the edge that reaches the gate." |
<!-- bdp-schema:end gateRef bundle=issue-callables -->

<!-- bdp-schema:start issueDetails bundle=issue-callables -->
### Schema: "issueDetails"

Value: object

Other fields: not allowed

Required order: ["issue", "dependencies"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The detail view behind the native show command: an issueView plus its neighbors, comments, gates and epic progress." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "comments" | array of (ref "#/$defs/commentRecord") | no | — | "The comment bodies; present only when include_comments was set." |
| "dependencies" | array of (ref "#/$defs/neighborView") | yes | — | "Issues this one depends on, each with its Link; reduced to identity fields when brief_deps was set." |
| "dependents" | array of (ref "#/$defs/neighborView") | no | — | "Issues that depend on this one; present only when include_dependents was set." |
| "epic_closeable" | boolean | no | — | "For an epic, whether every child is closed." |
| "epic_closed_children" | integer | no | — | "For an epic, its closed child count." |
| "epic_total_children" | integer | no | — | "For an epic, its child count." |
| "gated_by" | array of (ref "#/$defs/gateRef") | no | — | "The gates actively blocking this Issue." |
| "issue" | ref "#/$defs/issueView" | yes | — | "The Issue itself." |
| "unresolvable_dependencies" | integer | no | — | "Outgoing edges whose far end has no record in this Scope." |
| "unresolvable_dependents" | integer | no | — | "Incoming edges whose far end has no record in this Scope; present only with include_dependents." |
<!-- bdp-schema:end issueDetails bundle=issue-callables -->

<!-- bdp-schema:start blockedIssueView bundle=issue-callables -->
### Schema: "blockedIssueView"

Value: object

Other fields: not allowed

Required order: ["issue", "blocked_by", "blocked_by_count"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "An Issue the native blocked listing names, with its blockers." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "blocked_by" | array of (ref "#/$defs/issueUrl") | yes | — | "The Issues named as blockers: active blocking targets, else the parent; external references appear as opaque URIs." |
| "blocked_by_count" | integer | yes | — | "The length of blocked_by." |
| "issue" | ref "#/$defs/issueView" | yes | — | "The blocked Issue." |
<!-- bdp-schema:end blockedIssueView bundle=issue-callables -->

<!-- bdp-schema:start treeNode bundle=issue-callables -->
### Schema: "treeNode"

Value: object

Other fields: not allowed

Required order: ["issue", "depth", "truncated"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One node of a walked Dependency tree: the Issue and where the walk reached it. The tree is flat; depth and parent rebuild it in depth-first pre-order." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "deduped" | boolean | no | — | "True on a stub recording only the edge into an Issue already expanded earlier in the answer." |
| "depth" | integer | yes | — | "Distance from the root; the root is 0." |
| "edge_from_parent" | ref "#/$defs/typeUri" | no | — | "The Dependency Type of the edge that led here; absent on the root." |
| "issue" | ref "#/$defs/issueView" | yes | — | "The node." |
| "parent" | ref "#/$defs/issueUrl" | no | — | "The node this one was reached from; absent on the root." |
| "truncated" | boolean | yes | — | "Always false in preview-1: a node beyond max_depth is absent, never flagged." |
<!-- bdp-schema:end treeNode bundle=issue-callables -->

<!-- bdp-schema:start bondRef bundle=issue-callables -->
### Schema: "bondRef"

Value: object

Other fields: not allowed

Required order: ["source_id", "bond_type"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A constituent of a compound molecule." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bond_point" | text | no | — | "Where the bond attaches." |
| "bond_type" | text | yes | — | "The bond kind." |
| "source_id" | ref "#/$defs/issueUrl" | yes | — | "The constituent." |
<!-- bdp-schema:end bondRef bundle=issue-callables -->

<!-- bdp-schema:start dependencyEdge bundle=issue-callables -->
### Schema: "dependencyEdge"

Value: object

Other fields: not allowed

Required order: ["source", "target", "type"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One directed Dependency as a request names it: source, target and Type." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "source" | ref "#/$defs/locator" | yes | — | "The depending Issue." |
| "target" | ref "#/$defs/locator" | yes | — | "The Issue depended upon; an opaque external URI is admitted where the provider admits external references." |
| "type" | ref "#/$defs/typeUri" | yes | — | "The Dependency Type." |
<!-- bdp-schema:end dependencyEdge bundle=issue-callables -->

<!-- bdp-schema:start applyRef bundle=issue-callables -->
### Schema: "applyRef"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Names one Issue inside an applyBatch invocation: either a locator of an existing Issue or the key a create item earlier in the same invocation gave itself. Exactly one member is set." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | no | — | "The key of a create item in this invocation." |
| "locator" | ref "#/$defs/locator" | no | — | "An existing Issue." |
<!-- bdp-schema:end applyRef bundle=issue-callables -->

<!-- bdp-schema:start statistics bundle=issue-callables -->
### Schema: "statistics"

Value: object

Other fields: not allowed

Required order: ["total_issues", "open_issues", "in_progress_issues", "closed_issues", "deferred_issues", "blocked_issues", "ready_issues", "pinned_issues", "epics_eligible_for_closure", "average_lead_time_hours"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Workspace summary counts. Two of them are DEPENDENCY-AWARE and two are structurally always zero; both facts are stated on the properties themselves, because every number here is the same JSON type and nothing else on the wire […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "average_lead_time_hours" | number | yes | — | "ALWAYS 0, for the reason above." |
| "blocked_issues" | schema | yes | — | "Rows the dependency graph blocks — the transitive is_blocked flag, NOT the count of rows whose status is `blocked`. An open row with an unfinished blocker is counted […]" |
| "closed_issues" | integer | yes | — | — |
| "deferred_issues" | integer | yes | — | — |
| "epics_eligible_for_closure" | integer | yes | — | "ALWAYS 0. No implementation computes it, on any backend or either surface. It is documented rather than dropped because this schema is pinned to the struct both […]" |
| "gate_issues" | integer | no | — | "Gate rows, which the default `bd list` suppresses on account of what they are rather than on any filter the caller passed. ALREADY INCLUDED in `total_issues`, which […]" |
| "in_progress_issues" | integer | yes | — | — |
| "open_issues" | integer | yes | — | — |
| "pinned_issues" | integer | yes | — | "Rows carrying the pinned flag, overlapping every status bucket. Always 0 when `assignee` is set: that answer tallies the five statuses and nothing else." |
| "ready_issues" | schema | yes | — | "ARITHMETIC, not a query: `open_issues` minus `blocked_issues`, clamped at zero. It is NOT the cardinality of `GET /v0/beads/ready`, which applies type exclusions, the […]" |
| "template_issues" | integer | no | — | "Template rows, suppressed by the default `bd list` on the same terms as `gate_issues` and likewise already counted in `total_issues`. Do not sum the two: a row can be […]" |
| "total_issues" | integer | yes | — | "Every row in the workspace-wide answer's scan, INCLUDING closed and pinned ones. The status counts below do not sum to it: a row whose status is none of the four […]" |

#### Advanced

```json-schema
{
  "properties": {
    "blocked_issues": {
      "type": [
        "integer",
        "null"
      ]
    },
    "ready_issues": {
      "type": [
        "integer",
        "null"
      ]
    }
  }
}
```
<!-- bdp-schema:end statistics bundle=issue-callables -->

<!-- bdp-schema:start cycle bundle=issue-callables -->
### Schema: "cycle"

Value: object

Other fields: not allowed

Required order: ["members", "partial"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One circular blocking dependency: its members in EDGE ORDER, so `members[i]` blocks on `members[i+1]` and the last member blocks on the first. The closing edge is implied and is not repeated as a final member. The rotation is canonical […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "members" | array of (ref "#/$defs/cycleMember") | yes | — | "The nodes, in edge order, starting at the lowest id. Never empty." |
| "partial" | boolean | yes | — | "True when at least one member has no `issue`. It is always present, including when false: a consumer must be able to read \\"this path is complete\\" from the answer […]" |
<!-- bdp-schema:end cycle bundle=issue-callables -->

<!-- bdp-schema:start cycleMember bundle=issue-callables -->
### Schema: "cycleMember"

Value: object

Other fields: not allowed

Required order: ["id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One node on a dependency cycle. `id` is always present, and its presence is what proves the node is on the cycle. `issue` is the row behind it, and is ABSENT — never null — when this workspace holds no record for that id: a target in […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/issueUrl" | yes | — | — |
| "issue" | ref "#/$defs/issueView" | no | — | — |
<!-- bdp-schema:end cycleMember bundle=issue-callables -->

<!-- bdp-schema:start edgeCount bundle=issue-callables -->
### Schema: "edgeCount"

Value: object

Other fields: not allowed

Required order: ["id", "count", "missing"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One anchor's edge cardinality, or the report that it is not there." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "count" | schema | yes | — | "How many stored edges match, in the requested direction, after the type and status filters. Never negative. It SPANS BOTH DEPENDENCY PLANES and is a SUM over them […]" |
| "id" | ref "#/$defs/issueUrl" | yes | — | "The anchor, spelled exactly as the request spelled it. It is not re-canonicalized: there is no fuzzy, prefix or substring resolution on this surface, so what comes […]" |
| "missing" | boolean | yes | — | "True when no issue and no wisp carries this id. ALWAYS PRESENT, including as `false`. It is the member that keeps this from being a question a caller cannot tell it […]" |

#### Advanced

```json-schema
{
  "properties": {
    "count": {
      "type": "integer"
    }
  }
}
```
<!-- bdp-schema:end edgeCount bundle=issue-callables -->

<!-- bdp-schema:start blockingAnnotation bundle=issue-callables -->
### Schema: "blockingAnnotation"

Value: object

Other fields: not allowed

Required order: ["id", "blocked_by", "blocks"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One issue's derived blocking decoration. `blocked_by` and `blocks` are ASCENDING BY ID with repeats collapsed, and both are always present — an empty array, never null and never absent, so a client reads \\"nothing blocks this\\" from the […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "blocked_by" | array of (ref "#/$defs/issueUrl") | yes | — | "The OPEN issues this one is blocked by: the targets of its `blocks` edges whose own status is not closed." |
| "blocks" | array of (ref "#/$defs/issueUrl") | yes | — | "The issues this one blocks. Empty when this issue is itself closed, which is the same rule `blocked_by` applies from the other end." |
| "id" | ref "#/$defs/issueUrl" | yes | — | "The annotated id, spelled exactly as the request spelled it." |
| "is_blocked" | boolean | no | — | "The issue's stored, transitive is_blocked flag — present only when the request carried `is_blocked=true` (capability `dependencies.blocking.isBlocked`) and the id […]" |
| "parent" | ref "#/$defs/issueUrl" | no | — | "This issue's parent id. AT MOST ONE is reported; where an issue carries several `parent-child` edges, which one appears here is not specified. A client that needs […]" |
<!-- bdp-schema:end blockingAnnotation bundle=issue-callables -->

<!-- bdp-schema:start closeOutcome bundle=issue-callables -->
### Schema: "closeOutcome"

Value: object

Other fields: not allowed

Required order: ["issue_id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "What happened to ONE requested item. `code` IS THE DISCRIMINATOR. Present means the item REFUSED and nothing was written for it; absent means it succeeded, and `issue`, `already_closed` and `open_children` are all present. A client […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "already_closed" | boolean | no | — | "True when the issue was already closed and this item changed nothing — the idempotent re-close, spelled the way `CloseIssueResponse.already_closed` spells it. Present […]" |
| "assignee" | text | no | — | "With `not_assignee`: the issue's assignee the refusing transaction observed, exactly as `Problem.assignee` carries it for the single close. Absent on a successful […]" |
| "auto_closed_molecule" | ref "#/$defs/issueView" | no | — | — |
| "blockers" | array of (ref "#/$defs/blocker") | no | — | "With `not_closable` on the live-blocker refusal: the blockers that refused THIS item, exactly as `Problem.blockers` carries them for the single close, and optional […]" |
| "issue" | ref "#/$defs/issueView" | no | — | — |
| "issue_id" | ref "#/$defs/issueUrl" | yes | — | "The id the caller asked for, echoed verbatim so an outcome can be read without indexing back into the request." |
| "molecule_auto_close_refusal" | text | no | — | "`CloseIssueResponse.molecule_auto_close_refusal` for this item, under `issues.close.autoCloseMolecule`; `auto_closed_molecule` beside it is […]" |
| "open_children" | integer | no | — | "How many open children the transaction observed for this item. ITS MEANING FOLLOWS `code`, and both readings are the ones the single close already publishes. On a […]" |
| "reason" | text | no | — | "This item's refusal as a reason token of §6, or not-found; present means the item refused and nothing was written for it, absent means it succeeded and issue is present." |
<!-- bdp-schema:end closeOutcome bundle=issue-callables -->

<!-- bdp-schema:start blocker bundle=issue-callables -->
### Schema: "blocker"

Value: object

Other fields: not allowed

Required order: ["id", "kind"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One live blocker named by a blocked-issue refusal." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/issueUrl" | yes | — | "The blocker: a local issue id, or the full `external:<project>:<capability>` reference." |
| "kind" | text | yes | — | "`local` for an issue this database holds, which clears when it closes; `external` for an `external:` reference, which clears when the named project ships the […]" |
| "type" | ref "#/$defs/typeUri" | no | — | "The blocking edge's dependency type (`blocks`, `waits-for`, `conditional-blocks`). ABSENT when the refusal did not report it, which is the case for an `external:` […]" |
<!-- bdp-schema:end blocker bundle=issue-callables -->

<!-- bdp-schema:start batchCloseItem bundle=issue-callables -->
### Schema: "batchCloseItem"

Value: object

Other fields: not allowed

Required order: ["id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/locator" | yes | — | "Exact canonical issue id, resolved across BOTH planes. No fuzzy, prefix or substring resolution — `IssueID`'s rule. A DUPLICATE is admissible; see the operation […]" |
| "reason" | schema | no | — | "Why THIS issue is closed. It is per item rather than per request because `bd close a b c --reason x --reason y --reason z` has always mapped them positionally, and […]" |

#### Advanced

```json-schema
{
  "properties": {
    "reason": {
      "type": "string",
      "maxLength": 255
    }
  }
}
```
<!-- bdp-schema:end batchCloseItem bundle=issue-callables -->

<!-- bdp-schema:start reclaimedLease bundle=issue-callables -->
### Schema: "reclaimedLease"

Value: object

Other fields: not allowed

Required order: ["id", "previous_owner", "revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One row a lease sweep reverted." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/issueUrl" | yes | — | "The reverted issue's id." |
| "previous_owner" | text | yes | — | "The assignee the stale lease was taken from; empty when the row carried none." |
| "revision" | text | yes | — | "The row's NEW revision, minted by the revert: the optimistic-concurrency token a guarded write after the reclaim needs. A decimal string, like every `revision` on […]" |
<!-- bdp-schema:end reclaimedLease bundle=issue-callables -->

<!-- bdp-schema:start sweepSkips bundle=issue-callables -->
### Schema: "sweepSkips"

Value: object

Other fields: not allowed

Required order: ["pinned", "referenced", "not_closed", "unknown_closed_at", "closed_at_or_after_cutoff", "unreadable"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The candidates a sweep declined to delete, bucketed by WHY. They are separate counters rather than one number because they mean different things: `pinned`, `referenced`, `live_dependent` and `retention_required` are PROTECTIONS, and the […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "closed_at_or_after_cutoff" | integer | yes | — | "Candidates whose close timestamp did not satisfy `closed_before`. See `not_closed`." |
| "live_dependent" | integer | no | — | "Candidates protected by `protect_live_dependents`. Always 0 when that member is false or absent. Present only behind the `issues.sweep.liveDependents` behavior token." |
| "not_closed" | integer | yes | — | "Candidates the tier query returned that the recheck found were not closed. A NON-ZERO VALUE HERE IS A DEFENSE FIRING, not a normal outcome: the query asked for […]" |
| "pinned" | integer | yes | — | "Candidates protected by the pinned flag. No request member overrides it — a caller who wants a pinned bead gone unpins it first." |
| "referenced" | integer | yes | — | "Candidates protected by `protect_referenced`. Always 0 when that member is false or absent, so a 0 read without having asked says nothing about whether beads are cited." |
| "retention_required" | integer | no | — | "Candidates held back because their issue type is named in the workspace's `types.retained` setting and the request did not set `retain_ids`: such a bead's id is an […]" |
| "unknown_closed_at" | integer | yes | — | "Closed candidates carrying no close timestamp. See `not_closed`." |
| "unreadable" | integer | yes | — | "Rows the tier query returned as nothing at all. A defense of the same kind, on a shape rather than a value." |
<!-- bdp-schema:end sweepSkips bundle=issue-callables -->

<!-- bdp-schema:start batchCreateItem bundle=issue-callables -->
### Schema: "batchCreateItem"

Value: object

Other fields: not allowed

Required order: ["title"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "acceptance_criteria" | text | no | — | — |
| "assignee" | schema | no | — | — |
| "dependencies" | array of (ref "#/$defs/batchCreateDependency") | no | — | "The edges this issue is created carrying. They are written in the same transaction as the issue, so this operation never publishes an issue whose declared […]" |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "labels" | schema | no | — | — |
| "priority" | schema | no | — | "0 is P0/critical. Absent means the create default, P2 (`2`), on a server advertising `issues.create.defaultPriority`; such a server never reads an absent member as […]" |
| "title" | schema | yes | — | — |
| "type" | ref "#/$defs/typeUri" | no | — | "Issue type. Spelled `issue_type` rather than `type`, matching the member `Issue` carries, and validated against the built-ins plus the workspace's configured custom […]" |

#### Advanced

```json-schema
{
  "properties": {
    "assignee": {
      "type": "string",
      "maxLength": 255
    },
    "labels": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 255
      }
    },
    "priority": {
      "type": "integer",
      "minimum": 0,
      "maximum": 4
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    }
  }
}
```
<!-- bdp-schema:end batchCreateItem bundle=issue-callables -->

<!-- bdp-schema:start batchCreateDependency bundle=issue-callables -->
### Schema: "batchCreateDependency"

Value: object

Other fields: not allowed

Required order: ["target", "type"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "target" | ref "#/$defs/locator" | yes | — | "The far end of the edge: an issue this workspace holds, an `external:` reference, or an id whose prefix belongs to another repository. Anything else is a `400` and […]" |
| "type" | ref "#/$defs/typeUri" | yes | — | "The edge type, from the same OPEN vocabulary `Dependency.type` carries. It is spelled `type` because that is the member an edge carries everywhere else on this surface." |
<!-- bdp-schema:end batchCreateDependency bundle=issue-callables -->

<!-- bdp-schema:start applyItem bundle=issue-callables -->
### Schema: "applyItem"

Value: object

Other fields: not allowed

Required order: ["kind"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One item of a plan: a `kind` naming what it does, plus exactly one payload member matching it. IT IS A TAGGED SINGLE-SHAPE OBJECT rather than a polymorphic one, and the spelling is deliberate. This document uses no `oneOf`, `anyOf` or […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "close" | ref "#/$defs/applyCloseItem" | no | — | — |
| "create" | ref "#/$defs/applyCreateItem" | no | — | — |
| "dep_add" | ref "#/$defs/applyDepAddItem" | no | — | — |
| "kind" | schema | yes | — | "Which member below is read. A CLOSED set, unlike a dependency `type`: every value here is a verb this operation implements, and an unknown one is a request the server […]" |
| "update" | ref "#/$defs/applyUpdateItem" | no | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "kind": {
      "type": "string",
      "enum": [
        "create",
        "update",
        "close",
        "dep_add"
      ]
    }
  }
}
```
<!-- bdp-schema:end applyItem bundle=issue-callables -->

<!-- bdp-schema:start applyCreateItem bundle=issue-callables -->
### Schema: "applyCreateItem"

Value: object

Other fields: not allowed

Required order: ["title"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Creates one issue and optionally NAMES it, so later items can reach the row without knowing an id the request has not minted yet. It publishes the whole create vocabulary rather than `POST /v0/beads/issues:batchCreate`'s narrow one, and […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "acceptance_criteria" | text | no | — | — |
| "assignee" | schema | no | — | — |
| "await_id" | schema | no | — | "The gate's condition identifier (a run id, a PR number, a `bead:<id>`). Opaque here; at most 255 characters, the stored column's width, and a longer value is a `400` […]" |
| "await_type" | schema | no | — | "The gate's await condition type (`gh:run`, `gh:pr`, `timer`, `human`, `bead`, or a formula-defined type). Free-form: there is no vocabulary, and any issue type may […]" |
| "defer_until" | ref "#/$defs/instant" | no | — | "RFC 3339. The issue is hidden from ready work until then." |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "due_at" | ref "#/$defs/instant" | no | — | "RFC 3339." |
| "ephemeral" | schema | no | — | "Creates the issue on the EPHEMERAL plane rather than the durable one. Per item, exactly as it is for `POST /v0/beads/issues:batchCreate`, so one request may create […]" |
| "estimated_minutes" | integer | no | — | "An estimate in minutes. Absent leaves it unset." |
| "external_ref" | schema | no | — | — |
| "id" | ref "#/$defs/locator" | no | — | "An explicit id for the new row, CREATE-ONLY: an id that already names a stored row is a `409` `already_exists` and the whole request is refused — never an adoption […]" |
| "key" | schema | no | — | "This item's name inside the request. OPTIONAL — an item nothing refers to needs no name — and unique across the request's create items; a repeat is a `400`. It is […]" |
| "labels" | schema | no | — | "The complete label set the issue is created with. Authoritative, not a patch — a create has nothing to add to." |
| "metadata" | ref "#/$defs/metadataValue" | no | — | — |
| "no_history" | schema | no | — | "Creates the issue on the ephemeral plane WITHOUT history, and without the garbage collection an ordinary ephemeral row is eligible for. Mutually exclusive with […]" |
| "notes" | text | no | — | — |
| "owner" | schema | no | — | "The human owner, which is a different member from `assignee`: the assignee is who is working it now, the owner is who it is attributed to." |
| "priority" | schema | no | — | "0 is P0/critical. Absent means the create default, P2 (`2`), on a server advertising `issues.create.defaultPriority`; such a server never reads an absent member as […]" |
| "sender" | schema | no | — | "Who sent this, for the message-shaped rows a plan creates. Stored verbatim and interpreted by nothing on this surface." |
| "status" | schema | no | — | "The status the issue is created in, from this workspace's own configured vocabulary. Absent means the workspace default." |
| "timeout" | schema | no | — | "The gate's timeout in NANOSECONDS, the encoding `Issue.timeout` reads back. A negative value is a `400` naming this member. Requires the behavior token […]" |
| "title" | schema | yes | — | — |
| "type" | ref "#/$defs/typeUri" | no | — | "Issue type. Spelled `issue_type` rather than `type`, matching the member `Issue` carries, and validated against the built-ins plus the workspace's configured custom […]" |
| "waiters" | array of text | no | — | "The addresses woken when the gate clears, stored as sent: duplicates are kept and nothing is trimmed, as a local create stores them. The list's JSON encoding must fit […]" |

#### Advanced

```json-schema
{
  "properties": {
    "assignee": {
      "type": "string",
      "maxLength": 255
    },
    "await_id": {
      "type": "string",
      "maxLength": 255
    },
    "await_type": {
      "type": "string",
      "maxLength": 32
    },
    "ephemeral": {
      "type": "boolean",
      "default": false
    },
    "external_ref": {
      "type": "string",
      "maxLength": 255
    },
    "key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "labels": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 255
      }
    },
    "no_history": {
      "type": "boolean",
      "default": false
    },
    "owner": {
      "type": "string",
      "maxLength": 255
    },
    "priority": {
      "type": "integer",
      "minimum": 0,
      "maximum": 4
    },
    "sender": {
      "type": "string",
      "maxLength": 255
    },
    "status": {
      "type": "string",
      "maxLength": 255
    },
    "timeout": {
      "type": "integer",
      "minimum": 0
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    }
  }
}
```
<!-- bdp-schema:end applyCreateItem bundle=issue-callables -->

<!-- bdp-schema:start applyUpdateItem bundle=issue-callables -->
### Schema: "applyUpdateItem"

Value: object

Other fields: not allowed

Required order: ["target", "patch"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Patches one existing issue, under `PATCH /v0/beads/issues/{id}`'s rules. The two carry the same preconditions and the same force flags; what is this operation's alone is that its guards evaluate AS-MODIFIED — against the row as earlier […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "expected_assignee" | schema | no | — | "Requires the issue's assignee to equal this value, evaluated as-modified. A match AUTHORIZES the requested `patch.assignee` transfer: this compare-and-set replaces […]" |
| "expected_revision" | text | no | — | "Requires the subject's current revision to equal this opaque token before anything is written; a miss is revision-mismatch and nothing is written." |
| "expected_status" | schema | no | — | "Requires the issue's status to equal this value, evaluated AS-MODIFIED — against the row as this request has already changed it at this item's position. A miss […]" |
| "force_assignee_transfer" | schema | no | — | "Bypasses ONLY a genuine transfer away from a live foreign in-progress owner. Reasserting the exact current assignee is idempotent and needs no force. It requires […]" |
| "force_close_policy" | schema | no | — | "Bypasses ONLY close policy — the open-children refusal and the live blocker refusal — for a `patch.status` that crosses into the workspace's done category. It has no […]" |
| "force_notes_overwrite" | schema | no | — | "Bypasses ONLY the refusal on a `patch.notes` that would replace existing non-empty notes with different non-empty content (an explicit clear is not fenced). It […]" |
| "patch" | ref "#/$defs/applyPatch" | yes | — | — |
| "target" | ref "#/$defs/applyRef" | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "expected_assignee": {
      "type": "string",
      "maxLength": 255
    },
    "expected_status": {
      "type": "string",
      "maxLength": 255
    },
    "force_assignee_transfer": {
      "type": "boolean",
      "default": false
    },
    "force_close_policy": {
      "type": "boolean",
      "default": false
    },
    "force_notes_overwrite": {
      "type": "boolean",
      "default": false
    }
  }
}
```
<!-- bdp-schema:end applyUpdateItem bundle=issue-callables -->

<!-- bdp-schema:start applyPatch bundle=issue-callables -->
### Schema: "applyPatch"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The fields an `update` item writes. Every member is optional and PRESENCE is the signal: a member present is written, a member absent is untouched. An empty object is a `400` — a write that writes nothing is a client bug. It mirrors […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "acceptance_criteria" | text | no | — | — |
| "append_notes" | text | no | — | "Appends to the notes rather than replacing them. Mutually exclusive with `notes`." |
| "assignee" | schema | no | — | "The assignee. A transfer away from a live foreign in-progress owner is refused with `409 already_claimed` unless `force_assignee_transfer` is set or […]" |
| "await_id" | schema | no | — | "Replaces the gate's condition identifier; the empty string clears it. Not nullable. At most 255 characters, the stored column's width; a longer value is a `400` […]" |
| "defer_until" | ref "#/$defs/instant" | no | — | "RFC 3339. Explicit `null` CLEARS the deferral." |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "due_at" | ref "#/$defs/instant" | no | — | "RFC 3339. Explicit `null` CLEARS the due date." |
| "estimated_minutes" | schema | no | — | "Explicit `null` CLEARS the estimate." |
| "external_ref" | schema | no | — | "Explicit `null` CLEARS the reference." |
| "labels" | ref "#/$defs/labelPatch" | no | — | — |
| "metadata" | ref "#/$defs/metadataPatch" | no | — | — |
| "notes" | text | no | — | "Replaces the notes. Mutually exclusive with `append_notes`; sending both is a `400`. Replacing EXISTING non-empty notes with different non-empty content is refused […]" |
| "owner" | schema | no | — | — |
| "priority" | schema | no | — | — |
| "status" | schema | no | — | "The issue's status, from this workspace's own configured vocabulary. A STATUS THAT CROSSES INTO THE DONE CATEGORY ANSWERS TO CLOSE POLICY: the item is refused with […]" |
| "title" | schema | no | — | "Must not be blank after trimming; the length bound is what the column holds." |
| "type" | ref "#/$defs/typeUri" | no | — | "The issue type, from this workspace's own configured vocabulary. A type outside it is refused by the ROLE and reaches the client as a `400`." |
| "waiters" | array of text | no | — | "A WHOLE-VALUE replacement of the gate's waiter list; `[]` clears it. Not nullable. Stored as sent (duplicates kept: deduplicating is the caller's, as `bd gate add- […]" |

#### Advanced

```json-schema
{
  "properties": {
    "assignee": {
      "type": "string",
      "maxLength": 255
    },
    "await_id": {
      "type": "string",
      "maxLength": 255
    },
    "estimated_minutes": {
      "type": [
        "integer",
        "null"
      ]
    },
    "external_ref": {
      "type": [
        "string",
        "null"
      ],
      "maxLength": 255
    },
    "owner": {
      "type": "string",
      "maxLength": 255
    },
    "priority": {
      "type": "integer",
      "minimum": 0,
      "maximum": 4
    },
    "status": {
      "type": "string",
      "maxLength": 255
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    }
  }
}
```
<!-- bdp-schema:end applyPatch bundle=issue-callables -->

<!-- bdp-schema:start labelPatch bundle=issue-callables -->
### Schema: "labelPatch"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "An ordered label edit: `replace` first, then `add`, then `remove`, so REMOVAL WINS when the same label appears in more than one member. It is the full patch rather than `IssuePatchBody.labels`' complete replacement because a plan edits […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "add" | schema | no | — | "Labels to add after any replacement." |
| "remove" | schema | no | — | "Labels to remove after replacement and addition." |
| "replace" | schema | no | — | "The complete starting label set. An empty array CLEARS every label; omitting the member leaves the current set as the starting point." |

#### Advanced

```json-schema
{
  "properties": {
    "add": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 255
      }
    },
    "remove": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 255
      }
    },
    "replace": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 255
      }
    }
  }
}
```
<!-- bdp-schema:end labelPatch bundle=issue-callables -->

<!-- bdp-schema:start metadataPatch bundle=issue-callables -->
### Schema: "metadataPatch"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A metadata edit. `replace` is mutually exclusive with the other three; without it the edits apply as `merge`, then `set` in key order, then `unset`, so UNSETTING A KEY WINS over setting or merging it. Sending `replace` beside any of the […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "merge" | ref "#/$defs/metadataValue" | no | — | — |
| "replace" | ref "#/$defs/metadataValue" | no | — | — |
| "set" | object | no | — | "Individual top-level keys to write, in deterministic key order. A value present holding `null` writes JSON null; a key is removed with `unset`, never by sending a […]" |
| "unset" | schema | no | — | "Top-level keys to remove, applied after every other edit." |

#### Advanced

```json-schema
{
  "properties": {
    "unset": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 255
      }
    }
  }
}
```
<!-- bdp-schema:end metadataPatch bundle=issue-callables -->

<!-- bdp-schema:start applyCloseItem bundle=issue-callables -->
### Schema: "applyCloseItem"

Value: object

Other fields: not allowed

Required order: ["target"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Closes one existing issue, under `POST /v0/beads/issues/{id}:close`'s rules including first-close-wins." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "expected_revision" | text | no | — | "Requires the subject's current revision to equal this opaque token before anything is written; a miss is revision-mismatch and nothing is written." |
| "force" | schema | no | — | "Bypasses close policy — the open-children refusal and the live-blocker refusal — and the pin and the assignee guard, and nothing else: never the template guard. CLOSE […]" |
| "reason" | schema | no | — | "Why the issue is closed, stored and read back as `close_reason`. THE FIRST CLOSE WINS: an idempotent re-close writes neither this nor `session`." |
| "session" | schema | no | — | "The working session that closed the issue, stored and read back as `closed_by_session`, under the same first-close-wins rule." |
| "target" | ref "#/$defs/applyRef" | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "force": {
      "type": "boolean",
      "default": false
    },
    "reason": {
      "type": "string",
      "maxLength": 255
    },
    "session": {
      "type": "string",
      "maxLength": 255
    }
  }
}
```
<!-- bdp-schema:end applyCloseItem bundle=issue-callables -->

<!-- bdp-schema:start applyDepAddItem bundle=issue-callables -->
### Schema: "applyDepAddItem"

Value: object

Other fields: not allowed

Required order: ["source", "target", "type"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Asserts ONE dependency edge, under `POST /v0/beads/dependencies:add`'s rules. An edge from a row to itself is a `400`. A TARGET NEED NOT BE A ROW THIS DATABASE HOLDS: an `external:` reference and an id belonging to another repository […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_spawner" | boolean | no | — | "Gated by `issues.batchApply.depAddLineage`. Ignored for every `type` but `waits-for`: on a `waits-for` edge, `true` stamps `metadata.spawner_id` with this item's […]" |
| "metadata" | ref "#/$defs/metadataValue" | no | — | — |
| "source" | ref "#/$defs/applyRef" | yes | — | — |
| "target" | ref "#/$defs/applyRef" | yes | — | — |
| "thread_id" | schema | no | — | "Gated by `issues.batchApply.depAddLineage`. A plain column on the stored edge, separate from `metadata`'s blob — the graph-plan thread this edge belongs to, for a […]" |
| "type" | ref "#/$defs/typeUri" | yes | — | "The edge type, from the same OPEN vocabulary `Dependency.type` carries: checked for BEING a storable value, never for membership of a known-types list, so a […]" |

#### Advanced

```json-schema
{
  "properties": {
    "thread_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    }
  }
}
```
<!-- bdp-schema:end applyDepAddItem bundle=issue-callables -->

<!-- bdp-schema:start applyItemResult bundle=issue-callables -->
### Schema: "applyItemResult"

Value: object

Other fields: not allowed

Required order: ["kind", "issue", "changed", "revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "What ONE item did, at the index the item occupied. IT IS LEAN, AND CARRIES NO ISSUE. Every other write on this surface answers with the stored row; this one answers with ids and a revision, and a client that wants the rows reads them […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "changed" | boolean | yes | — | "Whether this item persisted a semantic mutation. A `create` is always true. An `update` and a `close` follow their own operations' `changed`/`already_closed` answers, […]" |
| "depends_on" | ref "#/$defs/issueUrl" | no | — | "The target of a dep_add; absent for every other kind." |
| "issue" | ref "#/$defs/issueUrl" | yes | — | "The Issue the item acted on: the minted or explicit identity for a create, the resolved target for an update or a close, the source for a dep_add." |
| "kind" | schema | yes | — | "Echoes the item's kind, so a caller walking the results does not have to walk the request alongside them." |
| "revision" | text | yes | — | "The row's optimistic-concurrency token AFTER the item, and the value an `expected_version` guard is composed from. The same member the CLI's detail view publishes […]" |

#### Advanced

```json-schema
{
  "properties": {
    "kind": {
      "type": "string",
      "enum": [
        "create",
        "update",
        "close",
        "dep_add"
      ]
    }
  }
}
```
<!-- bdp-schema:end applyItemResult bundle=issue-callables -->

<!-- bdp-schema:start setting bundle=issue-callables -->
### Schema: "setting"

Value: object

Other fields: not allowed

Required order: ["key", "redacted"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One entry of the workspace's stored settings plane. THIS SCHEMA IS DELIBERATELY NOT `x-go-type`-PINNED, and it is one of the two ROW schemas on this surface that is not — `Memory` is the other. (Envelopes and page wrappers are unpinned […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The setting's key, echoed verbatim." |
| "redacted" | boolean | yes | — | "True when `value` is withheld because the KEY marks the setting as credential-bearing — the name contains `token`, `secret`, `password`, or an API-key spelling. It is […]" |
| "value" | text | no | — | "The stored value, verbatim. ABSENT MEANS ONE OF TWO THINGS, and `redacted` says which. With `redacted: false` the workspace stores nothing for this key OR stores the […]" |
<!-- bdp-schema:end setting bundle=issue-callables -->

<!-- bdp-schema:start memory bundle=issue-callables -->
### Schema: "memory"

Value: object

Other fields: not allowed

Required order: ["key", "value"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One entry of the workspace's persistent memory plane. NOT `x-go-type`-PINNED, for the reason `Setting` is not: the CLI marshals an ad-hoc map per verb, so there is no canonical Go struct whose JSON encoding is this contract, and minting […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The memory's key, echoed verbatim." |
| "value" | text | yes | — | "The stored content, verbatim: newlines, surrounding space and unicode as stored, never truncated and never withheld. Always present. It is the empty string only where […]" |
<!-- bdp-schema:end memory bundle=issue-callables -->

<!-- bdp-schema:start rememberedMemory bundle=issue-callables -->
### Schema: "rememberedMemory"

Value: object

Other fields: not allowed

Required order: ["key", "value", "replaced"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One stored memory, plus whether storing it overwrote a previous value. It is `Memory`'s shape with `replaced` added rather than a composition of it, because this document repeats property lists instead of using `allOf` (see the note at […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key the memory now lives under: the one the request supplied, or the one derived from `content`. Recall it under exactly these bytes." |
| "replaced" | boolean | yes | — | "True when a previous value existed under `key` and this request overwrote it; false when the key was new. It is observed in the same transaction as the write, so it […]" |
| "value" | text | yes | — | "The stored content, echoed verbatim. Always present, and never withheld — this plane has no redaction; see the operation description." |
<!-- bdp-schema:end rememberedMemory bundle=issue-callables -->

<!-- bdp-schema:start removedSetting bundle=issue-callables -->
### Schema: "removedSetting"

Value: object

Other fields: not allowed

Required order: ["key"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The outcome of removing one setting. IT CARRIES THE KEY AND NOTHING ELSE, and the absence is the contract rather than an unfinished shape. There is no `removed` flag because the storage seam discards the affected-row count on every […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key that now holds nothing, echoed verbatim." |
<!-- bdp-schema:end removedSetting bundle=issue-callables -->

<!-- bdp-schema:start eventRecord bundle=issue-callables -->
### Schema: "eventRecord"

Value: object

Other fields: not allowed

Required order: ["seq", "ts", "op", "issue_id", "issue"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One record of the durable events journal: a single committed issue mutation, as a replaying consumer receives it. THIS IS THE CLI'S RECORD. It is pinned to the same Go struct `bd events tail` and `bd events export` marshal one per line, […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "comment" | object | no | — | "On `comment` only: `{\\"id\\",\\"author\\",\\"text\\",\\"created_at\\",\\"source\\"}`. Absent on every other op." |
| "dep" | object | no | — | "On `dep_add` and `dep_remove` only: `{\\"kind\\",\\"target\\",\\"metadata\\"}` for the edge. Absent on every other op. `metadata` differs in PROVENANCE between the two: on […]" |
| "issue" | object | yes | — | "The full issue state after the mutation — the same object shape `Issue` describes — or `null` on a delete. Always present. A post-image of a wisp-plane record carries […]" |
| "issue_id" | ref "#/$defs/issueUrl" | yes | — | "The mutated issue's canonical id." |
| "op" | text | yes | — | "What was done: `create`, `update`, `close`, `delete`, `dep_add`, `dep_remove` or `comment`. The set is closed in v0; a client MUST default-branch on an unknown value […]" |
| "seq" | schema | yes | — | "Counter-assigned inside the mutation's own transaction: gapless, strictly increasing in commit order, never reused and never reset. This is the value to pass back as […]" |
| "ts" | text | yes | — | "UTC insert time, stamped inside the committing transaction and normalized to RFC 3339. It is NOT monotone in `seq`: two writers against one SQL server, or a clock […]" |

#### Advanced

```json-schema
{
  "properties": {
    "seq": {
      "type": "integer"
    }
  }
}
```
<!-- bdp-schema:end eventRecord bundle=issue-callables -->

<!-- bdp-schema:start listReadyWorkArguments bundle=issue-callables -->
### Schema: "listReadyWorkArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of listReadyWork." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "assignee" | text | no | — | "Only issues assigned to this actor." |
| "brief" | schema | no | — | "Omit the free-form text from every item: `description`, `design`, `acceptance_criteria`, `notes`, `payload` and `waiters` are not selected. Filtering is unaffected, […]" |
| "exclude_label" | array of text | no | — | "Labels that must not be present." |
| "exclude_type" | array of (ref "#/$defs/typeUri") | no | — | "Issue types to exclude. Repeat the parameter, or pass a comma-separated list. Ignored when `type` is set." |
| "has_metadata_key" | text | no | — | "Only issues carrying this top-level metadata key." |
| "include_deferred" | schema | no | — | "Include issues whose `defer_until` is still in the future." |
| "include_ephemeral" | schema | no | — | "Include ephemeral (non-synced) rows." |
| "label" | array of text | no | — | "Labels that must ALL be present (AND)." |
| "label_any" | array of text | no | — | "Labels of which at least one must be present (OR)." |
| "label_pattern" | text | no | — | "Glob matched against labels." |
| "label_regex" | text | no | — | "Regular expression matched against labels, compiled by the database in its own dialect. A pattern it cannot compile is a 400 `invalid_value` on this parameter." |
| "limit" | schema | no | — | "Maximum number of items to return. `0` means unlimited, exactly as `bd ready --limit 0` does — the two surfaces read the same shared default and the same zero […]" |
| "metadata_field" | array of text | no | — | "Top-level metadata equality filter as `key=value`, split on the first `=`. Repeatable. An invalid key is a 400." |
| "parent" | ref "#/$defs/locator" | no | — | "Restrict to recursive descendants of this issue." |
| "priority" | integer | no | — | "Exact priority (0 is a real value, not \\"unset\\")." |
| "sort" | schema | no | — | "Ready-work ordering. `priority` is priority-first; `hybrid` orders recent issues by priority and older ones by age; `oldest` is creation order. An unrecognized value […]" |
| "type" | ref "#/$defs/typeUri" | no | — | "Issue type. The only normalization is shorthand ALIAS expansion, exactly what `bd ready --type` does: `mr` → `merge-request`, `feat` → `feature`, `mol` → `molecule`, […]" |
| "unassigned" | boolean | no | — | "Only issues with no assignee." |

#### Advanced

```json-schema
{
  "properties": {
    "brief": {
      "type": "boolean",
      "default": false
    },
    "include_deferred": {
      "type": "boolean",
      "default": false
    },
    "include_ephemeral": {
      "type": "boolean",
      "default": false
    },
    "limit": {
      "type": "integer",
      "minimum": 0,
      "default": 100
    },
    "sort": {
      "type": "string",
      "enum": [
        "hybrid",
        "priority",
        "oldest"
      ],
      "default": "priority"
    }
  }
}
```
<!-- bdp-schema:end listReadyWorkArguments bundle=issue-callables -->

<!-- bdp-schema:start readyPage bundle=issue-callables -->
### Schema: "readyPage"

Value: object

Other fields: not allowed

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | "True when the limit truncated the result. There is no cursor on this operation; narrow the filters or raise the limit." |
| "items" | array of (ref "#/$defs/issueView") | yes | — | "Empty array (never null) when nothing is ready." |
<!-- bdp-schema:end readyPage bundle=issue-callables -->

<!-- bdp-schema:start countReadyWorkArguments bundle=issue-callables -->
### Schema: "countReadyWorkArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of countReadyWork." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "assignee" | text | no | — | "Only issues assigned to this actor." |
| "exclude_label" | array of text | no | — | "Labels that must not be present." |
| "exclude_type" | array of (ref "#/$defs/typeUri") | no | — | "Issue types to exclude. Repeat the parameter, or pass a comma-separated list. Ignored when `type` is set." |
| "has_metadata_key" | text | no | — | "Only issues carrying this top-level metadata key." |
| "include_deferred" | schema | no | — | "Include issues whose `defer_until` is still in the future." |
| "include_ephemeral" | schema | no | — | "Include ephemeral (non-synced) rows, which the count merges exactly as the listing lists them." |
| "label" | array of text | no | — | "Labels that must ALL be present (AND)." |
| "label_any" | array of text | no | — | "Labels of which at least one must be present (OR)." |
| "label_pattern" | text | no | — | "Glob matched against labels." |
| "label_regex" | text | no | — | "Regular expression matched against labels, compiled by the database in its own dialect. A pattern it cannot compile is a 400 `invalid_value` on this parameter." |
| "metadata_field" | array of text | no | — | "Top-level metadata equality filter as `key=value`, split on the first `=`. Repeatable. An invalid key is a 400." |
| "parent" | ref "#/$defs/locator" | no | — | "Restrict to recursive descendants of this issue." |
| "priority" | integer | no | — | "Exact priority (0 is a real value, not \\"unset\\")." |
| "type" | ref "#/$defs/typeUri" | no | — | "Issue type, with the shorthand alias expansion and the match-nothing-rather-than-fail treatment `GET /v0/beads/ready` documents. Setting it drops the default type […]" |
| "unassigned" | boolean | no | — | "Only issues with no assignee." |

#### Advanced

```json-schema
{
  "properties": {
    "include_deferred": {
      "type": "boolean",
      "default": false
    },
    "include_ephemeral": {
      "type": "boolean",
      "default": false
    }
  }
}
```
<!-- bdp-schema:end countReadyWorkArguments bundle=issue-callables -->

<!-- bdp-schema:start readyCount bundle=issue-callables -->
### Schema: "readyCount"

Value: object

Other fields: not allowed

Required order: ["total"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The size of a ready set. It carries no items, no `has_more` and no cursor: this is a number about a set, and the operation that returns rows is `GET /v0/beads/ready`. It is NOT `x-go-type`-pinned, unlike the seven schemas above, and […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "total" | schema | yes | — | "How many items `GET /v0/beads/ready` would return for these filters with `limit=0`. Never negative; 0 when nothing is ready, which is a 200 rather than a 404 — a […]" |

#### Advanced

```json-schema
{
  "properties": {
    "total": {
      "type": "integer"
    }
  }
}
```
<!-- bdp-schema:end readyCount bundle=issue-callables -->

<!-- bdp-schema:start listBlockedIssuesArguments bundle=issue-callables -->
### Schema: "listBlockedIssuesArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of listBlockedIssues." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "exclude_label" | array of text | no | — | "Labels that must all be absent." |
| "label" | array of text | no | — | "Labels that must ALL be present (AND). Each value is trimmed, and blank and repeated values are dropped, as `bd blocked --label` does." |
| "label_any" | array of text | no | — | "Labels of which at least one must be present (OR)." |
| "parent" | ref "#/$defs/locator" | no | — | "Only the parent's direct children (a parent-child edge) and ids under it in the dotted hierarchy, as `bd blocked --parent` narrows." |
<!-- bdp-schema:end listBlockedIssuesArguments bundle=issue-callables -->

<!-- bdp-schema:start blockedPage bundle=issue-callables -->
### Schema: "blockedPage"

Value: object

Other fields: not allowed

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | "Always false in v0: this operation takes no limit, so the listing is never truncated. Present so that adding a bound later is additive." |
| "items" | array of (ref "#/$defs/blockedIssueView") | yes | — | "Empty array (never null) when nothing is blocked." |
<!-- bdp-schema:end blockedPage bundle=issue-callables -->

<!-- bdp-schema:start getStatsArguments bundle=issue-callables -->
### Schema: "getStatsArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of getStats." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "assignee" | text | no | — | "Answer for ONE ACTOR instead of the workspace. Used as written: no trimming, no case folding, no alias expansion. An empty value is a 400 — the workspace-wide […]" |
| "skip_blocked" | schema | no | — | "Ask for the answer WITHOUT the blocked-set scan, which is the expensive half of this query on a large workspace — the same request `bd status --no-blocked` makes. IT […]" |

#### Advanced

```json-schema
{
  "properties": {
    "skip_blocked": {
      "type": "boolean",
      "default": false
    }
  }
}
```
<!-- bdp-schema:end getStatsArguments bundle=issue-callables -->

<!-- bdp-schema:start statsResult bundle=issue-callables -->
### Schema: "statsResult"

Value: object

Other fields: not allowed

Required order: ["summary", "blocked_count_skipped"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The same envelope `bd status --json` prints, minus one member: the CLI also carries `recent_activity`, which every shipped code path leaves absent, so it is not published here." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "blocked_count_skipped" | boolean | yes | — | "True when the summary came back without the blocked-set scan, which is exactly `summary.blocked_issues == null`. It is DERIVED from the answer rather than echoed from […]" |
| "summary" | ref "#/$defs/statistics" | yes | — | — |
<!-- bdp-schema:end statsResult bundle=issue-callables -->

<!-- bdp-schema:start listIssuesArguments bundle=issue-callables -->
### Schema: "listIssuesArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of listIssues." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "all" | schema | no | — | "Drop the default status exclusions (closed plus any custom statuses in the done/frozen categories). Redundant when `status` is set, which drops them already." |
| "assignee" | text | no | — | "Only issues assigned to this actor." |
| "brief" | schema | no | — | "Omit the free-form text from every item: `description`, `design`, `acceptance_criteria`, `notes`, `payload` and `waiters` are not selected. Filtering is unaffected, […]" |
| "closed_after" | ref "#/$defs/instant" | no | — | "Only issues closed strictly after this instant: `bd list --closed-after`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the […]" |
| "closed_before" | ref "#/$defs/instant" | no | — | "Only issues closed strictly before this instant: `bd list --closed-before`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the […]" |
| "created_after" | ref "#/$defs/instant" | no | — | "Only issues created strictly after this instant. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second before it is […]" |
| "created_before" | ref "#/$defs/instant" | no | — | "Only issues created strictly before this instant. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second before it is […]" |
| "cursor" | text | no | — | "Opaque keyset position, taken verbatim from a previous response's `next_cursor`. Clients MUST NOT construct, parse or mutate it: its encoding is server-private and […]" |
| "defer_after" | ref "#/$defs/instant" | no | — | "Only issues deferred until strictly after this instant: `bd list --defer-after`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to […]" |
| "defer_before" | ref "#/$defs/instant" | no | — | "Only issues deferred until strictly before this instant: `bd list --defer-before`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated […]" |
| "deferred" | schema | no | — | "Only deferred issues: `bd list --deferred`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with […]" |
| "desc_contains" | text | no | — | "Case-insensitive substring match on the description: `bd list --desc-contains`. Behind the `issues.list.filters` behavior token: an older server answers […]" |
| "due_after" | ref "#/$defs/instant" | no | — | "Only issues due strictly after this instant: `bd list --due-after`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second […]" |
| "due_before" | ref "#/$defs/instant" | no | — | "Only issues due strictly before this instant: `bd list --due-before`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second […]" |
| "empty_description" | schema | no | — | "Only issues with an empty description: `bd list --empty-description`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for […]" |
| "exclude_label" | array of text | no | — | "Labels that must not be present." |
| "exclude_status" | array of text | no | — | "Statuses to leave out (repeat the parameter; a value may also be comma-separated), on top of what `status` or the default exclusions select; it never re-admits a row […]" |
| "exclude_type" | array of (ref "#/$defs/typeUri") | no | — | "Issue types to leave out (repeat the parameter; a value may also be comma-separated): `bd list --exclude-type`. Normalized by the role as the local listing normalizes […]" |
| "external_contains" | text | no | — | "Substring match on the external reference: `bd list --external-contains`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` […]" |
| "external_ref" | text | no | — | "Exact match on the external reference: `bd list --external-ref`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this […]" |
| "has_metadata_key" | text | no | — | "Only issues carrying this top-level metadata key." |
| "id" | array of (ref "#/$defs/locator") | no | — | "Restrict to these canonical ids (repeat the parameter). AND-ed with every other filter, including the default exclusions, so a caller addressing rows regardless of […]" |
| "include_ephemeral" | schema | no | — | "Include the ephemeral tier — ephemeral rows and the non-synced rows stored beside them — merged into the same order as the durable ones, whichever order `sort` named. […]" |
| "include_gates" | schema | no | — | "Include gate issues." |
| "include_infra" | schema | no | — | "Include the workspace's configured infrastructure issue types. This also admits the ephemeral plane those types live in, so it is strictly wider than `include_ephemeral`." |
| "include_templates" | schema | no | — | "Include template molecules." |
| "label" | array of text | no | — | "Labels that must ALL be present (AND)." |
| "label_any" | array of text | no | — | "Labels of which at least one must be present (OR)." |
| "label_pattern" | text | no | — | "Glob label filter: `bd list --label-pattern`, with `GET /v0/beads/ready`'s spelling. Behind the `issues.list.filters` behavior token: an older server answers […]" |
| "label_regex" | text | no | — | "Regular-expression label filter: `bd list --label-regex`, with `GET /v0/beads/ready`'s spelling. A pattern the database cannot compile is a 400 `invalid_value` on […]" |
| "limit" | schema | no | — | "Maximum number of items to return. `0` means unlimited, exactly as `bd list --limit 0` does — the two surfaces read the same shared default and the same zero […]" |
| "metadata_field" | array of text | no | — | "Top-level metadata equality filter as `key=value`, split on the first `=`. Repeatable. An invalid key is a 400." |
| "mol_type" | schema | no | — | "Only molecules of this type: `bd list --mol-type`. Any other value, including an empty one, is a 400 naming the parameter. Behind the `issues.list.filters` behavior […]" |
| "no_assignee" | schema | no | — | "Only issues with no assignee: `bd list --no-assignee`, handed to the role as written beside the other filters. Behind the `issues.list.noAssignee` behavior token: an […]" |
| "no_labels" | schema | no | — | "Only issues carrying no label: `bd list --no-labels`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A […]" |
| "no_parent" | schema | no | — | "Only top-level issues, those with no parent: `bd list --no-parent`. Sending it with `parent` is a 400 on `no_parent`, as on `GET /v0/beads/issues:count`. Behind the […]" |
| "no_pinned" | schema | no | — | "Only issues without the pinned flag, held in place where `all` or a pinned/hooked `status` would otherwise drop that predicate: `bd list --no-pinned`. Sending it with […]" |
| "notes_contains" | text | no | — | "Case-insensitive substring match on the notes: `bd list --notes-contains`. Behind the `issues.list.filters` behavior token: an older server answers […]" |
| "overdue" | schema | no | — | "Only overdue issues, those whose due time is before now: `bd list --overdue`. Now is the SERVER's clock when the query runs, not the client's. Behind the […]" |
| "parent" | ref "#/$defs/locator" | no | — | "Restrict to recursive descendants of this issue." |
| "pinned" | schema | no | — | "Only issues carrying the pinned FLAG, at any status: `bd list --pinned`. The pinned STATUS is `status`; the flag is a separate predicate. Sending it with `no_pinned` […]" |
| "priority" | integer | no | — | "Exact priority: `bd list --priority`. Absent means unfiltered; `0` is a real priority. Behind the `issues.list.filters` behavior token: an older server answers […]" |
| "priority_max" | integer | no | — | "Highest priority to list, inclusive: `bd list --priority-max`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this […]" |
| "priority_min" | integer | no | — | "Lowest priority to list, inclusive: `bd list --priority-min`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this […]" |
| "q" | text | no | — | "`bd search`'s free text. A row matches when its title or its id contains the text, case-insensitively; a text shaped like an issue id also matches that exact id, an […]" |
| "sort" | schema | no | — | "Which of the two served total orders this page is in. `created` is `(created_at DESC, id ASC)`; `priority` is `(priority ASC, created_at DESC, id ASC)` — `bd list`'s […]" |
| "spec" | text | no | — | "Only issues whose spec id starts with this prefix: `bd list --spec`. Behind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for […]" |
| "status" | array of text | no | — | "Status filter. Repeat the parameter, or pass a comma-separated list. Custom statuses configured for the workspace are honored. Setting this REPLACES the default […]" |
| "title" | text | no | — | "Case-insensitive substring match on the title: `bd list --title`. It narrows the listing and lifts none of its default exclusions. Behind the `issues.list.title` […]" |
| "title_contains" | text | no | — | "Case-insensitive substring match on the title: `bd list --title-contains`, spelled as `GET /v0/beads/issues:count` spells it. It overlaps `title` deliberately: both […]" |
| "type" | ref "#/$defs/typeUri" | no | — | "Issue type. Shorthand aliases are expanded exactly as `bd list --type` expands them (`mr`, `feat`, `mol`, `enhancement`, `dec`, `adr`); there is no plural folding. […]" |
| "updated_after" | ref "#/$defs/instant" | no | — | "Only issues last updated strictly after this instant: `bd list --updated-after`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to […]" |
| "updated_before" | ref "#/$defs/instant" | no | — | "Only issues last updated strictly before this instant: `bd list --updated-before`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated […]" |
| "wisp_type" | schema | no | — | "Only rows of this wisp type (a predicate on the column, not a plane selector): `bd list --wisp-type`. Any other value, including an empty one, is a 400 naming the […]" |

#### Advanced

```json-schema
{
  "properties": {
    "all": {
      "type": "boolean",
      "default": false
    },
    "brief": {
      "type": "boolean",
      "default": false
    },
    "deferred": {
      "type": "boolean",
      "default": false
    },
    "empty_description": {
      "type": "boolean",
      "default": false
    },
    "include_ephemeral": {
      "type": "boolean",
      "default": false
    },
    "include_gates": {
      "type": "boolean",
      "default": false
    },
    "include_infra": {
      "type": "boolean",
      "default": false
    },
    "include_templates": {
      "type": "boolean",
      "default": false
    },
    "limit": {
      "type": "integer",
      "minimum": 0,
      "default": 50
    },
    "mol_type": {
      "type": "string",
      "enum": [
        "swarm",
        "patrol",
        "work"
      ]
    },
    "no_assignee": {
      "type": "boolean",
      "default": false
    },
    "no_labels": {
      "type": "boolean",
      "default": false
    },
    "no_parent": {
      "type": "boolean",
      "default": false
    },
    "no_pinned": {
      "type": "boolean",
      "default": false
    },
    "overdue": {
      "type": "boolean",
      "default": false
    },
    "pinned": {
      "type": "boolean",
      "default": false
    },
    "sort": {
      "type": "string",
      "enum": [
        "created",
        "priority"
      ],
      "default": "created"
    },
    "wisp_type": {
      "type": "string",
      "enum": [
        "heartbeat",
        "ping",
        "patrol",
        "gc_report",
        "recovery",
        "error",
        "escalation"
      ]
    }
  }
}
```
<!-- bdp-schema:end listIssuesArguments bundle=issue-callables -->

<!-- bdp-schema:start issuesPage bundle=issue-callables -->
### Schema: "issuesPage"

Value: object

Other fields: not allowed

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | — |
| "items" | array of (ref "#/$defs/issueView") | yes | — | "Empty array (never null) when nothing matches." |
| "next_cursor" | text | no | — | "Present if and only if `has_more` is true. Pass it back verbatim as `cursor` to fetch the next page. Opaque and server-private." |
<!-- bdp-schema:end issuesPage bundle=issue-callables -->

<!-- bdp-schema:start queryIssuesArguments bundle=issue-callables -->
### Schema: "queryIssuesArguments"

Value: object

Other fields: not allowed

Required order: ["q"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of queryIssues." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "all" | schema | no | — | "Include closed issues. Without it closed issues are excluded — unless the expression itself compares `status`, in which case the expression's own opinion stands and […]" |
| "limit" | schema | no | — | "Maximum number of items to return. `0` means unlimited, exactly as `bd query --limit 0` does — the two surfaces read the same shared default […]" |
| "q" | text | yes | — | "The query expression, e.g. `status=open AND priority>1` or `type=bug OR label=urgent`. Blank, unparseable, or naming a field or operator the language does not have is […]" |
| "reverse" | schema | no | — | "Invert the display order. Ignored when `sort` is absent." |
| "sort" | schema | no | — | "Display order for the page. Absent leaves the rows in the order the query returned them, which is the same thing `bd query` without `--sort` does. WHAT IT ORDERS is […]" |

#### Advanced

```json-schema
{
  "properties": {
    "all": {
      "type": "boolean",
      "default": false
    },
    "limit": {
      "type": "integer",
      "minimum": 0,
      "default": 50
    },
    "reverse": {
      "type": "boolean",
      "default": false
    },
    "sort": {
      "type": "string",
      "enum": [
        "priority",
        "created",
        "updated",
        "closed",
        "status",
        "id",
        "title",
        "type",
        "assignee"
      ]
    }
  }
}
```
<!-- bdp-schema:end queryIssuesArguments bundle=issue-callables -->

<!-- bdp-schema:start queryPage bundle=issue-callables -->
### Schema: "queryPage"

Value: object

Other fields: not allowed

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A page of query results. It is `ReadyPage`'s shape rather than `IssuesPage`'s, and the missing member is the point: a page of this operation carries no `next_cursor`, because a cursor is a keyset position in a database order and a […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | "True when `limit` truncated the result. It is exact for every expression, including the ones evaluated outside the database: those are matched against every candidate […]" |
| "items" | array of (ref "#/$defs/issueView") | yes | — | "Empty array (never null) when the expression matched nothing." |
<!-- bdp-schema:end queryPage bundle=issue-callables -->

<!-- bdp-schema:start countIssuesArguments bundle=issue-callables -->
### Schema: "countIssuesArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of countIssues." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "assignee" | text | no | — | "Only issues assigned to this actor. Sending it beside `no_assignee` is not refused: the two are handed to the filter as written and answer with the empty […]" |
| "closed_after" | ref "#/$defs/instant" | no | — | "RFC 3339. Only issues closed strictly after this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and […]" |
| "closed_before" | ref "#/$defs/instant" | no | — | "RFC 3339. Only issues closed strictly before this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and […]" |
| "created_after" | ref "#/$defs/instant" | no | — | "RFC 3339. Only issues created strictly after this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and […]" |
| "created_before" | ref "#/$defs/instant" | no | — | "RFC 3339. Only issues created strictly before this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and […]" |
| "desc_contains" | text | no | — | "Substring match on the description." |
| "empty_description" | schema | no | — | "Only issues with no description." |
| "exclude_status" | array of text | no | — | "Statuses to exclude from the count. Repeat the parameter, or pass a comma-separated list; entries are taken as written (no normalization) but — UNLIKE `status` and […]" |
| "exclude_type" | array of (ref "#/$defs/typeUri") | no | — | "Issue types to exclude from the count. Repeat the parameter, or pass a comma-separated list; entries are split and trimmed inside the role and are NOT validated […]" |
| "group_by" | schema | no | — | "Bucket the count by one dimension and return `groups` beside `total`. Absent, the response carries `total` alone. The set is CLOSED, and a value outside it is a `400` […]" |
| "has_metadata_key" | text | no | — | "Only issues carrying this top-level metadata key." |
| "id" | array of (ref "#/$defs/locator") | no | — | "The Issues to count among, as a list rather than the native comma-separated string." |
| "include_ephemeral" | schema | no | — | "Admit the EPHEMERAL PLANE — the wisps table — and nothing else. Exactly the first of `include_infra`'s four changes, with none of the other three: no type exclusion […]" |
| "include_infra" | schema | no | — | "Count the cardinality of `bd list --include-infra --all` instead of the durable plane. IT CHANGES FOUR THINGS AT ONCE, and they are listed rather than summarized […]" |
| "label" | array of text | no | — | "Labels that must ALL be present. Repeat the parameter. Entries are trimmed and de-duplicated inside the role, and a set whose entries are all blank is the same as an […]" |
| "label_any" | array of text | no | — | "Labels of which at least ONE must be present. Repeat the parameter; same normalization as `label`." |
| "metadata_field" | array of text | no | — | "Top-level metadata equality filter as `key=value`, split on the first `=`. Repeatable. An invalid key is a 400." |
| "no_assignee" | schema | no | — | "Only issues with no assignee." |
| "no_labels" | schema | no | — | "Only issues carrying no label." |
| "no_parent" | schema | no | — | "Only issues carrying NO parent-child dependency edge. Unlike `parent`, this does NOT consult the dotted-id convention — an issue named `X.1` with no edge to `X` is […]" |
| "notes_contains" | text | no | — | "Substring match on the notes." |
| "parent" | ref "#/$defs/locator" | no | — | "Restrict to one issue's children through one predicate with two arms: a parent-child dependency edge onto `parent`, OR — for an issue carrying no parent-child edge at […]" |
| "priority" | integer | no | — | "Exact priority. Absent means unfiltered — the distinction matters because `0` is a real priority, which is why the role models this as a pointer." |
| "priority_max" | integer | no | — | "Highest priority to count, inclusive." |
| "priority_min" | integer | no | — | "Lowest priority to count, inclusive." |
| "status" | text | no | — | "One stored status. The empty value and the literal `all` both mean EVERY status, which is what makes a bare count answer for closed rows as well as open ones. IT IS […]" |
| "title" | text | no | — | "Case-insensitive substring match on the title." |
| "title_contains" | text | no | — | "Substring match on the title, spelled as `GET /v0/beads/issues:query` spells it. It overlaps `title` deliberately: both reach the filter, and the two names exist […]" |
| "type" | ref "#/$defs/typeUri" | no | — | "One issue type, with `status`'s match-nothing-rather-than-fail treatment and NO shorthand alias expansion at all — unlike `GET /v0/beads/ready`'s `type`, which […]" |
| "updated_after" | ref "#/$defs/instant" | no | — | "RFC 3339. Only issues last updated strictly after this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and […]" |
| "updated_before" | ref "#/$defs/instant" | no | — | "RFC 3339. Only issues last updated strictly before this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and […]" |

#### Advanced

```json-schema
{
  "properties": {
    "empty_description": {
      "type": "boolean",
      "default": false
    },
    "group_by": {
      "type": "string",
      "enum": [
        "status",
        "priority",
        "type",
        "assignee",
        "label"
      ]
    },
    "include_ephemeral": {
      "type": "boolean",
      "default": false
    },
    "include_infra": {
      "type": "boolean",
      "default": false
    },
    "no_assignee": {
      "type": "boolean",
      "default": false
    },
    "no_labels": {
      "type": "boolean",
      "default": false
    },
    "no_parent": {
      "type": "boolean",
      "default": false
    }
  }
}
```
<!-- bdp-schema:end countIssuesArguments bundle=issue-callables -->

<!-- bdp-schema:start issueCount bundle=issue-callables -->
### Schema: "issueCount"

Value: object

Other fields: not allowed

Required order: ["total"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The size of a matching set, and its buckets when `group_by` asked for them. It carries no items and no cursor: this is a number about a set, and the operations that return rows are `GET /v0/beads/issues` and `GET […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "groups" | object | no | — | "Bucket key to cardinality, PRESENT exactly when the request carried `group_by` and ABSENT otherwise. That absence is the answer to \\"you did not ask for buckets\\"; an […]" |
| "total" | schema | yes | — | "How many issues match. Never negative; `0` when nothing matches, which is a 200 rather than a 404 — a question about a set has an answer even when the set is empty, […]" |

#### Advanced

```json-schema
{
  "properties": {
    "total": {
      "type": "integer"
    }
  }
}
```
<!-- bdp-schema:end issueCount bundle=issue-callables -->

<!-- bdp-schema:start getIssueArguments bundle=issue-callables -->
### Schema: "getIssueArguments"

Value: object

Other fields: not allowed

Required order: ["issue"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of getIssue." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "brief_deps" | schema | no | — | "Reduce each row in `dependencies` to its identity-and-shape fields (`id`, `title`, `status`, `issue_type`, `priority`, `dependency_type`), dropping `description`, […]" |
| "include_comments" | schema | no | — | "Populate `comments` with the issue's full comment bodies. When it is honored `comments_omitted` is false, so a client is never left to guess whether an absent list […]" |
| "include_dependents" | schema | no | — | "Populate `dependents` with the issues that depend on this one, each carrying its edge type — the shape `dependencies` already carries. Default false, for […]" |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |

#### Advanced

```json-schema
{
  "properties": {
    "brief_deps": {
      "type": "boolean",
      "default": false
    },
    "include_comments": {
      "type": "boolean",
      "default": false
    },
    "include_dependents": {
      "type": "boolean",
      "default": false
    }
  }
}
```
<!-- bdp-schema:end getIssueArguments bundle=issue-callables -->

<!-- bdp-schema:start listRelatedIssuesArguments bundle=issue-callables -->
### Schema: "listRelatedIssuesArguments"

Value: object

Other fields: not allowed

Required order: ["issue", "direction"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of listRelatedIssues." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "direction" | schema | yes | — | "Which way this issue's edges are walked. `out` answers the issues it DEPENDS ON — the `dependencies` member of `GET /v0/beads/issues/{id}`. `in` answers the issues […]" |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |
| "type" | array of (ref "#/$defs/typeUri") | no | — | "Edge types to include. Repeat the parameter. Empty means every type. `GET /v0/beads/dependencies`'s `type` exactly: the vocabulary is OPEN, so an unrecognized value […]" |

#### Advanced

```json-schema
{
  "properties": {
    "direction": {
      "type": "string",
      "enum": [
        "out",
        "in"
      ]
    }
  }
}
```
<!-- bdp-schema:end listRelatedIssuesArguments bundle=issue-callables -->

<!-- bdp-schema:start relatedIssues bundle=issue-callables -->
### Schema: "relatedIssues"

Value: object

Other fields: not allowed

Required order: ["items"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One issue's neighbors — the body of `GET /v0/beads/issues/{id}/related`. It is NOT a page: this operation has no limit and no cursor, and it names ONE anchor, so there is nothing for a `has_more` to be about. There is no `missing` […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/neighborView") | yes | — | "The neighbors, ascending by id with the edge type breaking a tie. Empty array (never null) when this issue has none in the requested direction, or when the `type` […]" |
<!-- bdp-schema:end relatedIssues bundle=issue-callables -->

<!-- bdp-schema:start listDependencyCyclesArguments bundle=issue-callables -->
### Schema: "listDependencyCyclesArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of listDependencyCycles." |
| type | "object" |
<!-- bdp-schema:end listDependencyCyclesArguments bundle=issue-callables -->

<!-- bdp-schema:start cyclesPage bundle=issue-callables -->
### Schema: "cyclesPage"

Value: object

Other fields: not allowed

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | "Always false in v0: this operation takes no limit, so the report is never truncated. Present so that adding a bound later is additive." |
| "items" | array of (ref "#/$defs/cycle") | yes | — | "Empty array (never null) when the workspace has no cycles. Its LENGTH is the total: a cycle whose members this workspace cannot describe is still counted here, so the […]" |
<!-- bdp-schema:end cyclesPage bundle=issue-callables -->

<!-- bdp-schema:start getDependencyTreeArguments bundle=issue-callables -->
### Schema: "getDependencyTreeArguments"

Value: object

Other fields: not allowed

Required order: ["root"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of getDependencyTree." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "direction" | schema | no | — | "Which way to follow edges. `down` (the default) walks what the root DEPENDS ON; `up` walks what depends ON it; `both` walks each way and returns one list. For `both` […]" |
| "max_depth" | schema | no | — | "How many LEVELS to descend, counting the root as level one: `max_depth=1` is the root alone. A node beyond the bound is ABSENT rather than present and flagged. Zero […]" |
| "root" | ref "#/$defs/locator" | yes | — | "The issue to walk from. It must be an EXACT canonical issue id: there is no fuzzy, prefix or substring resolution on this surface, for the reason `GET […]" |
| "status" | text | no | — | "Prune the walked tree to the nodes carrying this status AND the ancestor chain of each survivor, so the answer is still a tree. It is a POST-WALK PRUNE, not a filter […]" |

#### Advanced

```json-schema
{
  "properties": {
    "direction": {
      "type": "string",
      "enum": [
        "down",
        "up",
        "both"
      ],
      "default": "down"
    },
    "max_depth": {
      "type": "integer",
      "minimum": 1,
      "default": 50
    }
  }
}
```
<!-- bdp-schema:end getDependencyTreeArguments bundle=issue-callables -->

<!-- bdp-schema:start dependencyTreePage bundle=issue-callables -->
### Schema: "dependencyTreePage"

Value: object

Other fields: not allowed

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | "Always false in v0: this operation takes no limit, so the walk is bounded by `max_depth` rather than truncated after the fact. Present so that adding a bound later is […]" |
| "items" | array of (ref "#/$defs/treeNode") | yes | — | "The walked nodes in DEPTH-FIRST PRE-ORDER: a node appears before every node it led to, and a subtree is contiguous. Never null. It is empty only when a `status` […]" |
<!-- bdp-schema:end dependencyTreePage bundle=issue-callables -->

<!-- bdp-schema:start countDependencyEdgesArguments bundle=issue-callables -->
### Schema: "countDependencyEdgesArguments"

Value: object

Other fields: not allowed

Required order: ["issue", "direction"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of countDependencyEdges." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "direction" | schema | yes | — | "Which end of the edge the anchors sit on. `out` counts what each anchor DEPENDS ON — the direction `bd dep list` reads and the number `bd show` prints as the […]" |
| "issue" | array of (ref "#/$defs/locator") | yes | — | "The anchors to count around. Repeat the parameter; at least one is required and at most 100 are accepted, and either bound is a 400 `invalid_argument` with `param: […]" |
| "status" | text | no | — | "Count only edges whose DEPENDENT — the issue at the source end, the one doing the depending — is in this stored status. Empty means every status. IT IS LEGAL ONLY […]" |
| "type" | array of (ref "#/$defs/typeUri") | no | — | "Edge types to include. Repeat the parameter. Empty means every type. `GET /v0/beads/dependencies`'s `type` exactly: the vocabulary is OPEN, so an unrecognized value […]" |

#### Advanced

```json-schema
{
  "properties": {
    "direction": {
      "type": "string",
      "enum": [
        "out",
        "in"
      ]
    }
  }
}
```
<!-- bdp-schema:end countDependencyEdgesArguments bundle=issue-callables -->

<!-- bdp-schema:start edgeCounts bundle=issue-callables -->
### Schema: "edgeCounts"

Value: object

Other fields: not allowed

Required order: ["anchors"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Each anchor's edge cardinality — the body of `GET /v0/beads/dependencies:count`. It is NOT a page and carries no total: the answer is per anchor, and a sum across anchors would double-count every edge whose two ends were both named. It […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "anchors" | array of (ref "#/$defs/edgeCount") | yes | — | "One entry per DISTINCT requested `issue_id`, in the order the request first named it. Empty array (never null) when the request named no anchors this server accepted […]" |
<!-- bdp-schema:end edgeCounts bundle=issue-callables -->

<!-- bdp-schema:start listBlockingAnnotationsArguments bundle=issue-callables -->
### Schema: "listBlockingAnnotationsArguments"

Value: object

Other fields: not allowed

Required order: ["issue"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of listBlockingAnnotations." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "is_blocked" | schema | no | — | "`true` adds each item's `is_blocked`: the issue's stored, TRANSITIVE readiness flag — the column the ready set filters on, which a child inherits from a blocked […]" |
| "issue" | array of (ref "#/$defs/locator") | yes | — | "The issues to annotate. Repeat the parameter; at least one is required and at most 100 are accepted, and either bound is a 400 `invalid_argument` with `param: […]" |

#### Advanced

```json-schema
{
  "properties": {
    "is_blocked": {
      "type": "boolean",
      "default": false
    }
  }
}
```
<!-- bdp-schema:end listBlockingAnnotationsArguments bundle=issue-callables -->

<!-- bdp-schema:start blockingAnnotations bundle=issue-callables -->
### Schema: "blockingAnnotations"

Value: object

Other fields: not allowed

Required order: ["items"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The blocking decoration of the named issues. It is NOT a page: this operation has no limit and no cursor, because the number of issues asked about is what bounds it." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/blockingAnnotation") | yes | — | "One entry per DISTINCT requested id, in the order the request first named it — so a client can zip this against the ids it sent. Empty array (never null) when the […]" |
<!-- bdp-schema:end blockingAnnotations bundle=issue-callables -->

<!-- bdp-schema:start addDependenciesArguments bundle=issue-callables -->
### Schema: "addDependenciesArguments"

Value: object

Other fields: not allowed

Required order: ["edges"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of addDependencies." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "edges" | array of (ref "#/$defs/dependencyEdge") | yes | — | "The edges to assert, in the caller's order. An empty array is a `400` rather than a successful no-op: a write request that writes nothing is a client bug, and […]" |
<!-- bdp-schema:end addDependenciesArguments bundle=issue-callables -->

<!-- bdp-schema:start addDependenciesResult bundle=issue-callables -->
### Schema: "addDependenciesResult"

Value: object

Other fields: not allowed

Required order: ["added"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "added" | array of (ref "#/$defs/dependencyEdge") | yes | — | "The request's edges, in REQUEST ORDER. It echoes the request because all-or-nothing means it is either every edge or the call failed, so a caller reporting what […]" |
<!-- bdp-schema:end addDependenciesResult bundle=issue-callables -->

<!-- bdp-schema:start claimIssueArguments bundle=issue-callables -->
### Schema: "claimIssueArguments"

Value: object

Other fields: not allowed

Required order: ["issue"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of claimIssue." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |
<!-- bdp-schema:end claimIssueArguments bundle=issue-callables -->

<!-- bdp-schema:start claimResult bundle=issue-callables -->
### Schema: "claimResult"

Value: object

Other fields: not allowed

Required order: ["issue", "already_claimed"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "already_claimed" | boolean | yes | — | "True when the caller already held the issue and this call changed nothing — the idempotent re-claim. A claim held by a DIFFERENT actor is a 409, not a 200 with this flag." |
| "issue" | ref "#/$defs/issueView" | yes | — | — |
<!-- bdp-schema:end claimResult bundle=issue-callables -->

<!-- bdp-schema:start claimNextIssueArguments bundle=issue-callables -->
### Schema: "claimNextIssueArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of claimNextIssue." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "assignee" | text | no | — | "Only issues assigned to this actor." |
| "exclude_label" | array of text | no | — | "Labels that must not be present." |
| "exclude_type" | array of (ref "#/$defs/typeUri") | no | — | "Issue types to exclude. Repeat the parameter, or pass a comma-separated list. Ignored when `type` is set." |
| "has_metadata_key" | text | no | — | "Only issues carrying this top-level metadata key." |
| "include_deferred" | schema | no | — | "Include issues whose `defer_until` is still in the future." |
| "include_ephemeral" | schema | no | — | "Include ephemeral (non-synced) rows." |
| "label" | array of text | no | — | "Labels that must ALL be present (AND)." |
| "label_any" | array of text | no | — | "Labels of which at least one must be present (OR)." |
| "label_pattern" | text | no | — | "Glob matched against labels." |
| "label_regex" | text | no | — | "Regular expression matched against labels, compiled by the database in its own dialect. A pattern it cannot compile is a 400 `invalid_value` on this parameter." |
| "metadata_field" | array of text | no | — | "Top-level metadata equality filter as `key=value`, split on the first `=`. Repeatable. An invalid key is a 400." |
| "parent" | ref "#/$defs/locator" | no | — | "Restrict to recursive descendants of this issue." |
| "priority" | integer | no | — | "Exact priority (0 is a real value, not \\"unset\\")." |
| "sort" | schema | no | — | "Ready-work ordering. `priority` is priority-first; `hybrid` orders recent issues by priority and older ones by age; `oldest` is creation order. An unrecognized value […]" |
| "type" | ref "#/$defs/typeUri" | no | — | "Issue type. The only normalization is shorthand ALIAS expansion, exactly what `bd ready --type` does: `mr` → `merge-request`, `feat` → `feature`, `mol` → `molecule`, […]" |
| "unassigned" | boolean | no | — | "Only issues with no assignee." |

#### Advanced

```json-schema
{
  "properties": {
    "include_deferred": {
      "type": "boolean",
      "default": false
    },
    "include_ephemeral": {
      "type": "boolean",
      "default": false
    },
    "sort": {
      "type": "string",
      "enum": [
        "hybrid",
        "priority",
        "oldest"
      ],
      "default": "priority"
    }
  }
}
```
<!-- bdp-schema:end claimNextIssueArguments bundle=issue-callables -->

<!-- bdp-schema:start claimNextResult bundle=issue-callables -->
### Schema: "claimNextResult"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The outcome of one atomic take of ready work. `claimed` IS ABSENT WHEN NOTHING WAS ELIGIBLE, and its absence is the whole signal — there is no boolean beside it, because a second member carrying the same fact is a second member that can […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "claimed" | ref "#/$defs/issueView" | no | — | — |
<!-- bdp-schema:end claimNextResult bundle=issue-callables -->

<!-- bdp-schema:start releaseIssueArguments bundle=issue-callables -->
### Schema: "releaseIssueArguments"

Value: object

Other fields: not allowed

Required order: ["issue"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of releaseIssue." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "expected_assignee" | text | no | — | "Compare-and-set on the holder: the release proceeds only while the issue is still assigned to this actor, and otherwise refuses with `409` / `precondition_failed` […]" |
| "force" | schema | no | — | "Bypass the ownership fence, so an actor that is not the holder may release the claim. It is the escape hatch `bd unclaim --force` spells, for an abandoned claim whose […]" |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |

#### Advanced

```json-schema
{
  "properties": {
    "force": {
      "type": "boolean",
      "default": false
    }
  }
}
```
<!-- bdp-schema:end releaseIssueArguments bundle=issue-callables -->

<!-- bdp-schema:start releaseResult bundle=issue-callables -->
### Schema: "releaseResult"

Value: object

Other fields: not allowed

Required order: ["issue", "changed"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "changed" | boolean | yes | — | "Whether the release WROTE the row. It is TRUE on every 200 this operation returns, because every shape that would not write is refused above it — an unheld row is a […]" |
| "issue" | ref "#/$defs/issueView" | yes | — | — |
<!-- bdp-schema:end releaseResult bundle=issue-callables -->

<!-- bdp-schema:start heartbeatIssueArguments bundle=issue-callables -->
### Schema: "heartbeatIssueArguments"

Value: object

Other fields: not allowed

Required order: ["issue"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of heartbeatIssue." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |
<!-- bdp-schema:end heartbeatIssueArguments bundle=issue-callables -->

<!-- bdp-schema:start heartbeatResult bundle=issue-callables -->
### Schema: "heartbeatResult"

Value: object

Other fields: not allowed

Required order: ["id", "holder", "heartbeat_at", "lease_expires_at", "rearmed"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "heartbeat_at" | ref "#/$defs/instant" | yes | — | "The server clock, in UTC, the refresh stamped on the lease." |
| "holder" | text | yes | — | "The lease holder after the refresh (the request's `actor`)." |
| "id" | ref "#/$defs/issueUrl" | yes | — | "The issue whose lease was refreshed." |
| "lease_expires_at" | ref "#/$defs/instant" | yes | — | "`heartbeat_at` plus the server's lease TTL: the deadline the next heartbeat must beat before a reclaim may revert the claim." |
| "rearmed" | boolean | yes | — | "True when the actor held the claim but no lease row existed for it (a claim hand-doled through `updateIssue`), so the heartbeat granted a fresh lease instead of […]" |
<!-- bdp-schema:end heartbeatResult bundle=issue-callables -->

<!-- bdp-schema:start closeIssueArguments bundle=issue-callables -->
### Schema: "closeIssueArguments"

Value: object

Other fields: not allowed

Required order: ["issue"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of closeIssue." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "auto_close_molecule" | schema | no | — | "Behind the `issues.close.autoCloseMolecule` behavior token: an older server answers `unknown_parameter` for this name, and a client checks the token before sending […]" |
| "expected_revision" | text | no | — | "Requires the subject's current revision to equal this opaque token before anything is written; a miss is revision-mismatch and nothing is written." |
| "force" | schema | no | — | "Bypass close policy — the open-children refusal and the live-blocker refusal — and the pin and the assignee guard, and nothing else: never the template guard (see […]" |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |
| "reason" | schema | no | — | "Why the issue is closed. Stored on the issue and read back as `close_reason`. THE FIRST CLOSE WINS: an idempotent re-close writes neither this nor `session`, so a […]" |
| "session" | schema | no | — | "The working session that closed the issue, stored and read back as `closed_by_session`, under the same first-close-wins rule and the same bounds as `reason`." |

#### Advanced

```json-schema
{
  "properties": {
    "auto_close_molecule": {
      "type": "boolean",
      "default": false
    },
    "force": {
      "type": "boolean",
      "default": false
    },
    "reason": {
      "type": "string",
      "maxLength": 255
    },
    "session": {
      "type": "string",
      "maxLength": 255
    }
  }
}
```
<!-- bdp-schema:end closeIssueArguments bundle=issue-callables -->

<!-- bdp-schema:start closeResult bundle=issue-callables -->
### Schema: "closeResult"

Value: object

Other fields: not allowed

Required order: ["issue", "already_closed", "open_children"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "already_closed" | boolean | yes | — | "True when the issue was already closed and this call changed nothing — the idempotent re-close, mirroring `ClaimResponse.already_claimed`. The response still carries […]" |
| "auto_closed_molecule" | ref "#/$defs/issueView" | no | — | — |
| "issue" | ref "#/$defs/issueView" | yes | — | — |
| "molecule_auto_close_refusal" | text | no | — | "With `issues.close.autoCloseMolecule` and `auto_close_molecule`: why the molecule root this close completed stayed open — the root's own close policy refused it (a […]" |
| "open_children" | integer | yes | — | "How many open children the close observed. Reported by a FORCED close — including an idempotent re-close — because a caller that bypassed the guard is exactly the […]" |
<!-- bdp-schema:end closeResult bundle=issue-callables -->

<!-- bdp-schema:start batchCloseIssuesArguments bundle=issue-callables -->
### Schema: "batchCloseIssuesArguments"

Value: object

Other fields: not allowed

Required order: ["items"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of batchCloseIssues." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "auto_close_molecule" | schema | no | — | "Behind the `issues.close.autoCloseMolecule` behavior token: an older server answers `unknown_parameter` for this name. Close each item's molecule root when the batch […]" |
| "force" | schema | no | — | "Bypass close policy — the open-children refusal and the live-blocker refusal — and the pin and the assignee guard for EVERY item, and nothing else. It never bypasses […]" |
| "items" | array of (ref "#/$defs/batchCloseItem") | yes | — | "The issues to close, in the order the caller asked for them. Every item appears in `outcomes` at the same index. An EMPTY array is a `400` rather than an empty […]" |
| "session" | schema | no | — | "The working session, recorded against every item that closes, under `CloseIssueRequest.session`'s first-close-wins rule and bounds." |

#### Advanced

```json-schema
{
  "properties": {
    "auto_close_molecule": {
      "type": "boolean",
      "default": false
    },
    "force": {
      "type": "boolean",
      "default": false
    },
    "session": {
      "type": "string",
      "maxLength": 255
    }
  }
}
```
<!-- bdp-schema:end batchCloseIssuesArguments bundle=issue-callables -->

<!-- bdp-schema:start batchCloseResult bundle=issue-callables -->
### Schema: "batchCloseResult"

Value: object

Other fields: not allowed

Required order: ["outcomes"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "outcomes" | array of (ref "#/$defs/closeOutcome") | yes | — | "Exactly one entry per requested item, in REQUEST ORDER — including for items that refused, so a client walks this against its own argument list without matching ids […]" |
<!-- bdp-schema:end batchCloseResult bundle=issue-callables -->

<!-- bdp-schema:start reopenIssueArguments bundle=issue-callables -->
### Schema: "reopenIssueArguments"

Value: object

Other fields: not allowed

Required order: ["issue"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of reopenIssue." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "expected_revision" | text | no | — | "Requires the subject's current revision to equal this opaque token before anything is written; a miss is revision-mismatch and nothing is written." |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |
| "reason" | schema | no | — | "Why the issue is being reopened. Recorded on the `reopened` EVENT this move records — not on a field of the issue, and not carried in the response, so a caller that […]" |

#### Advanced

```json-schema
{
  "properties": {
    "reason": {
      "type": "string",
      "maxLength": 255
    }
  }
}
```
<!-- bdp-schema:end reopenIssueArguments bundle=issue-callables -->

<!-- bdp-schema:start reopenResult bundle=issue-callables -->
### Schema: "reopenResult"

Value: object

Other fields: not allowed

Required order: ["issue", "already_open"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "already_open" | boolean | yes | — | "True when the issue was not in a done status and this call changed nothing — idempotent, mirroring `CloseIssueResponse.already_closed` and […]" |
| "issue" | ref "#/$defs/issueView" | yes | — | — |
<!-- bdp-schema:end reopenResult bundle=issue-callables -->

<!-- bdp-schema:start compareAndSetMetadataArguments bundle=issue-callables -->
### Schema: "compareAndSetMetadataArguments"

Value: object

Other fields: not allowed

Required order: ["issue", "key"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of compareAndSetMetadata." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "expected" | ref "#/$defs/metadataValue" | no | — | — |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |
| "key" | schema | yes | — | "The single metadata key to read and write. It must match the workspace's metadata-key syntax — a letter or underscore, then letters, digits, underscores, dots and […]" |
| "value" | ref "#/$defs/metadataValue" | no | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    }
  }
}
```
<!-- bdp-schema:end compareAndSetMetadataArguments bundle=issue-callables -->

<!-- bdp-schema:start compareAndSetMetadataResult bundle=issue-callables -->
### Schema: "compareAndSetMetadataResult"

Value: object

Other fields: not allowed

Required order: ["swapped"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "current" | ref "#/$defs/metadataValue" | no | — | — |
| "swapped" | boolean | yes | — | "Whether the precondition held and the transition applied. THIS IS THE VERDICT and the only member to dispatch on. False is a lost race — an answer, not a failure — […]" |
<!-- bdp-schema:end compareAndSetMetadataResult bundle=issue-callables -->

<!-- bdp-schema:start advanceMoleculeArguments bundle=issue-callables -->
### Schema: "advanceMoleculeArguments"

Value: object

Other fields: not allowed

Required order: ["issue"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of advanceMolecule." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "auto_claim" | schema | no | — | "Claim the next ready step for `actor`. Without it the operation writes nothing and only names the step." |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |

#### Advanced

```json-schema
{
  "properties": {
    "auto_claim": {
      "type": "boolean",
      "default": false
    }
  }
}
```
<!-- bdp-schema:end advanceMoleculeArguments bundle=issue-callables -->

<!-- bdp-schema:start advanceMoleculeResult bundle=issue-callables -->
### Schema: "advanceMoleculeResult"

Value: object

Other fields: not allowed

Required order: ["closed_step", "complete", "claimed"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "claimed" | boolean | yes | — | "`next_step` was claimed for `actor`, and is the post-claim row." |
| "closed_step" | ref "#/$defs/issueView" | yes | — | — |
| "complete" | boolean | yes | — | "Every step of the molecule is closed; `next_step` is then absent." |
| "molecule_id" | ref "#/$defs/issueUrl" | no | — | "The step's molecule root. ABSENT when the step belongs to no molecule, and then nothing else below is set." |
| "next_step" | ref "#/$defs/issueView" | no | — | — |
<!-- bdp-schema:end advanceMoleculeResult bundle=issue-callables -->

<!-- bdp-schema:start reclaimIssuesArguments bundle=issue-callables -->
### Schema: "reclaimIssuesArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of reclaimIssues." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "any_replica" | boolean | no | — | "Also revert leases another replica granted. The one member that WIDENS the sweep; see the operation. Absent means `false`." |
| "assignees" | array of text | no | — | "Only leases held by one of these owners are eligible." |
| "exclude_labels" | array of text | no | — | "An issue carrying ANY of these labels is never eligible." |
| "ids" | array of (ref "#/$defs/locator") | no | — | "Only these issues are eligible. An id that is not currently a stale lease is absent from the answer rather than refused. The cap is on the REQUEST, counted before […]" |
| "labels" | array of text | no | — | "Only issues carrying ALL of these labels are eligible." |
| "labels_any" | array of text | no | — | "Only issues carrying AT LEAST ONE of these labels are eligible." |
| "older_than_seconds" | schema | no | — | "The grace window past a lease's own expiry, in seconds (fractions allowed): only a lease that expired more than this long ago is eligible. Absent means `0`, every […]" |

#### Advanced

```json-schema
{
  "properties": {
    "older_than_seconds": {
      "type": "number",
      "minimum": 0
    }
  }
}
```
<!-- bdp-schema:end reclaimIssuesArguments bundle=issue-callables -->

<!-- bdp-schema:start reclaimResult bundle=issue-callables -->
### Schema: "reclaimResult"

Value: object

Other fields: not allowed

Required order: ["reclaimed"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Every row the sweep reverted, in the order the sweep found them." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "reclaimed" | array of (ref "#/$defs/reclaimedLease") | yes | — | "One entry per reverted row. Empty array (never null) when nothing was stale in scope." |
<!-- bdp-schema:end reclaimResult bundle=issue-callables -->

<!-- bdp-schema:start sweepIssuesArguments bundle=issue-callables -->
### Schema: "sweepIssuesArguments"

Value: object

Other fields: not allowed

Required order: ["tier"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of sweepIssues." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "closed_before" | ref "#/$defs/instant" | no | — | "Keep only beads closed STRICTLY BEFORE this instant (RFC 3339). A bead closed exactly at it is kept, which is the half-open interval every other time bound on this […]" |
| "dry_run" | schema | no | — | "Report what the sweep WOULD do and delete nothing. The counts, the skips and the refusals are the same ones the real sweep would produce, computed against the same […]" |
| "limit" | schema | no | — | "Cap how many beads this sweep deletes, OLDEST-CLOSED-FIRST. Absent or zero means unbounded. A negative value is a `400` invalid_argument, the same as the role's own […]" |
| "pattern" | text | no | — | "Keep only beads whose id matches this shell glob (`*`, `?`, `[...]`, `\\\\` escapes; `*` also crosses `-` and `.`, since an id is not a path). Absent matches every bead […]" |
| "protect_live_dependents" | schema | no | — | "Skip a closed candidate that a LIVE (not-done) bead depends on through a parent/child, tracks, or blocks edge, so closing a dependent's dependency does not erase the […]" |
| "protect_referenced" | schema | no | — | "Skip candidates whose id is CITED — as a literal, at word boundaries — in the description, notes or comments of any bead that is not done, so a decision trail a live […]" |
| "retain_ids" | schema | no | — | "RETIRE every id this sweep deletes. In the same transaction as the delete, the server writes one permanent tombstone per deleted bead — its id and its `closed_at`, […]" |
| "tier" | schema | yes | — | "Which plane to clear. `ephemeral` is the wisp tier (`bd purge`) and `durable` is the issue tier (`bd prune`). The two are DISJOINT: a sweep of one can never touch a […]" |

#### Advanced

```json-schema
{
  "properties": {
    "dry_run": {
      "type": "boolean",
      "default": false
    },
    "limit": {
      "type": "integer"
    },
    "protect_live_dependents": {
      "type": "boolean",
      "default": false
    },
    "protect_referenced": {
      "type": "boolean",
      "default": true
    },
    "retain_ids": {
      "type": "boolean",
      "default": false
    },
    "tier": {
      "type": "string",
      "enum": [
        "ephemeral",
        "durable",
        "wisps-plane"
      ]
    }
  }
}
```
<!-- bdp-schema:end sweepIssuesArguments bundle=issue-callables -->

<!-- bdp-schema:start sweepResult bundle=issue-callables -->
### Schema: "sweepResult"

Value: object

Other fields: not allowed

Required order: ["dry_run", "swept", "dependencies", "labels", "events", "skipped"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "What one sweep did. Every number describes the SAME snapshot, because the selection and the deletion ran in one transaction. It is NOT `x-go-type`-pinned, for the reason `ReadyCount` is not: there is no canonical Go struct whose JSON […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "dependencies" | integer | yes | — | "Dependency edge rows removed with them. Reported because a sweep's visible effect is much larger than its bead count." |
| "dry_run" | boolean | yes | — | "Echoes the request, so a result carries whether its numbers describe beads that are gone or beads that would go." |
| "events" | integer | yes | — | "Event rows removed with the swept beads." |
| "labels" | integer | yes | — | "Label rows removed with the swept beads." |
| "referenced_ids" | array of (ref "#/$defs/issueUrl") | no | — | "A BOUNDED SAMPLE of the ids `skipped.referenced` counts — at most 100, in the order the candidate query returned them. It is a sample, not the set: compare its length […]" |
| "remaining" | schema | no | — | "How many beads this sweep's own selection left unswept because `limit` cut it off, oldest-closed-first. Always 0 when `limit` was absent, zero, or at least as large […]" |
| "retain_ids" | boolean | no | — | "Echoes the request's `retain_ids`: `true` means every bead `swept` counts is now a retired id (under `dry_run`, would be). Present only behind the […]" |
| "skipped" | ref "#/$defs/sweepSkips" | yes | — | — |
| "swept" | integer | yes | — | "How many beads were deleted, or under `dry_run` would be." |

#### Advanced

```json-schema
{
  "properties": {
    "remaining": {
      "type": "integer"
    }
  }
}
```
<!-- bdp-schema:end sweepResult bundle=issue-callables -->

<!-- bdp-schema:start deleteIssuesArguments bundle=issue-callables -->
### Schema: "deleteIssuesArguments"

Value: object

Other fields: not allowed

Required order: ["ids"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of deleteIssues." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "cascade" | schema | no | — | "Also delete the named beads' parent-child descendants, at every depth. Every other dependent of the deleted set — a bead joined by any edge type other than parent- […]" |
| "dry_run" | schema | no | — | "Report what the deletion WOULD do and change nothing. The counts and BOTH refusals are the ones the real request would produce, computed against the same snapshot, […]" |
| "expected_revision" | text | no | — | "Requires the subject's current revision to equal this opaque token before anything is written; a miss is revision-mismatch and nothing is written." |
| "force" | schema | no | — | "Delete the named beads and leave their dependents ORPHANED, reported in `orphaned`. Without it and without `cascade`, a named bead with a dependent the request did […]" |
| "ids" | array of (ref "#/$defs/locator") | yes | — | "The beads to delete, exact ids, in either plane. DUPLICATES COLLAPSE. An empty array is a `400` rather than a no-op — a caller whose id list came out empty because […]" |

#### Advanced

```json-schema
{
  "properties": {
    "cascade": {
      "type": "boolean",
      "default": false
    },
    "dry_run": {
      "type": "boolean",
      "default": false
    },
    "force": {
      "type": "boolean",
      "default": false
    }
  }
}
```
<!-- bdp-schema:end deleteIssuesArguments bundle=issue-callables -->

<!-- bdp-schema:start deleteResult bundle=issue-callables -->
### Schema: "deleteResult"

Value: object

Other fields: not allowed

Required order: ["dry_run", "deleted", "dependencies", "labels", "events", "references_updated"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "What one delete did. Every number describes the SAME snapshot, because the guard, the deletion and the reference rewrite ran in one transaction. It is NOT `x-go-type`-pinned, for the reason `SweepResult` is not: there is no canonical Go […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "deleted" | integer | yes | — | "How many beads were deleted, or under `dry_run` would be. Under `cascade` this counts the whole closure, so it is normally larger than `ids` and it — not the request […]" |
| "deleted_ids" | array of (ref "#/$defs/issueUrl") | no | — | "The beads `deleted` counts, in ascending id order without duplicates: under `cascade`, the whole parent-child closure. Under `dry_run` it names the beads that would […]" |
| "dependencies" | integer | yes | — | "Dependency edge rows removed with them, in either direction. Reported because a delete's visible effect is much larger than its bead count." |
| "dry_run" | boolean | yes | — | "Echoes the request, so a result carries whether its numbers describe beads that are gone or beads that would go." |
| "events" | integer | yes | — | "Event rows removed with the deleted beads." |
| "labels" | integer | yes | — | "Label rows removed with the deleted beads." |
| "orphaned" | array of (ref "#/$defs/issueUrl") | no | — | "The surviving beads that depended on something this request deleted, in ascending id order. Present when the request carried `cascade` (a cascade follows parent-child […]" |
| "references_updated" | integer | yes | — | "How many SURVIVING beads had their text rewritten — beads, not occurrences. Always 0 under `dry_run`, because a preview rewrites nothing." |
<!-- bdp-schema:end deleteResult bundle=issue-callables -->

<!-- bdp-schema:start batchCreateIssuesArguments bundle=issue-callables -->
### Schema: "batchCreateIssuesArguments"

Value: object

Other fields: not allowed

Required order: ["items"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of batchCreateIssues." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/batchCreateItem") | yes | — | "The issues to create, in order. An empty array is a `400` rather than a successful no-op: a write request that writes nothing is a client bug, and answering it with a […]" |
<!-- bdp-schema:end batchCreateIssuesArguments bundle=issue-callables -->

<!-- bdp-schema:start batchCreateResult bundle=issue-callables -->
### Schema: "batchCreateResult"

Value: object

Other fields: not allowed

Required order: ["items"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/issueView") | yes | — | "One entry per requested item, in REQUEST ORDER, each the stored issue with its generated id and its labels. Never null and never shorter than the request: a partial […]" |
<!-- bdp-schema:end batchCreateResult bundle=issue-callables -->

<!-- bdp-schema:start applyBatchArguments bundle=issue-callables -->
### Schema: "applyBatchArguments"

Value: object

Other fields: not allowed

Required order: ["items"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of applyBatch." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "force_id_prefix" | schema | no | — | "Permits an explicit `create.id` outside the workspace's configured issue prefix, for EVERY create item in the request. Without it such an id is refused by the role […]" |
| "items" | array of (ref "#/$defs/applyItem") | yes | — | "The items to apply, IN THE ORDER THEY ARE TO BE APPLIED. An empty array is a `400` rather than a successful no-op: a write request that writes nothing is a client […]" |
| "provenance" | schema | no | — | "Labels the version-control history entry this request records, under `updateIssue`'s rule: it changes how the entry READS, never whether one is recorded. Empty […]" |
| "skip_per_edge_cycle_check" | schema | no | — | "Drops the PER-EDGE cycle probe for a caller wiring a large graph, exactly as it does on `POST /v0/beads/dependencies:add`. IT NEVER DROPS THE END GATE, which runs […]" |

#### Advanced

```json-schema
{
  "properties": {
    "force_id_prefix": {
      "type": "boolean",
      "default": false
    },
    "provenance": {
      "type": "string",
      "maxLength": 255
    },
    "skip_per_edge_cycle_check": {
      "type": "boolean",
      "default": false
    }
  }
}
```
<!-- bdp-schema:end applyBatchArguments bundle=issue-callables -->

<!-- bdp-schema:start applyBatchResult bundle=issue-callables -->
### Schema: "applyBatchResult"

Value: object

Other fields: not allowed

Required order: ["keys", "items"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/applyItemResult") | yes | — | "One entry per requested item, in REQUEST ORDER. Never null and never shorter than the request: a batch that could not apply every item applied none, so there is no […]" |
| "keys" | object | yes | — | "Each create item's `key` mapped to the id it was bound to. It is the one fact the request cannot carry and every caller needs. It carries only the keys the request […]" |
<!-- bdp-schema:end applyBatchResult bundle=issue-callables -->

<!-- bdp-schema:start addCommentArguments bundle=issue-callables -->
### Schema: "addCommentArguments"

Value: object

Other fields: not allowed

Required order: ["issue", "author", "text"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of addComment." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "author" | schema | yes | — | "Who is signing the comment. CALLER-ASSERTED, and not the authenticated principal — see the operation description. Trimmed of surrounding space, then refused when the […]" |
| "issue" | ref "#/$defs/locator" | yes | — | "The Issue the operation acts on." |
| "text" | text | yes | — | "The comment body, stored VERBATIM: newlines, surrounding space and unicode all survive, and nothing trims the value that lands in the row. NO LENGTH BOUND AND NO […]" |

#### Advanced

```json-schema
{
  "properties": {
    "author": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    }
  }
}
```
<!-- bdp-schema:end addCommentArguments bundle=issue-callables -->

<!-- bdp-schema:start removeDependencyArguments bundle=issue-callables -->
### Schema: "removeDependencyArguments"

Value: object

Other fields: not allowed

Required order: ["issue", "depends_on"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of removeDependency." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "depends_on" | ref "#/$defs/locator" | yes | — | "The edge's TARGET — the issue depended upon. An exact canonical id, under `issue_id`'s rule." |
| "issue" | ref "#/$defs/locator" | yes | — | "The edge's SOURCE — the issue that depends on the other end. An EXACT canonical id: there is no fuzzy, prefix or substring resolution on this surface." |
<!-- bdp-schema:end removeDependencyArguments bundle=issue-callables -->

<!-- bdp-schema:start removeDependencyResult bundle=issue-callables -->
### Schema: "removeDependencyResult"

Value: object

Other fields: not allowed

Required order: ["removed"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "removed" | boolean | yes | — | "True when an edge was there and is now gone. FALSE IS A SUCCESS, not a refusal: it says this pair carried no such edge, which is the same graph a second removal […]" |
<!-- bdp-schema:end removeDependencyResult bundle=issue-callables -->

<!-- bdp-schema:start listSettingsArguments bundle=issue-callables -->
### Schema: "listSettingsArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of listSettings." |
| type | "object" |
<!-- bdp-schema:end listSettingsArguments bundle=issue-callables -->

<!-- bdp-schema:start settingsPage bundle=issue-callables -->
### Schema: "settingsPage"

Value: object

Other fields: not allowed

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | "Always false in v0: the whole plane is returned in one page. It is present so that a later revision can page this collection without changing the response shape." |
| "items" | array of (ref "#/$defs/setting") | yes | — | "The stored settings, ordered by key. Empty array (never null) when the workspace stores none." |
| "next_cursor" | text | no | — | "Present if and only if `has_more` is true, which is never in v0." |
<!-- bdp-schema:end settingsPage bundle=issue-callables -->

<!-- bdp-schema:start getSettingArguments bundle=issue-callables -->
### Schema: "getSettingArguments"

Value: object

Other fields: not allowed

Required order: ["key"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of getSetting." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key, used verbatim." |
<!-- bdp-schema:end getSettingArguments bundle=issue-callables -->

<!-- bdp-schema:start setSettingArguments bundle=issue-callables -->
### Schema: "setSettingArguments"

Value: object

Other fields: not allowed

Required order: ["key", "value"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of setSetting." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key, used verbatim." |
| "value" | text | yes | — | "The value to store, VERBATIM. It is not trimmed and not character-filtered: two of the keys this plane holds carry structured configuration a filter would corrupt. IT […]" |
<!-- bdp-schema:end setSettingArguments bundle=issue-callables -->

<!-- bdp-schema:start unsetSettingArguments bundle=issue-callables -->
### Schema: "unsetSettingArguments"

Value: object

Other fields: not allowed

Required order: ["key"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of unsetSetting." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key, used verbatim." |
<!-- bdp-schema:end unsetSettingArguments bundle=issue-callables -->

<!-- bdp-schema:start listMemoriesArguments bundle=issue-callables -->
### Schema: "listMemoriesArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of listMemories." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "search" | text | no | — | "Narrows the answer to memories that MATCH: a memory matches when the lowercase of its key, or the lowercase of its value, contains the lowercase of this term. Absent […]" |
<!-- bdp-schema:end listMemoriesArguments bundle=issue-callables -->

<!-- bdp-schema:start memoriesPage bundle=issue-callables -->
### Schema: "memoriesPage"

Value: object

Other fields: not allowed

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "has_more" | boolean | yes | — | "Always false in v0: the whole plane is returned in one page. It is present so that a later revision can page this collection without changing the response shape." |
| "items" | array of (ref "#/$defs/memory") | yes | — | "The stored memories, ordered by key. Empty array (never null) when the workspace holds none, or when `q` matched none." |
| "next_cursor" | text | no | — | "Present if and only if `has_more` is true, which is never in v0." |
<!-- bdp-schema:end memoriesPage bundle=issue-callables -->

<!-- bdp-schema:start getMemoryArguments bundle=issue-callables -->
### Schema: "getMemoryArguments"

Value: object

Other fields: not allowed

Required order: ["key"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of getMemory." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key, used verbatim." |
<!-- bdp-schema:end getMemoryArguments bundle=issue-callables -->

<!-- bdp-schema:start rememberMemoryArguments bundle=issue-callables -->
### Schema: "rememberMemoryArguments"

Value: object

Other fields: not allowed

Required order: ["content"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of rememberMemory." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "content" | text | yes | — | "The memory itself, stored VERBATIM: newlines, surrounding space and unicode all survive. Flattening it to one line is what a front door does when it prints, not what […]" |
| "key" | text | no | — | "The key to store under. OMIT IT to have the server derive one from `content`; the response's `key` is then how the caller learns where the memory landed. Supplied, it […]" |
<!-- bdp-schema:end rememberMemoryArguments bundle=issue-callables -->

<!-- bdp-schema:start forgetMemoryArguments bundle=issue-callables -->
### Schema: "forgetMemoryArguments"

Value: object

Other fields: not allowed

Required order: ["key"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of forgetMemory." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key, used verbatim." |
<!-- bdp-schema:end forgetMemoryArguments bundle=issue-callables -->

<!-- bdp-schema:start listEventsArguments bundle=issue-callables -->
### Schema: "listEventsArguments"

Value: object

Other fields: not allowed

Required order: ["since"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of listEvents." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "limit" | schema | no | — | "Maximum number of records to return, from 1 to 10000. A value outside that range — `0` included — is a 400 `invalid_argument`. THERE IS NO UNLIMITED READ HERE, and […]" |
| "since" | schema | yes | — | "Return records with `seq` strictly greater than this value. Pass `0` to read from the beginning of the retained journal. REQUIRED, and deliberately not defaulted to […]" |

#### Advanced

```json-schema
{
  "properties": {
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10000,
      "default": 1000
    },
    "since": {
      "type": "integer",
      "minimum": 0
    }
  }
}
```
<!-- bdp-schema:end listEventsArguments bundle=issue-callables -->

<!-- bdp-schema:start eventsPage bundle=issue-callables -->
### Schema: "eventsPage"

Value: object

Other fields: not allowed

Required order: ["records", "head"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One page of the journal plus the position of its end. THERE IS NO `has_more`, and that is deliberate rather than an omission. Every other page on this surface reports truncation with a boolean because its ordering is a query's; here the […]" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "head" | schema | yes | — | "The highest `seq` this journal has ever assigned, read in the same transaction as the records above. It is the journal's HISTORY, not its contents: pruning deletes […]" |
| "records" | array of (ref "#/$defs/eventRecord") | yes | — | "Records with `seq` strictly greater than the requested `since`, in ASCENDING `seq` order and contiguous — a gap in the retained window is a 410, never a quietly […]" |

#### Advanced

```json-schema
{
  "properties": {
    "head": {
      "type": "integer"
    }
  }
}
```
<!-- bdp-schema:end eventsPage bundle=issue-callables -->
## 10. Obsolescence

This document is new. It takes the operation semantics of the v0 HTTP contract of
OSS beads (`internal/httpapi/spec/openapi.v0.yaml` at 6d713a74) as its source and
restates them over the Callables profile; it replaces nothing in the specification
tree and is listed from `specs/README.md` beside the Issue and Dependency Types
package. The fragments of §9 carry `bundle=issue-callables` and extract to
`specs/types/issue/issue-callables-preview-1.schema.json`; references into the
common bundle use its full schema identity.
