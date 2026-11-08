---
status: editorial-draft
intended-status: type-package-operations
version: "preview-1"
---

# Beads Protocol — Issue and Dependency Callables

Editorial draft preview-1 · November 5, 2026 · generated from the v0 HTTP contract of OSS beads at 6d713a74 by `scripts/generate-issue-callables.py`

This document is the operations half of the [Issue and Dependency Types](issue.md)
package. It is a routing table: each Callable routes to the product's v0 operation
over the [Callables](../../profiles/callables/callables.md) profile, and returns the
product's JSON. The operation's behavior is the product's and is not specified here.

The generic reads and `createBead`, `updateBead`, `deleteBead`, `createLink`,
`updateLink` and `deleteLink` are unchanged and stay available beside these names. A
Scope serving the Issue and Dependency Types package and advertising Callables1 offers
the names of §1. Rules marked **preview** may change in a later edition without a
compatibility promise.

## Contents

1. [Names](#1-names)
2. [The routing rule](#2-the-routing-rule)
3. [Product adapters](#3-product-adapters)
4. [Service defaults](#4-service-defaults)
5. [Errors](#5-errors)
6. [Queries](#6-queries)
7. [Batches](#7-batches)
8. [Conformance rows for preview-1](#8-conformance-rows-for-preview-1)
9. [Schemas](#9-schemas)
10. [Obsolescence](#10-obsolescence)

## 1. Names

45 Callables are declared: 21 CallableQuery and 24 CallableBatch declarations, one per v0
operation. `issue/purge` and `issue/prune` are the one exception: both route to
`sweepIssues`, and they differ only in their defaults (§4). A caller of either may supply
`tier` itself, and either name then clears the tier it is given.

| Name | Type | v0 operation | Route |
| --- | --- | --- | --- |
| `issue/context` | CallableQuery | `getContext` | `GET /v0/beads/context` |
| `issue/ready` | CallableQuery | `listReadyWork` | `GET /v0/beads/ready` |
| `issue/ready-count` | CallableQuery | `countReadyWork` | `GET /v0/beads/ready:count` |
| `issue/stats` | CallableQuery | `getStats` | `GET /v0/beads/stats` |
| `issue/blocked` | CallableQuery | `listBlockedIssues` | `GET /v0/beads/blocked` |
| `issue/dep/cycles` | CallableQuery | `listDependencyCycles` | `GET /v0/beads/dependencies/cycles` |
| `issue/dep/tree` | CallableQuery | `getDependencyTree` | `GET /v0/beads/dependencies/tree` |
| `issue/list` | CallableQuery | `listIssues` | `GET /v0/beads/issues` |
| `issue/create` | CallableBatch | `createIssue` | `POST /v0/beads/issues` |
| `issue/query` | CallableQuery | `queryIssues` | `GET /v0/beads/issues:query` |
| `issue/count` | CallableQuery | `countIssues` | `GET /v0/beads/issues:count` |
| `issue/show` | CallableQuery | `getIssue` | `GET /v0/beads/issues/{id}` |
| `issue/update` | CallableBatch | `updateIssue` | `PATCH /v0/beads/issues/{id}` |
| `issue/dep/list` | CallableQuery | `listRelatedIssues` | `GET /v0/beads/issues/{id}/related` |
| `issue/comment` | CallableBatch | `addComment` | `POST /v0/beads/issues/{id}/comments` |
| `issue/claim` | CallableBatch | `claimIssue` | `POST /v0/beads/issues/{id}:claim` |
| `issue/unclaim` | CallableBatch | `releaseIssue` | `POST /v0/beads/issues/{id}:release` |
| `issue/heartbeat` | CallableBatch | `heartbeatIssue` | `POST /v0/beads/issues/{id}:heartbeat` |
| `issue/close` | CallableBatch | `closeIssue` | `POST /v0/beads/issues/{id}:close` |
| `issue/advance` | CallableBatch | `advanceMolecule` | `POST /v0/beads/issues/{id}:advanceMolecule` |
| `issue/reopen` | CallableBatch | `reopenIssue` | `POST /v0/beads/issues/{id}:reopen` |
| `issue/metadata/compare-and-set` | CallableBatch | `compareAndSetMetadata` | `POST /v0/beads/issues/{id}:casMetadata` |
| `issue/purge` | CallableBatch | `sweepIssues` | `POST /v0/beads/issues:sweep` |
| `issue/prune` | CallableBatch | `sweepIssues` | `POST /v0/beads/issues:sweep` |
| `issue/delete` | CallableBatch | `deleteIssues` | `POST /v0/beads/issues:delete` |
| `issue/get-many` | CallableQuery | `batchGetIssues` | `POST /v0/beads/issues:batchGet` |
| `issue/reclaim` | CallableBatch | `reclaimIssues` | `POST /v0/beads/issues:reclaim` |
| `issue/create-many` | CallableBatch | `batchCreateIssues` | `POST /v0/beads/issues:batchCreate` |
| `issue/batch` | CallableBatch | `applyBatch` | `POST /v0/beads/issues:batchApply` |
| `issue/close-many` | CallableBatch | `batchCloseIssues` | `POST /v0/beads/issues:batchClose` |
| `issue/claim-next` | CallableBatch | `claimNextIssue` | `POST /v0/beads/issues:claimNext` |
| `issue/dep/edges` | CallableQuery | `listDependencies` | `GET /v0/beads/dependencies` |
| `issue/dep/count` | CallableQuery | `countDependencyEdges` | `GET /v0/beads/dependencies:count` |
| `issue/blocking-annotations` | CallableQuery | `listBlockingAnnotations` | `GET /v0/beads/dependencies/blocking` |
| `issue/dep/add` | CallableBatch | `addDependencies` | `POST /v0/beads/dependencies:add` |
| `issue/dep/remove` | CallableBatch | `removeDependency` | `POST /v0/beads/dependencies:remove` |
| `config/list` | CallableQuery | `listSettings` | `GET /v0/beads/config` |
| `config/get` | CallableQuery | `getSetting` | `GET /v0/beads/config/{key}` |
| `config/set` | CallableBatch | `setSetting` | `PUT /v0/beads/config/{key}` |
| `config/unset` | CallableBatch | `unsetSetting` | `DELETE /v0/beads/config/{key}` |
| `memory/list` | CallableQuery | `listMemories` | `GET /v0/beads/memories` |
| `memory/remember` | CallableBatch | `rememberMemory` | `POST /v0/beads/memories` |
| `memory/recall` | CallableQuery | `getMemory` | `GET /v0/beads/memories/{key}` |
| `memory/forget` | CallableBatch | `forgetMemory` | `DELETE /v0/beads/memories/{key}` |
| `events/list` | CallableQuery | `listEvents` | `GET /v0/beads/events` |

`health` and `watchEvents` stay plain routes of the product and are not declared.

## 2. The routing rule

- **Arguments.** A Callable's parameters are its v0 operation's path, query and body
  parameters, flattened into one closed `arguments` object under the Callables
  [OpenAPI rule](../../profiles/callables/callables.md#14-openapi), with v0's names, types
  and defaults, apart from the Types rule below, §3 and §4. Each section's table says where
  each parameter goes.
- **Actor.** No declaration has an `actor` parameter. A CallableBatch invocation says who
  is acting in `revisionProvenance.actor`, and the product's router passes its `id` to v0
  (§3). It is caller-asserted data on every Callable, and never authentication.
- **Results.** A Callable's `resultSchema` is its v0 operation's 200 response schema,
  verbatim but for the Types rule, and `result` is the product's JSON under that rule.
- **Identifiers.** Identifiers are v0's native forms: `bd-1`.
- **Types.** A Type reference a Callable carries as a filter, a parameter, or a dependency's
  kind is a `type` member, and its value is
  a Type reference, as Core spells it ([Issue §2](issue.md#2-bead-and-link-types)): a Bead
  Type such as `https://github.com/gastownhall/bdp/types/issue/task`, a Link Type such as
  `https://github.com/gastownhall/bdp/types/dependency/blocks`, or the Scope-local identity of a configured
  name. The Issue Bead's own Type keeps v0's `issue_type` — the member the `Issue` record carries — in the
  create arguments, the patch, and the result bodies below. `exclude_type` keeps its name, as
  `exclude_label` and `exclude_status` keep theirs beside `label` and `status`, and takes
  Bead Type references. An abstract Type, a Type of the
  other kind, and a reference with no identity in the Scope's table are refused as
  `validation-failed` and never guessed at; a reference has no aliases and is never split at
  a comma. A stored name with no identity is not served, as in Core, and the invocation is
  `temporarily-unavailable`. The rule reaches these members:

  | Where | v0 member | Type |
  | --- | --- | --- |
  | Parameters of `issue/ready`, `issue/ready-count`, `issue/list`, `issue/count`, `issue/claim-next` | `type`, `exclude_type` | Bead |
  | Parameters of `issue/dep/list`, `issue/dep/edges`, `issue/dep/count` | `type` | Link |
  | Members of `Issue`, `BatchGetIssue`, `IssueWithCounts`, `IssueDetails`, `IssueWithDependencyMetadata`, `TreeNode`, `BlockedIssue`, `CreateIssueRequest`, `IssuePatchBody`, `BatchCreateItem`, `ApplyCreateItem`, `ApplyPatchBody` | `issue_type` (v0's own member, kept) | Bead |
  | Members of `Dependency`, `DependencyEdge`, `CreateIssueDependency`, `BatchCreateDependency`, `ApplyDepAddItem`, `Blocker` | `type` | Link |
  | Parameter of `issue/dep/add` (§3) | `type` | Link |
  | `EventRecord.issue` | It is an `Issue`, and §2's rule for `Issue` applies to it | Bead |
  | `EventRecord.dep` | Its `kind` is renamed `type`, a Link Type reference (§2) | Link |
- **Revision tokens.** A Callable's result carries v0's `revision`, the row version. A
  generic Core record carries its own revision, which also moves on a change the row
  version does not ([Issue §7](issue.md#7-revisions-and-attribution)). `expected_version`
  on `issue/update`, `issue/close`, `issue/reopen` and `issue/delete` takes either: a Core
  revision holds only if the record still carries exactly that revision, and otherwise the
  invocation is `revision-mismatch` and writes nothing. An `issue/batch` item's
  `expected_version` takes the row version only, as v0's own routes do.
- **Schemas.** §9 carries each v0 component under its v0 name. OpenAPI 3.0's `nullable`
  is spelled as a JSON Schema type array, references point within this bundle, and the
  contract's code-generation annotations are absent. Declarations carry their own closure,
  as Callables §2.3 requires.
- **Carried text.** Descriptions are v0's, and speak in v0's terms: "this surface" is the
  v0 API, "this document" and its document-level rules are `internal/httpapi/spec/openapi.v0.yaml` at 6d713a74, a
  status is v0's, and an operation path is the v0 route. Where it names `issue_type`, a
  type's short name, its aliases or a comma-separated list of types, it speaks of v0's
  spelling of the value the Types rule spells as a reference. §5 says how a v0 refusal reaches
  a Callable's caller.

## 3. Product adapters

Four things need a thin adapter in the product's router. Everything else in this
document is the routing rule above.

| Callable | Adapter |
| --- | --- |
| `issue/dep/add` | Accepts flat `source`, `target` and optional `type` beside `edges`, exactly one form per call, and sends v0 one edge built from the flat form. An omitted `type` is `https://github.com/gastownhall/bdp/types/dependency/blocks`. Both forms present, or neither, is `validation-failed` |
| Every CallableBatch whose v0 operation has `actor` | `revisionProvenance.actor.id` is sent as v0's `actor`. Where v0 requires it, an invocation with no actor is refused as `validation-failed`; `issue/purge`, `issue/prune` and `issue/delete` run without one. On `issue/claim`, `issue/claim-next`, `issue/unclaim`, `issue/heartbeat` and `issue/advance` the value also names the holder or the fence's subject, as v0's `actor` does |
| `issue/comment` | `revisionProvenance.actor.id` is sent as v0's `author`, and the comment stays signed under `author`. An invocation with no actor is refused as `validation-failed` |
| `config/set`, `config/unset`, `memory/remember`, `memory/forget` | v0 records no actor on these, so an invocation that supplies one is refused as `validation-failed` rather than dropped |

## 4. Service defaults

These are the native CLI's defaults, declared as each parameter's `default`, so an omitted
parameter behaves the same from the command tree, from `bdp call` and over HTTP. The
product's router supplies them before calling v0. They are this document's, and v0's own
route keeps its behavior.

| Callable | Omitted parameters |
| --- | --- |
| `issue/list` | `{"sort": "priority"}` |
| `issue/create` | `{"issue_type": "task"}` |
| `issue/dep/list` | `{"direction": "out"}` |
| `issue/close` | `{"reason": "Closed"}` |
| `issue/purge` | `{"dry_run": true, "tier": "ephemeral", "protect_referenced": false, "protect_live_dependents": true}` |
| `issue/prune` | `{"dry_run": true, "tier": "durable", "protect_referenced": true, "protect_live_dependents": false}` |
| `issue/delete` | `{"dry_run": true}` |
| `issue/reclaim` | `{"older_than_seconds": 600}` |

`issue/delete`, `issue/purge` and `issue/prune` preview by default, and a real run sends
`dry_run: false`. `force` on `issue/delete` keeps its v0 meaning, orphaning
dependents.

## 5. Errors

A failure that meets the condition of a Core or Write code uses that code, as Callables
§9 requires:

| v0 code | BDP code |
| --- | --- |
| `already_exists`, `idempotency_expired` | `identity-taken` |
| `invalid_cursor` | `invalid-parameter` |
| `not_found` | `resource-not-found` |
| `precondition_failed` on a stale `expected_version` | `revision-mismatch` |
| `internal`, `busy`, `db_unavailable` | `temporarily-unavailable` |
| `unauthenticated` | `unauthenticated` |
| `invalid_argument` | `validation-failed` |

Every other code a v0 operation documents is a declared reason of its Callable. It
answers `callable-error` at HTTP 409, and the `error` member is v0's `Problem` body
verbatim but for §2's Types rule, whose `code` is the reason. That body keeps its own `status`, `title`,
`request_id` and extension members, so its `status` can differ from the invocation's.

```json
{"code": "callable-error", "error": {"status": 409, "title": "Conflict", "code": "already_claimed", "request_id": "r1", "assignee": "sam", "issue_status": "in_progress"}}
```

| Reason | Declared by |
| --- | --- |
| `already_claimed` | `issue/update`, `issue/claim`, `issue/unclaim`, `issue/heartbeat`, `issue/batch` |
| `dependency_cycle` | `issue/create`, `issue/update`, `issue/batch`, `issue/dep/add` |
| `dependency_exists` | `issue/update`, `issue/batch`, `issue/dep/add` |
| `events_journal_disabled` | `events/list` |
| `events_journal_truncated` | `events/list` |
| `issue_pinned` | `issue/close`, `issue/batch` |
| `lease_not_held` | `issue/heartbeat` |
| `not_assignee` | `issue/close`, `issue/batch` |
| `not_claimable` | `issue/update`, `issue/claim` |
| `not_closable` | `issue/update`, `issue/close`, `issue/batch` |
| `not_releasable` | `issue/unclaim` |
| `notes_overwrite_refused` | `issue/update`, `issue/batch` |
| `precondition_failed` | `issue/update`, `issue/unclaim`, `issue/batch` |
| `template_read_only` | `issue/update`, `issue/close`, `issue/batch` |

## 6. Queries

### issue/context (CallableQuery)

A startup snapshot of the served workspace plus the API's own identity. Serves a fixed field allowlist; it does not reflect the server's whole configuration, and in particular never carries a sync remote URL (those routinely embed credentials). v0 answers from the snapshot without touching the database, which is why no 503 is documented here.

**`issueContextArguments`** — Arguments of issue/context.

Result: `ContextResponse`

Title: Workspace and API identity

Routes to: v0 `getContext`, `GET /v0/beads/context`.

### issue/ready (CallableQuery)

Unblocked, open work, ordered by the requested sort policy. Items are `IssueWithCounts` — the same element type `bd ready --json` emits — so dependency, dependent and comment counts are present from v0 onward.

The result set is always restricted to `status=open`; there is no status parameter. There is no cursor either: the sort policies admit no keyset predicate, and the intended usage is snapshot-and-requery.

SOME TYPES ARE EXCLUDED BY DEFAULT, exactly as `bd ready` excludes them: `merge-request`, `gate`, `molecule`, `rig` and the workspace's configured infrastructure types, plus anything named in `exclude_type`. Setting `type` DROPS THAT ENTIRE EXCLUSION SET (also matching the CLI), so `type=molecule` returns records the default view never shows. A client scanning the active set with `limit=0` and no `type` therefore never sees those classes at all.

**`issueReadyArguments`** — Arguments of issue/ready.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `assignee` | text | no | query | Only issues assigned to this actor. |
| `unassigned` | boolean | no | query | Only issues with no assignee. |
| `type` | Bead Type reference | no | query | A Bead Type reference (§2). |
| `exclude_type` | Bead Type reference array | no | query | A Bead Type reference (§2). |
| `label` | array of text | no | query | Labels that must ALL be present (AND). |
| `label_any` | array of text | no | query | Labels of which at least one must be present (OR). |
| `exclude_label` | array of text | no | query | Labels that must not be present. |
| `label_pattern` | text | no | query | Glob matched against labels. |
| `label_regex` | text | no | query | Regular expression matched against labels, compiled by the database in its own dialect. |
| `priority` | integer | no | query | Exact priority (0 is a real value, not "unset"). |
| `parent` | text | no | query | Restrict to recursive descendants of this issue. |
| `metadata_field` | array of text | no | query | Top-level metadata equality filter as `key=value`, split on the first `=`. |
| `has_metadata_key` | text | no | query | Only issues carrying this top-level metadata key. |
| `include_ephemeral` | boolean | no | query | Include ephemeral (non-synced) rows. |
| `include_deferred` | boolean | no | query | Include issues whose `defer_until` is still in the future. |
| `sort` | text | no | query | Ready-work ordering. |
| `limit` | integer | no | query | Maximum number of items to return. |
| `brief` | boolean | no | query | Omit the free-form text from every item: `description`, `design`, `acceptance_criteria`, `notes`, `payload` and `waiters` are not selected. |

Result: `ReadyPage`

Title: List ready work

Routes to: v0 `listReadyWork`, `GET /v0/beads/ready`.

CLI mapping:

```json
{"flags": [{"names": ["-n"], "parameter": "limit"}, {"names": ["-p"], "parameter": "priority"}, {"names": ["-a"], "parameter": "assignee"}, {"names": ["-u"], "parameter": "unassigned"}, {"names": ["-s"], "parameter": "sort"}, {"names": ["-l"], "parameter": "label"}, {"names": ["-t"], "parameter": "type"}]}
```

### issue/ready-count (CallableQuery)

How many items `GET /v0/beads/ready` would return for the same filters with `limit=0`. That is an identity, not an estimate: the two operations answer from one role over one predicate (`issueops.ReadyCounter`), so a client may page the listing and print this number beside it — which is exactly what `bd ready` does when it reports "showing 100 of 412".

THERE IS NO `limit` AND NO `sort` PARAMETER, and both absences are deliberate. A cardinality has no page: a limit here would answer "how many of the first N", which breaks the identity above, so the role refuses one rather than accepting it and dropping it. A cardinality has no order either — this operation counts the same set the listing returns under ANY sort policy — so there is nothing for a `sort` parameter to change and it is not published. Every other parameter of the listing is here and means exactly what it means there, including the default type exclusions and the way `type` drops them.

It costs a query of its own. A client that only needs to know whether MORE work exists should read `has_more` on the listing instead; this operation is for the client that needs the number.

**`issueReadyCountArguments`** — Arguments of issue/ready-count.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `assignee` | text | no | query | Only issues assigned to this actor. |
| `unassigned` | boolean | no | query | Only issues with no assignee. |
| `type` | Bead Type reference | no | query | A Bead Type reference (§2). |
| `exclude_type` | Bead Type reference array | no | query | A Bead Type reference (§2). |
| `label` | array of text | no | query | Labels that must ALL be present (AND). |
| `label_any` | array of text | no | query | Labels of which at least one must be present (OR). |
| `exclude_label` | array of text | no | query | Labels that must not be present. |
| `label_pattern` | text | no | query | Glob matched against labels. |
| `label_regex` | text | no | query | Regular expression matched against labels, compiled by the database in its own dialect. |
| `priority` | integer | no | query | Exact priority (0 is a real value, not "unset"). |
| `parent` | text | no | query | Restrict to recursive descendants of this issue. |
| `metadata_field` | array of text | no | query | Top-level metadata equality filter as `key=value`, split on the first `=`. |
| `has_metadata_key` | text | no | query | Only issues carrying this top-level metadata key. |
| `include_ephemeral` | boolean | no | query | Include ephemeral (non-synced) rows, which the count merges exactly as the listing lists them. |
| `include_deferred` | boolean | no | query | Include issues whose `defer_until` is still in the future. |

Result: `ReadyCount`

Title: Count ready work

Routes to: v0 `countReadyWork`, `GET /v0/beads/ready:count`.

### issue/stats (CallableQuery)

The counts `bd status` prints and its `bd stats` alias reprints: rows by status across the durable plane, plus the two DEPENDENCY-AWARE numbers — the blocked count and the readiness derived from it — that make this a different question from a filtered count.

It is `stats` rather than `status` in the path deliberately. `status` on an HTTP surface reads as the SERVER's condition, which is `/healthz`; this operation answers about the WORKSPACE and touches the database to do it.

THE WISP TIER IS NOT INCLUDED in the workspace-wide answer, so a workspace whose work lives in ephemeral rows reports zeros here. Supplying `assignee` changes that, along with three other definitions — see the parameter.

THERE IS NO PREDICATE and there will not be one. A count of a set the caller describes is a different question with a different answer shape; this operation is the summary or it is nothing.

**`issueStatsArguments`** — Arguments of issue/stats.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `assignee` | text | no | query | Answer for ONE ACTOR instead of the workspace. |
| `skip_blocked` | boolean | no | query | Ask for the answer WITHOUT the blocked-set scan, which is the expensive half of this query on a large workspace — the same request `bd status --no-blocked` makes. |

Result: `StatsResponse`

Title: Workspace summary statistics

Routes to: v0 `getStats`, `GET /v0/beads/stats`.

### issue/blocked (CallableQuery)

The blocked issues, each with the blockers bd names for it: what `bd blocked --json` prints, from the same role (`issueops.BlockedLister`). Items are `BlockedIssue`, the element type that command emits, so the two surfaces carry one shape.

THE SET IS SEEDED FROM THE STORED, TRANSITIVE `is_blocked` FLAG on both planes (durable and ephemeral), with closed and pinned-status rows excluded and NO type exclusions, then NARROWED to rows bd can name a blocker for: an active `blocks`, `waits-for` or `conditional-blocks` target resident in this workspace that is neither closed nor pinned, else the parent. A row whose flag is set but which has neither is not listed. Where the server applies the external-dependency policy (`policy.external_dependencies`), an unsatisfied `external:` blocker is added to the row's `blocked_by`, and a row blocked only by such refs (neither closed nor pinned) is listed too, narrowed by the same `parent` and label filters as every other row.

Ordered by priority ascending, then `created_at` descending, then id.

THERE IS NO `limit` AND NO CURSOR, like the local command, and `has_more` is therefore always false in v0. The whole listing is one response body, and this server bounds it by nothing but the blocked set itself, so a client's own response-size limit is the effective bound (bd's HTTP client refuses a body over 32 MiB, loudly, rather than reading part of it). A client MUST refuse an answer with `has_more` true rather than treat it as the whole listing: a later server may bound the answer and say so there, and with no cursor there is nothing to page with. Available when the server advertises `blocked.list`.

**`issueBlockedArguments`** — Arguments of issue/blocked.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `parent` | text | no | query | Only the parent's direct children (a parent-child edge) and ids under it in the dotted hierarchy, as `bd blocked --parent` narrows. |
| `label` | array of text | no | query | Labels that must ALL be present (AND). |
| `label_any` | array of text | no | query | Labels of which at least one must be present (OR). |
| `exclude_label` | array of text | no | query | Labels that must all be absent. |

Result: `BlockedPage`

Title: List blocked issues

Routes to: v0 `listBlockedIssues`, `GET /v0/beads/blocked`.

### issue/dep/cycles (CallableQuery)

Every circular blocking dependency in the workspace, the same sweep `bd dep cycles` performs. Items are `Cycle` — the element type that command's `--json` emits — so the two surfaces carry one shape.

THE ANSWER IS CANONICAL: each cycle's members are rotated so the lowest id comes first, and the cycles are sorted against each other, so two calls against an unchanged workspace return the same bytes. A client may diff two snapshots and read a difference as a real change.

EDGES ARE NARROWER THAN THEY ARE AT WRITE TIME. The walk follows `blocks` and `conditional-blocks` only: `waits-for` is gate semantics, so a mutual wait is not a deadlock, and `parent-child` is walked by the refusal a dependency WRITE performs but not by this report. A workspace this operation calls clean can therefore still refuse an edge.

Both dependency planes — durable and ephemeral — are one graph here, so a cycle that runs issue → wisp → issue is reported.

THERE IS NO `limit` AND NO CURSOR, and `has_more` is therefore always false in v0. Truncating would shrink the count, and the count is the number an operator acts on; the response is bounded by the number of cycles in the workspace, which in a healthy one is zero. `has_more` is present so that adding a bound later is additive rather than a new envelope.

**`issueDepCyclesArguments`** — Arguments of issue/dep/cycles.

Result: `CyclesPage`

Title: List dependency cycles

Routes to: v0 `listDependencyCycles`, `GET /v0/beads/dependencies/cycles`.

### issue/dep/tree (CallableQuery)

The dependency graph walked recursively from ONE root — the answer `bd dep tree` renders, and the same `TreeNode` elements that command's `--json` emits.

THE ANSWER IS FLAT. Each element carries `depth` and `parent_id`, and a client rebuilds the shape from those two; the elements are in depth-first pre-order, so a subtree is contiguous.

EVERY NODE IS EXPANDED AT MOST ONCE PER WALK, at the depth and parent of the first path that reached it. A cycle TERMINATES rather than failing the call or being reported (`GET /v0/beads/dependencies/cycles` is where a cycle is an answer): the edge back into the current path adds no element. A shared subtree is expanded under one parent only, with no option to expand it twice, and every later parent's edge into it is a stub element carrying `deduped: true`, so ids repeat; drop the stubs to get each issue once.

EDGES ARE WIDER THAN THEY ARE ON THE CYCLE REPORT. This walk follows every dependency type except `relates-to`, which is symmetric annotation — following it would make the "tree" the connected component. The cycle report follows `blocks` and `conditional-blocks` only, because it is about scheduling deadlock. Note that `related` and `relates-to` are two different types and only the second is excluded.

Both dependency planes — durable and ephemeral — are one graph here, so an ephemeral step in the middle of a chain does not end the picture.

A NODE THIS DATABASE CANNOT DESCRIBE ENDS THAT BRANCH. A `TreeNode` IS an issue, so there is no shape for "on the tree and undescribable": an edge whose target is an `external:` reference or an id in another repository's namespace contributes no node, and nothing in the answer says a branch stopped for that reason rather than because it ended. That is the one place this operation is less honest than the cycle report, whose `CycleMember` can carry a bare id.

THERE IS NO `limit` AND NO CURSOR. The walk is bounded by `max_depth` instead, which bounds the DESCENT rather than truncating the answer; `has_more` is therefore always false in v0. There is also no `max_rows`: the CLI's defensive cap is a circuit breaker for a caller that would rather fail than wait, and refusing a whole answer is not something this surface offers a remote client.

**`issueDepTreeArguments`** — Arguments of issue/dep/tree.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `root_id` | text | yes | query | The issue to walk from. |
| `direction` | text | no | query | Which way to follow edges. |
| `max_depth` | integer | no | query | How many LEVELS to descend, counting the root as level one: `max_depth=1` is the root alone. |
| `status` | text | no | query | Prune the walked tree to the nodes carrying this status AND the ancestor chain of each survivor, so the answer is still a tree. |

Result: `DependencyTreePage`

Title: Walk the dependency tree of one issue

Routes to: v0 `getDependencyTree`, `GET /v0/beads/dependencies/tree`.

CLI mapping:

```json
{"flags": [{"names": ["-d"], "parameter": "max_depth"}], "positionals": [{"position": 0, "parameter": "root_id"}]}
```

### issue/list (CallableQuery)

Issues under the same default exclusions `bd list` applies (closed and custom done/frozen statuses, templates, gates and configured infra types), each carrying dependency, dependent and comment counts.

ORDERING IS NAMED BY `sort`, AND THE VOCABULARY IS CLOSED. Two orders are served: `created` — `(created_at DESC, id ASC)`, the default and the only order earlier revisions had — and `priority` — `(priority ASC, created_at DESC, id ASC)`, which is `bd list`'s flagless ordering and also what `bd list --sort priority` produces. Absent `sort` means `created`, permanently: it is the compatibility contract for every client written before this parameter existed.

THE ORDER AND THE CURSOR ARE ONE DECISION, which is why the vocabulary is closed rather than the nine-value display vocabulary `bd list --sort` and `GET /v0/beads/issues:query` take. A `cursor` is a keyset POSITION in a total order, so each served order needs its own strictly-after predicate and its own proof that its key is total. Both of these have one: `priority` and `created_at` are non-null and `id` is unique, so a page boundary landing inside a run of equal keys resolves on `id` with no dropped and no repeated row. The other seven orders do not — `id` is a natural-numeric order no database expresses, `updated` moves on every write, `closed` is nullable, and `status`/`title`/`type`/`assignee` are mutable and unindexed — so they are not offered here at all rather than offered behind a cursor that would silently skip and duplicate.

A CURSOR IS A POSITION IN THE ORDER IT WAS MINTED IN, and re-sending one under a different `sort` is refused with 400 `invalid_cursor` (recovery: restart paging). This is the one thing about a cursor that is NOT "just repeat your request": mismatched FILTERS are undetectable and silently resume from the old position, while a mismatched ORDER is detected and refused, because a position whose order is unknown is not interpretable at all.

`priority` IS A MUTABLE KEY, which `created_at` is not, and a paging client should know what that costs. Under `created` only new rows move relative to a walk; under `priority` an `bd update --priority` moves an existing row too, so it can be seen twice or missed. That is the already-documented consequence of a cursor pinning a position rather than a snapshot, reached by updates as well as by creations — not a new class of error. Unchanged data never skips or repeats under either order.

The item set, and each item's JSON, are identical to `bd list --json`. Under `sort=priority` so is the order, so a client that used to page this operation to exhaustion and re-sort client-side to reproduce `bd list` can now ask for one page.

EPHEMERAL ROWS ARE OUT OF SCOPE BY DEFAULT and are admitted by `include_ephemeral`, which merges that tier IN ADDITION to the durable one. The merged page is ordered by the requested `sort` across both tiers as if they were one table, and `cursor` pages across the merge without skipping or repeating a row.

`include_ephemeral` and `include_infra` are INDEPENDENT and compose: the first admits a tier, the second takes the infrastructure TYPE exclusions off (and admits the tier those types live in). Ephemeral rows of an infrastructure type therefore need `include_infra`.

The CLI has no `--include-ephemeral` flag for `bd list` yet, so this is the one filter on this operation with no `bd list` spelling; `--include-infra` is the nearest one and is wider.

THE ROWS CARRY NO `revision`, AND THE DETAIL READ DOES. A list-then-guard loop is a real shape, and the reason the token stops at `GET /v0/beads/issues/{id}` is not its size — measured against a 20k-row production export the member is 28 bytes on a 1449-byte median row, under 2%. It is that `IssueWithCounts` is ALSO THE INTERCHANGE ROW: it is the record `bd export` writes to JSONL and the auto-export flushes into a git-tracked `issues.jsonl`, and the token is re-minted by every write, so publishing it on this element would put a per-write-random value into a file whose whole value is that it diffs only when something meant something. `IssueDetails` has neither problem: nothing interchanges it, and it is assembled in exactly one place, which is also why its token cannot be silently 0 on some path that forgot to set it. A caller that has a list and wants a guard reads the rows it actually intends to write, one detail read each — the read it needs anyway to decide.

THE ROWS CARRY NO COMMENT BODIES, AND THE DETAIL READ DOES. This operation has no `include_comments`: `comments` is always absent here and `comments_omitted` is how a row says that its comment text exists and was not sent, so a caller reads the bodies it wants one detail read each (`GET /v0/beads/issues/{id}?include_comments=true`), as it does for `revision` above. `bd list --include-comments` hydrates a whole page because a CLI listing is one command's whole answer; the cost is a query per commented row, which is a choice a local invocation makes for itself and a served endpoint should not make on a caller's behalf by default. Growing the parameter here is a later revision's call, and until it happens the marker is this operation's answer rather than a hole it cannot describe.

**`issueListArguments`** — Arguments of issue/list.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `status` | array of text | no | query | Status filter. |
| `type` | Bead Type reference | no | query | A Bead Type reference (§2). |
| `assignee` | text | no | query | Only issues assigned to this actor. |
| `label` | array of text | no | query | Labels that must ALL be present (AND). |
| `label_any` | array of text | no | query | Labels of which at least one must be present (OR). |
| `exclude_label` | array of text | no | query | Labels that must not be present. |
| `parent` | text | no | query | Restrict to recursive descendants of this issue. |
| `all` | boolean | no | query | Drop the default status exclusions (closed plus any custom statuses in the done/frozen categories). |
| `include_templates` | boolean | no | query | Include template molecules. |
| `include_gates` | boolean | no | query | Include gate issues. |
| `include_infra` | boolean | no | query | Include the workspace's configured infrastructure issue types. |
| `include_ephemeral` | boolean | no | query | Include the ephemeral tier — ephemeral rows and the non-synced rows stored beside them — merged into the same order as the durable ones, whichever order `sort` named. |
| `created_before` | text | no | query | Only issues created strictly before this instant. |
| `created_after` | text | no | query | Only issues created strictly after this instant. |
| `metadata_field` | array of text | no | query | Top-level metadata equality filter as `key=value`, split on the first `=`. |
| `has_metadata_key` | text | no | query | Only issues carrying this top-level metadata key. |
| `q` | text | no | query | `bd search`'s free text. |
| `no_assignee` | boolean | no | query | Only issues with no assignee: `bd list --no-assignee`, handed to the role as written beside the other filters. |
| `title` | text | no | query | Case-insensitive substring match on the title: `bd list --title`. |
| `id` | array of text | no | query | Restrict to these canonical ids (repeat the parameter). |
| `title_contains` | text | no | query | Case-insensitive substring match on the title: `bd list --title-contains`, spelled as `GET /v0/beads/issues:count` spells it. |
| `desc_contains` | text | no | query | Case-insensitive substring match on the description: `bd list --desc-contains`. |
| `notes_contains` | text | no | query | Case-insensitive substring match on the notes: `bd list --notes-contains`. |
| `external_contains` | text | no | query | Substring match on the external reference: `bd list --external-contains`. |
| `external_ref` | text | no | query | Exact match on the external reference: `bd list --external-ref`. |
| `spec` | text | no | query | Only issues whose spec id starts with this prefix: `bd list --spec`. |
| `label_pattern` | text | no | query | Glob label filter: `bd list --label-pattern`, with `GET /v0/beads/ready`'s spelling. |
| `label_regex` | text | no | query | Regular-expression label filter: `bd list --label-regex`, with `GET /v0/beads/ready`'s spelling. |
| `updated_after` | text | no | query | Only issues last updated strictly after this instant: `bd list --updated-after`. |
| `updated_before` | text | no | query | Only issues last updated strictly before this instant: `bd list --updated-before`. |
| `closed_after` | text | no | query | Only issues closed strictly after this instant: `bd list --closed-after`. |
| `closed_before` | text | no | query | Only issues closed strictly before this instant: `bd list --closed-before`. |
| `defer_after` | text | no | query | Only issues deferred until strictly after this instant: `bd list --defer-after`. |
| `defer_before` | text | no | query | Only issues deferred until strictly before this instant: `bd list --defer-before`. |
| `due_after` | text | no | query | Only issues due strictly after this instant: `bd list --due-after`. |
| `due_before` | text | no | query | Only issues due strictly before this instant: `bd list --due-before`. |
| `priority` | integer | no | query | Exact priority: `bd list --priority`. |
| `priority_min` | integer | no | query | Lowest priority to list, inclusive: `bd list --priority-min`. |
| `priority_max` | integer | no | query | Highest priority to list, inclusive: `bd list --priority-max`. |
| `empty_description` | boolean | no | query | Only issues with an empty description: `bd list --empty-description`. |
| `no_labels` | boolean | no | query | Only issues carrying no label: `bd list --no-labels`. |
| `no_parent` | boolean | no | query | Only top-level issues, those with no parent: `bd list --no-parent`. |
| `exclude_type` | Bead Type reference array | no | query | A Bead Type reference (§2). |
| `exclude_status` | array of text | no | query | Statuses to leave out (repeat the parameter; a value may also be comma-separated), on top of what `status` or the default exclusions select; it never re-admits a row they hide. |
| `pinned` | boolean | no | query | Only issues carrying the pinned FLAG, at any status: `bd list --pinned`. |
| `no_pinned` | boolean | no | query | Only issues without the pinned flag, held in place where `all` or a pinned/hooked `status` would otherwise drop that predicate: `bd list --no-pinned`. |
| `deferred` | boolean | no | query | Only deferred issues: `bd list --deferred`. |
| `overdue` | boolean | no | query | Only overdue issues, those whose due time is before now: `bd list --overdue`. |
| `mol_type` | text | no | query | Only molecules of this type: `bd list --mol-type`. |
| `wisp_type` | text | no | query | Only rows of this wisp type (a predicate on the column, not a plane selector): `bd list --wisp-type`. |
| `sort` | text | no | query | Omitted, this Callable uses `"priority"`. |
| `cursor` | text | no | query | Opaque keyset position, taken verbatim from a previous response's `next_cursor`. |
| `limit` | integer | no | query | Maximum number of items to return. |
| `brief` | boolean | no | query | Omit the free-form text from every item: `description`, `design`, `acceptance_criteria`, `notes`, `payload` and `waiters` are not selected. |

Result: `IssuesPage`

Title: List issues

Routes to: v0 `listIssues`, `GET /v0/beads/issues`.

CLI mapping:

```json
{"flags": [{"names": ["-s"], "parameter": "status"}, {"names": ["-a"], "parameter": "assignee"}, {"names": ["-t"], "parameter": "type"}, {"names": ["-l"], "parameter": "label"}, {"names": ["-n"], "parameter": "limit"}]}
```

### issue/query (CallableQuery)

The `bd query` expression language over HTTP: field comparisons combined with `AND`, `OR`, `NOT` and parentheses. It is the one operation on this surface that takes a DISJUNCTION — every filter parameter of `GET /v0/beads/issues` narrows the answer, and no combination of them expresses `type=bug OR label=urgent`.

IT IS NOT A SQL PASSTHROUGH, and the shape of the language is what makes that true rather than a promise about validation: there are no table names, no joins and no way to name a column the vocabulary does not publish. The vocabulary is the one `bd query --help` documents, and an expression outside it is a 400 rather than an empty page.

EVERY MATCH IS IN SCOPE, which has not always been true and is the reason this operation exists in the shape it does. An expression the storage filter cannot express is answered by evaluating the predicate over every candidate row and then cutting the page, so `has_more` means what it says. The CLI used to bound that scan at a few hundred rows and filter what came back, which silently dropped matches from an `OR` query and reported the result as complete. The cost is stated rather than hidden: a broad expression over a large workspace is a large read, and `limit` bounds the RESPONSE rather than the scan.

THERE IS NO CURSOR AND NO `offset`. A cursor is a keyset position in a database order, and the matching set of a predicate query is assembled outside the database, so there is no position to encode; `offset` is absent because the two database sources this server can be built on disagree about whether they can honor one, and a parameter that works under one deployment topology and refuses under another is worse on a wire than an absent one. Raise `limit`, or narrow the expression.

**`issueQueryArguments`** — Arguments of issue/query.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `q` | text | yes | query | The query expression, e.g. |
| `all` | boolean | no | query | Include closed issues. |
| `sort` | text | no | query | Display order for the page. |
| `reverse` | boolean | no | query | Invert the display order. |
| `limit` | integer | no | query | Maximum number of items to return. |

Result: `QueryPage`

Title: Query issues with a boolean expression

Routes to: v0 `queryIssues`, `GET /v0/beads/issues:query`.

CLI mapping:

```json
{"flags": [{"names": ["-n"], "parameter": "limit"}, {"names": ["-a"], "parameter": "all"}, {"names": ["-r"], "parameter": "reverse"}], "positionals": [{"position": 0, "parameter": "q"}]}
```

### issue/count (CallableQuery)

How many issues match, and — with `group_by` — how many in each bucket. It is the operation behind `bd count`, and it answers from `issueops.Counter` over the same predicate that command builds.

##### It is not `GET /v0/beads/issues` with the page taken off

That is the difference to internalize before using it, because the two answer about DIFFERENT SETS by default. A listing hides closed, pinned, template and gate rows; a count hides NONE of them. An empty request here counts every durable row this workspace holds, closed rows included, and it is the ROLE that decides that — the same decision `bd count` has always made — not a default this operation applies.

Nor is it a listing with paging removed at the type level: there is no `limit`, no `offset` and no `cursor`, and the role refuses the first two rather than accepting them and dropping them. A cardinality is a number about a set; bounding the scan would answer "how many of the first N", which is the shape that makes a caller believe `limit=10` bounded the answer.

There is no free-text `q` either. The count seam takes one and both of this role's front doors have always passed the empty string, so it is left off rather than published untested. `title`, `title_contains`, `desc_contains` and `notes_contains` are the substring matches that ARE reachable.

##### One operation, two shapes of one answer

`group_by` selects the bucketed form. It is a parameter rather than a second operationId because the role is one role born with two methods, for a reason this document inherits rather than re-decides: the two ask the SAME predicate of the SAME set and differ only in whether the answer is one number or a number per bucket. The grouped response is the scalar response PLUS `groups` — the same schema, with one member that appears when you ask for it — so there is no second contract here to hide under one id.

That is the opposite of `GET /v0/beads/events:watch`, which is a sibling operation rather than a mode of the paged read: those two differ in media type, lifetime, limits and capacity, and one operation carrying both would have documented two of everything. Here nothing differs but one optional response member.

##### `total` is not the sum of `groups`

For four of the five dimensions it happens to be. For `label` it is not, and that is why the role computes it rather than leaving a client to add the buckets up: LABEL BUCKETS OVERLAP. An issue carrying three labels is one row in `total` and one row in each of three buckets, so a client that summed them would report a workspace three times its size.

The two numbers are NOT promised to describe one snapshot. The store-backed implementation runs the scalar and the grouped query separately, so a concurrent write between them can leave them disagreeing by that write. Nothing here is transactional across the two.

##### Planes

A count is DURABLE-PLANE ONLY unless `include_infra` or `include_ephemeral` is set. The wisps tier — ephemeral wisps and the `no_history` beads that are durable work stored in that tier — is not counted by default. `include_ephemeral` admits that tier and changes nothing else; `include_infra` admits it too but changes FOUR things at once rather than one. See that parameter; it is the one place on this operation where a single flag moves the set in more than one direction.

**`issueCountArguments`** — Arguments of issue/count.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `status` | text | no | query | One stored status. |
| `type` | Bead Type reference | no | query | A Bead Type reference (§2). |
| `assignee` | text | no | query | Only issues assigned to this actor. |
| `priority` | integer | no | query | Exact priority. |
| `priority_min` | integer | no | query | Lowest priority to count, inclusive. |
| `priority_max` | integer | no | query | Highest priority to count, inclusive. |
| `label` | array of text | no | query | Labels that must ALL be present. |
| `label_any` | array of text | no | query | Labels of which at least ONE must be present. |
| `title` | text | no | query | Case-insensitive substring match on the title. |
| `id` | text | no | query | A comma-separated id set to restrict the count to. |
| `title_contains` | text | no | query | Substring match on the title, spelled as `GET /v0/beads/issues:query` spells it. |
| `desc_contains` | text | no | query | Substring match on the description. |
| `notes_contains` | text | no | query | Substring match on the notes. |
| `created_after` | text | no | query | RFC 3339. |
| `created_before` | text | no | query | RFC 3339. |
| `updated_after` | text | no | query | RFC 3339. |
| `updated_before` | text | no | query | RFC 3339. |
| `closed_after` | text | no | query | RFC 3339. |
| `closed_before` | text | no | query | RFC 3339. |
| `empty_description` | boolean | no | query | Only issues with no description. |
| `no_assignee` | boolean | no | query | Only issues with no assignee. |
| `no_labels` | boolean | no | query | Only issues carrying no label. |
| `metadata_field` | array of text | no | query | Top-level metadata equality filter as `key=value`, split on the first `=`. |
| `include_ephemeral` | boolean | no | query | Admit the EPHEMERAL PLANE — the wisps table — and nothing else. |
| `has_metadata_key` | text | no | query | Only issues carrying this top-level metadata key. |
| `include_infra` | boolean | no | query | Count the cardinality of `bd list --include-infra --all` instead of the durable plane. |
| `parent` | text | no | query | Restrict to one issue's children through one predicate with two arms: a parent-child dependency edge onto `parent`, OR — for an issue carrying no parent-child edge at all — a dotted-id prefix match (`parent.anything`). |
| `no_parent` | boolean | no | query | Only issues carrying NO parent-child dependency edge. |
| `exclude_type` | Bead Type reference array | no | query | A Bead Type reference (§2). |
| `exclude_status` | array of text | no | query | Statuses to exclude from the count. |
| `group_by` | text | no | query | Bucket the count by one dimension and return `groups` beside `total`. |

Result: `IssueCount`

Title: Count issues matching a predicate

Routes to: v0 `countIssues`, `GET /v0/beads/issues:count`.

CLI mapping:

```json
{"flags": [{"names": ["-s"], "parameter": "status"}, {"names": ["-p"], "parameter": "priority"}, {"names": ["-a"], "parameter": "assignee"}, {"names": ["-t"], "parameter": "type"}, {"names": ["-l"], "parameter": "label"}]}
```

### issue/show (CallableQuery)

Returns a single object, never an array. The id must be the exact canonical issue id: there is no fuzzy, prefix or substring resolution on this surface, so a lookup can never resolve to a different issue than the caller named. Wisp (ephemeral) records are looked up as a fallback when no issue matches.

COMMENT BODIES AND DEPENDENTS ARE ASKED FOR, NEVER VOLUNTEERED. They are the two expensive row lists on this read, so each is absent unless the request sets the parameter that populates it, and a caller that wants only the cardinalities reads `comment_count`, `dependent_count` and `comments_omitted` and pays for neither. A request that sets neither parameter is answered exactly as this operation answered it before the parameters existed.

IT IS THE TOKEN SOURCE FOR A GUARDED WRITE. The response carries `revision`, the row's optimistic-concurrency token, so a read-modify-write loop starts HERE: read the row, decide from what it says, and send the token back as the next request's `expected_version`. Before this member every token on the surface was minted by a WRITE, so the first guarded write of a loop had to be preceded by a write the caller did not want to make — or guarded on nothing at all, which is the lost-update this whole family exists to refuse. The token is carried on every 200, including for an ephemeral wisp resolved by the fallback lookup.

**`issueShowArguments`** — Arguments of issue/show.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `id` | text | yes | path | Exact canonical issue id. |
| `include_comments` | boolean | no | query | Populate `comments` with the issue's full comment bodies. |
| `include_dependents` | boolean | no | query | Populate `dependents` with the issues that depend on this one, each carrying its edge type — the shape `dependencies` already carries. |
| `brief_deps` | boolean | no | query | Reduce each row in `dependencies` to its identity-and-shape fields (`id`, `title`, `status`, `issue_type`, `priority`, `dependency_type`), dropping `description`, `design`, `notes` and `acceptance_criteria`. |

Result: `IssueDetails`

Title: Get one issue with its labels, dependencies and counts

Routes to: v0 `getIssue`, `GET /v0/beads/issues/{id}`.

CLI mapping:

```json
{"positionals": [{"position": 0, "parameter": "id"}]}
```

### issue/dep/list (CallableQuery)

THE ISSUES ON THE FAR END of this issue's edges, in the direction the request names, each carrying the type of the edge that led to it. It is the read behind `bd dep list`'s neighbor view, and its elements are the same `IssueWithDependencyMetadata` the `dependencies` and `dependents` members of `GET /v0/beads/issues/{id}` already carry.

IT IS A SUB-RESOURCE OF THE ISSUE, not a member of the dependency collection, and the two answer different things about the same edges. `GET /v0/beads/dependencies` returns the stored edge ROWS — targets spelled exactly as stored, nothing looked up — for many anchors at once; this one is anchored on ONE issue and answers with HYDRATED ISSUES, so an edge whose far end this database holds no row for is not a neighbor at all. `issueops.Relations` and `issueops.EdgeReader` state that split once; nothing is restated here.

THE CONSEQUENCE IS WORTH READING BEFORE COUNTING ANYTHING. A dependency target may be an `external:` reference or an id belonging to another repository, and this database holds no issue for either. Such an edge is left out with no placeholder row and no error, so the length of `items` is this issue's NEIGHBOR count and not its EDGE count, and the two differ by however many of its edges point outside this database. A caller that needs the edges themselves reads `GET /v0/beads/dependencies`; a caller that needs the number reads `GET /v0/beads/dependencies:count`, which counts edges and not neighbors.

AN ID THAT NAMES NEITHER AN ISSUE NOR A WISP IS A 404, and that is the difference from every other graph read on this surface. Those are batched and report a miss per anchor, because failing the call would throw away the answers for the ids that were found; here there is one anchor and no other answer to preserve. It matters because an empty `items` is the COMMON case — most issues have neighbors in only one direction — so a typo answered with an empty list would never surface.

BOTH PLANES ARE READ, on the anchor and on its neighbors. The anchor is resolved against the durable and ephemeral planes together, so a wisp id is a legal anchor; and the neighbors are collected from BOTH dependency tables and hydrated from both issue tables, so a durable issue's `in` neighbors include the wisps that depend on it and a `direction=out` answer includes the wisp targets it depends on. Those are the ROLE's rules, stated at `issueops.Relations`, and this document cites them rather than restating them.

THE ORDER IS PINNED: ascending by the neighbor's id, with the edge type breaking a tie. It is pinned rather than left to the query because the rows come from two dependency tables read in sequence, so their natural order is an artifact of which plane a neighbor happens to live on — stable enough to look deliberate and not stable enough to rely on.

THE ROWS CARRY NO `revision`, on `GET /v0/beads/issues`'s terms. A client holding a neighbor list and wanting a guard reads the rows it actually intends to write, one detail read each.

THERE IS NO `limit` AND NO CURSOR. One issue's neighbors are unbounded here exactly as the `dependencies` member of `GET /v0/beads/issues/{id}` already is, and this operation names ONE anchor, so there is no question to bound instead — which is what the dependency-collection reads bound at 100 `issue_id` values apiece. A limit with no cursor behind it would truncate with no way to fetch the rest.

THERE IS NO `both` DIRECTION, for the reason `GET /v0/beads/dependencies:count` has none: a caller that wants the pair asks twice, and one call answering both would have to say which direction each row came from — which is a second member on an element this document deliberately shares with the detail read.

**`issueDepListArguments`** — Arguments of issue/dep/list.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `id` | text | yes | path | Exact canonical issue id. |
| `direction` | text | no | query | Omitted, this Callable uses `"out"`. |
| `type` | Link Type reference array | no | query | A Link Type reference (§2). |

Result: `RelatedIssues`

Title: List one issue's neighbors in a named direction

Routes to: v0 `listRelatedIssues`, `GET /v0/beads/issues/{id}/related`.

CLI mapping:

```json
{"flags": [{"names": ["-t"], "parameter": "type"}], "positionals": [{"position": 0, "parameter": "id"}]}
```

### issue/get-many (CallableQuery)

Reads every issue the request NAMES, hydrated, in ONE snapshot. It is the operation behind `issueops.BatchGetter`, and exists because the obvious way to read N issues — `GET /v0/beads/issues/{id}` repeated N times — costs N round trips to answer a question a caller already knows the shape of: "which of these ids exist, and what do they look like right now."

A POST rather than a `GET` with a repeated query parameter: the request names up to 1000 ids, which does not fit a query string reliably, and `issues:delete` beside it makes the same choice for the same reason.

##### What a miss means

AN ID THAT NAMES NO STORED ROW IS NOT AN ERROR. It is reported in `missing`, in the order it was first named, beside whatever else resolved — the same answer `GET /v0/beads/dependencies` and `GET /v0/beads/dependencies:count` give a miss on their own anchors, and the opposite of `GET /v0/beads/issues/{id}`, which answers ONE id with the issue or a `404`. There is no `404` on this operation: a batch read that discarded the ids that DID resolve because one did not would be strictly worse than reporting both.

DUPLICATES COLLAPSE. A request naming the same id twice gets it back once, in `issues` or in `missing`, in the position of its FIRST mention — never both. `issues` and `missing` partition the DISTINCT ids the request named; their lengths always sum to that count.

An empty `ids` is legal and answers with both arrays empty — the same empty-request answer `EdgeCountRequest.ids` documents, because "no ids" is a legitimate thing to ask for 0 issues about.

##### One snapshot

The existence check and the hydration share ONE transaction, so a response never reports an id missing while a concurrent write was creating it, or hands back a row for an id a concurrent write had already deleted. Each returned issue carries its current `revision`, so a caller that goes on to write one back has the optimistic-concurrency token a lifecycle write wants without a second round trip.

##### No HTTP client leg yet

This operation ships a server and a library role on every leg (dolt, embedded dolt, the unit-of-work provider), but no generated HTTP CLIENT method. A caller on the wrong side of that door reaches it through the raw request this document describes rather than through a typed client call, until the client generator lands.

**`issueGetManyArguments`** — Arguments of issue/get-many.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `ids` | array of text | yes | body | The issues to read, exact ids, in either plane. |

Result: `BatchGetIssuesResult`

Title: Read many issues by id in one snapshot

Routes to: v0 `batchGetIssues`, `POST /v0/beads/issues:batchGet`.

### issue/dep/edges (CallableQuery)

The STORED EDGE ROWS whose source is each named issue — the answer `bd dep list a b c` gives, and the same `Dependency` elements that command's `--json` emits.

THESE ARE ROWS, NOT NEIGHBORS, and that is the difference from the `dependencies` member of `GET /v0/beads/issues/{id}`'s issue body. A dependency target may be an `external:` reference or an id belonging to another repository, and this database holds no issue for either; such an edge is returned here with its target spelled exactly as stored, and nothing is looked up on the far end. The `id` member of each element is absent: the read behind this operation does not select the row's surrogate key, so the `(issue_id, depends_on_id, type)` triple is what identifies an edge on this surface.

THE DIRECTION IS OUTGOING ONLY — what each issue depends on. There is no direction parameter: the inbound bulk read is a different read against a different key with its own de-duplication rule across the two dependency tables, and adding it later is additive.

A NAMED ISSUE THAT DOES NOT EXIST IS NOT A 404. It is listed in `missing`, and the edges of the issues that do exist are still returned: a batch that failed on one absent id would throw away the answers for the ids that were found. An issue that exists and depends on nothing is absent from `missing` and contributes no `items`, which is the distinction this operation exists to publish — an empty edge list is otherwise indistinguishable from a typo, and the empty list is the common case.

THERE IS NO `limit` AND NO CURSOR. `bd dep list` has no limit either, so one here would make the two surfaces answer differently by default; instead the QUESTION is bounded — at most 100 `issue_id` values per call — which bounds the answer without truncating it. Each issue's edges are unbounded, exactly as the `dependencies` member of `GET /v0/beads/issues/{id}` already is.

**`issueDepEdgesArguments`** — Arguments of issue/dep/edges.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `issue_id` | array of text | yes | query | The issues to read edges for. |
| `type` | Link Type reference array | no | query | A Link Type reference (§2). |

Result: `DependencyEdges`

Title: List the stored dependency edges of several issues

Routes to: v0 `listDependencies`, `GET /v0/beads/dependencies`.

### issue/dep/count (CallableQuery)

HOW MANY EDGES each named issue has in ONE named direction, after the type and status filters — the cardinality behind `GET /v0/beads/dependencies`, plus the direction that read does not take. Nothing is materialized: this is the operation for a caller that wants the numbers for issues whose edges it will never print.

IT IS NOT THE LISTING COUNTED, and the operationId says so rather than pretending otherwise. The listing is OUTGOING ONLY and takes no direction; this one REQUIRES a direction and answers about either end. Naming it `countDependencies` would have promised that it sizes the set `listDependencies` returns, which it does only at `direction=out`.

THE ANSWER IS PER ANCHOR, which is the other difference from the listing. That one flattens every issue's edges onto one array because the rows carry their own `issue_id`; a number does not, so folding these together would produce a total no caller asked for and lose the per-issue answer every caller wants. `anchors` carries one entry per DISTINCT requested id, in the order the request first named it — an array rather than an object, because the request's order is part of the answer and a keyed object would have made that ordering this surface's own invention.

A NAMED ISSUE THAT DOES NOT EXIST IS NOT A 404, on `GET /v0/beads/dependencies`'s terms and one sharper: its entry reports `missing: true` with `count: 0`, and 0 is the COMMON answer here — most issues have no edges in at least one direction — so without that flag a typo would be indistinguishable from a real zero and would never surface. There is no `not_found` on this operation at all.

THE COUNT SPANS BOTH DEPENDENCY PLANES and is a SUM rather than a distinct count of edge rows; a status-narrowed count reads the dependent's status from its own plane; and `status` is legal only with `direction=in` because an outbound edge's far end may be a row this database does not hold. Those are the ROLE's rules, stated once at `issueops.GraphCounter` and its `EdgeCountRequest`, and this document cites them rather than restating them — a second telling is a second thing to keep true.

THERE IS NO `limit` AND NO CURSOR, for the reason `GET /v0/beads/dependencies` has none and `GET /v0/beads/issues:count` gives: a cardinality has no page, and bounding the scan would answer "how many of the first N". The QUESTION is bounded instead, at 100 `issue_id` values per call — the same bound, the same number and the same constant as the listing on this collection, because the two bound the same thing and a client holding both must not have to learn two numbers.

THERE IS NO `both` DIRECTION. A caller that wants the pair asks twice, which is what every front door in the tree already does. One call answering both would mean two numbers per anchor, and `status` — which narrows by a row only the inbound direction has — would then govern one of them and silently not the other.

**`issueDepCountArguments`** — Arguments of issue/dep/count.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `issue_id` | array of text | yes | query | The anchors to count around. |
| `direction` | text | yes | query | Which end of the edge the anchors sit on. |
| `type` | Link Type reference array | no | query | A Link Type reference (§2). |
| `status` | text | no | query | Count only edges whose DEPENDENT — the issue at the source end, the one doing the depending — is in this stored status. |

Result: `EdgeCounts`

Title: Count the dependency edges around several issues

Routes to: v0 `countDependencyEdges`, `GET /v0/beads/dependencies:count`.

### issue/blocking-annotations (CallableQuery)

The DERIVED blocking summary `bd list` prints beside each row — `(parent: X, blocked by: Y, blocks: Z)` — for the issues named here.

IT IS DERIVED, NOT STORED, and that is the whole difference from `GET /v0/beads/dependencies` next door. That operation returns the edge ROWS: every edge type, targets spelled exactly as stored, nothing looked up. This one answers a summary over TWO of those types with a rule applied: a `blocks` edge counts only while its blocker is open, and a `parent-child` edge becomes `parent` rather than a blocker. A client that wants the rows asks the other operation; a client that wants the decoration a listing shows asks this one.

A CLOSED BLOCKER IS NOT A BLOCKER, in either direction. An issue whose every blocker is closed comes back with an empty `blocked_by`, and a CLOSED issue blocks nothing — its `blocks` is empty even where the edges still exist. `parent` follows the same rule: a closed parent is absent.

A BLOCKER THIS WORKSPACE HOLDS NO ROW FOR STILL BLOCKS. An `external:` reference, an id in another repository's namespace and an id whose issue was deleted out from under its edges are all statuses this database cannot read, and an unreadable status is not `closed`. Hiding such a blocker would report work as unblocked on the strength of a row that was never found, so it is reported.

THERE IS NO `missing` MEMBER, unlike `GET /v0/beads/dependencies`. This operation runs no existence probe: an id that names nothing and an id with no live blocking edges decorate identically, so the probe would be a read whose answer no client could act on. A client that needs to know whether an id exists calls `GET /v0/beads/issues/{id}`, which answers `404`. Every requested id gets an entry here either way.

THERE IS NO `limit` AND NO CURSOR, for the reason `GET /v0/beads/dependencies` has none: the QUESTION is bounded instead, at 100 `issue_id` values per call, which bounds the answer without truncating it.

**`issueBlockingAnnotationsArguments`** — Arguments of issue/blocking-annotations.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `issue_id` | array of text | yes | query | The issues to annotate. |
| `is_blocked` | boolean | no | query | `true` adds each item's `is_blocked`: the issue's stored, TRANSITIVE readiness flag — the column the ready set filters on, which a child inherits from a blocked parent and which `waits-for` and `conditional-blocks` […] |

Result: `BlockingAnnotations`

Title: Read the blocking decoration of several issues

Routes to: v0 `listBlockingAnnotations`, `GET /v0/beads/dependencies/blocking`.

### config/list (CallableQuery)

The SETTINGS stored in the workspace database, which is the plane `bd config list` reads. It is not the effective configuration: values that reach a running `bd` from `config.yaml`, from environment variables or from git config are absent and cannot be here, because they are files and variables on the CLIENT's machine and this server answers for the database. `bd config show` is the multi-source view and has no HTTP operation for the same reason.

IT IS NOT EVERY ROW OF THAT TABLE. Keys under `kv.` are omitted — the generic `bd kv` namespace and the `bd remember` memories nested under it. Those rows are USER DATA that rides in the settings table because there is one table, not because they are settings, and enumerating them here published a workspace's memories, key and value, to anything that could reach this port. `bd config list` omits them too: the exclusion is in the shared role both doors call, so the two cannot drift.
`getSetting` still answers a `kv.` key NAMED EXACTLY, and this operation is where it stopped being discoverable.

SETTINGS WHOSE KEY MARKS THEM AS CREDENTIAL-BEARING ARE WITHHELD. Their entry is present with `redacted: true` and no `value`, so a client can see that the key is configured without the surface handing a secret to every process that can reach the port. A CONFIGURED BEARER DOES NOT NARROW IT: authentication on this surface is a deployment posture and the credential, where there is one, is a single shared token that names nobody — it decides WHO may call, never what a caller who is let in may read — and there is no TLS either. The rule is the KEY's and is the same for every caller. See `Setting`, and `PUT` on this key's own path for the write half, which withholds the value in its response for the same reason and permits the write.

The envelope is the paginated one and `has_more` is always false today: settings are a keyed namespace a workspace holds tens of, not a collection to scan, so the whole plane is returned in one page. The envelope is used anyway because entries are ordered by key, which makes a keyset cursor expressible later without a breaking change.

**`configListArguments`** — Arguments of config/list.

Result: `SettingsPage`

Title: List the workspace's stored settings

Routes to: v0 `listSettings`, `GET /v0/beads/config`.

### config/get (CallableQuery)

The value stored for one key, used verbatim: there is no namespace completion, no case folding and no dash/underscore equivalence.

THERE IS NO 404 ON THIS OPERATION, deliberately. A key nothing stored and a key stored as the empty string are the same answer here — 200 with `value` absent — because the storage seam behind it cannot tell them apart and neither can `bd config get`, which prints "(not set)" for both. Answering 404 for one of them would publish a distinction this server would have to invent.

**`configGetArguments`** — Arguments of config/get.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `key` | text | yes | path | Exact setting key, used verbatim. |

Result: `Setting`

Title: Get one stored setting

Routes to: v0 `getSetting`, `GET /v0/beads/config/{key}`.

CLI mapping:

```json
{"positionals": [{"position": 0, "parameter": "key"}]}
```

### memory/list (CallableQuery)

Every memory this workspace holds, optionally narrowed by `search`. It is the plane `bd memories` reads.

ONLY THE MEMORY PLANE. Memories ride in the same database table as the workspace's settings and as the generic `bd kv` namespace, and neither of those appears here, whatever it contains — including a memory whose key SHADOWS a settings name: a memory called `issue_prefix` is a memory, and the workspace's real issue prefix is not one. That separation is the role's, pinned by its conformance contract, not a filter applied to this answer.

MEMORY CONTENT IS SERVED IN FULL, and authentication does not narrow that. Every entry carries its value verbatim; there is no `redacted` member and nothing is withheld. A bearer decides WHO may call, not what a caller who is let in may read, so a token-protected server serves every memory to every holder of the token. See `POST /v0/beads/memories` for why a key-name heuristic would be worse here than no promise at all. This is the operation that makes stored memories DISCOVERABLE rather than merely readable by a caller who already knows a key — an operator binding beyond loopback is accepting exactly that for everyone the token admits.

A memory stored as the EMPTY STRING is enumerated here, because its key exists, and `GET /v0/beads/memories/{key}` agrees: it answers `200` for that same row, with an empty `value`. Presence is row existence on both surfaces, never whether the value happens to be non-empty; only a key nothing stored is missing from either one.

The envelope is the paginated one and `has_more` is ALWAYS false: memories are a keyed namespace a workspace holds tens of, not a collection to scan, so the whole plane comes back in one page. There is no `limit` and no cursor. The envelope is used anyway because entries are ordered by key, which makes a keyset cursor expressible later without a breaking change.

**`memoryListArguments`** — Arguments of memory/list.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `search` | text | no | query | Narrows the answer to memories that MATCH: a memory matches when the lowercase of its key, or the lowercase of its value, contains the lowercase of this term. |

Result: `MemoriesPage`

Title: List the workspace's stored memories

Routes to: v0 `listMemories`, `GET /v0/beads/memories`.

CLI mapping:

```json
{"positionals": [{"position": 0, "parameter": "search"}]}
```

### memory/recall (CallableQuery)

The memory stored under one key, used verbatim: no namespace completion, no case folding, no dash/underscore equivalence. It is the operation behind `bd recall`.

THIS OPERATION HAS A REAL 404, and it is the one place this surface diverges from `GET /v0/beads/config/{key}`, which deliberately has none. The planes genuinely differ. On the settings plane a key nothing stored and a key stored empty are one answer that `bd config get` prints identically, so a 404 would publish a distinction the server would have to invent. On this plane `bd recall` ALREADY distinguishes a miss, by exit code, and the role answers a miss as a result rather than a value — so a 404 reports a distinction that exists rather than minting one.

A MEMORY STORED AS THE EMPTY STRING IS A 200, WITH AN EMPTY `value`. No front door can create one — storing empty content is refused — but an out-of-band write to the config table can, and presence here is row existence, never whether the value happens to be non-empty. That is the same rule `GET /v0/beads/memories` already followed by enumerating such a row because its key exists; the two surfaces now agree rather than splitting on an asymmetry a client would have had to know about.

MEMORY CONTENT IS SERVED IN FULL, and a configured bearer does not narrow it: `Memory` carries no `redacted` member and withholds nothing from any caller the token admits. See `POST /v0/beads/memories` for why a key-name heuristic would be worse than no promise at all.

KEYS THIS OPERATION CANNOT REACH. `bd remember --key` accepts any string, so a stored key may carry a control character — and `key` is one path segment, percent-decoded once, so such a key would arrive here as a decoded control character in a path. This operation refuses it with a `400` rather than looking it up, exactly as `getSetting` does. The ROLE stays verbatim: breaking `bd recall` of an odd key someone already stored, to tidy a wire rule, would be the tail wagging the dog. Such a memory is reachable from the CLI and from `GET /v0/beads/memories`, and not by path.

**`memoryRecallArguments`** — Arguments of memory/recall.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `key` | text | yes | path | Exact memory key, used verbatim. |

Result: `Memory`

Title: Get one stored memory

Routes to: v0 `getMemory`, `GET /v0/beads/memories/{key}`.

CLI mapping:

```json
{"positionals": [{"position": 0, "parameter": "key"}]}
```

### events/list (CallableQuery)

The workspace's append-only record of every committed issue mutation, paged from a caller-held checkpoint. It is the HTTP form of `bd events tail --since`, and it exists so a hosted consumer can mirror or replay a workspace without shelling out to the CLI.

THE RECORDS ARE THE CLI'S RECORDS, byte for byte. `records[]` elements are the same `EventRecord` objects `bd events tail` and `bd events export` print one per line, produced by the same projection and covered by the same committed golden fixture. A consumer may reconcile an HTTP mirror against a CLI export without a translation layer.

`since` IS THE CURSOR, and it is not one this server minted. It is a sequence number the journal itself assigned, gapless and strictly increasing in commit order, so a consumer's position is durable across restarts on both sides and means the same thing to the CLI. Read with `since` set to the highest `seq` you have DURABLY PROCESSED — not the highest you have received — and advance it only after your own write lands, because this server keeps no per-consumer state and cannot redeliver.

THIS OPERATION POLLS; there is no long poll and no `follow` parameter. `head` is what makes polling cheap to pace: when the last record's `seq` equals `head` you are caught up and can back off until your next interval. A caught-up read is a 200 with an EMPTY `records` array, never a 404 — "nothing new yet" is an ordinary answer about a log.

FOR A PUSH FEED USE `watchEvents`, the sibling operation at `GET /v0/beads/events:watch`, which streams the same records from the same `since` as `text/event-stream`. It is a separate operation rather than a mode of this one because the two differ in media type, lifetime and capacity; a client that streams still needs this operation, because this is the one that is never refused for capacity and the one a stream falls back to.

SCOPE IS PER REPLICA AND PER BRANCH, and this is the part that most often surprises. The journal records what THIS clone mutated on the branch its writer commits to. Rows arrive by direct write, never by merge, so `bd dolt pull` and the changes a merge settles into this workspace are NOT journaled — they arrived as data, and nothing here wrote them through the mutation seam. Each replica also has its OWN seq space, counted from its own first mutation: a checkpoint taken against one server is meaningless against another, where the same number names a different record and a number above that replica's head reads as "caught up" and stalls forever. Track a checkpoint per server URL, and re-baseline (a fresh export or full re-read) after a sync rather than carrying one across.

NOT EVERY MUTATION IS COVERED. Raw DML through `bd sql` bypasses the mutation seam and is not journaled; nor are the schema migrations and version reconciliation that run while a store is being opened, which touch no bead. Dependency records are not symmetric either: `dep_add` is emitted for an idempotent same-type re-add that only refreshes edge metadata, so treat it as an upsert of the edge rather than proof the edge is new, and a `dep_remove` naming an edge that is already gone emits nothing at all.

THIS OPERATION NEVER DELETES. Retention is the workspace's decision, made by `bd events prune` and by the automatic bounding that keeps an enabled journal inside its floors; no prune is reachable over HTTP, and reading a record does not acknowledge or release it.

IT ALSO DEPENDS ON WORKSPACE STATE, alone among the operations here. `events.list` in `ContextResponse.capabilities` says this BUILD serves the operation; it does not say this workspace has a journal, because the journal is a per-workspace setting that is off by default. A server that advertises the capability and answers 409 `events_journal_disabled` to every request is behaving correctly. Handle that 409 as "not on this workspace" rather than as a fault, and do not read the capability as a promise that records will arrive.

A workspace that HAS enabled the journal on a storage backend with no journal seam does not reach this operation at all: `bd serve` refuses to start, matching the refusal that opening such a workspace already produces. Either the server is running and this operation can answer, or the operator saw the failure at startup.

Its `errorSchema` is `eventsListError`.

**`eventsListArguments`** — Arguments of events/list.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `since` | integer | yes | query | Return records with `seq` strictly greater than this value. |
| `limit` | integer | no | query | Maximum number of records to return, from 1 to 10000. |

Result: `EventsPage`

Title: Read the durable events journal

Routes to: v0 `listEvents`, `GET /v0/beads/events`.

Declared reasons: `events_journal_disabled`, `events_journal_truncated`.

## 7. Batches

### issue/create (CallableBatch)

Creates one issue, with its parent, its explicit edges and its waits-for gate, as ONE transaction. A plain collection `POST` rather than a custom method, because creating one member of the collection the path names is what `POST` already means — the same argument `memories.remember` makes on its own collection.

##### It publishes the whole create vocabulary

Every member the role accepts and this surface publishes anywhere is here, and that is deliberate: `POST /v0/beads/issues:batchCreate` spells nine of them, which is what makes it unusable for a caller composing a real row — no `status`, no `sender`, no `metadata`, no `ephemeral`, no `no_history`, no `id`. This operation is the single-issue create with `ApplyCreateItem`'s vocabulary, and the two agree member for member except where a difference is stated below.

THE EDGES ARE HERE, unlike on `issues:batchApply`. That operation splits edges into their own `dep_add` items so a plan's edge order is total; one create has no ordering to express, so `parent_id`, `dependencies` and `waits_for` ride on the request the way `bd create --parent`, `--deps` and `--waits-for` do. Every edge lands in the same transaction as the row: an edge this request could not write is a `400` and the issue is not created either.

##### The explicit id

`id` is CREATE-ONLY. An id that already names a stored row — on either plane — is a `409 already_exists` and nothing is written. It is never an adoption and never an overwrite: `PATCH /v0/beads/issues/{id}` acts on a row that already exists, and `bd import` is the upsert surface, which this API does not publish. Absent is the ordinary case and the server mints one.

An id a retaining sweep RETIRED (`issues:sweep` with `retain_ids`) is a `410 idempotency_expired`: the bead that held it was deleted after the create that used the id had already happened, and a create of that id never runs again. A minted id is never a retired one.

##### What this operation deliberately cannot set

`created_at` and `created_by` — a create whose stored creation time and author come from the caller makes the row's own timestamp disagree with the journal entry that records it, and re-dating history is what an import is for. `issues:batchApply`'s create item publishes neither either.

`spec_id`, `mol_type`, `wisp_type`, `work_type`, `storage_class`, `source_*`, `pinned`, `is_template` and the event quartet (`event_kind`, `actor`, `target`, `payload`) — workflow and classification plumbing this surface accepts on no write. `PATCH /v0/beads/issues/{id}` says the same of `spec_id`. The gate members `await_type`, `await_id`, `timeout` and `waiters` ARE published here, behind `issues.create.gates`, and every read of an `Issue` carries them.

The per-type `storage-class.<type>` keys in `config.yaml` are CLI-door policy that `bd create` resolves before it calls the role, so they do not reach any create on this surface — this operation, `issues:batchCreate` and `issues:batchApply` all mint the unset (versioned) class no matter what those keys say on the server's machine.

`comments` and an inline `dependencies` list on the issue itself — the role refuses both, because edges belong to the request's own `dependencies` member where their direction can be stated.

##### Planes

`ephemeral` and `no_history` create the row on the EPHEMERAL plane rather than the durable one, exactly as they do for `issues:batchApply`. They are mutually exclusive; sending both is a `400`. An edge between rows on opposite planes is refused with everything else the request asked for.

##### Hooks and auto-commit

Hooks do not fire and the per-command auto-commit machinery does not run, exactly as for `POST /v0/beads/issues/{id}:claim`. The only durable effect is the single storage commit the role makes in its own transaction.

Its `errorSchema` is `issueCreateError`.

**`issueCreateArguments`** — Arguments of issue/create.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `id` | text | no | body | An explicit id for the new row, CREATE-ONLY: an id that already names a stored row is a `409` `already_exists` and nothing is written — never an adoption and never an overwrite. |
| `title` | text | yes | body | The issue's title. |
| `description` | text | no | body | — |
| `design` | text | no | body | — |
| `acceptance_criteria` | text | no | body | — |
| `notes` | text | no | body | — |
| `issue_type` | Bead Type reference | no | body | Omitted, this Callable uses `"task"`. |
| `status` | text | no | body | The status the issue is created in, from this workspace's own configured vocabulary. |
| `priority` | integer | no | body | 0 is P0/critical. |
| `assignee` | text | no | body | — |
| `owner` | text | no | body | The human owner, which is a different member from `assignee`: the assignee is who is working it now, the owner is who it is attributed to. |
| `labels` | array of text | no | body | The complete label set the issue is created with. |
| `estimated_minutes` | integer | no | body | An estimate in minutes. |
| `external_ref` | text | no | body | e.g. |
| `due_at` | text | no | body | RFC 3339. |
| `defer_until` | text | no | body | RFC 3339. |
| `sender` | text | no | body | Who sent this, for the message-shaped rows an orchestrator creates. |
| `metadata` | `MetadataValue` | no | body | — |
| `ephemeral` | boolean | no | body | Creates the issue on the EPHEMERAL plane rather than the durable one, exactly as it does for `POST /v0/beads/issues:batchApply`. |
| `no_history` | boolean | no | body | Creates the issue on the ephemeral plane WITHOUT history, and without the garbage collection an ordinary ephemeral row is eligible for. |
| `parent_id` | text | no | body | Creates a typed `parent-child` edge from the new issue to this target. |
| `inherit_labels_from_parent` | boolean | no | body | Copies the parent's labels onto the new issue at creation, on top of `labels`. |
| `dependencies` | array of `CreateIssueDependency` | no | body | The complete set of explicit edges created with the issue. |
| `await_type` | text | no | body | The gate's await condition type (`gh:run`, `gh:pr`, `timer`, `human`, `bead`, or a formula-defined type). |
| `await_id` | text | no | body | The gate's condition identifier (a run id, a PR number, a `bead:<id>`). |
| `timeout` | integer | no | body | The gate's timeout in NANOSECONDS, the encoding `Issue.timeout` reads back. |
| `waiters` | array of text | no | body | The addresses woken when the gate clears, stored as sent: duplicates are kept and nothing is trimmed, as a local create stores them. |
| `waits_for` | `CreateIssueWaitsFor` | no | body | — |
| `force_id_prefix` | boolean | no | body | Permits an explicit `id` outside the workspace's configured issue prefix. |

Result: `Issue`

Title: Create one issue

Routes to: v0 `createIssue`, `POST /v0/beads/issues`.

Declared reasons: `dependency_cycle`.

CLI mapping:

```json
{"flags": [{"names": ["-t", "--type"], "parameter": "issue_type"}, {"names": ["-p"], "parameter": "priority"}, {"names": ["-s"], "parameter": "status"}, {"names": ["-a"], "parameter": "assignee"}, {"names": ["-d"], "parameter": "description"}, {"names": ["-l"], "parameter": "labels"}, {"names": ["--parent"], "parameter": "parent_id"}, {"names": ["--acceptance"], "parameter": "acceptance_criteria"}], "fromFile": [{"names": ["--body-file"], "parameter": "description"}, {"names": ["--design-file"], "parameter": "design"}], "memberFlags": [{"member": "spawner_id", "parameter": "waits_for"}, {"member": "gate", "names": ["--waits-for-gate"], "parameter": "waits_for"}], "positionals": [{"position": 0, "parameter": "title"}]}
```

### issue/update (CallableBatch)

Partial update of one named issue. A plain `PATCH` rather than a custom method, because partial update of one named resource is what `PATCH` already means — exactly as one named resource with no body is what `DELETE` means for `forgetMemory`. The custom-method namespace is left for the operations that are not CRUD.

##### Member presence is the signal

A member PRESENT in `patch` is written; a member ABSENT is left untouched. That is the whole partial-update rule, and it is why an absent member and a member set to its current value are different requests with the same outcome.

Explicit `null` is defined per member. On the four NULLABLE members — `estimated_minutes`, `external_ref`, `due_at`, `defer_until` — it CLEARS the value, because `null` is the only wire spelling a clear has. On every other member it is a `400` naming the member, so a null is never quietly recorded as an empty string.

An EMPTY `patch` object is a `400`: a write that writes nothing is a client bug, the same judgement `issues:batchCreate` makes about an empty `items`. The one exception is an empty `patch` beside `claim: true`, where the claim is the whole write.

##### Claim

`claim: true` claims the issue for `actor` IN THE SAME TRANSACTION as the patch — what `bd update <id> --claim` does on the direct route, through the same role, so eligibility, claim pools and the conflict vocabulary are one definition. The claim sets `assignee` to `actor` and `status` to `in_progress` first and the patch applies after it, so a `patch.assignee` or `patch.status` overrides the claim's own value. An issue already `in_progress` and held by `actor` is an idempotent success (`changed: false` when the patch changes nothing either). A refused claim writes NOTHING, the patch included. It cannot be combined with `expected_assignee`, `expected_status` or `force_assignee_transfer` — the claim is its own compare-and-set — and it may be combined with `expected_version`, which is checked before the claim.

A server that predates this member refuses it as an unknown member (`400`, `reason: "unknown_parameter"`, `param: "claim"`) before any database work, so a client can never mistake an older server for one that dropped the claim.

`labels` is COMPLETE REPLACEMENT. It is the only shape whose result the client already knows without a read-back; an additive `labels_add`/`labels_remove` pair can join the vocabulary later without disturbing it.

`notes` and `append_notes` are mutually exclusive; sending both is a `400`.

##### Guards, forces and the conflicts they answer

`expected_version`, `expected_status` and `expected_assignee` are compare-and-set preconditions, checked before the patch. A miss refuses the WHOLE request with `409 precondition_failed` and writes nothing, so recovery is to re-read and recompose rather than to retry the same body. They are `ApplyUpdateItem`'s three members with `ApplyUpdateItem`'s contract; `expected_version`'s token is the `revision` this operation answers with.

`force_close_policy` and `force_assignee_transfer` bypass exactly one refusal each and nothing else. Neither bypasses validation, the preconditions above, or the other's guard.

Four members carry policy, which is where this operation's `409`s come from. `claim` answers exactly as `{id}:claim` does (`already_claimed`, `not_claimable`). `status` crossing into the workspace's done category answers to close policy (`not_closable`). `assignee` transferring away from a live foreign in-progress owner answers to the assignee fence (`already_claimed`). `parent_id` is a graph edit and answers to the graph (`dependency_cycle`, `dependency_exists`). Each is the SAME refusal `issues:batchApply` and `dependencies:add` already publish, not a second vocabulary.

##### What this operation deliberately cannot edit

`owner` — additive later, and there is no argument against it any more: the one it had was `assignee`'s, which this operation now publishes. Nothing has asked for it.

`closed_by_session` and `close_reason` — written under first-close-wins by `{id}:close`, which a patch write would bypass. A `status` that crosses into the done category still answers to close POLICY here; it does not acquire the close's semantics, and that includes its close guards: a patch is never refused `issue_pinned` or `not_assignee`. That is why `{id}:close` remains the operation to reach for when what you mean is "close this".

`created_at`, `created_by` — `POST /v0/beads/issues` withholds them for the same reason: a caller-chosen creation time makes the row disagree with the journal entry that recorded it, and re-dating history is what an import is for.

`spec_id` — workflow plumbing this surface accepts on no write.

`await_type` and `timeout` — no local update route changes them, so the patch does not either; they are written at create (`issues.create.gates`). `await_id` and `waiters` ARE patch members, behind `issues.update.gates`.

##### Planes

The id resolves across BOTH planes, as the close and reopen do. An update whose target is a wisp lands on the unversioned plane and records no durable history entry.

##### Hooks and auto-commit

Hooks do not fire and the per-command auto-commit machinery does not run, exactly as for `POST /v0/beads/issues/{id}:claim`. The only durable effect is the single storage commit the role makes in its own transaction.

Its `errorSchema` is `issueUpdateError`.

**`issueUpdateArguments`** — Arguments of issue/update.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `id` | text | yes | path | Exact canonical issue id. |
| `patch` | `IssuePatchBody` | yes | body | — |
| `claim` | boolean | no | body | Claims the issue for `actor` in the same transaction as `patch`: `bd update <id> --claim`, served by the same role. |
| `expected_version` | text | no | body | Requires the row's revision to equal this value before the patch. |
| `expected_status` | text | no | body | Requires the issue's status to equal this value before the patch. |
| `expected_assignee` | text | no | body | Requires the issue's assignee to equal this value before the patch. |
| `force_close_policy` | boolean | no | body | Bypasses ONLY close policy — the open-children refusal and the live blocker refusal — for a `patch.status` that crosses into the workspace's done category. |
| `force_assignee_transfer` | boolean | no | body | Bypasses ONLY a genuine transfer away from a live foreign in-progress owner. |
| `force_notes_overwrite` | boolean | no | body | Bypasses ONLY the refusal on a `patch.notes` that would replace existing non-empty notes with different non-empty content (an explicit clear is not fenced). |
| `allow_template` | boolean | no | body | The caller edits a template deliberately, so the template read-only refusal (`409 template_read_only`) stands down for this request. |

Result: `UpdateIssueResponse`

Title: Edit the fields of one issue

Routes to: v0 `updateIssue`, `PATCH /v0/beads/issues/{id}`.

Declared reasons: `already_claimed`, `dependency_cycle`, `dependency_exists`, `not_claimable`, `not_closable`, `notes_overwrite_refused`, `precondition_failed`, `template_read_only`.

CLI mapping:

```json
{"memberFlags": [{"member": "title", "parameter": "patch"}, {"member": "description", "names": ["-d"], "parameter": "patch"}, {"member": "design", "parameter": "patch"}, {"member": "acceptance_criteria", "names": ["--acceptance"], "parameter": "patch"}, {"member": "notes", "parameter": "patch"}, {"member": "append_notes", "parameter": "patch"}, {"member": "priority", "names": ["-p"], "parameter": "patch"}, {"member": "issue_type", "names": ["-t", "--type"], "parameter": "patch"}, {"member": "status", "names": ["-s"], "parameter": "patch"}, {"member": "assignee", "names": ["-a"], "parameter": "patch"}, {"member": "parent_id", "names": ["--parent"], "parameter": "patch"}, {"member": "labels", "names": ["--set-labels"], "parameter": "patch"}, {"member": "add_labels", "names": ["-l", "--add-label"], "parameter": "patch"}, {"member": "remove_labels", "names": ["--remove-label"], "parameter": "patch"}, {"member": "estimated_minutes", "names": ["-e", "--estimate"], "parameter": "patch"}, {"member": "external_ref", "parameter": "patch"}, {"member": "due_at", "names": ["--due"], "parameter": "patch"}, {"member": "defer_until", "names": ["--defer"], "parameter": "patch"}, {"member": "await_id", "parameter": "patch"}], "positionals": [{"position": 0, "parameter": "id"}]}
```

### issue/comment (CallableBatch)

Appends ONE comment to the thread the issue owns, as one atomic mutation — the write behind `bd comment`. It leaves every field of the issue untouched: a comment is not a patch, which is why it is not a member of `PATCH /v0/beads/issues/{id}` and why `issueops.Commenter` is its own role rather than a lifecycle verb.

IT IS A SUB-RESOURCE COLLECTION OF THE ISSUE, and the argument is the one `GET /v0/beads/issues/{id}/related` makes, applied to a write: the row this creates is the SAME pinned `Comment` `GET /v0/beads/issues/{id}?include_comments=true` already carries under `comments`, so the operation that appends one belongs on the resource whose members it publishes. A PLAIN collection `POST` rather than a custom method, for `POST /v0/beads/issues`' reason: creating one member of the collection a path names is what `POST` already means, and a `{id}:addComment` spelling would in addition need the claim route's wildcard contortion for no gain. It collides with nothing — the custom-method dispatcher's pattern is one segment shorter, and this path's literal final segment is what ServeMux matches whole.

THIS COLLECTION PUBLISHES NO `GET`, and the absence is a statement rather than a gap. No role answers a comment PAGE: reading the thread is `GET /v0/beads/issues/{id}?include_comments=true`, which returns the bodies in full, and a paged walk is a second question with a cursor of its own — `issueops.Commenter` says exactly that, and a `GET` here would be this surface inventing the role that does not exist. A `GET` on this path is answered `404`, which is what every method mismatch on this surface gets; `405` is not in the v0 status vocabulary.

##### `author` is caller-asserted, and it is not `actor`

IT IS NOT THE AUTHENTICATED PRINCIPAL even where a bearer is required: the token a deployment configures admits a client to the whole surface and names nobody, so it can neither confirm nor contradict the name in `author`. A reader of the thread is reading a claim the writer made about itself.

It is spelled `author` rather than the `actor` every issue mutation here carries because it is a different thing. An `actor` is the principal a mutation is attributed to and is not part of what the mutation wrote; this value IS part of the row, echoed back by every read of the thread, and it is spelled the way the `Comment` element that carries it back spells it. `issueops.AddCommentRequest.Author` states the distinction; this member is that field.

##### Planes

The id resolves across BOTH planes, as `POST /v0/beads/issues/{id}:close` does and unlike `POST /v0/beads/issues/{id}:claim`: A WISP IS A LEGAL TARGET. The comment lands on the ephemeral thread and reads back from it, and only the DURABLE trace is missing — a comment on an ephemeral row records NO history entry, none rather than one, because the wisp tables are dolt-ignored precisely so ephemeral work never ships. A caller reconstructing threads from durable history alone will not see it. An id that names neither plane is a `404` and nothing is written.

##### What this operation does not have

NO CONFLICT CODE AND NO `expected_version`. A thread is append-only and this write touches no field of the issue, so there is no row state for a guard to be stale about and no concurrent comment for this one to collide with. Two callers commenting at once both succeed, in whatever order the database commits them.

NO IDEMPOTENCY KEY EITHER: a retried request appends a SECOND comment, because two identical comments are a legitimate thread and nothing here can tell that pair from a retry. A client that must not double-post reads the thread.

Hooks do not fire and the per-command auto-commit machinery does not run, as for every write on this surface. The only durable effect is the single storage commit the role makes inside its own transaction.

Declared `atomic`.

**`issueCommentArguments`** — Arguments of issue/comment.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `id` | text | yes | path | Exact canonical issue id. |
| `text` | text | yes | body | The comment body, stored VERBATIM: newlines, surrounding space and unicode all survive, and nothing trims the value that lands in the row. |

Result: `Comment`

Title: Append one comment to an issue's thread

Routes to: v0 `addComment`, `POST /v0/beads/issues/{id}/comments`.

CLI mapping:

```json
{"fromFile": [{"names": ["-f", "--file"], "parameter": "text"}], "positionals": [{"position": 0, "parameter": "id"}, {"position": 1, "parameter": "text"}]}
```

### issue/claim (CallableBatch)

Compare-and-set claim. The caller always names the actor: the server never infers one, because its own identity is meaningless for remote callers.

A re-claim by the CURRENT holder is idempotent — 200 with `already_claimed: true` — matching CLI semantics. A claim held by a different actor is 409 `already_claimed` and carries the holder in the `assignee` extension member, read inside the same transaction; an issue in a non-claimable state is 409 `not_claimable` and carries `issue_status`. Neither needs the client to parse prose.

Declared `idempotent`. Its `errorSchema` is `issueClaimError`.

**`issueClaimArguments`** — Arguments of issue/claim.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `id` | text | yes | path | Exact canonical issue id. |

Result: `ClaimResponse`

Title: Claim an issue for an actor

Routes to: v0 `claimIssue`, `POST /v0/beads/issues/{id}:claim`.

Declared reasons: `already_claimed`, `not_claimable`.

CLI mapping:

```json
{"positionals": [{"position": 0, "parameter": "id"}]}
```

### issue/unclaim (CallableBatch)

The claim's inverse, and what `bd unclaim` spells. It ends the OWNERSHIP and leaves the work open for the next taker: assignee cleared, status the literal `open`, `started_at` cleared, the lease dropped, and `revision` reminted so a concurrent reclaim or close conflicts rather than silently merging.

It is a named lifecycle action rather than a `patch`, for `POST /v0/beads/issues/{id}:close`'s reason: an update spells a release as three fields at a time, which puts the transition's definition in the CALLER, and the lease it drops is the part a patch cannot express at all.

The caller always names the actor, for `POST /v0/beads/issues/{id}:claim`'s reason. HERE IT IS ALSO THE OWNERSHIP FENCE'S SUBJECT: a release carrying neither `expected_assignee` nor `force` succeeds only while `actor` is the current holder. That is not authentication — `actor` is caller-asserted provenance exactly as it is on the claim, and it is NOT the authenticated principal even where a bearer is required: the token a deployment configures admits a client to the whole surface and names nobody, so it can neither confirm nor contradict the name in `actor`. The fence is the same anti-yank guard the claim gets from refusing a foreign holder, pointed the other way.

##### NOT IDEMPOTENT, which is the one thing to read before adopting it

A release over a row that holds NO claim is `409` / `not_releasable`, never a 200. There is no `already_released` member here and there must not be one, because the post-state is ANONYMOUS: "I released this twice", "a reaper beat me to it" and "nothing ever claimed it" leave the identical row — assignee cleared, status open, `started_at` gone — so one 200 would report one answer for three situations that want different things from a caller. `claimIssue` can afford `already_claimed: true` because a claim's post-state NAMES the claimant, and this operation has nothing left on the row to name.

ON `not_releasable`, READ THE ROW. Do NOT treat the code as "already released", however ordinary that case is for you — it is the one shortcut this operation's taxonomy makes unsafe, and it is unsafe in the direction that strands work.

The code covers TWO conditions and publishes no member telling them apart (see the `409` below). One of them is "nothing holds this". The other is "the status will not accept a release", which is true of a row that is CLOSED and equally true of a row parked in a status this workspace configured — and such a row can still be ASSIGNED. A reaper that read this code as success would book a claim as dropped while it is still held, by an agent that is already gone, with nothing left to free it. That is exactly the stranding this operation resolves ids across both planes to prevent, reintroduced through the refusal vocabulary instead of through the id.

So the recovery is a read: the row tells you which of the two you got — an assignee, or none. That is one extra request on an uncommon path, and it is the honest price of one code rather than two. A caller that wants the distinction without the read should say so, and it arrives as an ADDITION, which the `Problem.code` rules already tell clients to tolerate.

##### The two ways to release a claim you do not hold

`expected_assignee` is a compare-and-set on the holder and REPLACES the ownership fence: a caller that can name the current holder has demonstrated the view the fence exists to protect, so `actor` need not be that holder. It cannot release a claim that has since moved, which is what makes it the safer of the two for a supervisor reaping one named agent's abandoned work.

`force` ignores the holder entirely, and ignores NOTHING ELSE. It does not make an unheld row releasable, it does not make a closed one releasable, and it may not accompany `expected_assignee` — the two are answers to the same question and they disagree, so sending both is a 400.

##### Planes

The id resolves across BOTH planes, unlike `POST /v0/beads/issues/{id}:claim` and like `POST /v0/beads/issues/{id}:close`. The asymmetry is about which direction strands work: a wisp can hold a claim, so an operation that refused to release one would leave an ephemeral row owned by an agent that is gone with no verb able to free it. A release whose target is a wisp records no durable history entry.

##### Hooks and auto-commit

Hooks do not fire and the per-command auto-commit machinery does not run, exactly as for `POST /v0/beads/issues/{id}:claim`. The only durable effect is the single storage commit the role makes inside its own transaction, which is what a proxied CLI write does today.

Its `errorSchema` is `issueUnclaimError`.

**`issueUnclaimArguments`** — Arguments of issue/unclaim.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `id` | text | yes | path | Exact canonical issue id. |
| `expected_assignee` | text | no | body | Compare-and-set on the holder: the release proceeds only while the issue is still assigned to this actor, and otherwise refuses with `409` / `precondition_failed` naming this value, having written nothing. |
| `force` | boolean | no | body | Bypass the ownership fence, so an actor that is not the holder may release the claim. |

Result: `ReleaseIssueResponse`

Title: Give back the claim on an issue

Routes to: v0 `releaseIssue`, `POST /v0/beads/issues/{id}:release`.

Declared reasons: `already_claimed`, `not_releasable`, `precondition_failed`.

CLI mapping:

```json
{"flags": [{"names": ["--if-assignee"], "parameter": "expected_assignee"}], "positionals": [{"position": 0, "parameter": "id"}]}
```

### issue/heartbeat (CallableBatch)

What `bd heartbeat` spells. It pushes the lease forward by the server's lease TTL and stamps `heartbeat_at`, and a refresh writes ONLY the lease. The issue row is untouched: `revision` is NOT reminted (a following `expected_version` guard written against the pre-heartbeat revision still wins), the versioned-history revision does not advance, `updated_at` does not move, and no event or events-journal entry is written (`events.list` / `events.watch` see nothing).

FENCED ON THE HOLDER AND THE LIVE CLAIM: `actor` must hold the claim, and the issue must be `in_progress` under it when the lease is refreshed. A holder that is `in_progress` with no lease row (a claim hand-doled through `updateIssue`) is re-armed and reported `rearmed: true`; a refresh of an existing lease row never is. A re-arm is recorded as a mutation, a refresh is not: the re-arm remints `revision`, moves `updated_at` and records an event (once, so that it collides with a release or close racing it rather than leaving a lease on an issue that is no longer claimed); re-read the issue before a guarded write after `rearmed: true`. `heartbeat_at` and `lease_expires_at` are whole seconds, the values stored. Wisps hold no lease and are refused. Safe to repeat: a repeat only moves the expiry forward. The request carries no TTL, as the claim carries none: lease policy is the server's, and `lease_expires_at` reports the result so a worker can see its margin.

There is no `expected_version` member, deliberately: the fence is the holder, and the revision changes on unrelated edits by the holder itself, so a revision-fenced heartbeat would fail spuriously.

Available when the server advertises the `issues.heartbeat` capability.

Its `errorSchema` is `issueHeartbeatError`.

**`issueHeartbeatArguments`** — Arguments of issue/heartbeat.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `id` | text | yes | path | Exact canonical issue id. |

Result: `HeartbeatIssueResponse`

Title: Refresh the claim lease on an issue the actor holds

Routes to: v0 `heartbeatIssue`, `POST /v0/beads/issues/{id}:heartbeat`.

Declared reasons: `already_claimed`, `lease_not_held`.

CLI mapping:

```json
{"positionals": [{"position": 0, "parameter": "id"}]}
```

### issue/close (CallableBatch)

Closes the issue this path names, moving it to the literal `closed` status including from a configured done status. It is the half of the agent loop — claim, work, close — that this surface did not serve before.

A named lifecycle action rather than a status patch, because the close carries semantics a patch has nowhere to put: the reason and session under first-close-wins, the done-status normalization, and the close POLICY vocabulary below.

THE FIRST CLOSE WINS. A re-close of an already-closed issue is idempotent — 200 with `already_closed: true` — and writes neither `reason` nor `session`, so a replayed close cannot rewrite the record of why the work ended. The stored pair keeps what the first close gave it until a reopen clears both.

##### Close policy

An unforced close is refused with `409` / `not_closable` when the issue has open children (the refusal carries `open_children`, the count the refusing transaction observed) or a live blocker (no `open_children`; the blockers themselves travel in `blockers`). The MEMBER'S PRESENCE is the discriminator, so telling the two apart never requires reading `detail`. Both refusals are the ROLE's, so `force` bypasses those two — this endpoint cannot skip a guard by forgetting one exists.

##### Close guards

Before close policy, a close of an issue that is not already closed answers to three guards, in this order. A template refuses with `409` / `template_read_only` and has no bypass. A pinned issue (the `pinned` flag or the `pinned` status) refuses with `409` / `issue_pinned`. An issue assigned to someone other than `actor` (compared separator-insensitively; an unassigned issue is closable by anyone) refuses with `409` / `not_assignee`, carrying the holder in `assignee`. `force` bypasses the pin and the assignee guard. They are the guards `bd close` applies, and they are the ROLE's, so every close operation — this one, `POST /v0/beads/issues:batchClose` and a `close` item of `POST /v0/beads/issues:batchApply` — applies them alike. An idempotent re-close is not guarded: it changes nothing.

The guards gate the close operations, not the closed state. A status update that crosses into the done category — a `PATCH` of `/v0/beads/issues/{id}` or an `update` item of `POST /v0/beads/issues:batchApply` — is not a close operation and answers to close policy only, so it still closes a pinned issue or one another actor holds.

##### The guard

`expected_version` is a compare-and-set precondition on the row's revision, checked FIRST — before close policy and before the idempotent re-close. A miss refuses the whole request with `409 precondition_failed` and writes nothing.

POLICY AND PRECONDITION ARE DIFFERENT THINGS, and `force` is the bypass for exactly one of them. A forced close still answers to the guard: the two members say "close it even though the graph objects" and "only if this is still the row I read", which are unrelated claims.

The token travels back on `revision`, so a read-modify-write chain that ends in a close composes its expectation from the value the previous write answered with — or, where the chain STARTS with a read, from `GET /v0/beads/issues/{id}`'s `revision`, which is the same token and agrees with this one.

##### Planes

The id resolves across BOTH planes, unlike `POST /v0/beads/issues/{id}:claim`. A close whose target is a wisp lands on the unversioned plane and records no durable history entry.

##### Hooks and auto-commit

Hooks do not fire and the per-command auto-commit machinery does not run, exactly as for `POST /v0/beads/issues/{id}:claim`. The only durable effect is the single storage commit the role makes in its own transaction.

Declared `idempotent`. Its `errorSchema` is `issueCloseError`.

**`issueCloseArguments`** — Arguments of issue/close.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `id` | text | yes | path | Exact canonical issue id. |
| `reason` | text | no | body | Omitted, this Callable uses `"Closed"`. |
| `session` | text | no | body | The working session that closed the issue, stored and read back as `closed_by_session`, under the same first-close-wins rule and the same bounds as `reason`. |
| `force` | boolean | no | body | Bypass close policy — the open-children refusal and the live-blocker refusal — and the pin and the assignee guard, and nothing else: never the template guard (see "Close guards" on `POST /v0/beads/issues/{id}:close`). |
| `expected_version` | text | no | body | Requires the row's revision to equal this value BEFORE the close. |
| `auto_close_molecule` | boolean | no | body | Behind the `issues.close.autoCloseMolecule` behavior token: an older server answers `unknown_parameter` for this name, and a client checks the token before sending it. |

Result: `CloseIssueResponse`

Title: Close one issue

Routes to: v0 `closeIssue`, `POST /v0/beads/issues/{id}:close`.

Declared reasons: `issue_pinned`, `not_assignee`, `not_closable`, `template_read_only`.

CLI mapping:

```json
{"flags": [{"names": ["-r"], "parameter": "reason"}, {"names": ["-f"], "parameter": "force"}, {"names": ["--if-revision"], "parameter": "expected_version"}], "fromFile": [{"names": ["--reason-file"], "parameter": "reason"}], "positionals": [{"position": 0, "parameter": "id"}]}
```

### issue/advance (CallableBatch)

The operation behind `bd close --continue`: after the step this path names closed, find where its molecule stands and, with `auto_claim`, claim the next ready step for `actor`.

A step is READY when it is open and no open step of the same molecule blocks it (blocks, conditional-blocks or waits-for). The claim is a real claim — the step's assignee becomes `actor` — and a step another actor holds is skipped, never taken: a ready step lost that way, or one moved out of a claimable status since it was read, falls through to the next ready step. When every ready step is lost nothing is claimed and `next_step` names the first.

A step in no molecule answers 200 with no `molecule_id`. A step id that names nothing is `404`.

**`issueAdvanceArguments`** — Arguments of issue/advance.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `id` | text | yes | path | Exact canonical issue id. |
| `auto_claim` | boolean | no | body | Claim the next ready step for `actor`. |

Result: `AdvanceMoleculeResponse`

Title: Advance a molecule to its next ready step

Routes to: v0 `advanceMolecule`, `POST /v0/beads/issues/{id}:advanceMolecule`.

CLI mapping:

```json
{"positionals": [{"position": 0, "parameter": "id"}]}
```

### issue/reopen (CallableBatch)

Moves the literal `closed` status and every configured done status back to `open`. It is `POST /v0/beads/issues/{id}:close`'s mirror, and it completes the lifecycle pair so a recovery flow works end to end over this surface.

A reopen of an issue that is NOT done changes nothing and succeeds — 200 with `already_open: true`, the re-claim's and the re-close's answer to the same question. An agent replaying its own recovery should not have to classify an error to learn it already ran.

Reopening CLEARS `close_reason` and `closed_by_session`, because they describe a closure that no longer holds. That is what makes the close's first-close-wins rule survivable: the way to write a new reason is to reopen and close again, not to re-close.

##### Where the reason is recorded

On the `reopened` EVENT this move records, not on a field of the issue, and the response does not carry it. A caller that wants it back reads the issue's events — the same place the actor attribution for the reopen lives. A reopen with no reason still records that entry; it simply carries none.

##### No POLICY conflict to name

There is still no policy refusal here, and the absence is deliberate: close has one — open children, a live blocker — and reopen is the direction that removes an issue from the done category rather than adding it, so there is nothing for a policy to refuse. `not_closable` is not in this operation's vocabulary and never will be.

The one `409` it does document is a PRECONDITION rather than a policy. `expected_version` is a compare-and-set on the row's revision, checked FIRST — before the non-done no-op — and a miss refuses the whole request with `precondition_failed` and writes nothing. It is the caller's own guard rather than a rule of the graph, which is why the operation can carry it while carrying no policy conflict at all.

The token travels back on `revision`, so a reopen-then-re-close recovery composes its next expectation from the value this operation answered with, and a recovery that starts by reading composes its first from `GET /v0/beads/issues/{id}`'s `revision`.

##### Planes

The id resolves across BOTH planes, as the close does. A reopen whose target is a wisp lands on the unversioned plane and records no durable history entry.

##### Hooks and auto-commit

Hooks do not fire and the per-command auto-commit machinery does not run, exactly as for `POST /v0/beads/issues/{id}:claim`. The only durable effect is the single storage commit the role makes in its own transaction.

Declared `idempotent`.

**`issueReopenArguments`** — Arguments of issue/reopen.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `id` | text | yes | path | Exact canonical issue id. |
| `reason` | text | no | body | Why the issue is being reopened. |
| `expected_version` | text | no | body | Requires the row's revision to equal this value BEFORE the reopen. |

Result: `ReopenIssueResponse`

Title: Reopen one issue

Routes to: v0 `reopenIssue`, `POST /v0/beads/issues/{id}:reopen`.

CLI mapping:

```json
{"flags": [{"names": ["-r"], "parameter": "reason"}, {"names": ["--if-revision"], "parameter": "expected_version"}], "positionals": [{"position": 0, "parameter": "id"}]}
```

### issue/metadata/compare-and-set (CallableBatch)

Sets `metadata[key]` if and only if it currently holds `expected`, and reports what it found either way. It is the conditional write every coordination protocol over the metadata plane is built from, and the one operation on this surface a client is expected to call in a LOOP.

THE TRANSITION IS A PAIR. `expected` is the key's value before, `value` is its value after, and OMITTING either member means the key is ABSENT there. So a first-writer-wins acquire omits `expected`, a release omits `value`, and an ordinary hand-off carries both. A member present with the JSON value `null` is a real value and does NOT mean absent: a key stored holding null exists, and the server can tell the two apart.

EQUALITY IS CANONICAL. Two JSON values match when their canonical encodings match, so insignificant whitespace is ignored and object keys compare as a set rather than in the order they were written — a client cannot lose a swap to its own serializer.

NUMBERS COMPARE AS THEIR SOURCE LITERAL, so `1` and `1.0` do not match, and that is a CONSTRAINT ON CLIENTS rather than a precision guarantee. The metadata store decodes JSON numbers through a float and re-emits them, so a number is not always stored as it was sent: `1.0` is stored as `1`, an integer past 2^53 is rounded, and `1e300` is stored as three hundred and one digits. COMPOSE `expected` FROM A PREVIOUS `current`, never from your own spelling of a number — `current` is the value the row HOLDS, so a loop that feeds it back converges while a loop that re-sends a renormalized literal is refused forever. For a coordination token, prefer a STRING: it round-trips byte for byte.

SERIALIZERS OMIT NULLS BY DEFAULT, AND HERE THAT CHANGES THE REQUEST. Omitting `value` is a DELETE, not "leave the value alone" — so a client that builds this body from a struct under Jackson's NON_NULL, Pydantic's `exclude_none`, or Go's `omitempty` will send a delete when it meant to write null. Send the members explicitly, and check what your serializer does with a null before you rely on either meaning.

A REFUSED SWAP IS A 200, not a 409. `swapped` is false and `current` carries the value that refused it, which is what lets a client recompute and retry without a second read that could itself go stale. A lost race is the ordinary path here rather than an exceptional one, and a client that treats this operation's non-2xx codes as "the swap did not happen" would be wrong in both directions. DISPATCH ON `swapped`.

A SUCCESSFUL SWAP THAT CHANGES NOTHING WRITES NOTHING: when the precondition holds over a value already equal to `value`, `swapped` is true, `current` is that value, and no row and no history entry is touched. `swapped` answers the PRECONDITION; it does not claim a write happened.

`current` IS ALWAYS THE VALUE THE ROW HOLDS, read inside the transaction that decided — on a refusal, on a swap that landed, and on a swap that changed nothing. It is not an echo of what was sent, so where the store renormalized a value on the way in, `current` reports the store's form. A member present holding `null` is a value; an ABSENT `current` member means the key is absent.

Sibling keys survive. The read, the comparison and the write share one transaction, so a concurrent write to a DIFFERENT key of the same issue is preserved rather than clobbered.

The id resolves across both planes, so a swap whose target is a wisp lands on the unversioned plane and records no durable history entry.

An issue whose stored metadata is not a JSON object answers 500 rather than 400 or 404, and that is deliberate: the request was well-formed and the issue exists, so both client-error codes would be something a caller could act on. The row is corrupt and no retry converges.

**`issueMetadataCompareAndSetArguments`** — Arguments of issue/metadata/compare-and-set.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `id` | text | yes | path | Exact canonical issue id. |
| `key` | text | yes | body | The single metadata key to read and write. |
| `expected` | `MetadataValue` | no | body | — |
| `value` | `MetadataValue` | no | body | — |

Result: `CompareAndSetMetadataResponse`

Title: Conditionally set one metadata key on an issue

Routes to: v0 `compareAndSetMetadata`, `POST /v0/beads/issues/{id}:casMetadata`.

CLI mapping:

```json
{"positionals": [{"position": 0, "parameter": "id"}]}
```

### issue/purge (CallableBatch)

Bulk clearance of CLOSED beads from ONE tier: the operation behind `bd purge` (`tier: ephemeral`) and `bd prune` (`tier: durable`). It is one of the two DESTRUCTIVE operations on this surface — the other is `issues:delete` — and nothing it deletes comes back.

A collection-level custom method rather than `DELETE /v0/beads/issues?...`: this describes a SET and acts on it, and a `DELETE` with a filtering query string is the shape where a dropped parameter widens what is erased. Sending a body makes every narrowing term a member the server refuses by name if it does not know it.

##### What it selects, in order

The closed rows of `tier`, then `pattern`, then the two protections — pinned beads are never swept and `protect_referenced` holds back beads another live bead cites. The ORDER is part of the answer: `skipped` counts what the request actually reached, so a pinned bead the pattern excluded is not counted as protected.

##### The safety gate is the ROLE'S, not this handler's

A `durable` sweep with neither `closed_before` nor `pattern` is refused with `400` / `invalid_argument`. That refusal comes from the same library surface `bd prune` calls, not from a check written here, which is what makes this endpoint incapable of erasing every closed bead in a workspace by omission. A caller that really means everything closed sends `pattern: "*"`.

##### One transaction

The selection and the deletion share one transaction, so the set the response describes IS the set that was deleted. The cost is that a sweep is all-or-nothing: one large enough to exceed the backend's write timeout fails whole and deletes nothing. Narrow the request rather than expecting progress.

`dry_run: true` answers the same question and changes nothing — including history. Ask it first.

**`issuePurgeArguments`** — Arguments of issue/purge.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `tier` | text | no | body | Omitted, this Callable uses `"ephemeral"`. |
| `closed_before` | text | no | body | Keep only beads closed STRICTLY BEFORE this instant (RFC 3339). |
| `pattern` | text | no | body | Keep only beads whose id matches this shell glob (`*`, `?`, `[...]`, `\` escapes; `*` also crosses `-` and `.`, since an id is not a path). |
| `protect_referenced` | boolean | no | body | Omitted, this Callable uses `false`. |
| `dry_run` | boolean | no | body | Omitted, this Callable uses `true`. |
| `protect_live_dependents` | boolean | no | body | Omitted, this Callable uses `true`. |
| `limit` | integer | no | body | Cap how many beads this sweep deletes, OLDEST-CLOSED-FIRST. |
| `retain_ids` | boolean | no | body | RETIRE every id this sweep deletes. |

Result: `SweepResult`

Title: Delete closed beads in bulk

Routes to: v0 `sweepIssues`, `POST /v0/beads/issues:sweep`.

### issue/prune (CallableBatch)

Bulk clearance of CLOSED beads from ONE tier: the operation behind `bd purge` (`tier: ephemeral`) and `bd prune` (`tier: durable`). It is one of the two DESTRUCTIVE operations on this surface — the other is `issues:delete` — and nothing it deletes comes back.

A collection-level custom method rather than `DELETE /v0/beads/issues?...`: this describes a SET and acts on it, and a `DELETE` with a filtering query string is the shape where a dropped parameter widens what is erased. Sending a body makes every narrowing term a member the server refuses by name if it does not know it.

##### What it selects, in order

The closed rows of `tier`, then `pattern`, then the two protections — pinned beads are never swept and `protect_referenced` holds back beads another live bead cites. The ORDER is part of the answer: `skipped` counts what the request actually reached, so a pinned bead the pattern excluded is not counted as protected.

##### The safety gate is the ROLE'S, not this handler's

A `durable` sweep with neither `closed_before` nor `pattern` is refused with `400` / `invalid_argument`. That refusal comes from the same library surface `bd prune` calls, not from a check written here, which is what makes this endpoint incapable of erasing every closed bead in a workspace by omission. A caller that really means everything closed sends `pattern: "*"`.

##### One transaction

The selection and the deletion share one transaction, so the set the response describes IS the set that was deleted. The cost is that a sweep is all-or-nothing: one large enough to exceed the backend's write timeout fails whole and deletes nothing. Narrow the request rather than expecting progress.

`dry_run: true` answers the same question and changes nothing — including history. Ask it first.

**`issuePruneArguments`** — Arguments of issue/prune.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `tier` | text | no | body | Omitted, this Callable uses `"durable"`. |
| `closed_before` | text | no | body | Keep only beads closed STRICTLY BEFORE this instant (RFC 3339). |
| `pattern` | text | no | body | Keep only beads whose id matches this shell glob (`*`, `?`, `[...]`, `\` escapes; `*` also crosses `-` and `.`, since an id is not a path). |
| `protect_referenced` | boolean | no | body | Omitted, this Callable uses `true`. |
| `dry_run` | boolean | no | body | Omitted, this Callable uses `true`. |
| `protect_live_dependents` | boolean | no | body | Omitted, this Callable uses `false`. |
| `limit` | integer | no | body | Cap how many beads this sweep deletes, OLDEST-CLOSED-FIRST. |
| `retain_ids` | boolean | no | body | RETIRE every id this sweep deletes. |

Result: `SweepResult`

Title: Delete closed beads in bulk

Routes to: v0 `sweepIssues`, `POST /v0/beads/issues:sweep`.

### issue/delete (CallableBatch)

Erases the beads this request NAMES, and — under `cascade` — their parent-child descendants. It is the operation behind `bd delete`, the other DESTRUCTIVE operation on this surface alongside `issues:sweep`, and nothing it deletes comes back.

It is a different operation from `POST /v0/beads/issues:sweep`, not a narrower spelling of it. A sweep DESCRIBES a set and lets the server resolve it; this one is handed ids. That difference is what decides where each one's safety lives: a description can be accidentally too wide, so the sweep carries a require-a-filter refusal, while a list of ids cannot be, so this one's guard is about the GRAPH instead.

A collection-level custom method rather than `DELETE /v0/beads/issues/{id}`: this acts on a SET, its behavior turns on three flags, and a `DELETE` carrying those in a query string is the shape where a dropped parameter changes what is erased. Sending a body makes every one of them a member the server refuses by name if it does not know it.

##### The three modes

With neither `cascade` nor `force`, a named bead that some bead OUTSIDE the request depends on is REFUSED with `400` / `invalid_argument`, and nothing is deleted. `force` deletes the named beads and leaves those dependents ORPHANED — they keep their rows, lose their edges, and come back in `orphaned`. `cascade` deletes the named beads' parent-child descendants as well, and every other dependent of that set survives ORPHANED and comes back in `orphaned`, as under `force`; a request carrying both behaves as `cascade`. A server announces this containment-only cascade with the `issues.delete.containmentCascade` behavior token: an older server's `cascade` deleted every transitive dependent, so a client must not send `cascade` to a server that does not advertise it.

The refusal is the LIBRARY's, not this handler's — the same surface `bd delete` calls — which is what makes this endpoint incapable of orphaning a workspace's graph by omission.

##### Every id must resolve

An id naming no stored bead is a `404` and NOTHING is deleted, not even the ids beside it that did resolve. There is no prefix matching here: ids are exact, because resolving an ambiguous prefix to a bead and then deleting it is the one place that convenience is not one.

##### The guard, and why it takes one id

`expected_version` is a compare-and-set precondition on the row this request NAMES: the deletion proceeds only if that bead's revision still equals it, and otherwise the request is `409 precondition_failed` and nothing is deleted. It is the guard that matters most on this operation, because being wrong about which bead you are looking at is the one mistake here that cannot be undone.

IT REQUIRES A SINGLE-ID REQUEST, and that is a `400` naming `expected_version` rather than a fudge: one token cannot describe two rows. Duplicates collapse first, so repeating one id is still one bead.

THE ORDER THE REFUSALS HAPPEN IN IS PART OF THE ANSWER. Request shape first, then the existence probe (`404`), then this guard (`409`), then the dependents refusal (`400`). A request that is both a typo and a graph problem reports the typo, which is the one a caller can fix without deciding anything; and a stale guard outranks the dependents refusal because a caller whose view has moved should not be asked to choose `cascade` or `force` over information that has already changed.

NEITHER `cascade` NOR `force` BYPASSES IT. They bypass POLICY. Under `cascade` the guard covers the named bead alone — the closure is resolved inside the deleting transaction, so it may have grown since the caller's read.

##### One transaction

The guard, the deletion and the rewrite of surviving beads' text references all share one transaction, so the set the response describes IS the set that was deleted and no bead is left citing an id that no longer exists. The cost is that a delete is all-or-nothing: one whose neighbourhood is large enough to exceed the backend's write timeout fails whole. Split the request rather than expecting progress.

`dry_run: true` answers the same question and changes nothing — including history, and including the two refusals, which a preview reports exactly where the real request would. Ask it first.

Declared `atomic`.

**`issueDeleteArguments`** — Arguments of issue/delete.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `ids` | array of text | yes | body | The beads to delete, exact ids, in either plane. |
| `cascade` | boolean | no | body | Also delete the named beads' parent-child descendants, at every depth. |
| `force` | boolean | no | body | Delete the named beads and leave their dependents ORPHANED, reported in `orphaned`. |
| `dry_run` | boolean | no | body | Omitted, this Callable uses `true`. |
| `expected_version` | text | no | body | Requires the named bead's revision to equal this value before anything is erased. |

Result: `DeleteIssuesResult`

Title: Delete named beads

Routes to: v0 `deleteIssues`, `POST /v0/beads/issues:delete`.

CLI mapping:

```json
{"flags": [{"names": ["--if-revision"], "parameter": "expected_version"}]}
```

### issue/reclaim (CallableBatch)

Reverts every in-progress issue whose LEASE has gone stale back to ready: the lease row is deleted, `status` becomes `open`, the assignee and `started_at` are cleared, and a recovery event naming the former holder is recorded. It is the operation behind `issueops.LeaseReclaimer` and `bd reclaim`, and the caller it is for is a CLOCK — a supervisor reaping the work of workers that died without releasing it — rather than the worker that held the claim, which releases its own with `POST /v0/beads/issues/{id}:release`.

A lease is stale when its expiry is more than `older_than_seconds` in the past. A lease a worker is still heartbeating is never eligible, whatever the request names.

##### Scope narrows, never widens

Every scope member narrows the sweep and they AND-combine: `ids`, `assignees`, `labels` (all of them), `labels_any` (at least one) and `exclude_labels` (none of them). A request with no scope member sweeps every stale lease this server granted. `any_replica` is the one member that WIDENS: it disarms the granting-replica guard, so a lease another replica granted is reverted too. It is an operator escape hatch for a replica that is gone for good, never a normal setting.

AN ID THAT IS NOT A STALE LEASE IS NOT AN ERROR. An id naming no row, or a row whose lease is live, or a row nobody holds, is simply absent from `reclaimed`; scoping by id narrows a sweep, it does not assert that every named id was reclaimable. There is no `404` on this operation.

##### A new revision per reverted row

Every reverted row's `revision` is minted fresh by the revert, and each entry of `reclaimed` carries it. A holder that wakes up after its lease was reclaimed and writes with the revision its claim handed it gets `412 precondition_failed`, so it cannot land over work another worker may already have taken.

The whole sweep is ONE transaction. A lease a heartbeat rescues between the snapshot that found it and its row's revert is skipped, not reported.

Available when the server advertises the `issues.reclaim` capability.

**`issueReclaimArguments`** — Arguments of issue/reclaim.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `older_than_seconds` | number | no | body | Omitted, this Callable uses `600`. |
| `ids` | array of text | no | body | Only these issues are eligible. |
| `assignees` | array of text | no | body | Only leases held by one of these owners are eligible. |
| `labels` | array of text | no | body | Only issues carrying ALL of these labels are eligible. |
| `labels_any` | array of text | no | body | Only issues carrying AT LEAST ONE of these labels are eligible. |
| `exclude_labels` | array of text | no | body | An issue carrying ANY of these labels is never eligible. |
| `any_replica` | boolean | no | body | Also revert leases another replica granted. |

Result: `ReclaimIssuesResult`

Title: Revert stale leases back to ready

Routes to: v0 `reclaimIssues`, `POST /v0/beads/issues:reclaim`.

### issue/create-many (CallableBatch)

Creates every item in the request, or none of them. There is no partial outcome and no per-item status: the whole request is one transaction, so a client that gets a 4xx knows nothing was written and can fix its payload and resend it unchanged.

That is the OPPOSITE of what a batch close would do, and it is the right default here for one reason: half a created plan cannot be re-sent without duplicating the half that landed, and nothing in the response would say which half that was.

THE SERVER ASSIGNS EVERY ID. There is no `id` member on an item, so this operation can never adopt or overwrite a stored row — `bd import` is the upsert surface and it is not published here. The generated ids come back in `items`, in request order, which is the only place a client can learn them.

A dependency target may name an issue this workspace holds, an `external:` reference, or an id belonging to another repository. A target that is none of those is a `400` and nothing is created — an edge silently dropped from a created issue is a relationship the client has no way to discover is missing.

AN ITEM OF THIS REQUEST CANNOT BE A DEPENDENCY TARGET, and this operation is the narrow fast path rather than the one to reach for when it needs to be. The server assigns every id, an item has no name a later item could spell, and only an id a caller already held could ever have addressed a row — so a plan whose edges point at its own new issues is `POST /v0/beads/issues:batchApply`, where a create item may NAME itself and later items address it by that name.

Hooks do not fire and the per-command auto-commit machinery does not run, exactly as for `POST /v0/beads/issues/{id}:claim`. The only durable effect is the single storage commit the role makes in its own transaction.

Declared `atomic`.

**`issueCreateManyArguments`** — Arguments of issue/create-many.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `items` | array of `BatchCreateItem` | yes | body | The issues to create, in order. |

Result: `BatchCreateResponse`

Title: Create many issues as one act

Routes to: v0 `batchCreateIssues`, `POST /v0/beads/issues:batchCreate`.

### issue/batch (CallableBatch)

Applies an ORDERED list of creates, updates, closes and dependency edges as ONE transaction, or applies none of them. It is the operation for a PLAN — create these three issues, wire them to each other, close the step that spawned them — which every other write here can only approximate as a sequence of calls with a window between each pair.

A collection-level custom method, spelled the way `issues:sweep` and `issues:delete` are: it acts on a set the request DESCRIBES rather than on one addressable resource, and every one of its narrowing terms is a body member the server refuses by name if it does not know it.

##### Order is the contract

Items apply in declaration order and are NEVER reordered. That is the difference from `POST /v0/beads/dependencies:add`, which applies parent-child edges first so the planned hierarchy is visible before any blocking edge is validated against it. Reordering is not available here because the items are not all edges: "clear the old blockers, then set the new ones" is a sequence, and a server that reordered it would apply the clear after the set. What that pass buys there, this operation buys with an END GATE instead — after every item has landed, every scheduling edge the request added is re-validated against the parent-child closure the WHOLE request produced. `skip_per_edge_cycle_check` never drops it.

##### Names, and which way they reach

A `create` item may give itself a `key`. Later items address the row it minted with a `Ref` carrying that key, and the response's `keys` member maps each key to the id it was bound to — the one fact the request cannot carry and every caller needs.

A KEY REACHES BACKWARD ONLY. A ref used to ADDRESS a row — an update's or a close's `target`, either endpoint of an edge — may name a key only if the create item declaring it appears EARLIER in `items`. That is forced by what the items do rather than chosen: an update has to see the row it patches. A key declared LATER is a `400` carrying `declared_later: true`, which is a different diagnosis from a key nothing in the request declares at all — one is an ordering mistake and the other is a typo, and a client fixes them differently.

`create.metadata_refs` IS THE ONE EXCEPTION and may reach forward, or name its own item's key. Every id is minted before any splice is applied, so direction cannot matter there; the backward-only rule exists to make a TARGET ROW exist before an item touches it, which a metadata VALUE does not need. The splice is a SECOND WRITE and says so: the row is created with the metadata the item spelled, and the resolved ids are written after every id exists, so a consumer of the event stream sees a create and then an update rather than one create carrying values nothing could have known yet.

##### All or nothing, and what that does to a precondition

A non-2xx means NOTHING WAS WRITTEN — no id was minted, no edge landed, no row was closed — so a client fixes its payload and resends it unchanged. There is no per-item status because there is no outcome but the request's: an item whose target is a key an earlier item failed to create has no outcome that could be reported.

THAT IS WHY A PRECONDITION MISS IS A `409` HERE and not an answer. `POST /v0/beads/issues/{id}:casMetadata` reports a lost compare-and-set as a 200, because a retry loop is its designed caller and a miss is the ordinary path. Here the guarded item is one step of a graph the caller meant to land as a unit, so committing the rest would leave a shape nobody asked for. `update.expected_version`, `update.expected_status`, `update.expected_assignee` and `close.expected_version` therefore refuse the WHOLE request with `precondition_failed`, and the problem names the offending item.

Those guards evaluate AS-MODIFIED: against the row as this request has already changed it at that item's position, not against the row as it was when the request began. An item guarding on what an earlier item of the same request just wrote is asking a coherent question and gets a coherent answer. `expected_version` is the exception and it is a `400`: the token is server-minted and rewritten by every write, so mid-request there is no value a caller COULD send, and guarding on a row an earlier item already touched is refused before anything is written rather than answered with a mismatch the caller would go looking for a concurrent writer to explain.

##### What lands, and what it costs

`items` accepts at most 1000 entries (raised from 100; see the `issues.batchApplyLarge` capability token on `ContextResponse`). The cap bounds how long one request may hold a write transaction — it is not a statement about batch semantics. A request over 100 items also EXTENDS the effective request deadline to an operator-configured ceiling (`bd serve --large-apply-ceiling`, 5 minutes by default) instead of the ordinary small-request deadline, so a plan that genuinely needs minutes to apply is not cut off mid-commit; a request at or under 100 items keeps exactly the deadline — and the sibling batch operations' bound — it has always had. Split a larger plan if you must; each request is atomic on its own, but note that splitting it changes what the end gate can see, since the gate runs over one request at a time.

ONE HISTORY ENTRY IS RECORDED FOR THE WHOLE REQUEST, attributed to `actor`, and none at all when nothing durable landed — a request made entirely of ephemeral items writes only to unversioned tables. `provenance` labels that entry: it changes how the entry READS, never whether one is recorded, and an empty one composes a default naming how many items of each kind landed rather than every id, since an entry listing a hundred is the diff written twice.

EPHEMERALITY IS PER ITEM, exactly as it is for `POST /v0/beads/issues:batchCreate`: one request may create durable issues and ephemeral ones together. The two planes hold their edges in different tables, so a `dep_add` BETWEEN two rows this request creates on opposite planes is refused with everything else the request asked for.

IT IS NOT IDEMPOTENT AND CARRIES NO IDEMPOTENCY KEY. Replaying a request applies it again — the creates mint new ids, the edges are idempotent, the closes are no-ops. A caller that needs a replay record makes it an ITEM of the batch, so the record lands or rolls back with the work it describes; a key on the request would be a second, weaker mechanism for the same thing.

Hooks do not fire and the per-command auto-commit machinery does not run, exactly as for `POST /v0/beads/issues/{id}:claim`. The only durable effect is the single storage commit the role makes in its own transaction.

Declared `atomic`. Its `errorSchema` is `issueBatchError`.

**`issueBatchArguments`** — Arguments of issue/batch.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `items` | array of `ApplyItem` | yes | body | The items to apply, IN THE ORDER THEY ARE TO BE APPLIED. |
| `provenance` | text | no | body | Labels the version-control history entry this request records, under `updateIssue`'s rule: it changes how the entry READS, never whether one is recorded. |
| `force_id_prefix` | boolean | no | body | Permits an explicit `create.id` outside the workspace's configured issue prefix, for EVERY create item in the request. |
| `skip_per_edge_cycle_check` | boolean | no | body | Drops the PER-EDGE cycle probe for a caller wiring a large graph, exactly as it does on `POST /v0/beads/dependencies:add`. |

Result: `ApplyBatchResponse`

Title: Apply an ordered, heterogeneous plan as one act

Routes to: v0 `applyBatch`, `POST /v0/beads/issues:batchApply`.

Declared reasons: `already_claimed`, `dependency_cycle`, `dependency_exists`, `issue_pinned`, `not_assignee`, `not_closable`, `notes_overwrite_refused`, `precondition_failed`, `template_read_only`.

### issue/close-many (CallableBatch)

Closes every item it can and commits them together. It is the write side of `bd close a b c`, and it is the operation `POST /v0/beads/issues:batchCreate` already names as its own opposite.

THE REQUEST IS THE TRANSACTION BOUNDARY, which is the whole reason this is one operation rather than a loop over `POST /v0/beads/issues/{id}:close`: closing N issues one call at a time is N transactions and N history entries, and a caller that wants them to land together has no way to say so.

##### It is NOT all-or-nothing, and that is the point

An id this batch refuses is SKIPPED and the survivors commit. An agent that finishes four of five steps and mistypes the fifth keeps the four; making the batch atomic in the other sense would turn a typo into a rollback of finished work.

SO THE ANSWER IS A 200 CARRYING PER-ITEM OUTCOMES, even when items refused. `outcomes` has exactly one entry per requested item, in REQUEST ORDER, so a client walks it against its own argument list without matching ids back up. A NON-2xx from this operation means the batch NEVER RAN — a refused body, or an infrastructure failure — and never that some items landed.

That divides the refusal vocabulary in two, and the division is the contract: a refusal OF THE REQUEST is a problem document, and a refusal OF AN ITEM is a member of that item's outcome. `code` on an outcome is the same vocabulary `Problem.code` publishes, restricted to `not_found`, `not_closable` and the three close guards (`template_read_only`, `issue_pinned`, `not_assignee`), so a client classifies an item exactly as it classifies a request.

WHAT IS ATOMIC IS EVERYTHING THAT LANDS: one transaction, at most one history entry, and none at all when nothing landed. LANDED MEANS CHANGED — an idempotent re-close is a per-item success that persisted nothing, so a batch of them lands nothing and records no history entry, exactly as a batch of typos does.

##### Duplicates and planes

A DUPLICATED id is not a request error: `bd close a b a` is a plausible typo, not a failure. Items are closed in the order given, so the second occurrence finds what the first one did and reports an idempotent re-close at ITS OWN index — a success with `already_closed: true`. The reason on the row is the first occurrence's, because the second mutated nothing and so wrote nothing.

A WISP ID IS AN ADMISSIBLE ITEM, resolved across both planes exactly as `POST /v0/beads/issues/{id}:close` resolves one. What it does not do is reach the durable history entry: the entry a mixed batch records is composed from its DURABLE landings alone.

##### What this operation does not publish

NO COMPOSED CLAIM. The role can claim the next ready issue in the same transaction once the closes land, and that member is deliberately not published here — expressing it would require a second, BODY-shaped spelling of the ready-filter vocabulary that `GET /v0/beads/ready` and `POST /v0/beads/issues:claimNext` both express as query parameters, and two spellings of one predicate eventually disagree. A client that wants both sends the two requests; what it loses is the single transaction, which is a real loss and is named here rather than papered over. It is additive later, once there is one shape for a ready filter in a body.

NO PER-ITEM PRECONDITION. There is no counterpart here to a compare-and-set guard, matching the role, so `force` is a question with only two answers: it bypasses blocker and open-child close policy, the pin and the assignee guard for every item, and it never bypasses the template guard, validation or existence.

##### Hooks and auto-commit

Hooks do not fire and the per-command auto-commit machinery does not run, exactly as for `POST /v0/beads/issues/{id}:close`.

**`issueCloseManyArguments`** — Arguments of issue/close-many.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `items` | array of `BatchCloseItem` | yes | body | The issues to close, in the order the caller asked for them. |
| `session` | text | no | body | The working session, recorded against every item that closes, under `CloseIssueRequest.session`'s first-close-wins rule and bounds. |
| `force` | boolean | no | body | Bypass close policy — the open-children refusal and the live-blocker refusal — and the pin and the assignee guard for EVERY item, and nothing else. |
| `auto_close_molecule` | boolean | no | body | Behind the `issues.close.autoCloseMolecule` behavior token: an older server answers `unknown_parameter` for this name. |

Result: `BatchCloseResponse`

Title: Close many issues as one act

Routes to: v0 `batchCloseIssues`, `POST /v0/beads/issues:batchClose`.

### issue/claim-next (CallableBatch)

Takes ONE ready issue and hands it back claimed, in a single transaction. It is `bd ready --claim`, and it is the operation this surface's polling clients have been composing by hand out of `GET /v0/beads/ready` and `POST /v0/beads/issues/{id}:claim`.

THAT COMPOSITION IS A RACE, and retiring it is why this exists. Between the listing that offered a row and the claim that asked for it, another agent claims it — so the second agent gets `409 already_claimed` for a row it was correctly offered, and a fleet polling one queue spends its requests losing races rather than doing work. Here the ready predicate, the compare-and-set that wins the row, and the hydration of the row that was won are ONE transaction, so the row cannot move between being chosen and being reported.

THE CALLER NAMES A QUESTION, NOT A ROW, which is what makes this a different operation rather than a mode of the claim. There is no id in the path and none in the body: selection is part of the contract.

##### Nothing eligible is a 200

An empty ready front is the steady state of a drained queue, not a failure, so a request that finds nothing answers `200` with `claimed` ABSENT. Its absence is the whole signal and there is no second member beside it: a polling agent branches on presence and sleeps. Nothing is written and no history entry is recorded.

This is the one place this operation deliberately differs from `POST /v0/beads/issues/{id}:claim`, which 404s an id that names nothing — that operation was asked about a ROW, and this one was asked a question whose honest answer can be "none".

##### The filters are the listing's, exactly

Every parameter below is `GET /v0/beads/ready`'s, means what it means there, and is decoded by the same function — including the default type exclusions and the way `type` drops them. That is not tidiness: a claim that answered a different question than the listing shows would hand an agent work the listing never offered it, and two predicates that are allowed to differ eventually do.

THERE IS NO `limit`, and sending one is a 400 rather than a silently dropped parameter. A claim delivers exactly the one row it wins no matter how large the pool it scanned, and the scan itself must stay UNBOUNDED: the implementation walks the ready order and continues past rows a racing agent already took, so a bounded window would report "nothing to claim" whenever that window happened to be unclaimable while plenty of other ready work remained.

`sort` IS published, unlike on `GET /v0/beads/ready:count`, because order decides WHICH row a claim wins where it cannot change a cardinality.

##### Leases, and the one case that has none

A DURABLE win grants exactly one lease on the row it won — the handle heartbeats extend, and the row lease-expiry recovery walks once nothing extends it.

An EPHEMERAL win carries NO LEASE, and that is the sharper consequence because it has no expiry to wait out. Ephemeral rows are outside the ready set by default; `include_ephemeral` pulls them in for the claim exactly as it does for the listing, and such a row IS claimable — claiming it moves the ephemeral row itself rather than promoting it. But heartbeats refuse an ephemeral row and lease-expiry recovery only walks leased durable ones, so nothing reclaims it if its claimant dies: it stays in progress under a gone actor until something releases or finishes it. A caller handing ephemeral work to agents it does not supervise owns that recovery itself. An ephemeral win records no durable history entry either, so a caller reconstructing who took what from history alone will not see it — read the row.

##### Hooks and auto-commit

Hooks do not fire and the per-command auto-commit machinery does not run, exactly as for `POST /v0/beads/issues/{id}:claim`.

Declared `atomic`.

**`issueClaimNextArguments`** — Arguments of issue/claim-next.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `assignee` | text | no | query | Only issues assigned to this actor. |
| `unassigned` | boolean | no | query | Only issues with no assignee. |
| `type` | Bead Type reference | no | query | A Bead Type reference (§2). |
| `exclude_type` | Bead Type reference array | no | query | A Bead Type reference (§2). |
| `label` | array of text | no | query | Labels that must ALL be present (AND). |
| `label_any` | array of text | no | query | Labels of which at least one must be present (OR). |
| `exclude_label` | array of text | no | query | Labels that must not be present. |
| `label_pattern` | text | no | query | Glob matched against labels. |
| `label_regex` | text | no | query | Regular expression matched against labels, compiled by the database in its own dialect. |
| `priority` | integer | no | query | Exact priority (0 is a real value, not "unset"). |
| `parent` | text | no | query | Restrict to recursive descendants of this issue. |
| `metadata_field` | array of text | no | query | Top-level metadata equality filter as `key=value`, split on the first `=`. |
| `has_metadata_key` | text | no | query | Only issues carrying this top-level metadata key. |
| `include_ephemeral` | boolean | no | query | Include ephemeral (non-synced) rows. |
| `include_deferred` | boolean | no | query | Include issues whose `defer_until` is still in the future. |
| `sort` | text | no | query | Ready-work ordering. |

Result: `ClaimNextResponse`

Title: Claim the next ready issue

Routes to: v0 `claimNextIssue`, `POST /v0/beads/issues:claimNext`.

CLI mapping:

```json
{"flags": [{"names": ["-p"], "parameter": "priority"}, {"names": ["-a"], "parameter": "assignee"}, {"names": ["-u"], "parameter": "unassigned"}, {"names": ["-s"], "parameter": "sort"}, {"names": ["-l"], "parameter": "label"}, {"names": ["-t"], "parameter": "type"}]}
```

### issue/dep/add (CallableBatch)

Asserts every edge in the request, or none of them.

IT IS ALL-OR-NOTHING, and unlike a batch close that is not a policy choice but the shape of the question. Edges asserted together describe a GRAPH, and half a graph is a graph nobody asked for — the cycle a caller was refused for is exactly the state a partial commit would leave behind. A client that gets a 4xx knows nothing was written, and can fix its payload and resend it unchanged. There is no per-edge outcome because there is no outcome but the request's.

AN EDGE IS IDEMPOTENT AT ITS OWN TYPE. A pair that already carries an edge of the requested type refuses nothing and is still echoed in `added`; a pair that carries a DIFFERENT type is a `409` `dependency_exists`, whichever of the two types was stored first. Repetition WITHIN one request answers the same way: the second occurrence of a pair finds the first already written, and two different types for one pair in one request is the same `409`.

A TARGET NEED NOT BE AN ISSUE THIS DATABASE HOLDS. An `external:` reference and an id belonging to another repository are legitimate targets — the vocabulary is open — so only an absence this database can SEE is refused. A SOURCE has no such latitude: an edge follows its source, so a source this database holds no row for has no plane to land in.

Edges are applied parent-child first regardless of request order, so the complete planned hierarchy is visible before any blocking edge is validated against it, and a whole-graph gate runs once at the end. Both hold ACROSS the durable and ephemeral planes: a request may mix them, and it is still one transaction.

A request that wrote no genuinely new durable edge records no history entry, and a request made entirely of wisp-sourced edges records none either — an edge follows its source, and the wisp plane is not versioned. Each genuinely new edge records a `dependency_added` entry on its source's event stream, attributed to `actor`.

Hooks do not fire and the per-command auto-commit machinery does not run, exactly as for `POST /v0/beads/issues/{id}:claim`. The only durable effect is the single storage commit the role makes in its own transaction.

Declared `idempotent` and `atomic`. Its `errorSchema` is `issueDepAddError`.

**`issueDepAddArguments`** — Arguments of issue/dep/add.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `edges` | array of `DependencyEdge` | no | body | The edges to assert, in the caller's order. |
| `source` | text | no | adapter | The edge's source. |
| `target` | text | no | adapter | The edge's target. |
| `type` | Link Type reference | no | adapter | A Link Type reference (§2). |

Result: `AddDependenciesResponse`

Title: Assert dependency edges as one act

Routes to: v0 `addDependencies`, `POST /v0/beads/dependencies:add`.

Declared reasons: `dependency_cycle`, `dependency_exists`.

CLI mapping:

```json
{"flags": [{"names": ["-t"], "parameter": "type"}, {"names": ["--blocked-by", "--depends-on"], "parameter": "target"}], "positionals": [{"position": 0, "parameter": "source"}, {"position": 1, "parameter": "target"}]}
```

### issue/dep/remove (CallableBatch)

Removes exactly the edge the request names — source, target — and at most that one edge.

IT IS IDEMPOTENT, and `removed: false` is a SUCCESS rather than a refusal. Removing an edge twice leaves the same graph as removing it once, so an agent replaying its own teardown does not have to classify an error to discover it already ran. Nothing is written for it and no event is recorded.

THERE IS NO `404` ON THIS OPERATION, deliberately. An edge that is not there is `removed: false`, and an endpoint id that names nothing holds no edge either, so this operation probes no id's existence and has nothing it could report a miss on.

It is a collection-level custom method rather than a `DELETE`: an edge is named by TWO endpoints, so there is no single-segment resource path for a `DELETE` to address, and a `DELETE` carrying a body is the shape proxies mangle. `DELETE /v0/beads/memories/{key}` is a `DELETE` for the opposite reason — one named resource, no body.

A removal that found its edge records a `dependency_removed` entry on the source's event stream, attributed to `actor`. An edge FOLLOWS ITS SOURCE, so a wisp-sourced edge is removed from the unversioned plane and leaves no durable history entry.

Hooks do not fire and the per-command auto-commit machinery does not run, exactly as for `POST /v0/beads/issues/{id}:claim`. The only durable effect is the single storage commit the role makes in its own transaction.

Declared `idempotent`.

**`issueDepRemoveArguments`** — Arguments of issue/dep/remove.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `issue_id` | text | yes | body | The edge's SOURCE — the issue that depends on the other end. |
| `depends_on_id` | text | yes | body | The edge's TARGET — the issue depended upon. |

Result: `RemoveDependencyResponse`

Title: Remove one dependency edge

Routes to: v0 `removeDependency`, `POST /v0/beads/dependencies:remove`.

CLI mapping:

```json
{"positionals": [{"position": 0, "parameter": "issue_id"}, {"position": 1, "parameter": "depends_on_id"}]}
```

### config/set (CallableBatch)

Stores one setting, REPLACING any value already there — the write `bd config set` spells, on the durable settings plane this document's reads already publish.

`PUT` RATHER THAN A COLLECTION `POST`, and the method is the whole argument: the resource has a canonical URI, the caller names it, and the request carries the value that becomes its whole state. That is what `PUT` already means, and it is idempotent in the strict sense — the same request sent twice leaves the same row. `POST /v0/beads/memories` is the operation this is NOT: that one posts to the COLLECTION because its key may be derived from the content, so the caller cannot always name the resource it is creating. Here the caller always can.

THE KEY IS THE PATH'S and appears nowhere in the body: one anchor, one spelling, and no question about what to do when two disagree. It is used verbatim — no namespace completion, no case folding, no dash/underscore equivalence — and stored UNTRIMMED, because a key differing from another only by surrounding space is a key a reader will never match and trimming it would produce a write the caller cannot find again.

##### What this plane refuses, and what it does not

`issue_prefix` — in either spelling — is a `400` and NOTHING is written. The prefix is owned by `bd init --prefix`, `bd bootstrap` and `bd rename-prefix`, each of which does work this plane cannot: rewriting existing ids, or seeding a workspace that has none. Storing a new one here would leave the beads created before the write and the beads created after it disagreeing about their own namespace with nothing to reconcile them.

A `status.custom` value that does not PARSE is a `400` and nothing is written. That key is not merely stored — it is projected into the `custom_statuses` table, which reads consult first, IN THE SAME TRANSACTION as the row. `types.custom` is projected into `custom_types` the same way. A row without its table is a value that has been stored and has no effect for as long as the table holds something else, so the write and the projection are one durable act or neither happens.

A KEY WHOSE NAME MARKS IT CREDENTIAL-BEARING IS WRITABLE, and that is deliberate rather than an oversight in the redaction posture. Redaction is a rule about DISCLOSURE: it withholds a value from a reader because a bearer on this surface is shared and surface-wide and cannot decide that one caller may read a credential and another may not. A writer supplies the value, so refusing the write protects nothing that is not already in the caller's hand — and it would leave a workspace whose credentials can be seen to EXIST and never configured. The role refuses no such key either; `bd config set`'s own secret guard is about writing a credential into a git-tracked `config.yaml`, which is a different plane with a different hazard, and it returns clean for every key this operation reaches.

THE RESPONSE THEREFORE WITHHOLDS IT ANYWAY. The body is a `Setting` projected by the same rule `GET /v0/beads/config/{key}` projects with, so a `redacted: true` key comes back with no `value` — the response to a write is byte-identical to the read that follows it. It costs the caller nothing: the role promises the stored value equals the value sent for every key this plane accepts, so the echo carries no information the caller does not already hold, and publishing it would make one schema say two different things about `redacted`.

A key belonging to another SOURCE is not refused here and is worth knowing about: `export.*`, `dolt.*`, `federation.*`, `storage-class.*` and the rest of the yaml-only list live in `config.yaml`, and `beads.role` lives in git config. Written through this operation they land a row no reader consults. The role does not police that routing and neither can this server — three of the five sources `bd config show` reads are files on the CLIENT's machine, which is the same reason that command has no operation here.

Hooks do not fire, as for every write on this surface — and on this plane there are none to fire in any case: the workspace hook vocabulary is `on_create`/`on_update`/`on_close`, each of which hands a script an ISSUE, and a settings write has none to name.

**`configSetArguments`** — Arguments of config/set.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `key` | text | yes | path | Exact setting key, used verbatim. |
| `value` | text | yes | body | The value to store, VERBATIM. |

Result: `Setting`

Title: Store one setting

Routes to: v0 `setSetting`, `PUT /v0/beads/config/{key}`.

CLI mapping:

```json
{"positionals": [{"position": 0, "parameter": "key"}, {"position": 1, "parameter": "value"}]}
```

### config/unset (CallableBatch)

Removes the setting stored under one key — the write `bd config unset` spells. `DELETE` for `DELETE /v0/beads/memories/{key}`'s reason: it names ONE resource by path, carries no body and takes no flags, which is what the method already means.

REMOVING A KEY NOTHING SET SUCCEEDS, and this is where the operation parts company with the memory delete beside it. That one answers `404` for a key it held nothing under, because its role reports whether a row was found and `bd recall` already has an exit-code contract for the miss. THIS role reports no such thing: the storage seam discards the affected-row count on all three implementations, and an absent key and a key stored as the empty string are one answer on this plane — the same conflation `GET /v0/beads/config/{key}` has no `404` for. So this operation states an INTENDED END STATE rather than an act performed, and a caller clearing configuration it is not sure was ever written does not have to classify an error to learn it was already absent.

THERE IS CONSEQUENTLY NO `removed` MEMBER, and there must not be one: it would be a value one implementation had to invent. Sending the same request twice is `200` and then `200`.

UNSET DOES NOT UNDO `PUT`'s PROJECTION. Removing `status.custom` or `types.custom` deletes the row and LEAVES the normalized table exactly as the last write left it, so the custom statuses and types keep applying after the key that configured them is gone. All three implementations agree, so it is the plane's behavior rather than a divergence, and it is stated here so no reader infers a symmetry with `PUT` that the code does not have.

THE PROTECTED KEY IS NOT REFUSED HERE. `issue_prefix` cannot be WRITTEN through this plane and can be removed through it — an asymmetry that is shipped behavior on all three implementations rather than a decision this document makes, recorded as bd-yby99.34. Removing it does not rename anything; it leaves the workspace resolving its prefix from `config.yaml` or from nothing.

A CREDENTIAL-BEARING KEY IS REMOVABLE, on `PUT`'s reasoning: redaction withholds a value from a READER, and a removal discloses nothing at all.

Hooks do not fire, and this plane has none to fire; see `PUT`.

**`configUnsetArguments`** — Arguments of config/unset.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `key` | text | yes | path | Exact setting key, used verbatim. |

Result: `RemovedSetting`

Title: Remove one stored setting

Routes to: v0 `unsetSetting`, `DELETE /v0/beads/config/{key}`.

CLI mapping:

```json
{"positionals": [{"position": 0, "parameter": "key"}]}
```

### memory/remember (CallableBatch)

Stores one memory in the workspace's persistent memory plane — the operation behind `bd remember`. It is an UPSERT: a key that already holds a memory is overwritten, and `replaced` in the response reports which of the two happened.

`key` is OPTIONAL, and omitting it is the normal case. The server then derives the key from `content` using the one derivation `bd remember` has used since it shipped, and the response's `key` is where the caller learns what to recall. A `key` that IS supplied is used verbatim: no trimming, no slugging, no charset restriction, because a stored key has to stay recallable under the exact bytes the caller used.

MEMORY CONTENT IS SERVED IN FULL, here and on every other operation of this plane, and a bearer does not change that — it gates WHO may call, never what a caller who is let in may read. There is no `redacted` member and no value withholding: the settings surface's redaction is a heuristic over the KEY NAME, and memory keys are derived from the content, so the same rule would withhold a memory ABOUT tokens while serving one that CONTAINS a token under an innocuous slug. A promise that cannot be kept is not made. Do not store credentials in this plane.

There is no `201`/`200` split. `replaced` already says whether a row existed, saying it twice in a second vocabulary would add nothing, and an upsert whose key the server may derive has no stable `Location` to point at.

Hooks do not fire and the per-command auto-commit machinery does not run, exactly as for the other write operations on this surface. The only durable effect is the single storage commit the role makes in its own transaction — which also observes whether a previous value existed, so `replaced` is a statement about the row this request wrote rather than about a row some earlier read happened to see.

**`memoryRememberArguments`** — Arguments of memory/remember.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `content` | text | yes | body | The memory itself, stored VERBATIM: newlines, surrounding space and unicode all survive. |
| `key` | text | no | body | The key to store under. |

Result: `RememberedMemory`

Title: Store one memory

Routes to: v0 `rememberMemory`, `POST /v0/beads/memories`.

CLI mapping:

```json
{"positionals": [{"position": 0, "parameter": "content"}]}
```

### memory/forget (CallableBatch)

Removes the memory stored under one key and answers with what it held — the operation behind `bd forget`. IT IS DESTRUCTIVE and nothing it removes comes back, on a surface that has NO AUTHENTICATION: every process that can reach the port can erase any memory whose key it knows, exactly as `issues:sweep` and `issues:delete` state for beads. The recovery is the workspace's version control, not this API.

THE FIRST `DELETE` METHOD ON THIS SURFACE, and the shape is why. The two destructive issue operations are collection-level custom methods because they act on a SET the request describes and carry flags that change what is erased — a query string is exactly where a dropped parameter widens a deletion. This one names ONE resource by path, carries no body and takes no flags, which is what the `DELETE` method already means. The alternative spelling `POST /v0/beads/memories/{key}:forget` would in addition recreate the claim route's wildcard contortion, since `{key}:forget` is not a router pattern, for no gain.

REMOVING EXACTLY THE NAMED ROW is the ROLE's promise, pinned by its conformance contract rather than restated here: the memory plane shares one table with the workspace's settings and with the generic `bd kv` namespace, and a memory called `issue_prefix` is not the workspace's issue prefix.

Forgetting a key nothing stored is a `404` and removes nothing. Forgetting the same key twice is therefore a `200` and then a `404`, which is what a retrying client actually sees; the second answer is not a failure to act, it is the same fact reported after the act.

The same keys are unreachable here as on the `GET` beside it: a stored key carrying a control character is refused with a `400` rather than looked up, while the role stays verbatim, so such a memory can be forgotten from the CLI and not through this operation.

Hooks do not fire, as for every write on this surface. There is no `dry_run`: one named row is not a set to cost first.

**`memoryForgetArguments`** — Arguments of memory/forget.

| Name | Type | Required | In | Meaning |
| --- | --- | --- | --- | --- |
| `key` | text | yes | path | Exact memory key, used verbatim. |

Result: `Memory`

Title: Forget one stored memory

Routes to: v0 `forgetMemory`, `DELETE /v0/beads/memories/{key}`.

CLI mapping:

```json
{"positionals": [{"position": 0, "parameter": "key"}]}
```

## 8. Conformance rows for preview-1

| Row | Expectation |
| --- | --- |
| IC-1 | Every name of §1 is invocable |
| IC-2 | Each invocation's arguments and result validate against its declaration |

## 9. Schemas

The following markdown-json-schema/0.6 fragments, bundle `issue-callables`, are the arguments and
errors each section names and the v0 components they reach;
`scripts/spec-schema-fragments.mjs` extracts them into
`issue-callables-preview-1.schema.json`.

<!-- bdp-schema:start issueContextArguments bundle=issue-callables -->
### Schema: "issueContextArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/context." |
| type | "object" |

<!-- bdp-schema:end issueContextArguments bundle=issue-callables -->

<!-- bdp-schema:start issueReadyArguments bundle=issue-callables -->
### Schema: "issueReadyArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/ready." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "assignee" | text | no | — | "Only issues assigned to this actor." |
| "unassigned" | boolean | no | — | "Only issues with no assignee." |
| "type" | schema | no | — | "A Bead Type reference (§2). Issue type. The only normalization is shorthand ALIAS expansion, exactly what `bd ready --type` does: `mr` → `merge-request`, `feat` → `feature`, `mol` → `molecule`, `enhancement` → `feature`, `dec`/`adr` → `decision`. Every other value is used as written — there is NO plural folding, so `bugs` is not `bug`.\\n\\nAn unrecognized type is not an error here: the type vocabulary is workspace-configurable, and `bd ready` does not validate it either, so it simply matches nothing and `items` comes back empty. (The list operation differs — `bd list` DOES validate the type, so `GET /v0/beads/issues?type=bugs` is a 400.)\\n\\nWhen set, `exclude_type` is ignored, and so are the default type exclusions described above." |
| "exclude_type" | schema | no | — | "A Bead Type reference (§2). Issue types to exclude. Repeat the parameter, or pass a comma-separated list. Ignored when `type` is set." |
| "label" | array of (text) | no | — | "Labels that must ALL be present (AND)." |
| "label_any" | array of (text) | no | — | "Labels of which at least one must be present (OR)." |
| "exclude_label" | array of (text) | no | — | "Labels that must not be present." |
| "label_pattern" | text | no | — | "Glob matched against labels." |
| "label_regex" | text | no | — | "Regular expression matched against labels, compiled by the database in its own dialect. A pattern it cannot compile is a 400 `invalid_value` on this parameter." |
| "priority" | integer | no | — | "Exact priority (0 is a real value, not \\"unset\\")." |
| "parent" | text | no | — | "Restrict to recursive descendants of this issue." |
| "metadata_field" | array of (text) | no | — | "Top-level metadata equality filter as `key=value`, split on the first `=`. Repeatable. An invalid key is a 400." |
| "has_metadata_key" | text | no | — | "Only issues carrying this top-level metadata key." |
| "include_ephemeral" | schema | no | — | "Include ephemeral (non-synced) rows." |
| "include_deferred" | schema | no | — | "Include issues whose `defer_until` is still in the future." |
| "sort" | schema | no | — | "Ready-work ordering. `priority` is priority-first; `hybrid` orders recent issues by priority and older ones by age; `oldest` is creation order. An unrecognized value is a 400.\\n\\nThe default is the one `bd ready --sort` registers, so a client swapping `bd ready --json` for this operation gets the same items in the same order. The storage layer treats an EMPTY policy as `hybrid`, but that fallback is unreachable from the CLI and is NOT this parameter's default: `hybrid` demotes older high-priority work, so defaulting to it would change the item SET as soon as `limit` truncates — silently, and only for the clients this API exists to migrate." |
| "limit" | schema | no | — | "Maximum number of items to return. `0` means unlimited, exactly as `bd ready --limit 0` does — the two surfaces read the same shared default and the same zero semantics, so they cannot diverge. A negative value is a 400.\\n\\nThe default below is the shared ready-work limit constant (`workapi.DefaultReadyLimit`, the value `bd ready`'s `--limit` flag registers).\\n\\nOne exception, and it is mode-dependent: when the server was started with `--allow-non-loopback`, `limit=0` is refused with 400 `invalid_argument`, `param: \\"limit\\"`, `reason: \\"invalid_value\\"` and detail \\"unlimited reads are loopback-only; pass an explicit limit\\". An unlimited read buffers the whole active set and its JSON encoding inside one shared process, which must not be reachable by arbitrary network peers. The bind mode is deliberately NOT advertised in `ContextResponse` — a client that wants an unlimited read asks for one and, on that 400, re-issues with an explicit limit; it is a client-side fix, never a retry." |
| "brief" | schema | no | — | "Omit the free-form text from every item: `description`, `design`, `acceptance_criteria`, `notes`, `payload` and `waiters` are not selected. Filtering is unaffected, because it selects rows and this selects fields. Default false, so the payload is unchanged for a client that does not ask.\\n\\nThe response carries no marker for the omission, so an omitted field is indistinguishable from a genuinely empty one: only the client that sent this parameter knows the rows are partial. Fetch a whole issue with `GET /v0/beads/issues/{id}`." |

#### Advanced

```json-schema
{
  "properties": {
    "type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "exclude_type": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "uri",
        "pattern": "^https?://.+",
        "x-bdp-type-reference": true
      }
    },
    "include_ephemeral": {
      "type": "boolean",
      "default": false
    },
    "include_deferred": {
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
    },
    "limit": {
      "type": "integer",
      "minimum": 0,
      "default": 100
    },
    "brief": {
      "type": "boolean",
      "default": false
    }
  }
}
```

<!-- bdp-schema:end issueReadyArguments bundle=issue-callables -->

<!-- bdp-schema:start issueReadyCountArguments bundle=issue-callables -->
### Schema: "issueReadyCountArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/ready-count." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "assignee" | text | no | — | "Only issues assigned to this actor." |
| "unassigned" | boolean | no | — | "Only issues with no assignee." |
| "type" | schema | no | — | "A Bead Type reference (§2). Issue type, with the shorthand alias expansion and the match-nothing-rather-than-fail treatment `GET /v0/beads/ready` documents. Setting it drops the default type exclusions and makes `exclude_type` ignored, there and here alike." |
| "exclude_type" | schema | no | — | "A Bead Type reference (§2). Issue types to exclude. Repeat the parameter, or pass a comma-separated list. Ignored when `type` is set." |
| "label" | array of (text) | no | — | "Labels that must ALL be present (AND)." |
| "label_any" | array of (text) | no | — | "Labels of which at least one must be present (OR)." |
| "exclude_label" | array of (text) | no | — | "Labels that must not be present." |
| "label_pattern" | text | no | — | "Glob matched against labels." |
| "label_regex" | text | no | — | "Regular expression matched against labels, compiled by the database in its own dialect. A pattern it cannot compile is a 400 `invalid_value` on this parameter." |
| "priority" | integer | no | — | "Exact priority (0 is a real value, not \\"unset\\")." |
| "parent" | text | no | — | "Restrict to recursive descendants of this issue." |
| "metadata_field" | array of (text) | no | — | "Top-level metadata equality filter as `key=value`, split on the first `=`. Repeatable. An invalid key is a 400." |
| "has_metadata_key" | text | no | — | "Only issues carrying this top-level metadata key." |
| "include_ephemeral" | schema | no | — | "Include ephemeral (non-synced) rows, which the count merges exactly as the listing lists them." |
| "include_deferred" | schema | no | — | "Include issues whose `defer_until` is still in the future." |

#### Advanced

```json-schema
{
  "properties": {
    "type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "exclude_type": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "uri",
        "pattern": "^https?://.+",
        "x-bdp-type-reference": true
      }
    },
    "include_ephemeral": {
      "type": "boolean",
      "default": false
    },
    "include_deferred": {
      "type": "boolean",
      "default": false
    }
  }
}
```

<!-- bdp-schema:end issueReadyCountArguments bundle=issue-callables -->

<!-- bdp-schema:start issueStatsArguments bundle=issue-callables -->
### Schema: "issueStatsArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/stats." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "assignee" | text | no | — | "Answer for ONE ACTOR instead of the workspace. Used as written: no trimming, no case folding, no alias expansion. An empty value is a 400 — the workspace-wide question is asked by OMITTING the parameter, and an empty assignee would otherwise select the rows with no assignee and report them as one actor's workload.\\n\\nIT CHANGES FOUR DEFINITIONS AT ONCE, and they are named on the `Statistics` properties rather than here: the set widens to include the ephemeral tier, `blocked_issues` counts the `blocked` STATUS instead of the dependency flag, `ready_issues` becomes the real ready-work count instead of a subtraction, and `pinned_issues` is always 0. An actor with no rows is a summary of zeros, not a 404." |
| "skip_blocked" | schema | no | — | "Ask for the answer WITHOUT the blocked-set scan, which is the expensive half of this query on a large workspace — the same request `bd status --no-blocked` makes.\\n\\nIT IS A HINT. When it is honored, `blocked_issues` and `ready_issues` are both null and `blocked_count_skipped` is true; when the backend has no cheaper path the full numbers come back and the flag is false. Nothing else in the summary changes either way, so a client that reads neither pointer cannot tell the difference.\\n\\nIGNORED when `assignee` is set: that answer computes both numbers by a route with no fast path, and it is not an error to ask." |

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

<!-- bdp-schema:end issueStatsArguments bundle=issue-callables -->

<!-- bdp-schema:start issueBlockedArguments bundle=issue-callables -->
### Schema: "issueBlockedArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/blocked." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "parent" | text | no | — | "Only the parent's direct children (a parent-child edge) and ids under it in the dotted hierarchy, as `bd blocked --parent` narrows." |
| "label" | array of (text) | no | — | "Labels that must ALL be present (AND). Each value is trimmed, and blank and repeated values are dropped, as `bd blocked --label` does." |
| "label_any" | array of (text) | no | — | "Labels of which at least one must be present (OR)." |
| "exclude_label" | array of (text) | no | — | "Labels that must all be absent." |

<!-- bdp-schema:end issueBlockedArguments bundle=issue-callables -->

<!-- bdp-schema:start issueDepCyclesArguments bundle=issue-callables -->
### Schema: "issueDepCyclesArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/dep/cycles." |
| type | "object" |

<!-- bdp-schema:end issueDepCyclesArguments bundle=issue-callables -->

<!-- bdp-schema:start issueDepTreeArguments bundle=issue-callables -->
### Schema: "issueDepTreeArguments"

Value: object

Other fields: not allowed

Required order: ["root_id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/dep/tree." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "root_id" | text | yes | — | "The issue to walk from. It must be an EXACT canonical issue id: there is no fuzzy, prefix or substring resolution on this surface, for the reason `GET /v0/beads/issues/{id}` gives. An empty value is a 400 `invalid_argument`; a value that matches no issue and no wisp is a 404 `not_found`, because there is one anchor here and no other answer to preserve." |
| "direction" | schema | no | — | "Which way to follow edges. `down` (the default) walks what the root DEPENDS ON; `up` walks what depends ON it; `both` walks each way and returns one list.\\n\\nFor `both` the two walks are independent and the answer is their concatenation: every up node except the root, then the whole down tree beginning with the root. The root appears once. The two halves may repeat a node between them — an issue that both blocks and is blocked by something in the other half — so a client aggregating `items` must not assume the ids are distinct. Both walks see ONE database state.\\n\\nAny other value is a 400 `invalid_argument`: the vocabulary is closed." |
| "max_depth" | schema | no | — | "How many LEVELS to descend, counting the root as level one: `max_depth=1` is the root alone. A node beyond the bound is ABSENT rather than present and flagged.\\n\\nZero and negative values are a 400 `invalid_argument` rather than \\"unbounded\\": the answer to an unbounded recursive walk on a large workspace is the request that takes the database down." |
| "status" | text | no | — | "Prune the walked tree to the nodes carrying this status AND the ancestor chain of each survivor, so the answer is still a tree.\\n\\nIt is a POST-WALK PRUNE, not a filter on the walk, and the difference is observable: a matching node BEHIND a non-matching one is still reached, and the non-matcher is kept as its ancestor. A prune that matches nothing returns NO items at all, root included.\\n\\nThe value is not checked against the workspace's status vocabulary; an unrecognized status simply matches nothing." |

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

<!-- bdp-schema:end issueDepTreeArguments bundle=issue-callables -->

<!-- bdp-schema:start issueListArguments bundle=issue-callables -->
### Schema: "issueListArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/list." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "status" | array of (text) | no | — | "Status filter. Repeat the parameter, or pass a comma-separated list. Custom statuses configured for the workspace are honored.\\n\\nSetting this REPLACES the default status exclusions rather than fighting with them: `status=closed` on its own returns closed issues, and does NOT also need `all=true`. Leave it unset to get the default view described above." |
| "type" | schema | no | — | "A Bead Type reference (§2). Issue type. Shorthand aliases are expanded exactly as `bd list --type` expands them (`mr`, `feat`, `mol`, `enhancement`, `dec`, `adr`); there is no plural folding. Unlike on `ready`, an unknown type is a 400 `invalid_argument` with `reason: \\"invalid_value\\"`, because `bd list` validates the type against the workspace's configured vocabulary and this operation keeps that behavior." |
| "assignee" | text | no | — | "Only issues assigned to this actor." |
| "label" | array of (text) | no | — | "Labels that must ALL be present (AND)." |
| "label_any" | array of (text) | no | — | "Labels of which at least one must be present (OR)." |
| "exclude_label" | array of (text) | no | — | "Labels that must not be present." |
| "parent" | text | no | — | "Restrict to recursive descendants of this issue." |
| "all" | schema | no | — | "Drop the default status exclusions (closed plus any custom statuses in the done/frozen categories). Redundant when `status` is set, which drops them already." |
| "include_templates" | schema | no | — | "Include template molecules." |
| "include_gates" | schema | no | — | "Include gate issues." |
| "include_infra" | schema | no | — | "Include the workspace's configured infrastructure issue types. This also admits the ephemeral plane those types live in, so it is strictly wider than `include_ephemeral`." |
| "include_ephemeral" | schema | no | — | "Include the ephemeral tier — ephemeral rows and the non-synced rows stored beside them — merged into the same order as the durable ones, whichever order `sort` named.\\n\\nIt admits a TIER and takes no TYPE exclusion off, so a row whose type this operation already hides stays hidden. That includes the configured infrastructure types: ephemeral `agent`, `role` and `message` rows need `include_infra` as well as, or instead of, this one. What `include_ephemeral` alone reaches is the ephemeral rows of the types a listing already shows.\\n\\nA `type` this workspace calls infra is the one NARROWING it lifts. Such a type on its own reads only that type's ephemeral rows, which is where creating one puts it; with `include_ephemeral` the type's durable rows (a promoted wisp, an issue retyped after it was created) are listed as well. `include_infra` alone keeps the narrowing." |
| "created_before" | schema | no | — | "Only issues created strictly before this instant. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second before it is compared), and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does." |
| "created_after" | schema | no | — | "Only issues created strictly after this instant. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second before it is compared), and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does." |
| "metadata_field" | array of (text) | no | — | "Top-level metadata equality filter as `key=value`, split on the first `=`. Repeatable. An invalid key is a 400." |
| "has_metadata_key" | text | no | — | "Only issues carrying this top-level metadata key." |
| "q" | text | no | — | "`bd search`'s free text. A row matches when its title or its id contains the text, case-insensitively; a text shaped like an issue id also matches that exact id, an id prefix, and the external reference. It narrows the listing and lifts none of its default exclusions, so a caller that wants `bd search`'s every-status, every-kind answer also sends `all`, `include_templates`, `include_gates`, `include_infra` and `include_ephemeral`.\\n\\nBehind the `issues.list.search` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses a search locally against a server that does not advertise the token, rather than paying for that round trip." |
| "no_assignee" | schema | no | — | "Only issues with no assignee: `bd list --no-assignee`, handed to the role as written beside the other filters.\\n\\nBehind the `issues.list.noAssignee` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or listing assigned issues as well." |
| "title" | text | no | — | "Case-insensitive substring match on the title: `bd list --title`. It narrows the listing and lifts none of its default exclusions.\\n\\nBehind the `issues.list.title` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering the unnarrowed listing." |
| "id" | schema | no | — | "Restrict to these canonical ids (repeat the parameter). AND-ed with every other filter, including the default exclusions, so a caller addressing rows regardless of status, type or tier also sends all=true, include_templates, include_gates, include_infra and include_ephemeral. At most 200 values; an id longer than storage holds, an empty one, one with leading or trailing whitespace, or one carrying a control character or a comma is a 400 `invalid_argument` on `param: \\"id\\"` — each value is matched exactly as sent, never trimmed or split. An id that names no row is simply not matched. Advertised by the behavior token `issues.list.ids`." |
| "title_contains" | text | no | — | "Case-insensitive substring match on the title: `bd list --title-contains`, spelled as `GET /v0/beads/issues:count` spells it. It overlaps `title` deliberately: both reach the role, which carries both fields.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "desc_contains" | text | no | — | "Case-insensitive substring match on the description: `bd list --desc-contains`.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "notes_contains" | text | no | — | "Case-insensitive substring match on the notes: `bd list --notes-contains`.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "external_contains" | text | no | — | "Substring match on the external reference: `bd list --external-contains`.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "external_ref" | text | no | — | "Exact match on the external reference: `bd list --external-ref`.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "spec" | text | no | — | "Only issues whose spec id starts with this prefix: `bd list --spec`.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "label_pattern" | text | no | — | "Glob label filter: `bd list --label-pattern`, with `GET /v0/beads/ready`'s spelling.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "label_regex" | text | no | — | "Regular-expression label filter: `bd list --label-regex`, with `GET /v0/beads/ready`'s spelling. A pattern the database cannot compile is a 400 `invalid_value` on this parameter.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "updated_after" | schema | no | — | "Only issues last updated strictly after this instant: `bd list --updated-after`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second before it is compared), and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does. A row whose column is NULL never matches either bound.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "updated_before" | schema | no | — | "Only issues last updated strictly before this instant: `bd list --updated-before`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second before it is compared), and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does. A row whose column is NULL never matches either bound.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "closed_after" | schema | no | — | "Only issues closed strictly after this instant: `bd list --closed-after`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second before it is compared), and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does. A row whose column is NULL never matches either bound.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "closed_before" | schema | no | — | "Only issues closed strictly before this instant: `bd list --closed-before`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second before it is compared), and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does. A row whose column is NULL never matches either bound.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "defer_after" | schema | no | — | "Only issues deferred until strictly after this instant: `bd list --defer-after`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second before it is compared), and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does. A row whose column is NULL never matches either bound.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "defer_before" | schema | no | — | "Only issues deferred until strictly before this instant: `bd list --defer-before`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second before it is compared), and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does. A row whose column is NULL never matches either bound.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "due_after" | schema | no | — | "Only issues due strictly after this instant: `bd list --due-after`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second before it is compared), and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does. A row whose column is NULL never matches either bound.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "due_before" | schema | no | — | "Only issues due strictly before this instant: `bd list --due-before`. RFC 3339; compared strictly and at whole-second precision (the bound is truncated to the second before it is compared), and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does. A row whose column is NULL never matches either bound.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "priority" | integer | no | — | "Exact priority: `bd list --priority`. Absent means unfiltered; `0` is a real priority.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "priority_min" | integer | no | — | "Lowest priority to list, inclusive: `bd list --priority-min`.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "priority_max" | integer | no | — | "Highest priority to list, inclusive: `bd list --priority-max`.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "empty_description" | schema | no | — | "Only issues with an empty description: `bd list --empty-description`.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "no_labels" | schema | no | — | "Only issues carrying no label: `bd list --no-labels`.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "no_parent" | schema | no | — | "Only top-level issues, those with no parent: `bd list --no-parent`. Sending it with `parent` is a 400 on `no_parent`, as on `GET /v0/beads/issues:count`.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "exclude_type" | schema | no | — | "A Bead Type reference (§2). Issue types to leave out (repeat the parameter; a value may also be comma-separated): `bd list --exclude-type`. Normalized by the role as the local listing normalizes it.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "exclude_status" | array of (text) | no | — | "Statuses to leave out (repeat the parameter; a value may also be comma-separated), on top of what `status` or the default exclusions select; it never re-admits a row they hide. With `all` there are no default exclusions, so the listing keeps every status not named here (the `pinned` and `hooked` statuses and custom done or frozen statuses included unless named). Each name is validated against the workspace's statuses (built-in and custom), as `GET /v0/beads/issues:count` validates it: an unknown name is a 400 `invalid_value` on this parameter, never an exclusion that excludes nothing.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "pinned" | schema | no | — | "Only issues carrying the pinned FLAG, at any status: `bd list --pinned`. The pinned STATUS is `status`; the flag is a separate predicate. Sending it with `no_pinned` is a 400 on `no_pinned`.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "no_pinned" | schema | no | — | "Only issues without the pinned flag, held in place where `all` or a pinned/hooked `status` would otherwise drop that predicate: `bd list --no-pinned`. Sending it with `pinned` is a 400 on `no_pinned`.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "deferred" | schema | no | — | "Only deferred issues: `bd list --deferred`.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "overdue" | schema | no | — | "Only overdue issues, those whose due time is before now: `bd list --overdue`. Now is the SERVER's clock when the query runs, not the client's.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "mol_type" | schema | no | — | "Only molecules of this type: `bd list --mol-type`. Any other value, including an empty one, is a 400 naming the parameter.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "wisp_type" | schema | no | — | "Only rows of this wisp type (a predicate on the column, not a plane selector): `bd list --wisp-type`. Any other value, including an empty one, is a 400 naming the parameter.\\n\\nBehind the `issues.list.filters` behavior token: an older server answers `unknown_parameter` for this name. A client with the handshake's capabilities cached refuses the request locally against a server that does not advertise the token, rather than paying for that round trip or answering a wider listing." |
| "sort" | schema | no | — | "Omitted, this Callable uses `\\"priority\\"`. Which of the two served total orders this page is in. `created` is `(created_at DESC, id ASC)`; `priority` is `(priority ASC, created_at DESC, id ASC)` — `bd list`'s flagless ordering, and the order `bd list --sort priority` produces.\\n\\nTHE DEFAULT IS `created` AND WILL NOT CHANGE. It is what this operation served before this parameter existed, so moving it would alter which rows a truncated page contains for every client written against that behavior, with no error to notice it by.\\n\\nTHE VOCABULARY IS CLOSED, and deliberately smaller than the nine values `bd list --sort` and `GET /v0/beads/issues:query` take. Each value here is a cursor contract, not a display preference: it needs a keyset predicate and a key proven total. See the operation description for why the other seven have neither.\\n\\nA value outside the enum is a 400 `invalid_argument` with `param: \\"sort\\"` and `reason: \\"invalid_value\\"`. A server that predates this parameter answers `param: \\"sort\\"` with `reason: \\"unknown_parameter\\"` instead, which is the per-parameter capability probe a client can dispatch on to fall back to paging in `created` order and sorting client-side. This server also advertises the `issues.list.sort` token in `ContextResponse.capabilities` for exactly that check, so a client with capabilities cached from the handshake never has to pay for the round trip an old server's `unknown_parameter` answer costs." |
| "cursor" | text | no | — | "Opaque keyset position, taken verbatim from a previous response's `next_cursor`. Clients MUST NOT construct, parse or mutate it: its encoding is server-private and versioned, and an undecodable or unknown-version value is refused with 400 `invalid_cursor`. The recovery for that refusal is normative: restart paging with no `cursor` at all — the position cannot be salvaged, and re-sending the same value cannot succeed.\\n\\nLIFETIME: a cursor holds a position, the ORDER that position is in, and a private encoding version — and nothing else. The server keeps no state for it, so it does not expire, does not become invalid when the server restarts, and is not tied to the connection that issued it; the only thing that invalidates one is a change to the encoding, which surfaces as `invalid_cursor`. A token minted before `sort` existed is still accepted, as the `created`-order position it is, so no traversal in flight across a server upgrade has to be restarted.\\n\\nTHE ORDER MUST MATCH, AND THAT MISMATCH IS DETECTED. A cursor minted under one `sort` and re-sent under another is refused with 400 `invalid_cursor`; the same instant and id name a different row in a different order, so resuming from it would skip and duplicate rows silently. Send the same `sort` for the whole traversal.\\n\\nFILTER MISUSE IS *NOT* DETECTABLE, which is the difference, and why repeating the filters matters. Because the token carries no filters, a page fetched with a cursor minted under DIFFERENT filters is not refused: the server applies the filters of the current request from the position of the old one, silently skipping every row the new filter set would have placed before that position. Repeat every filter verbatim for the whole traversal, and start a new traversal when they change." |
| "limit" | schema | no | — | "Maximum number of items to return. `0` means unlimited, exactly as `bd list --limit 0` does — the two surfaces read the same shared default and the same zero semantics, so they cannot diverge. An unlimited page reports `has_more: false` and carries no `next_cursor`. A negative value is a 400.\\n\\nThe default below is the shared list limit constant (`workapi.DefaultListLimit`, the value `bd list`'s `--limit` flag registers).\\n\\nOne exception, and it is mode-dependent: when the server was started with `--allow-non-loopback`, `limit=0` is refused with 400 `invalid_argument`, `param: \\"limit\\"`, `reason: \\"invalid_value\\"` and detail \\"unlimited reads are loopback-only; pass an explicit limit\\". An unlimited read buffers the whole active set and its JSON encoding inside one shared process, which must not be reachable by arbitrary network peers. The bind mode is deliberately NOT advertised in `ContextResponse` — a client that wants an unlimited read asks for one and, on that 400, re-issues with an explicit limit (and pages with `cursor`); it is a client-side fix, never a retry." |
| "brief" | schema | no | — | "Omit the free-form text from every item: `description`, `design`, `acceptance_criteria`, `notes`, `payload` and `waiters` are not selected. Filtering is unaffected, because it selects rows and this selects fields. Default false, so the payload is unchanged for a client that does not ask.\\n\\nThe response carries no marker for the omission, so an omitted field is indistinguishable from a genuinely empty one: only the client that sent this parameter knows the rows are partial. Fetch a whole issue with `GET /v0/beads/issues/{id}`." |

#### Advanced

```json-schema
{
  "properties": {
    "type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "all": {
      "type": "boolean",
      "default": false
    },
    "include_templates": {
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
    "include_ephemeral": {
      "type": "boolean",
      "default": false
    },
    "created_before": {
      "type": "string",
      "format": "date-time"
    },
    "created_after": {
      "type": "string",
      "format": "date-time"
    },
    "no_assignee": {
      "type": "boolean",
      "default": false
    },
    "id": {
      "type": "array",
      "maxItems": 200,
      "items": {
        "type": "string"
      }
    },
    "updated_after": {
      "type": "string",
      "format": "date-time"
    },
    "updated_before": {
      "type": "string",
      "format": "date-time"
    },
    "closed_after": {
      "type": "string",
      "format": "date-time"
    },
    "closed_before": {
      "type": "string",
      "format": "date-time"
    },
    "defer_after": {
      "type": "string",
      "format": "date-time"
    },
    "defer_before": {
      "type": "string",
      "format": "date-time"
    },
    "due_after": {
      "type": "string",
      "format": "date-time"
    },
    "due_before": {
      "type": "string",
      "format": "date-time"
    },
    "empty_description": {
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
    "exclude_type": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "uri",
        "pattern": "^https?://.+",
        "x-bdp-type-reference": true
      }
    },
    "pinned": {
      "type": "boolean",
      "default": false
    },
    "no_pinned": {
      "type": "boolean",
      "default": false
    },
    "deferred": {
      "type": "boolean",
      "default": false
    },
    "overdue": {
      "type": "boolean",
      "default": false
    },
    "mol_type": {
      "type": "string",
      "enum": [
        "swarm",
        "patrol",
        "work"
      ]
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
    },
    "sort": {
      "type": "string",
      "enum": [
        "created",
        "priority"
      ],
      "default": "priority"
    },
    "limit": {
      "type": "integer",
      "minimum": 0,
      "default": 50
    },
    "brief": {
      "type": "boolean",
      "default": false
    }
  }
}
```

<!-- bdp-schema:end issueListArguments bundle=issue-callables -->

<!-- bdp-schema:start issueQueryArguments bundle=issue-callables -->
### Schema: "issueQueryArguments"

Value: object

Other fields: not allowed

Required order: ["q"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/query." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "q" | text | yes | — | "The query expression, e.g. `status=open AND priority>1` or `type=bug OR label=urgent`. Blank, unparseable, or naming a field or operator the language does not have is a 400 `invalid_argument` with `param: \\"q\\"` and `reason: \\"invalid_value\\"`.\\n\\nRelative date terms (`created>7d`) are resolved against the SERVER's clock at the moment the request is served." |
| "all" | schema | no | — | "Include closed issues. Without it closed issues are excluded — unless the expression itself compares `status`, in which case the expression's own opinion stands and this parameter changes nothing." |
| "sort" | schema | no | — | "Display order for the page. Absent leaves the rows in the order the query returned them, which is the same thing `bd query` without `--sort` does.\\n\\nWHAT IT ORDERS is the rows the query bounded, exactly as on the CLI: for an expression the database answered under `limit`, the page; for a predicate expression, which the database cannot bound, the whole matching set." |
| "reverse" | schema | no | — | "Invert the display order. Ignored when `sort` is absent." |
| "limit" | schema | no | — | "Maximum number of items to return. `0` means unlimited, exactly as `bd query --limit 0` does — the two surfaces read the same shared default (`workapi.DefaultQueryLimit`, the value `bd query --limit` registers) and the same zero semantics. A negative value is a 400.\\n\\nThe same mode-dependent refusal the issue listing carries applies here: under `--allow-non-loopback`, `limit=0` is refused with 400 `invalid_argument`, `param: \\"limit\\"`, `reason: \\"invalid_value\\"`." |

#### Advanced

```json-schema
{
  "properties": {
    "all": {
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
    },
    "reverse": {
      "type": "boolean",
      "default": false
    },
    "limit": {
      "type": "integer",
      "minimum": 0,
      "default": 50
    }
  }
}
```

<!-- bdp-schema:end issueQueryArguments bundle=issue-callables -->

<!-- bdp-schema:start issueCountArguments bundle=issue-callables -->
### Schema: "issueCountArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/count." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "status" | text | no | — | "One stored status. The empty value and the literal `all` both mean EVERY status, which is what makes a bare count answer for closed rows as well as open ones.\\n\\nIT IS ONE STATUS, NOT A COMMA-SEPARATED SET, and that is the one parameter name this operation shares with `GET /v0/beads/issues` while meaning something narrower — that one takes a comma-separated OR set. It is stated here rather than quietly reconciled, because a client that assumed otherwise would read a plausible number instead of an error.\\n\\nIt is NOT validated against this workspace's configured vocabulary. An unrecognized name matches nothing and the answer is `0`, not a refusal — the shipped behavior of `bd count`, published rather than tightened, because a scripted caller counting a status its workspace has since dropped currently reads 0 and would otherwise start reading an error." |
| "type" | schema | no | — | "A Bead Type reference (§2). One issue type, with `status`'s match-nothing-rather-than-fail treatment and NO shorthand alias expansion at all — unlike `GET /v0/beads/ready`'s `type`, which expands aliases.\\n\\nIt has a SECOND effect under `include_infra`: a type this workspace calls infra routes the count to the ephemeral tier, unless `include_ephemeral` is also set. See that parameter." |
| "assignee" | text | no | — | "Only issues assigned to this actor. Sending it beside `no_assignee` is not refused: the two are handed to the filter as written and answer with the empty intersection, which is `0`." |
| "priority" | integer | no | — | "Exact priority. Absent means unfiltered — the distinction matters because `0` is a real priority, which is why the role models this as a pointer." |
| "priority_min" | integer | no | — | "Lowest priority to count, inclusive." |
| "priority_max" | integer | no | — | "Highest priority to count, inclusive." |
| "label" | array of (text) | no | — | "Labels that must ALL be present. Repeat the parameter. Entries are trimmed and de-duplicated inside the role, and a set whose entries are all blank is the same as an unset one." |
| "label_any" | array of (text) | no | — | "Labels of which at least ONE must be present. Repeat the parameter; same normalization as `label`." |
| "title" | text | no | — | "Case-insensitive substring match on the title." |
| "id" | text | no | — | "A comma-separated id set to restrict the count to. Splitting, trimming and de-duplication happen inside the role, so a caller passes the string it was given rather than a slice it had to prepare." |
| "title_contains" | text | no | — | "Substring match on the title, spelled as `GET /v0/beads/issues:query` spells it. It overlaps `title` deliberately: both reach the filter, and the two names exist because the role carries both fields." |
| "desc_contains" | text | no | — | "Substring match on the description." |
| "notes_contains" | text | no | — | "Substring match on the notes." |
| "created_after" | schema | no | — | "RFC 3339. Only issues created strictly after this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does." |
| "created_before" | schema | no | — | "RFC 3339. Only issues created strictly before this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does." |
| "updated_after" | schema | no | — | "RFC 3339. Only issues last updated strictly after this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does." |
| "updated_before" | schema | no | — | "RFC 3339. Only issues last updated strictly before this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does." |
| "closed_after" | schema | no | — | "RFC 3339. Only issues closed strictly after this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does. A row whose `closed_at` is NULL never matches either bound. Counting closed rows needs no `status` beside it: a bare count already includes them." |
| "closed_before" | schema | no | — | "RFC 3339. Only issues closed strictly before this instant, compared at whole-second precision (the bound is truncated to the second before it is compared) and normalized to UTC, so a bound carrying an offset selects exactly what its `Z` twin does. A row whose `closed_at` is NULL never matches either bound." |
| "empty_description" | schema | no | — | "Only issues with no description." |
| "no_assignee" | schema | no | — | "Only issues with no assignee." |
| "no_labels" | schema | no | — | "Only issues carrying no label." |
| "metadata_field" | array of (text) | no | — | "Top-level metadata equality filter as `key=value`, split on the first `=`. Repeatable. An invalid key is a 400." |
| "include_ephemeral" | schema | no | — | "Admit the EPHEMERAL PLANE — the wisps table — and nothing else. Exactly the first of `include_infra`'s four changes, with none of the other three: no type exclusion is taken off, so a row whose TYPE a default count already excludes stays excluded.\\n\\nIt exists because there was no way to ask for that one thing. The write path routes on STORAGE CLASS, not type, so a `no_history` bead lives in the wisps table while remaining ordinary durable work. Reaching it needed `include_infra`, which also drops template rows of the named type — one silent undercount traded for another.\\n\\nBeside `include_infra` it also lifts the fourth change's routing of an infra `type`, so that type's durable rows are counted along with its ephemeral ones rather than instead of them." |
| "has_metadata_key" | text | no | — | "Only issues carrying this top-level metadata key." |
| "include_infra" | schema | no | — | "Count the cardinality of `bd list --include-infra --all` instead of the durable plane. IT CHANGES FOUR THINGS AT ONCE, and they are listed rather than summarized because a caller reading \\"include infra\\" would expect one:\\n\\nthe ephemeral wisps tier is MERGED IN, picking up both wisps and the `no_history` beads that are durable work stored in that tier; template molecules are EXCLUDED, which a default count includes; gate beads are EXCLUDED unless `type=gate` asks for them by name; and a `type` this workspace calls infra ROUTES the count to the ephemeral tier instead of the durable one — unless `include_ephemeral` is also set, which keeps the durable tier as well, as `GET /v0/beads/issues` does.\\n\\nThe infra vocabulary is the WORKSPACE's, read from its configuration inside the role. A caller does not supply it and cannot — that config load is what this role exists to keep off both front doors.\\n\\nUnset — and with `include_ephemeral` also unset — the count is durable-plane only and applies none of the four: the historical `bd count` answer, kept exactly so a scripted caller reads the same number it read yesterday." |
| "parent" | text | no | — | "Restrict to one issue's children through one predicate with two arms: a parent-child dependency edge onto `parent`, OR — for an issue carrying no parent-child edge at all — a dotted-id prefix match (`parent.anything`). NEITHER ARM WALKS. The edge arm stops at one level, so a grandchild with an edge of its own is not counted, while the prefix arm reaches every edge-less dotted id at any depth (`X.1.1` as well as `X.1`). It is the same predicate `GET /v0/beads/issues`'s own `parent` applies, so `bd count --parent X` agrees in cardinality with `bd list --parent X --flat --all` (or `--json`) for the shared part of the predicate — NOT with a bare `bd list --parent X --all`, whose default tree mode walks every descendant reachable through either arm (grandchildren and below) by re-querying this same predicate once per level client-side (cmd/bd/list_show_filter_modes.go). `--flat` and `--json` both skip that walk and return this field's answer directly.\\n\\nSending it beside `no_parent` IS refused: `invalid_argument` on `no_parent` with `reason: invalid_value`, matching `bd list`'s CLI refusal of the same combination.\\n\\nBehind the `issues.count.scope` behavior token: an older server answers `unknown_parameter` for this name." |
| "no_parent" | schema | no | — | "Only issues carrying NO parent-child dependency edge. Unlike `parent`, this does NOT consult the dotted-id convention — an issue named `X.1` with no edge to `X` is still counted here, which is the one place `parent` and `no_parent` are not exact opposites of each other.\\n\\nSending it beside `parent` IS refused: `invalid_argument` on this parameter with `reason: invalid_value`, matching `bd list`'s CLI refusal of the same combination (cmd/bd/list_input.go) rather than the empty-intersection treatment `assignee`/`no_assignee` get.\\n\\nBehind the `issues.count.scope` behavior token: an older server answers `unknown_parameter` for this name." |
| "exclude_type" | schema | no | — | "A Bead Type reference (§2). Issue types to exclude from the count. Repeat the parameter, or pass a comma-separated list; entries are split and trimmed inside the role and are NOT validated against this workspace's vocabulary — an unrecognized name excludes nothing rather than failing, `status`'s own treatment. It is NOT ignored when `type` is set (unlike `GET /v0/beads/ready`'s `exclude_type`): the two compose, and it also composes with the exclusions `include_infra` applies on its own rather than replacing them.\\n\\nBehind the `issues.count.scope` behavior token: an older server answers `unknown_parameter` for this name." |
| "exclude_status" | array of (text) | no | — | "Statuses to exclude from the count. Repeat the parameter, or pass a comma-separated list; entries are taken as written (no normalization) but — UNLIKE `status` and `exclude_type` above — each name IS validated against this workspace's vocabulary (built-in statuses plus this workspace's own custom ones): an unrecognized name is `invalid_argument` on this parameter with `reason: invalid_value`, rather than silently excluding nothing and overcounting. `GET /v0/beads/issues` takes the same parameter behind the `issues.list.filters` token and validates it by the same rule; there it narrows on top of the listing's default status exclusions, which a count does not apply.\\n\\nBehind the `issues.count.scope` behavior token: an older server answers `unknown_parameter` for this name." |
| "group_by" | schema | no | — | "Bucket the count by one dimension and return `groups` beside `total`. Absent, the response carries `total` alone.\\n\\nThe set is CLOSED, and a value outside it is a `400` rather than an empty answer: a caller that misspelled a dimension and got zero buckets back has no way to tell that from a workspace with nothing in it. That is the role's own rule, applied at the edge here so the refusal names the parameter.\\n\\nBucket KEYS are normalized and printed unmodified by every front door, so the normalization is part of this contract: a priority bucket is `P` followed by the number (`P1`); the assignee bucket for unassigned rows is `(unassigned)`, never the empty string, which would be indistinguishable from a stored empty assignee; the label bucket for rows carrying no label at all is `(no labels)`, and it is ABSENT rather than zero when every matching row has one; `status` and `type` buckets are the stored value verbatim." |

#### Advanced

```json-schema
{
  "properties": {
    "type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "created_after": {
      "type": "string",
      "format": "date-time"
    },
    "created_before": {
      "type": "string",
      "format": "date-time"
    },
    "updated_after": {
      "type": "string",
      "format": "date-time"
    },
    "updated_before": {
      "type": "string",
      "format": "date-time"
    },
    "closed_after": {
      "type": "string",
      "format": "date-time"
    },
    "closed_before": {
      "type": "string",
      "format": "date-time"
    },
    "empty_description": {
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
    "include_ephemeral": {
      "type": "boolean",
      "default": false
    },
    "include_infra": {
      "type": "boolean",
      "default": false
    },
    "no_parent": {
      "type": "boolean",
      "default": false
    },
    "exclude_type": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "uri",
        "pattern": "^https?://.+",
        "x-bdp-type-reference": true
      }
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
    }
  }
}
```

<!-- bdp-schema:end issueCountArguments bundle=issue-callables -->

<!-- bdp-schema:start issueShowArguments bundle=issue-callables -->
### Schema: "issueShowArguments"

Value: object

Other fields: not allowed

Required order: ["id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/show." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "Exact canonical issue id. No fuzzy, prefix or substring resolution." |
| "include_comments" | schema | no | — | "Populate `comments` with the issue's full comment bodies. When it is honored `comments_omitted` is false, so a client is never left to guess whether an absent list means \\"no comments\\" or \\"not asked for\\"." |
| "include_dependents" | schema | no | — | "Populate `dependents` with the issues that depend on this one, each carrying its edge type — the shape `dependencies` already carries. Default false, for `include_comments`'s reason." |
| "brief_deps" | schema | no | — | "Reduce each row in `dependencies` to its identity-and-shape fields (`id`, `title`, `status`, `issue_type`, `priority`, `dependency_type`), dropping `description`, `design`, `notes` and `acceptance_criteria`. Default false, so the payload is unchanged for a client that does not ask." |

#### Advanced

```json-schema
{
  "properties": {
    "include_comments": {
      "type": "boolean",
      "default": false
    },
    "include_dependents": {
      "type": "boolean",
      "default": false
    },
    "brief_deps": {
      "type": "boolean",
      "default": false
    }
  }
}
```

<!-- bdp-schema:end issueShowArguments bundle=issue-callables -->

<!-- bdp-schema:start issueDepListArguments bundle=issue-callables -->
### Schema: "issueDepListArguments"

Value: object

Other fields: not allowed

Required order: ["id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/dep/list." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "Exact canonical issue id. No fuzzy, prefix or substring resolution." |
| "direction" | schema | no | — | "Omitted, this Callable uses `\\"out\\"`. Which way this issue's edges are walked. `out` answers the issues it DEPENDS ON — the `dependencies` member of `GET /v0/beads/issues/{id}`. `in` answers the issues that depend on it — that read's `dependents` member.\\n\\nIT IS REQUIRED AND HAS NO DEFAULT, on `GET /v0/beads/dependencies:count`'s terms and for the reason `issueops.RelationDirection` gives: the two answers have the same shape and the same member names, so a caller handed the inverse graph has nothing to notice. The vocabulary is CLOSED — unlike `type` below — because it is a property of the edge's shape rather than of a workspace's configuration." |
| "type" | schema | no | — | "A Link Type reference (§2). Edge types to include. Repeat the parameter. Empty means every type.\\n\\n`GET /v0/beads/dependencies`'s `type` exactly: the vocabulary is OPEN, so an unrecognized value is not an error and simply matches no edge, while a value no edge could ever carry — empty, or longer than the column — is a 400 `invalid_argument` with `param: \\"type\\"`.\\n\\nThe filter narrows EDGES, never the anchor. An issue whose every edge it rejects is answered with an empty `items` and not with a 404, which is a different fact from an id that names nothing." |

#### Advanced

```json-schema
{
  "properties": {
    "direction": {
      "type": "string",
      "enum": [
        "out",
        "in"
      ],
      "default": "out"
    },
    "type": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "uri",
        "pattern": "^https?://.+",
        "x-bdp-type-reference": true
      }
    }
  }
}
```

<!-- bdp-schema:end issueDepListArguments bundle=issue-callables -->

<!-- bdp-schema:start issueGetManyArguments bundle=issue-callables -->
### Schema: "issueGetManyArguments"

Value: object

Other fields: not allowed

Required order: ["ids"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/get-many." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "ids" | schema | yes | — | "The issues to read, exact ids, in either plane. DUPLICATES COLLAPSE: a repeated id is answered once, in the position of its first mention. An EMPTY array is legal and answers with both `issues` and `missing` empty — it is not refused the way `DeleteIssuesRequest.ids` refuses one, because a read that found nothing to read is not a mistake the way a delete that erased nothing usually is.\\n\\nThe cap is on the REQUEST, counted before deduplication: a caller sending 1500 mentions of 3 distinct ids still names a request this operation refuses, because the obligation the cap bounds is reading the request apart, not reading the rows it resolves to." |

#### Advanced

```json-schema
{
  "properties": {
    "ids": {
      "type": "array",
      "maxItems": 1000,
      "items": {
        "type": "string"
      }
    }
  }
}
```

<!-- bdp-schema:end issueGetManyArguments bundle=issue-callables -->

<!-- bdp-schema:start issueDepEdgesArguments bundle=issue-callables -->
### Schema: "issueDepEdgesArguments"

Value: object

Other fields: not allowed

Required order: ["issue_id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/dep/edges." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue_id" | schema | yes | — | "The issues to read edges for. Repeat the parameter; at least one is required and at most 100 are accepted, and either bound is a 400 `invalid_argument` with `param: \\"issue_id\\"`, `reason: \\"invalid_value\\"`.\\n\\nEach value must be an EXACT canonical issue id: there is no fuzzy, prefix or substring resolution on this surface, for the reason `GET /v0/beads/issues/{id}` gives. A value that matches nothing is reported in `missing` rather than refused. An empty value is a 400.\\n\\nRepeats collapse: an id named twice is one entry in `missing` at most once, and its edges appear once." |
| "type" | schema | no | — | "A Link Type reference (§2). Edge types to include. Repeat the parameter. Empty means every type.\\n\\nThe vocabulary is OPEN — a workspace configures its own edge types — so an unrecognized value is not an error here: it simply matches no edge. What IS refused, with a 400 `invalid_argument`, is a value no edge could ever carry: empty, or longer than the column.\\n\\nThe filter narrows EDGES, never the named issues. An issue whose every edge the filter rejects is still not in `missing`." |

#### Advanced

```json-schema
{
  "properties": {
    "issue_id": {
      "type": "array",
      "minItems": 1,
      "maxItems": 100,
      "items": {
        "type": "string"
      }
    },
    "type": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "uri",
        "pattern": "^https?://.+",
        "x-bdp-type-reference": true
      }
    }
  }
}
```

<!-- bdp-schema:end issueDepEdgesArguments bundle=issue-callables -->

<!-- bdp-schema:start issueDepCountArguments bundle=issue-callables -->
### Schema: "issueDepCountArguments"

Value: object

Other fields: not allowed

Required order: ["issue_id", "direction"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/dep/count." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue_id" | schema | yes | — | "The anchors to count around. Repeat the parameter; at least one is required and at most 100 are accepted, and either bound is a 400 `invalid_argument` with `param: \\"issue_id\\"`, `reason: \\"invalid_value\\"`.\\n\\nEach value must be an EXACT canonical issue id, for the reason `GET /v0/beads/dependencies` gives. A value that matches nothing is reported on its own anchor rather than refused. An EMPTY value is a 400: the empty string names nothing a caller can have meant, and reporting it as a missing anchor would put a nameless row in an answer keyed by name.\\n\\nRepeats collapse onto the first mention — a second entry carries no second fact and would only invite a caller summing the result to count the same edges twice." |
| "direction" | schema | yes | — | "Which end of the edge the anchors sit on. `out` counts what each anchor DEPENDS ON — the direction `bd dep list` reads and the number `bd show` prints as the dependency count. `in` counts what depends on it.\\n\\nIT IS REQUIRED, and that is the one deliberate unfriendliness on this request. The two answers are about DIFFERENT EDGE SETS, and a workspace where most issues have edges in only one direction returns the same number for both often enough that a caller who meant the other one would not notice for a long time. An absent or unrecognized value is a 400 `invalid_argument` with `param: \\"direction\\"`, never a count in some default direction.\\n\\nThe vocabulary is CLOSED — unlike `type` below — because it is a property of the edge's shape rather than of a workspace's configuration." |
| "type" | schema | no | — | "A Link Type reference (§2). Edge types to include. Repeat the parameter. Empty means every type.\\n\\n`GET /v0/beads/dependencies`'s `type` exactly: the vocabulary is OPEN, so an unrecognized value is not an error and simply matches no edge, while a value no edge could ever carry — empty, or longer than the column — is a 400 `invalid_argument`.\\n\\nThe filter narrows EDGES, never anchors. An anchor whose every edge it rejects comes back present with a count of 0, which is a different fact from an anchor that is not there." |
| "status" | text | no | — | "Count only edges whose DEPENDENT — the issue at the source end, the one doing the depending — is in this stored status. Empty means every status.\\n\\nIT IS LEGAL ONLY WITH `direction=in`. Sending it beside `direction=out` is a 400 `invalid_argument` with `param: \\"status\\"` and `reason: \\"invalid_value\\"`, rather than a filter that is quietly ignored. The asymmetry is the substrate's and `issueops.EdgeCountRequest.Status` states why: narrowing by status joins the far end of the edge to the row holding its status, and an OUTBOUND edge's far end may be an `external:` reference or an id belonging to another repository — rows this database does not hold — so the filter would silently drop every dangling edge.\\n\\nIt is ONE status, not a comma-separated OR set, and it is NOT validated against the workspace vocabulary: an unrecognized name matches nothing and counts 0 rather than failing, exactly as `GET /v0/beads/issues:count`'s `status` does. A scripted caller counting a status its workspace has since dropped reads 0 and should keep reading 0." |

#### Advanced

```json-schema
{
  "properties": {
    "issue_id": {
      "type": "array",
      "minItems": 1,
      "maxItems": 100,
      "items": {
        "type": "string"
      }
    },
    "direction": {
      "type": "string",
      "enum": [
        "out",
        "in"
      ]
    },
    "type": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "uri",
        "pattern": "^https?://.+",
        "x-bdp-type-reference": true
      }
    }
  }
}
```

<!-- bdp-schema:end issueDepCountArguments bundle=issue-callables -->

<!-- bdp-schema:start issueBlockingAnnotationsArguments bundle=issue-callables -->
### Schema: "issueBlockingAnnotationsArguments"

Value: object

Other fields: not allowed

Required order: ["issue_id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/blocking-annotations." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue_id" | schema | yes | — | "The issues to annotate. Repeat the parameter; at least one is required and at most 100 are accepted, and either bound is a 400 `invalid_argument` with `param: \\"issue_id\\"`, `reason: \\"invalid_value\\"`.\\n\\nEach value must be an EXACT canonical issue id: there is no fuzzy, prefix or substring resolution on this surface, for the reason `GET /v0/beads/issues/{id}` gives. A value that matches nothing gets a bare entry rather than being refused. An empty value is a 400.\\n\\nRepeats collapse: an id named twice is one entry, at the position of its first mention." |
| "is_blocked" | schema | no | — | "`true` adds each item's `is_blocked`: the issue's stored, TRANSITIVE readiness flag — the column the ready set filters on, which a child inherits from a blocked parent and which `waits-for` and `conditional-blocks` gates set — rather than the two-edge-type, direct `blocked_by` summary. It is the batched readiness projection a client cache needs to answer readiness with the server's own predicate. An id that names no row in either plane gets no `is_blocked` member. Absent or `false` answers exactly as before. Behind the `dependencies.blocking.isBlocked` capability token; a server that predates it answers `400` with `param: \\"is_blocked\\"` and `reason: \\"unknown_parameter\\"`." |

#### Advanced

```json-schema
{
  "properties": {
    "issue_id": {
      "type": "array",
      "minItems": 1,
      "maxItems": 100,
      "items": {
        "type": "string"
      }
    },
    "is_blocked": {
      "type": "boolean",
      "default": false
    }
  }
}
```

<!-- bdp-schema:end issueBlockingAnnotationsArguments bundle=issue-callables -->

<!-- bdp-schema:start configListArguments bundle=issue-callables -->
### Schema: "configListArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of config/list." |
| type | "object" |

<!-- bdp-schema:end configListArguments bundle=issue-callables -->

<!-- bdp-schema:start configGetArguments bundle=issue-callables -->
### Schema: "configGetArguments"

Value: object

Other fields: not allowed

Required order: ["key"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of config/get." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | schema | yes | — | "Exact setting key, used verbatim. Keys routinely contain dots (`status.custom`); they occupy one path segment and are percent-decoded once." |

#### Advanced

```json-schema
{
  "properties": {
    "key": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<!-- bdp-schema:end configGetArguments bundle=issue-callables -->

<!-- bdp-schema:start memoryListArguments bundle=issue-callables -->
### Schema: "memoryListArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of memory/list." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "search" | text | no | — | "Narrows the answer to memories that MATCH: a memory matches when the lowercase of its key, or the lowercase of its value, contains the lowercase of this term. Absent or empty means everything, and a term nothing matches is a `200` with an empty `items`.\\n\\nIT IS A SUBSTRING MATCH, NOT THE `issues:query` EXPRESSION LANGUAGE, and it is spelled `search` rather than `q` FOR THAT REASON. On `GET /v0/beads/issues:query`, `q` is a boolean expression over issue fields that is refused when it does not parse; here there is nothing to parse, no vocabulary and no refusal — every string is a legal search term, `status=open` included, and it is matched literally. Two names because two questions: a client that sent this operation the other `q` would otherwise get a literal substring search back instead of an error.\\n\\nThe term reaches the role UNFOLDED. Case folding is the role's, so that this surface and `bd memories` cannot come to disagree about what matching means; a client sends what its user typed." |

<!-- bdp-schema:end memoryListArguments bundle=issue-callables -->

<!-- bdp-schema:start memoryRecallArguments bundle=issue-callables -->
### Schema: "memoryRecallArguments"

Value: object

Other fields: not allowed

Required order: ["key"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of memory/recall." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | schema | yes | — | "Exact memory key, used verbatim. It occupies one path segment and is percent-decoded once. Keys may contain spaces, dots and unicode — the plane stores what `bd remember --key` was given — and a key carrying a CONTROL character is refused here rather than looked up; see the operation description." |

#### Advanced

```json-schema
{
  "properties": {
    "key": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<!-- bdp-schema:end memoryRecallArguments bundle=issue-callables -->

<!-- bdp-schema:start eventsListArguments bundle=issue-callables -->
### Schema: "eventsListArguments"

Value: object

Other fields: not allowed

Required order: ["since"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of events/list." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "since" | schema | yes | — | "Return records with `seq` strictly greater than this value. Pass `0` to read from the beginning of the retained journal.\\n\\nREQUIRED, and deliberately not defaulted to zero. A consumer that omitted its checkpoint by mistake would be served the whole retained window, which reads as a flood of duplicate records rather than as an error. A negative value is a 400 `invalid_argument` for the same reason `bd events tail --since` refuses one: it is almost always arithmetic on an empty cursor, and `seq > -5` would quietly serve everything as though it were a legitimate resume.\\n\\nA value at or above `head` is not an error — it is the caught-up case, a 200 with an empty `records` array." |
| "limit" | schema | no | — | "Maximum number of records to return, from 1 to 10000. A value outside that range — `0` included — is a 400 `invalid_argument`.\\n\\nTHERE IS NO UNLIMITED READ HERE, and `0` does NOT mean unlimited as it does on `GET /v0/beads/issues`. A caller resuming from an old checkpoint would otherwise ask one process to buffer the entire retained window — a hundred thousand records under the shipped `events-journal-retain-rows` floor — and encode it into a single response. The ceiling is unconditional and does not depend on the bind mode.\\n\\nThe default of 1000 is deliberately much larger than the issue listings' 50: a journal consumer is a machine draining a backlog in order rather than a person reading a page, and the number that matters to it is round trips to catch up.\\n\\nA FULL PAGE DOES NOT MEAN THERE IS MORE, and a short one does not mean there is not. Compare the last record's `seq` against `head`; that is the only correct test, and it is why this envelope carries no `has_more`." |

#### Advanced

```json-schema
{
  "properties": {
    "since": {
      "type": "integer",
      "format": "int64",
      "minimum": 0
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10000,
      "default": 1000
    }
  }
}
```

<!-- bdp-schema:end eventsListArguments bundle=issue-callables -->

<!-- bdp-schema:start eventsListError bundle=issue-callables -->
### Schema: "eventsListError"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The error values events/list can return: v0's Problem, discriminated by code." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/Problem"
    },
    {
      "properties": {
        "code": {
          "enum": [
            "events_journal_disabled",
            "events_journal_truncated"
          ]
        }
      }
    }
  ]
}
```

<!-- bdp-schema:end eventsListError bundle=issue-callables -->

<!-- bdp-schema:start issueCreateArguments bundle=issue-callables -->
### Schema: "issueCreateArguments"

Value: object

Other fields: not allowed

Required order: ["title"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/create." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | schema | no | — | "An explicit id for the new row, CREATE-ONLY: an id that already names a stored row is a `409` `already_exists` and nothing is written — never an adoption and never an overwrite. It is checked against the workspace's configured issue prefix unless `force_id_prefix` is set. Absent is the ordinary case and the server mints one." |
| "title" | schema | yes | — | "The issue's title. Must not be blank after trimming." |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "acceptance_criteria" | text | no | — | — |
| "notes" | text | no | — | — |
| "issue_type" | schema | no | — | "Omitted, this Callable uses `\\"https://github.com/gastownhall/bdp/types/issue/task\\"`. A Bead Type reference (§2). Issue type. Spelled `issue_type` rather than `type`, matching the member `Issue` carries, and validated against the built-ins plus the workspace's configured custom types by the ROLE — this server cannot read that vocabulary without a transaction, so it checks only what this schema declares and an unknown one arrives as a `400`." |
| "status" | schema | no | — | "The status the issue is created in, from this workspace's own configured vocabulary. Absent means the workspace's own default, which is `open` today — unlike `issue_type`, the role fills this one in before it validates." |
| "priority" | schema | no | — | "0 is P0/critical. Absent means the create default, P2 (`2`), on a server advertising `issues.create.defaultPriority`; such a server never reads an absent member as `0`. An older server stores P0 for an absent member, so a client that does not see the token sends `2` explicitly." |
| "assignee" | schema | no | — | — |
| "owner" | schema | no | — | "The human owner, which is a different member from `assignee`: the assignee is who is working it now, the owner is who it is attributed to." |
| "labels" | schema | no | — | "The complete label set the issue is created with. Authoritative, not a patch — a create has nothing to add to. `inherit_labels_from_parent` adds the parent's labels on top of it." |
| "estimated_minutes" | integer | no | — | "An estimate in minutes. Absent leaves it unset. NOT nullable, unlike `IssuePatchBody.estimated_minutes`: a create has nothing to clear, so `null` here would be a second spelling of omission and is a `400`." |
| "external_ref" | schema | no | — | "e.g. `gh-9`. Not nullable, for `estimated_minutes`' reason." |
| "due_at" | schema | no | — | "RFC 3339. Not nullable, for `estimated_minutes`' reason." |
| "defer_until" | schema | no | — | "RFC 3339. The issue is hidden from ready work until then. Not nullable, for `estimated_minutes`' reason." |
| "sender" | schema | no | — | "Who sent this, for the message-shaped rows an orchestrator creates. Stored verbatim and interpreted by nothing on this surface." |
| "metadata" | ref "#/$defs/MetadataValue" | no | — | — |
| "ephemeral" | schema | no | — | "Creates the issue on the EPHEMERAL plane rather than the durable one, exactly as it does for `POST /v0/beads/issues:batchApply`. Mutually exclusive with `no_history`." |
| "no_history" | schema | no | — | "Creates the issue on the ephemeral plane WITHOUT history, and without the garbage collection an ordinary ephemeral row is eligible for. Mutually exclusive with `ephemeral`." |
| "parent_id" | schema | no | — | "Creates a typed `parent-child` edge from the new issue to this target. It must not duplicate an edge `dependencies` already spells; naming the same pair twice with two types is a `400`." |
| "inherit_labels_from_parent" | schema | no | — | "Copies the parent's labels onto the new issue at creation, on top of `labels`. It has no effect without `parent_id`.\\n\\nThe DEFAULT IS FALSE and diverges from `bd create --parent`, whose default is to inherit. A wire caller sends what it means: this operation has no `--no-inherit-labels` to turn off, and a create that silently acquired labels the request never named would be a set the caller has to read back to learn." |
| "dependencies" | schema | no | — | "The complete set of explicit edges created with the issue. Authoritative, not a patch. Every edge is written in the same transaction as the row, so an edge this request cannot write means no issue either.\\n\\nA TARGET NEED NOT BE A ROW THIS DATABASE HOLDS: an `external:` reference and an id belonging to another repository are legitimate targets, so only an absence this database can SEE is refused — `ApplyDepAddItem`'s rule, unchanged." |
| "await_type" | schema | no | — | "The gate's await condition type (`gh:run`, `gh:pr`, `timer`, `human`, `bead`, or a formula-defined type). Free-form: there is no vocabulary, and any issue type may carry it, as a local create allows. At most 32 characters, the stored column's width; a longer value is a `400` naming this member. Requires the behavior token `issues.create.gates`." |
| "await_id" | schema | no | — | "The gate's condition identifier (a run id, a PR number, a `bead:<id>`). Opaque here; at most 255 characters, the stored column's width, and a longer value is a `400` naming this member. Requires the behavior token `issues.create.gates`." |
| "timeout" | schema | no | — | "The gate's timeout in NANOSECONDS, the encoding `Issue.timeout` reads back. A negative value is a `400` naming this member. Requires the behavior token `issues.create.gates`." |
| "waiters" | array of (text) | no | — | "The addresses woken when the gate clears, stored as sent: duplicates are kept and nothing is trimmed, as a local create stores them. The list's JSON encoding must fit the stored TEXT column (65535 bytes); a larger one is a `400` naming this member. Requires the behavior token `issues.create.gates`." |
| "waits_for" | ref "#/$defs/CreateIssueWaitsFor" | no | — | — |
| "force_id_prefix" | schema | no | — | "Permits an explicit `id` outside the workspace's configured issue prefix. It bypasses ONLY that check: it is not a force on the create-only guard, so an occupied id is still a `409`." |

#### Advanced

```json-schema
{
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "issue_type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "default": "https://github.com/gastownhall/bdp/types/issue/task",
      "x-bdp-type-reference": true
    },
    "status": {
      "type": "string",
      "maxLength": 255
    },
    "priority": {
      "type": "integer",
      "minimum": 0,
      "maximum": 4
    },
    "assignee": {
      "type": "string",
      "maxLength": 255
    },
    "owner": {
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
    "external_ref": {
      "type": "string",
      "maxLength": 255
    },
    "due_at": {
      "type": "string",
      "format": "date-time"
    },
    "defer_until": {
      "type": "string",
      "format": "date-time"
    },
    "sender": {
      "type": "string",
      "maxLength": 255
    },
    "ephemeral": {
      "type": "boolean",
      "default": false
    },
    "no_history": {
      "type": "boolean",
      "default": false
    },
    "parent_id": {
      "type": "string",
      "maxLength": 255
    },
    "inherit_labels_from_parent": {
      "type": "boolean",
      "default": false
    },
    "dependencies": {
      "type": "array",
      "maxItems": 100,
      "items": {
        "$ref": "#/$defs/CreateIssueDependency"
      }
    },
    "await_type": {
      "type": "string",
      "maxLength": 32
    },
    "await_id": {
      "type": "string",
      "maxLength": 255
    },
    "timeout": {
      "type": "integer",
      "format": "int64",
      "minimum": 0
    },
    "force_id_prefix": {
      "type": "boolean",
      "default": false
    }
  }
}
```

<!-- bdp-schema:end issueCreateArguments bundle=issue-callables -->

<!-- bdp-schema:start issueCreateError bundle=issue-callables -->
### Schema: "issueCreateError"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The error values issue/create can return: v0's Problem, discriminated by code." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/Problem"
    },
    {
      "properties": {
        "code": {
          "enum": [
            "dependency_cycle"
          ]
        }
      }
    }
  ]
}
```

<!-- bdp-schema:end issueCreateError bundle=issue-callables -->

<!-- bdp-schema:start issueUpdateArguments bundle=issue-callables -->
### Schema: "issueUpdateArguments"

Value: object

Other fields: not allowed

Required order: ["id", "patch"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/update." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "Exact canonical issue id. No fuzzy, prefix or substring resolution." |
| "patch" | ref "#/$defs/IssuePatchBody" | yes | — | — |
| "claim" | schema | no | — | "Claims the issue for `actor` in the same transaction as `patch`: `bd update <id> --claim`, served by the same role. The claim sets `assignee` to `actor` and `status` to `in_progress`, then the patch applies, so a `patch.assignee` or `patch.status` overrides the claim's value. Eligibility is `{id}:claim`'s: a claimable status, and unassigned, already held by `actor`, or held by a configured claim pool. Held by `actor` and `in_progress` already is an idempotent success. A refusal is `409 already_claimed` or `409 not_claimable` naming `claim`, and writes nothing — the patch included. With `claim: true` the `patch` may be empty. It must not be combined with `expected_assignee`, `expected_status` or `force_assignee_transfer`; a request that does is a `400` naming `claim`. The id resolves on both planes, so a wisp is claimable here (where `{id}:claim` answers it `404`); a wisp claim takes no lease. Advertised by the behavior token `issues.update.claim`." |
| "expected_version" | text | no | — | "Requires the row's revision to equal this value before the patch. A miss refuses the WHOLE request with `409 precondition_failed` and writes nothing — `ApplyUpdateItem.expected_version`'s contract, on the operation that patches one row.\\n\\nThe token is the `revision` this operation's own response carries, and the same one `GET /v0/beads/issues/{id}` publishes — which is where a first guarded write seeds itself, rather than from an unguarded one or from `POST /v0/beads/issues:batchApply`'s `ApplyItemResult.revision`. Compose the next expectation from the value the write ANSWERED with, never from one the client composed itself: the token is OPAQUE and compared for equality alone, so it has no predecessor a client can compute.\\n\\nIT IS A STRING, and it must be the `revision` string a response carried, verbatim. A JSON number — or any other type — is a `400` naming this member. The token spans the FULL 64-bit range, so a number would be rounded past 2^53 by an IEEE-754-double parser and the guard would miss a row nothing else touched; a string round-trips exactly in every consumer." |
| "expected_status" | schema | no | — | "Requires the issue's status to equal this value before the patch. A miss refuses the whole request with `409 precondition_failed`.\\n\\nUnlike `expected_version` this one is readable: `Issue.status` is on every read of this surface, so a caller can guard a status transition without any token at all." |
| "expected_assignee" | schema | no | — | "Requires the issue's assignee to equal this value before the patch. A match AUTHORIZES the requested `patch.assignee` transfer: this compare-and-set replaces the ordinary anti-steal fence, so it must not be combined with `force_assignee_transfer`. A miss refuses the whole request with `409 precondition_failed`." |
| "force_close_policy" | schema | no | — | "Bypasses ONLY close policy — the open-children refusal and the live blocker refusal — for a `patch.status` that crosses into the workspace's done category. It has no effect without such a status change, and it never bypasses validation, the preconditions above, or the assignee fence." |
| "force_assignee_transfer" | schema | no | — | "Bypasses ONLY a genuine transfer away from a live foreign in-progress owner. Reasserting the exact current assignee is idempotent and needs no force. It requires `patch.assignee` — a request setting it without one is a `400` — and it must be false when `expected_assignee` is sent." |
| "force_notes_overwrite" | schema | no | — | "Bypasses ONLY the refusal on a `patch.notes` that would replace existing non-empty notes with different non-empty content (an explicit clear is not fenced). It requires `patch.notes` — a request setting it without one is a `400` — and, UNLIKE `force_assignee_transfer`, it has no `expected_assignee` exemption: there is no compare-and-set that authorizes a notes overwrite, so combining the two is legal and each answers its own question." |
| "allow_template" | schema | no | — | "The caller edits a template deliberately, so the template read-only refusal (`409 template_read_only`) stands down for this request. `bd label` and `bd set-state` send it: they have always written to templates. It bypasses nothing else, and has no effect on an issue that is not a template. Advertised by the `issues.update.allowTemplate` capability token; a server that predates the member refuses it as an unknown parameter, and such a server never applies the template guard either." |

#### Advanced

```json-schema
{
  "properties": {
    "claim": {
      "type": "boolean",
      "default": false
    },
    "expected_status": {
      "type": "string",
      "maxLength": 255
    },
    "expected_assignee": {
      "type": "string",
      "maxLength": 255
    },
    "force_close_policy": {
      "type": "boolean",
      "default": false
    },
    "force_assignee_transfer": {
      "type": "boolean",
      "default": false
    },
    "force_notes_overwrite": {
      "type": "boolean",
      "default": false
    },
    "allow_template": {
      "type": "boolean",
      "default": false
    }
  }
}
```

<!-- bdp-schema:end issueUpdateArguments bundle=issue-callables -->

<!-- bdp-schema:start issueUpdateError bundle=issue-callables -->
### Schema: "issueUpdateError"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The error values issue/update can return: v0's Problem, discriminated by code." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/Problem"
    },
    {
      "properties": {
        "code": {
          "enum": [
            "already_claimed",
            "dependency_cycle",
            "dependency_exists",
            "not_claimable",
            "not_closable",
            "notes_overwrite_refused",
            "precondition_failed",
            "template_read_only"
          ]
        }
      }
    }
  ]
}
```

<!-- bdp-schema:end issueUpdateError bundle=issue-callables -->

<!-- bdp-schema:start issueCommentArguments bundle=issue-callables -->
### Schema: "issueCommentArguments"

Value: object

Other fields: not allowed

Required order: ["id", "text"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/comment." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "Exact canonical issue id. No fuzzy, prefix or substring resolution." |
| "text" | text | yes | — | "The comment body, stored VERBATIM: newlines, surrounding space and unicode all survive, and nothing trims the value that lands in the row.\\n\\nNO LENGTH BOUND AND NO CHARACTER RULE, unlike `author` beside it, and both absences are the column: this one is `LONGTEXT` rather than a 255-character field, and a comment that is a stack trace or a diff is an ordinary comment. The only cap is the 1 MiB every body on this surface shares.\\n\\nBOTH PLANES AGREE ABOUT THAT, which is worth stating because they did not. `wisp_comments.text` was left `TEXT` — 65535 bytes — when the durable column was widened, so a comment past that limit wrote fine against an issue and failed against a wisp, on an operation that resolves its anchor across both planes deliberately. A caller therefore could not know which side of the bound it was on until the write failed. The ephemeral column is widened to match, so this member's bound is one number rather than two.\\n\\nBlank after trimming is a `400` — a comment of nothing but whitespace carries no information and is almost always a shell quoting accident — and blankness is judged on a TRIMMED COPY while the stored value is untrimmed, so a comment that merely begins with a newline is a comment." |

<!-- bdp-schema:end issueCommentArguments bundle=issue-callables -->

<!-- bdp-schema:start issueClaimArguments bundle=issue-callables -->
### Schema: "issueClaimArguments"

Value: object

Other fields: not allowed

Required order: ["id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/claim." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "Exact canonical issue id. No fuzzy, prefix or substring resolution." |

<!-- bdp-schema:end issueClaimArguments bundle=issue-callables -->

<!-- bdp-schema:start issueClaimError bundle=issue-callables -->
### Schema: "issueClaimError"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The error values issue/claim can return: v0's Problem, discriminated by code." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/Problem"
    },
    {
      "properties": {
        "code": {
          "enum": [
            "already_claimed",
            "not_claimable"
          ]
        }
      }
    }
  ]
}
```

<!-- bdp-schema:end issueClaimError bundle=issue-callables -->

<!-- bdp-schema:start issueUnclaimArguments bundle=issue-callables -->
### Schema: "issueUnclaimArguments"

Value: object

Other fields: not allowed

Required order: ["id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/unclaim." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "Exact canonical issue id. No fuzzy, prefix or substring resolution." |
| "expected_assignee" | text | no | — | "Compare-and-set on the holder: the release proceeds only while the issue is still assigned to this actor, and otherwise refuses with `409` / `precondition_failed` naming this value, having written nothing.\\n\\nA MATCH REPLACES THE OWNERSHIP FENCE, so `actor` need not be the holder. Sending it beside `force` is a 400: the two are answers to the same question and they disagree.\\n\\nTHE COMPARISON IS SEPARATOR-INSENSITIVE AND NOTHING ELSE. A run of `.`, `_` or `-` matches any other such run, so `agent-a`, `agent_a` and `agent.a` are one holder — that is deliberate, so a caller naming the holder under a different layer's spelling is a match rather than a mismatch. THE ONE EXCEPTION IS AN EXACT `--` RUN: that is gascity's session-name encoding of a rig-qualified agent's `/`, so it decodes to `/` instead of collapsing. `a--b` matches `a/b`, and no longer matches `a__b` or `a-b`. Those name different identities — `a--b` is the agent `b` on rig `a`, `a__b` is the dotted alias `a.b` — so treating them as one holder was a widening, and removing it is the point of the exception. Longer or mixed runs, `__` included, still collapse. NOTHING ELSE IS FORGIVEN: the value is not trimmed and not case-folded, so `\\" agent-a\\"` and `Agent-a` are both refusals. The server trims only far enough to tell a blank expectation from a real one and never sends the trimmed form on, so a caller that pads its expectation loses EVERY time rather than intermittently. Compose it from a holder a read gave you.\\n\\nTHE EMPTY STRING IS A 400, and this is the one place this member disagrees with `UpdateIssueRequest.expected_assignee`, where an empty string is a real guard meaning \\"expected unassigned\\". Here \\"release a row nobody holds\\" describes no release at all; a caller that wants to assert a row is unheld is asking a READER a question, not asking this operation to do nothing. Absent, and only absent, selects the unconditional path.\\n\\nIT IS NOT LENGTH- OR PATTERN-BOUNDED the way `actor` is, and the asymmetry is deliberate: this value is COMPARED and never stored, so a value no assignee column could hold simply cannot match, and refusing it at the edge would be a refusal the role does not have." |
| "force" | schema | no | — | "Bypass the ownership fence, so an actor that is not the holder may release the claim. It is the escape hatch `bd unclaim --force` spells, for an abandoned claim whose holder crashed.\\n\\nIT BYPASSES THE FENCE AND NOTHING ELSE. It does not make an unheld row releasable, it does not make a closed one releasable, and it never bypasses a precondition — sending it beside `expected_assignee` is a 400 rather than a silent win for either." |

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

<!-- bdp-schema:end issueUnclaimArguments bundle=issue-callables -->

<!-- bdp-schema:start issueUnclaimError bundle=issue-callables -->
### Schema: "issueUnclaimError"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The error values issue/unclaim can return: v0's Problem, discriminated by code." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/Problem"
    },
    {
      "properties": {
        "code": {
          "enum": [
            "already_claimed",
            "not_releasable",
            "precondition_failed"
          ]
        }
      }
    }
  ]
}
```

<!-- bdp-schema:end issueUnclaimError bundle=issue-callables -->

<!-- bdp-schema:start issueHeartbeatArguments bundle=issue-callables -->
### Schema: "issueHeartbeatArguments"

Value: object

Other fields: not allowed

Required order: ["id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/heartbeat." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "Exact canonical issue id. No fuzzy, prefix or substring resolution." |

<!-- bdp-schema:end issueHeartbeatArguments bundle=issue-callables -->

<!-- bdp-schema:start issueHeartbeatError bundle=issue-callables -->
### Schema: "issueHeartbeatError"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The error values issue/heartbeat can return: v0's Problem, discriminated by code." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/Problem"
    },
    {
      "properties": {
        "code": {
          "enum": [
            "already_claimed",
            "lease_not_held"
          ]
        }
      }
    }
  ]
}
```

<!-- bdp-schema:end issueHeartbeatError bundle=issue-callables -->

<!-- bdp-schema:start issueCloseArguments bundle=issue-callables -->
### Schema: "issueCloseArguments"

Value: object

Other fields: not allowed

Required order: ["id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/close." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "Exact canonical issue id. No fuzzy, prefix or substring resolution." |
| "reason" | schema | no | — | "Omitted, this Callable uses `\\"Closed\\"`. Why the issue is closed. Stored on the issue and read back as `close_reason`. THE FIRST CLOSE WINS: an idempotent re-close writes neither this nor `session`, so a replayed close cannot rewrite the record of why the work ended. Refused for control characters, and bounded by what the column holds rather than by the number above." |
| "session" | schema | no | — | "The working session that closed the issue, stored and read back as `closed_by_session`, under the same first-close-wins rule and the same bounds as `reason`." |
| "force" | schema | no | — | "Bypass close policy — the open-children refusal and the live-blocker refusal — and the pin and the assignee guard, and nothing else: never the template guard (see \\"Close guards\\" on `POST /v0/beads/issues/{id}:close`). The refusals are the ROLE's, so this endpoint cannot skip a guard by forgetting one exists. A forced close still reports `open_children`.\\n\\nIT BYPASSES POLICY, NEVER A PRECONDITION. `expected_version` is still checked with it set, for the reason `issueops.CloseRequest.Force` gives: a caller saying \\"close it anyway\\" has said nothing about whether the row is still the one it read." |
| "expected_version" | text | no | — | "Requires the row's revision to equal this value BEFORE the close. A miss refuses the whole request with `409 precondition_failed` and writes nothing — `UpdateIssueRequest.expected_version`'s contract, on the operation that closes one row.\\n\\nIT IS CHECKED BEFORE THE IDEMPOTENT RE-CLOSE, which is the one place this guard differs from the update's. A re-close of a row somebody else has moved since the caller read it is a `409` and not the 200-with-`already_closed` the same body earns without a guard: a replay whose premise has expired is a refusal the caller wants to see, and it is the only way `already_closed` can be trusted as \\"nothing has happened here since\\".\\n\\nThe token is the `revision` this operation's own response carries. Compose the next expectation from the value a write ANSWERED with, never from one the client composed itself: the token is OPAQUE and compared for equality alone, so it has no predecessor a client can compute. A first guarded close seeds itself from `GET /v0/beads/issues/{id}`'s `revision` — the read that sources a guard — or, for a chain already mid-flight, from an unguarded lifecycle write or `POST /v0/beads/issues:batchApply`'s `ApplyItemResult.revision`.\\n\\nIT IS A STRING, and it must be the `revision` string a response carried, verbatim. A JSON number — or any other type — is a `400` naming this member. The token spans the FULL 64-bit range, so a number would be rounded past 2^53 by an IEEE-754-double parser and the guard would miss a row nothing else touched; a string round-trips exactly in every consumer." |
| "auto_close_molecule" | schema | no | — | "Behind the `issues.close.autoCloseMolecule` behavior token: an older server answers `unknown_parameter` for this name, and a client checks the token before sending it.\\n\\nClose the issue's molecule root IN THE SAME TRANSACTION when this close completed it: the root is an auto-closing molecule root (a `molecule`-typed or ephemeral root, or a template-labeled epic), it is open, and every step under it is now closed. The root close is unforced, guarded on the root revision read inside that transaction, and records `all steps complete` and this request's `session`. It runs for an idempotent re-close too, so replaying the close of a molecule's last step heals a root left open.\\n\\nOPT-IN, because an orchestrator may run its own molecule lifecycle. A root that its close policy refuses (a live blocker) or a close guard refuses (a template, a pinned root, a root assigned to another actor) stays open, is named in `molecule_auto_close_refusal`, and never fails this close. Any other failure of the root close, such as a storage error, fails this close with it." |

#### Advanced

```json-schema
{
  "properties": {
    "reason": {
      "type": "string",
      "maxLength": 255,
      "default": "Closed"
    },
    "session": {
      "type": "string",
      "maxLength": 255
    },
    "force": {
      "type": "boolean",
      "default": false
    },
    "auto_close_molecule": {
      "type": "boolean",
      "default": false
    }
  }
}
```

<!-- bdp-schema:end issueCloseArguments bundle=issue-callables -->

<!-- bdp-schema:start issueCloseError bundle=issue-callables -->
### Schema: "issueCloseError"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The error values issue/close can return: v0's Problem, discriminated by code." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/Problem"
    },
    {
      "properties": {
        "code": {
          "enum": [
            "issue_pinned",
            "not_assignee",
            "not_closable",
            "template_read_only"
          ]
        }
      }
    }
  ]
}
```

<!-- bdp-schema:end issueCloseError bundle=issue-callables -->

<!-- bdp-schema:start issueAdvanceArguments bundle=issue-callables -->
### Schema: "issueAdvanceArguments"

Value: object

Other fields: not allowed

Required order: ["id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/advance." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "Exact canonical issue id. No fuzzy, prefix or substring resolution." |
| "auto_claim" | schema | no | — | "Claim the next ready step for `actor`. Without it the operation writes nothing and only names the step." |

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

<!-- bdp-schema:end issueAdvanceArguments bundle=issue-callables -->

<!-- bdp-schema:start issueReopenArguments bundle=issue-callables -->
### Schema: "issueReopenArguments"

Value: object

Other fields: not allowed

Required order: ["id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/reopen." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "Exact canonical issue id. No fuzzy, prefix or substring resolution." |
| "reason" | schema | no | — | "Why the issue is being reopened. Recorded on the `reopened` EVENT this move records — not on a field of the issue, and not carried in the response, so a caller that wants it back reads the issue's events. Refused for control characters, and bounded by what the column holds rather than by the number above." |
| "expected_version" | text | no | — | "Requires the row's revision to equal this value BEFORE the reopen. A miss refuses the whole request with `409 precondition_failed` and writes nothing — `CloseIssueRequest.expected_version`'s contract, on the close's mirror.\\n\\nIT IS CHECKED BEFORE THE NON-DONE NO-OP, the mirror of the close's check-before-the-idempotent-re-close, and for the same reason: a reopen of a row somebody else has moved is a `409` rather than the 200-with-`already_open` the same body earns unguarded, which is what lets `already_open` be read as \\"nothing has happened here since\\".\\n\\nThe token is the `revision` this operation's own response carries; compose the next expectation from a value a write ANSWERED with and never from one the client computed.\\n\\nIT IS A STRING, and it must be the `revision` string a response carried, verbatim. A JSON number — or any other type — is a `400` naming this member. The token spans the FULL 64-bit range, so a number would be rounded past 2^53 by an IEEE-754-double parser and the guard would miss a row nothing else touched; a string round-trips exactly in every consumer." |

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

<!-- bdp-schema:end issueReopenArguments bundle=issue-callables -->

<!-- bdp-schema:start issueMetadataCompareAndSetArguments bundle=issue-callables -->
### Schema: "issueMetadataCompareAndSetArguments"

Value: object

Other fields: not allowed

Required order: ["id", "key"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/metadata/compare-and-set." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "Exact canonical issue id. No fuzzy, prefix or substring resolution." |
| "key" | schema | yes | — | "The single metadata key to read and write. It must match the workspace's metadata-key syntax — a letter or underscore, then letters, digits, underscores, dots and slashes — so a key the query layer could not later spell is refused rather than written.\\n\\nONE KEY, NOT A PATH: a dotted key like `gc.lease` names a top-level key spelled with a dot, not a nested field. The metadata object's nesting is VALUE structure, and this operation swaps whole values." |
| "expected" | ref "#/$defs/MetadataValue" | no | — | — |
| "value" | ref "#/$defs/MetadataValue" | no | — | — |

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

<!-- bdp-schema:end issueMetadataCompareAndSetArguments bundle=issue-callables -->

<!-- bdp-schema:start issuePurgeArguments bundle=issue-callables -->
### Schema: "issuePurgeArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/purge." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "tier" | schema | no | — | "Omitted, this Callable uses `\\"ephemeral\\"`. Which plane to clear. `ephemeral` is the wisp tier (`bd purge`) and `durable` is the issue tier (`bd prune`). The two are DISJOINT: a sweep of one can never touch a bead of the other. `wisps-plane` is a THIRD, wider tier: it clears the whole wisps table (ephemeral beads) AND any durable bead with no history row, in one pass. Behind the `issues.sweep.wispsPlane` behavior token: an older server answers `invalid_value` for this member, since it predates the token and knows only the first two values." |
| "closed_before" | schema | no | — | "Keep only beads closed STRICTLY BEFORE this instant (RFC 3339). A bead closed exactly at it is kept, which is the half-open interval every other time bound on this surface uses. `bd prune --older-than 30d` resolves the duration itself and sends the resulting instant." |
| "pattern" | text | no | — | "Keep only beads whose id matches this shell glob (`*`, `?`, `[...]`, `\\\\` escapes; `*` also crosses `-` and `.`, since an id is not a path). Absent matches every bead in the tier. A MALFORMED glob is a `400`, never a pattern that matches nothing." |
| "protect_referenced" | schema | no | — | "Omitted, this Callable uses `false`. Skip candidates whose id is CITED — as a literal, at word boundaries — in the description, notes or comments of any bead that is not done, so a decision trail a live bead still points at is not deleted out from under it.\\n\\nIt DEFAULTS ON here, unlike the library default, and that is deliberate. This is the only destructive operation on the surface, and the bearer a deployment may configure is not a per-caller right: one shared token admits a client to everything published here, so being authenticated says nothing about whether this particular deletion was meant. A caller that omits the member must therefore not get weaker protection than the operator typing `bd prune`, which protects unless `--ignore-references`. The inverse — opt OUT locally, opt IN remotely — is the shape that lets a stray request delete a decision trail nothing brings back.\\n\\nIt costs a full scan of the not-done set and its comments. Sending `protect_referenced: false` buys the cheaper sweep, and asking for it explicitly is the point: that is the request that should be the deliberate one." |
| "dry_run" | schema | no | — | "Omitted, this Callable uses `true`. Report what the sweep WOULD do and delete nothing. The counts, the skips and the refusals are the same ones the real sweep would produce, computed against the same snapshot — and nothing is recorded in history either." |
| "protect_live_dependents" | schema | no | — | "Omitted, this Callable uses `true`. Skip a closed candidate that a LIVE (not-done) bead depends on through a parent/child, tracks, or blocks edge, so closing a dependent's dependency does not erase the row a live bead still points at. Protection is TRANSITIVE and crosses the ephemeral/durable plane boundary. Behind the `issues.sweep.liveDependents` behavior token: an older server answers `unknown_parameter` for this name." |
| "limit" | schema | no | — | "Cap how many beads this sweep deletes, OLDEST-CLOSED-FIRST. Absent or zero means unbounded. A negative value is a `400` invalid_argument, the same as the role's own ErrValidation. Behind the `issues.sweep.limit` behavior token: an older server answers `unknown_parameter` for this name." |
| "retain_ids" | schema | no | — | "RETIRE every id this sweep deletes. In the same transaction as the delete, the server writes one permanent tombstone per deleted bead — its id and its `closed_at`, nothing else — and from then on no write path creates a bead with that id again: a create naming it is refused with `410` `idempotency_expired` (on `POST /v0/beads/issues` and on an `issues:batchApply` create item), an import skips the row and reports it, and id generation never produces it. It is what lets a caller sweep beads whose ids are idempotency keys without a late retry re-creating the bead the first attempt created.\\n\\nOpt-in: absent or `false` sweeps exactly as before and leaves the swept ids reusable. Tombstones are permanent; nothing on this surface removes one. A tombstone is exactly as durable as the bead it replaces — a bead on the ephemeral plane leaves a clone-local one. `dry_run` writes none.\\n\\nBehind the `issues.sweep.retainIds` behavior token: an older server answers `unknown_parameter` for this name, and a client that needs the guarantee must not sweep at all without the token." |

#### Advanced

```json-schema
{
  "properties": {
    "tier": {
      "type": "string",
      "enum": [
        "ephemeral",
        "durable",
        "wisps-plane"
      ],
      "default": "ephemeral"
    },
    "closed_before": {
      "type": "string",
      "format": "date-time"
    },
    "protect_referenced": {
      "type": "boolean",
      "default": false
    },
    "dry_run": {
      "type": "boolean",
      "default": true
    },
    "protect_live_dependents": {
      "type": "boolean",
      "default": true
    },
    "limit": {
      "type": "integer",
      "format": "int64"
    },
    "retain_ids": {
      "type": "boolean",
      "default": false
    }
  }
}
```

<!-- bdp-schema:end issuePurgeArguments bundle=issue-callables -->

<!-- bdp-schema:start issuePruneArguments bundle=issue-callables -->
### Schema: "issuePruneArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/prune." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "tier" | schema | no | — | "Omitted, this Callable uses `\\"durable\\"`. Which plane to clear. `ephemeral` is the wisp tier (`bd purge`) and `durable` is the issue tier (`bd prune`). The two are DISJOINT: a sweep of one can never touch a bead of the other. `wisps-plane` is a THIRD, wider tier: it clears the whole wisps table (ephemeral beads) AND any durable bead with no history row, in one pass. Behind the `issues.sweep.wispsPlane` behavior token: an older server answers `invalid_value` for this member, since it predates the token and knows only the first two values." |
| "closed_before" | schema | no | — | "Keep only beads closed STRICTLY BEFORE this instant (RFC 3339). A bead closed exactly at it is kept, which is the half-open interval every other time bound on this surface uses. `bd prune --older-than 30d` resolves the duration itself and sends the resulting instant." |
| "pattern" | text | no | — | "Keep only beads whose id matches this shell glob (`*`, `?`, `[...]`, `\\\\` escapes; `*` also crosses `-` and `.`, since an id is not a path). Absent matches every bead in the tier. A MALFORMED glob is a `400`, never a pattern that matches nothing." |
| "protect_referenced" | schema | no | — | "Omitted, this Callable uses `true`. Skip candidates whose id is CITED — as a literal, at word boundaries — in the description, notes or comments of any bead that is not done, so a decision trail a live bead still points at is not deleted out from under it.\\n\\nIt DEFAULTS ON here, unlike the library default, and that is deliberate. This is the only destructive operation on the surface, and the bearer a deployment may configure is not a per-caller right: one shared token admits a client to everything published here, so being authenticated says nothing about whether this particular deletion was meant. A caller that omits the member must therefore not get weaker protection than the operator typing `bd prune`, which protects unless `--ignore-references`. The inverse — opt OUT locally, opt IN remotely — is the shape that lets a stray request delete a decision trail nothing brings back.\\n\\nIt costs a full scan of the not-done set and its comments. Sending `protect_referenced: false` buys the cheaper sweep, and asking for it explicitly is the point: that is the request that should be the deliberate one." |
| "dry_run" | schema | no | — | "Omitted, this Callable uses `true`. Report what the sweep WOULD do and delete nothing. The counts, the skips and the refusals are the same ones the real sweep would produce, computed against the same snapshot — and nothing is recorded in history either." |
| "protect_live_dependents" | schema | no | — | "Omitted, this Callable uses `false`. Skip a closed candidate that a LIVE (not-done) bead depends on through a parent/child, tracks, or blocks edge, so closing a dependent's dependency does not erase the row a live bead still points at. Protection is TRANSITIVE and crosses the ephemeral/durable plane boundary. Behind the `issues.sweep.liveDependents` behavior token: an older server answers `unknown_parameter` for this name." |
| "limit" | schema | no | — | "Cap how many beads this sweep deletes, OLDEST-CLOSED-FIRST. Absent or zero means unbounded. A negative value is a `400` invalid_argument, the same as the role's own ErrValidation. Behind the `issues.sweep.limit` behavior token: an older server answers `unknown_parameter` for this name." |
| "retain_ids" | schema | no | — | "RETIRE every id this sweep deletes. In the same transaction as the delete, the server writes one permanent tombstone per deleted bead — its id and its `closed_at`, nothing else — and from then on no write path creates a bead with that id again: a create naming it is refused with `410` `idempotency_expired` (on `POST /v0/beads/issues` and on an `issues:batchApply` create item), an import skips the row and reports it, and id generation never produces it. It is what lets a caller sweep beads whose ids are idempotency keys without a late retry re-creating the bead the first attempt created.\\n\\nOpt-in: absent or `false` sweeps exactly as before and leaves the swept ids reusable. Tombstones are permanent; nothing on this surface removes one. A tombstone is exactly as durable as the bead it replaces — a bead on the ephemeral plane leaves a clone-local one. `dry_run` writes none.\\n\\nBehind the `issues.sweep.retainIds` behavior token: an older server answers `unknown_parameter` for this name, and a client that needs the guarantee must not sweep at all without the token." |

#### Advanced

```json-schema
{
  "properties": {
    "tier": {
      "type": "string",
      "enum": [
        "ephemeral",
        "durable",
        "wisps-plane"
      ],
      "default": "durable"
    },
    "closed_before": {
      "type": "string",
      "format": "date-time"
    },
    "protect_referenced": {
      "type": "boolean",
      "default": true
    },
    "dry_run": {
      "type": "boolean",
      "default": true
    },
    "protect_live_dependents": {
      "type": "boolean",
      "default": false
    },
    "limit": {
      "type": "integer",
      "format": "int64"
    },
    "retain_ids": {
      "type": "boolean",
      "default": false
    }
  }
}
```

<!-- bdp-schema:end issuePruneArguments bundle=issue-callables -->

<!-- bdp-schema:start issueDeleteArguments bundle=issue-callables -->
### Schema: "issueDeleteArguments"

Value: object

Other fields: not allowed

Required order: ["ids"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/delete." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "ids" | schema | yes | — | "The beads to delete, exact ids, in either plane. DUPLICATES COLLAPSE. An empty array is a `400` rather than a no-op — a caller whose id list came out empty because its own construction broke would read \\"deleted 0\\" and conclude the workspace was already clean.\\n\\nThe cap is on the REQUEST rather than on what a cascade expands to: the whole delete is one transaction, so the practical bound is the backend's write timeout and no number here can promise it." |
| "cascade" | schema | no | — | "Also delete the named beads' parent-child descendants, at every depth. Every other dependent of the deleted set — a bead joined by any edge type other than parent-child — survives with its edges to the set removed and comes back in `orphaned`, so `cascade` makes `force` moot rather than conflicting with it: a request carrying both behaves as `cascade`. Announced by the `issues.delete.containmentCascade` behavior token; a server without it deletes every transitive dependent instead." |
| "force" | schema | no | — | "Delete the named beads and leave their dependents ORPHANED, reported in `orphaned`. Without it and without `cascade`, a named bead with a dependent the request did not name is refused.\\n\\nIt defaults FALSE, which is the guarded mode, and the default is the protection. Authentication here is a deployment posture, and where it is configured it is a single shared bearer that admits a client to the WHOLE surface — it names no principal this operation could weigh and grants no narrower right — so an omitted member must not silently choose the answer that changes another bead's graph." |
| "dry_run" | schema | no | — | "Omitted, this Callable uses `true`. Report what the deletion WOULD do and change nothing. The counts and BOTH refusals are the ones the real request would produce, computed against the same snapshot, and nothing is recorded in history either." |
| "expected_version" | text | no | — | "Requires the named bead's revision to equal this value before anything is erased. A miss refuses the whole request with `409 precondition_failed` and deletes NOTHING — `UpdateIssueRequest.expected_version`'s contract, on the operation where being wrong about which row you are looking at cannot be undone.\\n\\nIT REQUIRES A SINGLE-ID REQUEST. Sending it beside more than one DISTINCT id is a `400` naming this member, refused before anything is read. One token cannot describe two rows: the version space is per-row, so checking one number against a list would pass by coincidence for a list of never-written rows — every one of them holds 0 — and fail forever for a list whose rows have since diverged. A guard that passes by coincidence and a guard nobody can satisfy are one defect seen from two sides. Delete one bead per guarded request; the per-id shape a batch would need is a token PER id, which is a different request type.\\n\\nDUPLICATES COLLAPSE FIRST, so `{\\"ids\\":[\\"be-1\\",\\"be-1\\"], \\"expected_version\\":N}` names one bead and is legal. The refusal counts DISTINCT ids, not mentions, exactly as the library surface does.\\n\\nNEITHER `cascade` NOR `force` BYPASSES IT. Both bypass POLICY — the dependents guard — and never a precondition. Under `cascade` the guard still covers only the NAMED bead: the closure is resolved inside the deleting transaction, so a matching token promises the row is the one you read and promises nothing about how far the closure has grown since. A caller that needs the closure itself pinned wants `dry_run` first.\\n\\nIT GUARDS LIFECYCLE STATE, NOT THE GRAPH. The token is reminted by status, assignee and started-at writes and deliberately not by label, dependency or rename writes, so a match does not promise the bead's edges are the ones you saw.\\n\\nThe token is the `revision` a lifecycle write answers with, and the one `GET /v0/beads/issues/{id}` publishes — which is where a delete guard should seed itself, since reading the bead before erasing it is the only way to be sure it is the bead you meant.\\n\\nIT IS A STRING, and it must be the `revision` string a response carried, verbatim. A JSON number — or any other type — is a `400` naming this member. The token spans the FULL 64-bit range, so a number would be rounded past 2^53 by an IEEE-754-double parser and the guard would miss a row nothing else touched; a string round-trips exactly in every consumer." |

#### Advanced

```json-schema
{
  "properties": {
    "ids": {
      "type": "array",
      "minItems": 1,
      "maxItems": 1000,
      "items": {
        "type": "string"
      }
    },
    "cascade": {
      "type": "boolean",
      "default": false
    },
    "force": {
      "type": "boolean",
      "default": false
    },
    "dry_run": {
      "type": "boolean",
      "default": true
    }
  }
}
```

<!-- bdp-schema:end issueDeleteArguments bundle=issue-callables -->

<!-- bdp-schema:start issueReclaimArguments bundle=issue-callables -->
### Schema: "issueReclaimArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/reclaim." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "older_than_seconds" | schema | no | — | "Omitted, this Callable uses `600`. The grace window past a lease's own expiry, in seconds (fractions allowed): only a lease that expired more than this long ago is eligible. A negative value is refused." |
| "ids" | schema | no | — | "Only these issues are eligible. An id that is not currently a stale lease is absent from the answer rather than refused. The cap is on the REQUEST, counted before deduplication. A blank entry is refused." |
| "assignees" | array of (text) | no | — | "Only leases held by one of these owners are eligible." |
| "labels" | array of (text) | no | — | "Only issues carrying ALL of these labels are eligible." |
| "labels_any" | array of (text) | no | — | "Only issues carrying AT LEAST ONE of these labels are eligible." |
| "exclude_labels" | array of (text) | no | — | "An issue carrying ANY of these labels is never eligible." |
| "any_replica" | boolean | no | — | "Also revert leases another replica granted. The one member that WIDENS the sweep; see the operation. Absent means `false`." |

#### Advanced

```json-schema
{
  "properties": {
    "older_than_seconds": {
      "type": "number",
      "format": "double",
      "minimum": 0,
      "default": 600
    },
    "ids": {
      "type": "array",
      "maxItems": 1000,
      "items": {
        "type": "string"
      }
    }
  }
}
```

<!-- bdp-schema:end issueReclaimArguments bundle=issue-callables -->

<!-- bdp-schema:start issueCreateManyArguments bundle=issue-callables -->
### Schema: "issueCreateManyArguments"

Value: object

Other fields: not allowed

Required order: ["items"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/create-many." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | schema | yes | — | "The issues to create, in order. An empty array is a `400` rather than a successful no-op: a write request that writes nothing is a client bug, and answering it with a cheerful empty success is how a client whose own list filtered to nothing silently stops creating anything.\\n\\nThe 100-item cap is a bound on how long one request may hold a write transaction, not a statement about batch semantics. Split a larger plan; each request is atomic on its own." |

#### Advanced

```json-schema
{
  "properties": {
    "items": {
      "type": "array",
      "minItems": 1,
      "maxItems": 100,
      "items": {
        "$ref": "#/$defs/BatchCreateItem"
      }
    }
  }
}
```

<!-- bdp-schema:end issueCreateManyArguments bundle=issue-callables -->

<!-- bdp-schema:start issueBatchArguments bundle=issue-callables -->
### Schema: "issueBatchArguments"

Value: object

Other fields: not allowed

Required order: ["items"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/batch." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | schema | yes | — | "The items to apply, IN THE ORDER THEY ARE TO BE APPLIED. An empty array is a `400` rather than a successful no-op: a write request that writes nothing is a client bug, and answering it cheerfully is how a client whose own plan filtered to nothing silently stops writing.\\n\\nThe 1000-item cap (raised from 100; see the `issues.batchApplyLarge` capability token on `ContextResponse`) bounds how long one request may hold a write transaction, not batch semantics. A request over 100 items also EXTENDS the effective request deadline: the server grants a flat, operator-configured ceiling (`bd serve --large-apply-ceiling`, 5 minutes by default) instead of the ordinary small-request deadline, so a plan that genuinely needs minutes to apply is not cut off mid-commit. It never narrows: a request at or under 100 items keeps exactly the deadline it has always had. Split a larger plan if you must; each request is atomic on its own — but splitting it changes what the end gate can see, since the gate runs over one request at a time, and the server itself never splits a plan you send it: a single `items` array either commits in full or changes nothing.\\n\\nA per-item refusal names its offender as `items[i].kind.member`." |
| "provenance" | schema | no | — | "Labels the version-control history entry this request records, under `updateIssue`'s rule: it changes how the entry READS, never whether one is recorded. Empty composes a default naming how many items of each kind landed and no ids." |
| "force_id_prefix" | schema | no | — | "Permits an explicit `create.id` outside the workspace's configured issue prefix, for EVERY create item in the request. Without it such an id is refused by the role and arrives as a `400`." |
| "skip_per_edge_cycle_check" | schema | no | — | "Drops the PER-EDGE cycle probe for a caller wiring a large graph, exactly as it does on `POST /v0/beads/dependencies:add`.\\n\\nIT NEVER DROPS THE END GATE, which runs once after every item and re-validates the whole graph this request built, and it never drops the self-dependency refusal. It trades per-edge attribution for speed, not validation for speed." |

#### Advanced

```json-schema
{
  "properties": {
    "items": {
      "type": "array",
      "minItems": 1,
      "maxItems": 1000,
      "items": {
        "$ref": "#/$defs/ApplyItem"
      }
    },
    "provenance": {
      "type": "string",
      "maxLength": 255
    },
    "force_id_prefix": {
      "type": "boolean",
      "default": false
    },
    "skip_per_edge_cycle_check": {
      "type": "boolean",
      "default": false
    }
  }
}
```

<!-- bdp-schema:end issueBatchArguments bundle=issue-callables -->

<!-- bdp-schema:start issueBatchError bundle=issue-callables -->
### Schema: "issueBatchError"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The error values issue/batch can return: v0's Problem, discriminated by code." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/Problem"
    },
    {
      "properties": {
        "code": {
          "enum": [
            "already_claimed",
            "dependency_cycle",
            "dependency_exists",
            "issue_pinned",
            "not_assignee",
            "not_closable",
            "notes_overwrite_refused",
            "precondition_failed",
            "template_read_only"
          ]
        }
      }
    }
  ]
}
```

<!-- bdp-schema:end issueBatchError bundle=issue-callables -->

<!-- bdp-schema:start issueCloseManyArguments bundle=issue-callables -->
### Schema: "issueCloseManyArguments"

Value: object

Other fields: not allowed

Required order: ["items"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/close-many." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | schema | yes | — | "The issues to close, in the order the caller asked for them. Every item appears in `outcomes` at the same index.\\n\\nAn EMPTY array is a `400` rather than an empty answer, and the cap is `batchCreateIssues`' cap for its reason: it bounds how long one request may hold a write transaction." |
| "session" | schema | no | — | "The working session, recorded against every item that closes, under `CloseIssueRequest.session`'s first-close-wins rule and bounds." |
| "force" | schema | no | — | "Bypass close policy — the open-children refusal and the live-blocker refusal — and the pin and the assignee guard for EVERY item, and nothing else. It never bypasses the template guard or validation, and it never bypasses existence: an id that names nothing refuses whether or not this is set. It is request-wide because the flag that spells it is." |
| "auto_close_molecule" | schema | no | — | "Behind the `issues.close.autoCloseMolecule` behavior token: an older server answers `unknown_parameter` for this name.\\n\\nClose each item's molecule root when the batch completed it: `CloseIssueRequest.auto_close_molecule` for every item that closed or was already closed, run after all the closes inside the same transaction. A batch that closes several steps of one molecule decides its root once, and the root it closed, or its refusal, is reported on the outcome of the first successful item under that root." |

#### Advanced

```json-schema
{
  "properties": {
    "items": {
      "type": "array",
      "minItems": 1,
      "maxItems": 100,
      "items": {
        "$ref": "#/$defs/BatchCloseItem"
      }
    },
    "session": {
      "type": "string",
      "maxLength": 255
    },
    "force": {
      "type": "boolean",
      "default": false
    },
    "auto_close_molecule": {
      "type": "boolean",
      "default": false
    }
  }
}
```

<!-- bdp-schema:end issueCloseManyArguments bundle=issue-callables -->

<!-- bdp-schema:start issueClaimNextArguments bundle=issue-callables -->
### Schema: "issueClaimNextArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/claim-next." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "assignee" | text | no | — | "Only issues assigned to this actor." |
| "unassigned" | boolean | no | — | "Only issues with no assignee." |
| "type" | schema | no | — | "A Bead Type reference (§2). Issue type. The only normalization is shorthand ALIAS expansion, exactly what `bd ready --type` does: `mr` → `merge-request`, `feat` → `feature`, `mol` → `molecule`, `enhancement` → `feature`, `dec`/`adr` → `decision`. Every other value is used as written — there is NO plural folding, so `bugs` is not `bug`.\\n\\nAn unrecognized type is not an error here: the type vocabulary is workspace-configurable, and `bd ready` does not validate it either, so it simply matches nothing and `items` comes back empty. (The list operation differs — `bd list` DOES validate the type, so `GET /v0/beads/issues?type=bugs` is a 400.)\\n\\nWhen set, `exclude_type` is ignored, and so are the default type exclusions described above." |
| "exclude_type" | schema | no | — | "A Bead Type reference (§2). Issue types to exclude. Repeat the parameter, or pass a comma-separated list. Ignored when `type` is set." |
| "label" | array of (text) | no | — | "Labels that must ALL be present (AND)." |
| "label_any" | array of (text) | no | — | "Labels of which at least one must be present (OR)." |
| "exclude_label" | array of (text) | no | — | "Labels that must not be present." |
| "label_pattern" | text | no | — | "Glob matched against labels." |
| "label_regex" | text | no | — | "Regular expression matched against labels, compiled by the database in its own dialect. A pattern it cannot compile is a 400 `invalid_value` on this parameter." |
| "priority" | integer | no | — | "Exact priority (0 is a real value, not \\"unset\\")." |
| "parent" | text | no | — | "Restrict to recursive descendants of this issue." |
| "metadata_field" | array of (text) | no | — | "Top-level metadata equality filter as `key=value`, split on the first `=`. Repeatable. An invalid key is a 400." |
| "has_metadata_key" | text | no | — | "Only issues carrying this top-level metadata key." |
| "include_ephemeral" | schema | no | — | "Include ephemeral (non-synced) rows." |
| "include_deferred" | schema | no | — | "Include issues whose `defer_until` is still in the future." |
| "sort" | schema | no | — | "Ready-work ordering. `priority` is priority-first; `hybrid` orders recent issues by priority and older ones by age; `oldest` is creation order. An unrecognized value is a 400.\\n\\nThe default is the one `bd ready --sort` registers, so a client swapping `bd ready --json` for this operation gets the same items in the same order. The storage layer treats an EMPTY policy as `hybrid`, but that fallback is unreachable from the CLI and is NOT this parameter's default: `hybrid` demotes older high-priority work, so defaulting to it would change the item SET as soon as `limit` truncates — silently, and only for the clients this API exists to migrate." |

#### Advanced

```json-schema
{
  "properties": {
    "type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "exclude_type": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "uri",
        "pattern": "^https?://.+",
        "x-bdp-type-reference": true
      }
    },
    "include_ephemeral": {
      "type": "boolean",
      "default": false
    },
    "include_deferred": {
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

<!-- bdp-schema:end issueClaimNextArguments bundle=issue-callables -->

<!-- bdp-schema:start issueDepAddArguments bundle=issue-callables -->
### Schema: "issueDepAddArguments"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/dep/add." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "edges" | schema | no | — | "The edges to assert, in the caller's order. An empty array is a `400` rather than a successful no-op: a write request that writes nothing is a client bug, and answering it cheerfully is how a client whose own list filtered to nothing silently stops wiring anything.\\n\\nThe 100-edge cap is a bound on how long one request may hold a write transaction, not a statement about batch semantics. Split a larger graph; each request is atomic on its own — but note that splitting it changes what the cycle gate can see, since the gate runs over one request at a time.\\n\\nA per-edge refusal names its offender as `edges[i].member`." |
| "source" | schema | no | — | "The edge's source. Flat form only; exactly one of this form and `edges`." |
| "target" | schema | no | — | "The edge's target. Flat form only; exactly one of this form and `edges`." |
| "type" | schema | no | — | "A Link Type reference (§2). The edge's Link Type. Flat form only; omitted, it is `https://github.com/gastownhall/bdp/types/dependency/blocks`." |

#### Advanced

```json-schema
{
  "properties": {
    "edges": {
      "type": "array",
      "minItems": 1,
      "maxItems": 100,
      "items": {
        "$ref": "#/$defs/DependencyEdge"
      }
    },
    "source": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "target": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    }
  }
}
```

<!-- bdp-schema:end issueDepAddArguments bundle=issue-callables -->

<!-- bdp-schema:start issueDepAddError bundle=issue-callables -->
### Schema: "issueDepAddError"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The error values issue/dep/add can return: v0's Problem, discriminated by code." |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/Problem"
    },
    {
      "properties": {
        "code": {
          "enum": [
            "dependency_cycle",
            "dependency_exists"
          ]
        }
      }
    }
  ]
}
```

<!-- bdp-schema:end issueDepAddError bundle=issue-callables -->

<!-- bdp-schema:start issueDepRemoveArguments bundle=issue-callables -->
### Schema: "issueDepRemoveArguments"

Value: object

Other fields: not allowed

Required order: ["issue_id", "depends_on_id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of issue/dep/remove." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue_id" | schema | yes | — | "The edge's SOURCE — the issue that depends on the other end. An EXACT canonical id: there is no fuzzy, prefix or substring resolution on this surface." |
| "depends_on_id" | schema | yes | — | "The edge's TARGET — the issue depended upon. An exact canonical id, under `issue_id`'s rule." |

#### Advanced

```json-schema
{
  "properties": {
    "issue_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "depends_on_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    }
  }
}
```

<!-- bdp-schema:end issueDepRemoveArguments bundle=issue-callables -->

<!-- bdp-schema:start configSetArguments bundle=issue-callables -->
### Schema: "configSetArguments"

Value: object

Other fields: not allowed

Required order: ["key", "value"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of config/set." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | schema | yes | — | "Exact setting key, used verbatim. Keys routinely contain dots (`status.custom`); they occupy one path segment and are percent-decoded once." |
| "value" | text | yes | — | "The value to store, VERBATIM. It is not trimmed and not character-filtered: two of the keys this plane holds carry structured configuration a filter would corrupt.\\n\\nIT IS BOUNDED AT 65535 BYTES, which is the storage column, and the refusal is a `400` naming this member rather than the `500` the column would otherwise produce for a request the caller could have fixed. BYTES rather than characters, because that is how the column counts: 40000 multi-byte characters overflow it and 65000 ASCII ones do not. The 1 MiB body cap every operation shares still applies above this and is never the binding limit here.\\n\\nThe bound is NOT the one `addComment`'s `text` carries, and the difference is what the two members are for. A comment is a document — a stack trace, a diff, a captured transcript — so its column is `LONGTEXT`. A setting is a value: nothing this plane holds is a megabyte of configuration, so the narrow bound is the honest description rather than a limitation to widen later.\\n\\nThe empty string is a legal value and is stored. Read back it is INDISTINGUISHABLE from a key nothing ever set — `Setting.value` is absent for both — which is this plane's shipped conflation rather than something this operation introduces. A caller that means \\"remove it\\" sends `DELETE`.\\n\\nWhat comes back is this value, for every key this plane accepts: the one stored key with a normalization step is `issue_prefix`, which is also the one key this plane refuses, so no write through this door is transformed on its way in. The one thing the response may not repeat is a value the KEY marks credential-bearing; see the operation." |

#### Advanced

```json-schema
{
  "properties": {
    "key": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<!-- bdp-schema:end configSetArguments bundle=issue-callables -->

<!-- bdp-schema:start configUnsetArguments bundle=issue-callables -->
### Schema: "configUnsetArguments"

Value: object

Other fields: not allowed

Required order: ["key"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of config/unset." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | schema | yes | — | "Exact setting key, used verbatim. Keys routinely contain dots (`status.custom`); they occupy one path segment and are percent-decoded once." |

#### Advanced

```json-schema
{
  "properties": {
    "key": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<!-- bdp-schema:end configUnsetArguments bundle=issue-callables -->

<!-- bdp-schema:start memoryRememberArguments bundle=issue-callables -->
### Schema: "memoryRememberArguments"

Value: object

Other fields: not allowed

Required order: ["content"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of memory/remember." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "content" | text | yes | — | "The memory itself, stored VERBATIM: newlines, surrounding space and unicode all survive. Flattening it to one line is what a front door does when it prints, not what this plane does when it stores.\\n\\nEmpty after trimming is a `400`. So is content from which no key can be derived when `key` is omitted — `\\"!!!\\"` derives to nothing — and the recovery for that one is to send a `key`." |
| "key" | text | no | — | "The key to store under. OMIT IT to have the server derive one from `content`; the response's `key` is then how the caller learns where the memory landed.\\n\\nSupplied, it is used verbatim — no trimming, no slugging, no charset restriction. A key carrying a control character is storable this way and by `bd remember --key`, and is then unreachable through `GET`/`DELETE /v0/beads/memories/{key}`, which refuse one: see those operations." |

<!-- bdp-schema:end memoryRememberArguments bundle=issue-callables -->

<!-- bdp-schema:start memoryForgetArguments bundle=issue-callables -->
### Schema: "memoryForgetArguments"

Value: object

Other fields: not allowed

Required order: ["key"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Arguments of memory/forget." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | schema | yes | — | "Exact memory key, used verbatim. It occupies one path segment and is percent-decoded once. Keys may contain spaces, dots and unicode — the plane stores what `bd remember --key` was given — and a key carrying a CONTROL character is refused here rather than looked up; see the operation description." |

#### Advanced

```json-schema
{
  "properties": {
    "key": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<!-- bdp-schema:end memoryForgetArguments bundle=issue-callables -->

<!-- bdp-schema:start Issue bundle=issue-callables -->
### Schema: "Issue"

Value: object

Required order: ["id", "title", "priority", "created_at", "updated_at"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A tracked work item. Property semantics documented here apply to every schema that repeats them below." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "Canonical issue id, e.g. `bd-abc`." |
| "title" | text | yes | — | — |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "acceptance_criteria" | text | no | — | — |
| "notes" | text | no | — | — |
| "spec_id" | text | no | — | — |
| "status" | text | no | — | "`open`, `in_progress`, `blocked`, `closed`, or any custom status configured for the workspace. NOT a closed vocabulary: clients must treat an unrecognized value as \\"some status I do not know\\"." |
| "priority" | integer | yes | — | "0 (most urgent) through 4. Always present; 0 is a real value." |
| "issue_type" | schema | no | — | "A Bead Type reference (§2). `bug`, `feature`, `task`, `epic`, `chore`, `gate`, and workspace configured types. Not a closed vocabulary." |
| "is_blocked" | boolean | no | — | "The persisted readiness projection — true when an open blocking dependency keeps this issue out of the ready set. Derived from the dependency graph; never set by a client.\\n\\nNOT POPULATED by the /v0 read endpoints today: they hydrate issues without it, so the field is absent from their responses and its absence says nothing about whether an issue is blocked. Use `/v0/beads/ready` or the dependency endpoints to answer that. The field is carried by events-journal snapshots, which is where it is read back, and it is documented here because those snapshots serialize the same type this schema is pinned to." |
| "assignee" | text | no | — | "The actor currently holding the issue, if any." |
| "owner" | text | no | — | — |
| "estimated_minutes" | integer | no | — | — |
| "created_at" | schema | yes | — | — |
| "created_by" | text | no | — | — |
| "updated_at" | schema | yes | — | — |
| "started_at" | schema | no | — | — |
| "closed_at" | schema | no | — | — |
| "close_reason" | text | no | — | — |
| "closed_by_session" | text | no | — | — |
| "lease_expires_at" | schema | no | — | "Expiry of the current claim's lease, when one is active." |
| "heartbeat_at" | schema | no | — | — |
| "lease_granted_node" | text | no | — | "The replica that granted the lease. Empty means the provenance is unknown, which is treated as local." |
| "due_at" | schema | no | — | — |
| "defer_until" | schema | no | — | — |
| "external_ref" | text | no | — | — |
| "source_system" | text | no | — | — |
| "metadata" | schema | no | — | "Arbitrary caller-supplied JSON object. VALUES MAY BE OF ANY JSON TYPE — string, number, boolean, array or nested object — because typed values enter through the explicit JSON metadata path and persist in older rows. Clients MUST NOT decode this into a string-to-string map; a strict decode fails on the first typed value and takes the whole response with it. That prohibition is on assuming a narrower type when reading THIS document: a profile MAY declare a narrower value schema under the rules in **Profiles**, and a client of that profile may rely on the profile's declaration.\\n\\nThe object-at-top-level shape is the contract every producer and every metadata filter (`metadata_field`, `has_metadata_key`) assumes, but be aware the store validates only that the value is WELL-FORMED JSON: a row created with a non-object (e.g. `bd create --metadata '[1,2]'`) can carry an array or a scalar here. That is a storage-side gap, not licence for a producer to emit one — but a tolerant client should skip such a row rather than fail the whole response." |
| "compaction_level" | integer | no | — | — |
| "compacted_at" | schema | no | — | — |
| "compacted_at_commit" | text | no | — | — |
| "original_size" | integer | no | — | — |
| "labels" | array of (text) | no | — | — |
| "dependencies" | array of (ref "#/$defs/Dependency") | no | — | "Dependency edges. Populated in export/interchange contexts; the detail endpoint returns richer entries — see `IssueDetails`." |
| "comments" | array of (ref "#/$defs/Comment") | no | — | — |
| "sender" | text | no | — | — |
| "ephemeral" | boolean | no | — | "Ephemeral records are not synced." |
| "no_history" | boolean | no | — | — |
| "wisp_type" | text | no | — | — |
| "storage_class" | text | no | — | "The record's history/replication contract. Empty means unset, which resolves to ephemeral for wisp-plane records and versioned otherwise." |
| "arrival_seq" | schema | no | — | "The row's commit-ordered create sequence: the events-journal `seq` of the `create` record written by the transaction that inserted the row, stamped on the row in that same transaction (`issues.arrivalSeq`). Sorting rows by it reproduces the order their creates committed in, also after those journal records are pruned; read it from the row or a journal post-image, never infer it from a record's `seq` (a rename or an import upsert journals a synthetic create for a row that already exists). Only wisp-plane records (ephemeral or no_history) carry one: a record created while the workspace journals is stamped by its own insert, and one created while it did not is stamped by the first create record journaled for it later, so it sorts by that commit rather than its insert's; a record moved onto the wisp plane (`persistence`) has none until such a record either. Absent means none. Values are local to the workspace that assigned them — unique, not reused unless the server's seq counter is lost after the journal records that held them are pruned, never changed while the record stays on the wisp plane, never written to JSONL interchange, and never settable by a client." |
| "pinned" | boolean | no | — | — |
| "is_template" | boolean | no | — | — |
| "bonded_from" | array of (ref "#/$defs/BondRef") | no | — | — |
| "await_type" | text | no | — | "Gate condition type." |
| "await_id" | text | no | — | — |
| "timeout" | schema | no | — | "NANOSECONDS. This is a Go `time.Duration`, which encodes as an int64 nanosecond count — a pre-existing wire fact, not a choice." |
| "waiters" | array of (text) | no | — | — |
| "source_formula" | text | no | — | — |
| "source_location" | text | no | — | — |
| "mol_type" | text | no | — | — |
| "work_type" | text | no | — | — |
| "event_kind" | text | no | — | — |
| "actor" | text | no | — | "For event records, the entity that caused the event. Unrelated to the claiming actor in `ClaimRequest`." |
| "target" | text | no | — | — |
| "payload" | text | no | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "issue_type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    },
    "started_at": {
      "type": "string",
      "format": "date-time"
    },
    "closed_at": {
      "type": "string",
      "format": "date-time"
    },
    "lease_expires_at": {
      "type": "string",
      "format": "date-time"
    },
    "heartbeat_at": {
      "type": "string",
      "format": "date-time"
    },
    "due_at": {
      "type": "string",
      "format": "date-time"
    },
    "defer_until": {
      "type": "string",
      "format": "date-time"
    },
    "metadata": {
      "type": "object",
      "additionalProperties": true
    },
    "compacted_at": {
      "type": "string",
      "format": "date-time"
    },
    "arrival_seq": {
      "type": "integer",
      "format": "int64"
    },
    "timeout": {
      "type": "integer",
      "format": "int64"
    }
  }
}
```

<!-- bdp-schema:end Issue bundle=issue-callables -->

<!-- bdp-schema:start BatchGetIssue bundle=issue-callables -->
### Schema: "BatchGetIssue"

Value: object

Required order: ["id", "title", "priority", "created_at", "updated_at", "revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One resolved entry of `BatchGetIssuesResult.issues`: an `Issue` plus its current `revision`. Property semantics other than `revision` are documented on `Issue`; the spec repeats the list rather than composing it (see the note at the top of this document)." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "Canonical issue id, e.g. `bd-abc`." |
| "title" | text | yes | — | — |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "acceptance_criteria" | text | no | — | — |
| "notes" | text | no | — | — |
| "spec_id" | text | no | — | — |
| "status" | text | no | — | "`open`, `in_progress`, `blocked`, `closed`, or any custom status configured for the workspace. NOT a closed vocabulary: clients must treat an unrecognized value as \\"some status I do not know\\"." |
| "priority" | integer | yes | — | "0 (most urgent) through 4. Always present; 0 is a real value." |
| "issue_type" | schema | no | — | "A Bead Type reference (§2). `bug`, `feature`, `task`, `epic`, `chore`, `gate`, and workspace configured types. Not a closed vocabulary." |
| "is_blocked" | boolean | no | — | "The persisted readiness projection — true when an open blocking dependency keeps this issue out of the ready set. Derived from the dependency graph; never set by a client.\\n\\nNOT POPULATED by the /v0 read endpoints today: they hydrate issues without it, so the field is absent from their responses and its absence says nothing about whether an issue is blocked. Use `/v0/beads/ready` or the dependency endpoints to answer that. The field is carried by events-journal snapshots, which is where it is read back, and it is documented here because those snapshots serialize the same type this schema is pinned to." |
| "assignee" | text | no | — | "The actor currently holding the issue, if any." |
| "owner" | text | no | — | — |
| "estimated_minutes" | integer | no | — | — |
| "created_at" | schema | yes | — | — |
| "created_by" | text | no | — | — |
| "updated_at" | schema | yes | — | — |
| "started_at" | schema | no | — | — |
| "closed_at" | schema | no | — | — |
| "close_reason" | text | no | — | — |
| "closed_by_session" | text | no | — | — |
| "lease_expires_at" | schema | no | — | "Expiry of the current claim's lease, when one is active." |
| "heartbeat_at" | schema | no | — | — |
| "lease_granted_node" | text | no | — | "The replica that granted the lease. Empty means the provenance is unknown, which is treated as local." |
| "due_at" | schema | no | — | — |
| "defer_until" | schema | no | — | — |
| "external_ref" | text | no | — | — |
| "source_system" | text | no | — | — |
| "metadata" | schema | no | — | "Arbitrary caller-supplied JSON object. VALUES MAY BE OF ANY JSON TYPE — string, number, boolean, array or nested object — because typed values enter through the explicit JSON metadata path and persist in older rows. Clients MUST NOT decode this into a string-to-string map; a strict decode fails on the first typed value and takes the whole response with it. That prohibition is on assuming a narrower type when reading THIS document: a profile MAY declare a narrower value schema under the rules in **Profiles**, and a client of that profile may rely on the profile's declaration.\\n\\nThe object-at-top-level shape is the contract every producer and every metadata filter (`metadata_field`, `has_metadata_key`) assumes, but be aware the store validates only that the value is WELL-FORMED JSON: a row created with a non-object (e.g. `bd create --metadata '[1,2]'`) can carry an array or a scalar here. That is a storage-side gap, not licence for a producer to emit one — but a tolerant client should skip such a row rather than fail the whole response." |
| "compaction_level" | integer | no | — | — |
| "compacted_at" | schema | no | — | — |
| "compacted_at_commit" | text | no | — | — |
| "original_size" | integer | no | — | — |
| "labels" | array of (text) | no | — | — |
| "dependencies" | array of (ref "#/$defs/Dependency") | no | — | "Dependency edges. Populated in export/interchange contexts; the detail endpoint returns richer entries — see `IssueDetails`." |
| "comments" | array of (ref "#/$defs/Comment") | no | — | — |
| "sender" | text | no | — | — |
| "ephemeral" | boolean | no | — | "Ephemeral records are not synced." |
| "no_history" | boolean | no | — | — |
| "wisp_type" | text | no | — | — |
| "storage_class" | text | no | — | "The record's history/replication contract. Empty means unset, which resolves to ephemeral for wisp-plane records and versioned otherwise." |
| "arrival_seq" | schema | no | — | "As on Issue." |
| "pinned" | boolean | no | — | — |
| "is_template" | boolean | no | — | — |
| "bonded_from" | array of (ref "#/$defs/BondRef") | no | — | — |
| "await_type" | text | no | — | "Gate condition type." |
| "await_id" | text | no | — | — |
| "timeout" | schema | no | — | "NANOSECONDS. This is a Go `time.Duration`, which encodes as an int64 nanosecond count — a pre-existing wire fact, not a choice." |
| "waiters" | array of (text) | no | — | — |
| "source_formula" | text | no | — | — |
| "source_location" | text | no | — | — |
| "mol_type" | text | no | — | — |
| "work_type" | text | no | — | — |
| "event_kind" | text | no | — | — |
| "actor" | text | no | — | "For event records, the entity that caused the event. Unrelated to the claiming actor in `ClaimRequest`." |
| "target" | text | no | — | — |
| "payload" | text | no | — | — |
| "revision" | text | yes | — | "The row's optimistic-concurrency token, spelled the way `IssueDetails.revision` spells it — a decimal string, never a number (a JSON number loses precision past 2^53 and the token spans the full int64 range). EQUALITY-ONLY: compare it, never order or interpret it. Send it back verbatim as an `expected_version` on a lifecycle write.\\n\\nNO omitempty: it is ALWAYS PRESENT, including as `\\"0\\"` for a legacy migration-0054 row that has not been mutated since, the same rule `IssueDetails.revision` states in full." |

#### Advanced

```json-schema
{
  "properties": {
    "issue_type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    },
    "started_at": {
      "type": "string",
      "format": "date-time"
    },
    "closed_at": {
      "type": "string",
      "format": "date-time"
    },
    "lease_expires_at": {
      "type": "string",
      "format": "date-time"
    },
    "heartbeat_at": {
      "type": "string",
      "format": "date-time"
    },
    "due_at": {
      "type": "string",
      "format": "date-time"
    },
    "defer_until": {
      "type": "string",
      "format": "date-time"
    },
    "metadata": {
      "type": "object",
      "additionalProperties": true
    },
    "compacted_at": {
      "type": "string",
      "format": "date-time"
    },
    "arrival_seq": {
      "type": "integer",
      "format": "int64"
    },
    "timeout": {
      "type": "integer",
      "format": "int64"
    }
  }
}
```

<!-- bdp-schema:end BatchGetIssue bundle=issue-callables -->

<!-- bdp-schema:start IssueWithCounts bundle=issue-callables -->
### Schema: "IssueWithCounts"

Value: object

Required order: ["id", "title", "priority", "created_at", "updated_at", "dependency_count", "dependent_count", "comment_count"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "An `Issue` plus relationship cardinalities. This is the element type of both `/v0/beads/ready` and `/v0/beads/issues`, matching what `bd ready --json` and `bd list --json` emit. Property semantics are documented on `Issue`." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | — |
| "title" | text | yes | — | — |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "acceptance_criteria" | text | no | — | — |
| "notes" | text | no | — | — |
| "spec_id" | text | no | — | — |
| "status" | text | no | — | — |
| "priority" | integer | yes | — | — |
| "issue_type" | schema | no | — | "A Bead Type reference (§2)." |
| "is_blocked" | boolean | no | — | — |
| "assignee" | text | no | — | — |
| "owner" | text | no | — | — |
| "estimated_minutes" | integer | no | — | — |
| "created_at" | schema | yes | — | — |
| "created_by" | text | no | — | — |
| "updated_at" | schema | yes | — | — |
| "started_at" | schema | no | — | — |
| "closed_at" | schema | no | — | — |
| "close_reason" | text | no | — | — |
| "closed_by_session" | text | no | — | — |
| "lease_expires_at" | schema | no | — | — |
| "heartbeat_at" | schema | no | — | — |
| "lease_granted_node" | text | no | — | — |
| "due_at" | schema | no | — | — |
| "defer_until" | schema | no | — | — |
| "external_ref" | text | no | — | — |
| "source_system" | text | no | — | — |
| "metadata" | schema | no | — | — |
| "compaction_level" | integer | no | — | — |
| "compacted_at" | schema | no | — | — |
| "compacted_at_commit" | text | no | — | — |
| "original_size" | integer | no | — | — |
| "labels" | array of (text) | no | — | — |
| "dependencies" | array of (ref "#/$defs/Dependency") | no | — | — |
| "comments" | array of (ref "#/$defs/Comment") | no | — | "The issue's comment bodies. On a listing they are populated only when the caller opts in (`bd list --include-comments`); absent otherwise, which is what `comment_count` and `comments_omitted` report about." |
| "sender" | text | no | — | — |
| "ephemeral" | boolean | no | — | — |
| "no_history" | boolean | no | — | — |
| "wisp_type" | text | no | — | — |
| "storage_class" | text | no | — | — |
| "arrival_seq" | schema | no | — | — |
| "pinned" | boolean | no | — | — |
| "is_template" | boolean | no | — | — |
| "bonded_from" | array of (ref "#/$defs/BondRef") | no | — | — |
| "await_type" | text | no | — | — |
| "await_id" | text | no | — | — |
| "timeout" | schema | no | — | — |
| "waiters" | array of (text) | no | — | — |
| "source_formula" | text | no | — | — |
| "source_location" | text | no | — | — |
| "mol_type" | text | no | — | — |
| "work_type" | text | no | — | — |
| "event_kind" | text | no | — | — |
| "actor" | text | no | — | — |
| "target" | text | no | — | — |
| "payload" | text | no | — | — |
| "dependency_count" | integer | yes | — | "Number of issues this one depends on." |
| "dependent_count" | integer | yes | — | "Number of issues that depend on this one." |
| "comment_count" | integer | yes | — | — |
| "comments_omitted" | boolean | no | — | "True when `comment_count` is nonzero and `comments` was left out — every such row of a LIST response (`GET /v0/beads/issues`, and `bd list --json` without `--include-comments`). Without it, an absent `comments` key is ambiguous between \\"no comments\\" and \\"comments not included in this response\\", and on a listing that ambiguity is what makes a content search over the page answer with a plausible non-empty result whose matching rows are missing.\\n\\nIT IS SET BY THE LIST SURFACES ONLY. `GET /v0/beads/ready` and the claim response carry this same schema and do not set it, so an absent marker there says nothing about whether a row's comments exist — read `comment_count`. Extending the marker to them is tracked as be-ozp." |
| "parent" | text | no | — | "Parent issue id, computed from the parent-child edge." |

#### Advanced

```json-schema
{
  "properties": {
    "issue_type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    },
    "started_at": {
      "type": "string",
      "format": "date-time"
    },
    "closed_at": {
      "type": "string",
      "format": "date-time"
    },
    "lease_expires_at": {
      "type": "string",
      "format": "date-time"
    },
    "heartbeat_at": {
      "type": "string",
      "format": "date-time"
    },
    "due_at": {
      "type": "string",
      "format": "date-time"
    },
    "defer_until": {
      "type": "string",
      "format": "date-time"
    },
    "metadata": {
      "type": "object",
      "additionalProperties": true
    },
    "compacted_at": {
      "type": "string",
      "format": "date-time"
    },
    "arrival_seq": {
      "type": "integer",
      "format": "int64"
    },
    "timeout": {
      "type": "integer",
      "format": "int64"
    }
  }
}
```

<!-- bdp-schema:end IssueWithCounts bundle=issue-callables -->

<!-- bdp-schema:start IssueDetails bundle=issue-callables -->
### Schema: "IssueDetails"

Value: object

Required order: ["id", "title", "priority", "created_at", "updated_at", "revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "An `Issue` with its labels, dependency edges and cardinalities — the body of `GET /v0/beads/issues/{id}`. `dependencies` and `dependents` carry FULL issue objects plus the edge type, not bare edges. Property semantics are documented on `Issue`." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | — |
| "title" | text | yes | — | — |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "acceptance_criteria" | text | no | — | — |
| "notes" | text | no | — | — |
| "spec_id" | text | no | — | — |
| "status" | text | no | — | — |
| "priority" | integer | yes | — | — |
| "issue_type" | schema | no | — | "A Bead Type reference (§2)." |
| "is_blocked" | boolean | no | — | — |
| "assignee" | text | no | — | — |
| "owner" | text | no | — | — |
| "estimated_minutes" | integer | no | — | — |
| "created_at" | schema | yes | — | — |
| "created_by" | text | no | — | — |
| "updated_at" | schema | yes | — | — |
| "started_at" | schema | no | — | — |
| "closed_at" | schema | no | — | — |
| "close_reason" | text | no | — | — |
| "closed_by_session" | text | no | — | — |
| "lease_expires_at" | schema | no | — | — |
| "heartbeat_at" | schema | no | — | — |
| "lease_granted_node" | text | no | — | — |
| "due_at" | schema | no | — | — |
| "defer_until" | schema | no | — | — |
| "external_ref" | text | no | — | — |
| "source_system" | text | no | — | — |
| "metadata" | schema | no | — | — |
| "compaction_level" | integer | no | — | — |
| "compacted_at" | schema | no | — | — |
| "compacted_at_commit" | text | no | — | — |
| "original_size" | integer | no | — | — |
| "sender" | text | no | — | — |
| "ephemeral" | boolean | no | — | — |
| "no_history" | boolean | no | — | — |
| "wisp_type" | text | no | — | — |
| "storage_class" | text | no | — | — |
| "arrival_seq" | schema | no | — | — |
| "pinned" | boolean | no | — | — |
| "is_template" | boolean | no | — | — |
| "bonded_from" | array of (ref "#/$defs/BondRef") | no | — | — |
| "await_type" | text | no | — | — |
| "await_id" | text | no | — | — |
| "timeout" | schema | no | — | — |
| "waiters" | array of (text) | no | — | — |
| "source_formula" | text | no | — | — |
| "source_location" | text | no | — | — |
| "mol_type" | text | no | — | — |
| "work_type" | text | no | — | — |
| "event_kind" | text | no | — | — |
| "actor" | text | no | — | — |
| "target" | text | no | — | — |
| "payload" | text | no | — | — |
| "labels" | array of (text) | no | — | — |
| "dependencies" | array of (ref "#/$defs/IssueWithDependencyMetadata") | no | — | "Issues this one depends on, each carrying its edge type." |
| "comments" | array of (ref "#/$defs/Comment") | no | — | "The issue's comment bodies. Populated only when the request sets `getIssue`'s `include_comments`; absent otherwise, which is what `comment_count` and `comments_omitted` report about." |
| "dependents" | array of (ref "#/$defs/IssueWithDependencyMetadata") | no | — | "Issues that depend on this one, each carrying its edge type. Populated only when the request sets `getIssue`'s `include_dependents`; absent otherwise, where `dependent_count` is the cardinality." |
| "parent" | text | no | — | "Parent issue id, computed from the parent-child edge." |
| "dependency_count" | schema | no | — | — |
| "dependent_count" | schema | no | — | — |
| "comment_count" | schema | no | — | — |
| "gated_by" | schema | no | — | "The gates actively blocking this issue: gate-typed dependencies reached over a `blocks` or `conditional-blocks` edge whose own status is neither closed nor pinned, on an issue that is itself neither closed nor pinned. ADDITIVE and absent when empty. It is DERIVED, not stored — `status` is unaffected, and an open issue an open gate blocks still reports `open` — and both clauses are the ones the readiness query's is_blocked column applies, so a nonempty list means `bd ready` withholds this issue on a gate's account. A `waits-for` edge onto a gate is deliberately NOT here: that leg of the readiness rule is a fanout over the gate's children rather than a status test, and it can leave the issue ready." |
| "comments_omitted" | boolean | no | — | "True when `comment_count` is nonzero and `comments` was left out — every such issue on a request that did not set `include_comments`. Without it, an absent `comments` key is ambiguous between \\"no comments\\" and \\"comments not included in this response\\"." |
| "unresolvable_dependencies" | schema | no | — | "How many of `dependency_count`'s edges `dependencies` could not represent, because the issue on the far end has no row in this database — a cross-repo id or an `external:` reference. The edge is real and correctly stored; only its far end is unreachable from here, so the listing drops it while the count keeps it.\\n\\nWithout it the count reads as phantom: a caller sees `dependency_count: 1` beside an absent `dependencies`, finds nothing under that id anywhere, and concludes the count is wrong. It is not — the edge record itself is readable, and on the CLI `bd dep list <id> <id>` prints it.\\n\\nABSENT, NEVER ZERO, WHEN THERE IS NOTHING TO REPORT, and absent too when the dependency read FAILED rather than came back short. \\"Could not be represented\\" and \\"was never fetched\\" are different facts and do not collapse into one member — the same distinction `comments_omitted` draws." |
| "unresolvable_dependents" | schema | no | — | "The inbound counterpart of `unresolvable_dependencies`, on the same terms.\\n\\nPresent only on a request that set `include_dependents`. Without those rows `dependents` is absent by design, so a difference taken against it would report every dependent the issue has as unresolvable.\\n\\nNote the plane disagreement this creates: `bd show` in text mode reads dependents unconditionally and therefore always discloses the inbound direction on stderr, while a client of this field sees it only when it asked for `include_dependents`." |
| "epic_total_children" | integer | no | — | — |
| "epic_closed_children" | integer | no | — | — |
| "epic_closeable" | boolean | no | — | — |
| "revision" | text | yes | — | "The row's optimistic-concurrency token, and THE READ THAT SOURCES A GUARD. Every `expected_version` on this surface is composed from a token some response carried; until this member existed the only responses that carried one were WRITES, so a caller's first guarded write had to be preceded by a write it did not want to make. This is that member, and it is the one the write responses' \\"when a read publishes one, this member is what it will agree with\\" was written against.\\n\\nIT IS EQUALITY-ONLY: compare it, never order or interpret it. A change signals the row was mutated since you read it, and nothing more — it is a random value the engine rewrites, not a counter. `ApplyItemResult.revision` states the full rule and this member carries it verbatim.\\n\\nITS COVERAGE IS PARTIAL, on the same inherited terms: the token is rewritten by claim, close, unclaim and the generic update path, and NOT by the direct-update paths that rewrite text without touching it. A client needing complete change detection combines it with `updated_at`, `status` and the label set.\\n\\nIt is ALWAYS PRESENT, including as `\\"0\\"` — a legacy row backfilled and not mutated since — because an absent member would be ambiguous between a legacy-zero row and a server that does not publish the token.\\n\\nIT IS THE ANCHOR ROW'S ALONE. The issues nested under `dependencies` and `dependents` are `IssueWithDependencyMetadata` and carry no token: a caller that means to guard a NEIGHBOUR reads that neighbour with its own `GET /v0/beads/issues/{id}`, and a token lifted off an embedded relation would be one the response never promised was fresh.\\n\\nIT IS NOT ON THE LIST ROWS, and that is a decision rather than an oversight — see `GET /v0/beads/issues`.\\n\\nIT IS A STRING, the token's decimal spelling — `\\"-3819021935081927\\"`, or `\\"0\\"` for a legacy migration-0054 row. Send it back verbatim as an `expected_version`; do not parse it into a number. A JSON number would not survive the trip: the token spans the FULL 64-bit range, and an IEEE-754-double parser — JavaScript's `JSON.parse`, Go's `any`, Python's `float` — rounds anything past 2^53 to a value NEAR the token that is not it, so a guard composed from it is refused against a row nothing else touched. A string round-trips exactly in every consumer." |

#### Advanced

```json-schema
{
  "properties": {
    "issue_type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    },
    "started_at": {
      "type": "string",
      "format": "date-time"
    },
    "closed_at": {
      "type": "string",
      "format": "date-time"
    },
    "lease_expires_at": {
      "type": "string",
      "format": "date-time"
    },
    "heartbeat_at": {
      "type": "string",
      "format": "date-time"
    },
    "due_at": {
      "type": "string",
      "format": "date-time"
    },
    "defer_until": {
      "type": "string",
      "format": "date-time"
    },
    "metadata": {
      "type": "object",
      "additionalProperties": true
    },
    "compacted_at": {
      "type": "string",
      "format": "date-time"
    },
    "arrival_seq": {
      "type": "integer",
      "format": "int64"
    },
    "timeout": {
      "type": "integer",
      "format": "int64"
    },
    "dependency_count": {
      "type": "integer",
      "format": "int64"
    },
    "dependent_count": {
      "type": "integer",
      "format": "int64"
    },
    "comment_count": {
      "type": "integer",
      "format": "int64"
    },
    "gated_by": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "description": "The gate issue's id; close it with `bd gate resolve`."
          },
          "type": {
            "type": "string",
            "description": "The gate's await condition (human, timer, gh:run, gh:pr, bead), or `gate` when it carries none."
          },
          "reason": {
            "type": "string",
            "description": "The reason recorded when the gate was created, if any."
          }
        }
      }
    },
    "unresolvable_dependencies": {
      "type": "integer",
      "format": "int64"
    },
    "unresolvable_dependents": {
      "type": "integer",
      "format": "int64"
    }
  }
}
```

<!-- bdp-schema:end IssueDetails bundle=issue-callables -->

<!-- bdp-schema:start IssueWithDependencyMetadata bundle=issue-callables -->
### Schema: "IssueWithDependencyMetadata"

Value: object

Required order: ["id", "title", "priority", "created_at", "updated_at", "dependency_type"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A full issue plus the type of the dependency edge that led to it. Property semantics are documented on `Issue`." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | — |
| "title" | text | yes | — | — |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "acceptance_criteria" | text | no | — | — |
| "notes" | text | no | — | — |
| "spec_id" | text | no | — | — |
| "status" | text | no | — | — |
| "priority" | integer | yes | — | — |
| "issue_type" | schema | no | — | "A Bead Type reference (§2)." |
| "is_blocked" | boolean | no | — | — |
| "assignee" | text | no | — | — |
| "owner" | text | no | — | — |
| "estimated_minutes" | integer | no | — | — |
| "created_at" | schema | yes | — | — |
| "created_by" | text | no | — | — |
| "updated_at" | schema | yes | — | — |
| "started_at" | schema | no | — | — |
| "closed_at" | schema | no | — | — |
| "close_reason" | text | no | — | — |
| "closed_by_session" | text | no | — | — |
| "lease_expires_at" | schema | no | — | — |
| "heartbeat_at" | schema | no | — | — |
| "lease_granted_node" | text | no | — | — |
| "due_at" | schema | no | — | — |
| "defer_until" | schema | no | — | — |
| "external_ref" | text | no | — | — |
| "source_system" | text | no | — | — |
| "metadata" | schema | no | — | — |
| "compaction_level" | integer | no | — | — |
| "compacted_at" | schema | no | — | — |
| "compacted_at_commit" | text | no | — | — |
| "original_size" | integer | no | — | — |
| "labels" | array of (text) | no | — | — |
| "dependencies" | array of (ref "#/$defs/Dependency") | no | — | — |
| "comments" | array of (ref "#/$defs/Comment") | no | — | — |
| "sender" | text | no | — | — |
| "ephemeral" | boolean | no | — | — |
| "no_history" | boolean | no | — | — |
| "wisp_type" | text | no | — | — |
| "storage_class" | text | no | — | — |
| "arrival_seq" | schema | no | — | — |
| "pinned" | boolean | no | — | — |
| "is_template" | boolean | no | — | — |
| "bonded_from" | array of (ref "#/$defs/BondRef") | no | — | — |
| "await_type" | text | no | — | — |
| "await_id" | text | no | — | — |
| "timeout" | schema | no | — | — |
| "waiters" | array of (text) | no | — | — |
| "source_formula" | text | no | — | — |
| "source_location" | text | no | — | — |
| "mol_type" | text | no | — | — |
| "work_type" | text | no | — | — |
| "event_kind" | text | no | — | — |
| "actor" | text | no | — | — |
| "target" | text | no | — | — |
| "payload" | text | no | — | — |
| "dependency_type" | text | yes | — | "The edge type, e.g. `blocks`, `parent-child`, `related`, `discovered-from`. Not a closed vocabulary." |

#### Advanced

```json-schema
{
  "properties": {
    "issue_type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    },
    "started_at": {
      "type": "string",
      "format": "date-time"
    },
    "closed_at": {
      "type": "string",
      "format": "date-time"
    },
    "lease_expires_at": {
      "type": "string",
      "format": "date-time"
    },
    "heartbeat_at": {
      "type": "string",
      "format": "date-time"
    },
    "due_at": {
      "type": "string",
      "format": "date-time"
    },
    "defer_until": {
      "type": "string",
      "format": "date-time"
    },
    "metadata": {
      "type": "object",
      "additionalProperties": true
    },
    "compacted_at": {
      "type": "string",
      "format": "date-time"
    },
    "arrival_seq": {
      "type": "integer",
      "format": "int64"
    },
    "timeout": {
      "type": "integer",
      "format": "int64"
    }
  }
}
```

<!-- bdp-schema:end IssueWithDependencyMetadata bundle=issue-callables -->

<!-- bdp-schema:start TreeNode bundle=issue-callables -->
### Schema: "TreeNode"

Value: object

Required order: ["id", "title", "priority", "created_at", "updated_at", "depth", "parent_id", "truncated"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One node of a walked dependency tree: a full issue plus where the walk reached it. Property semantics for the issue members are documented on `Issue`.\\n\\nThe tree is FLAT. A node's place in it is read from `depth` and `parent_id`, not from nesting, and a subtree is contiguous in `items`." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | — |
| "title" | text | yes | — | — |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "acceptance_criteria" | text | no | — | — |
| "notes" | text | no | — | — |
| "spec_id" | text | no | — | — |
| "status" | text | no | — | — |
| "priority" | integer | yes | — | — |
| "issue_type" | schema | no | — | "A Bead Type reference (§2)." |
| "is_blocked" | boolean | no | — | — |
| "assignee" | text | no | — | — |
| "owner" | text | no | — | — |
| "estimated_minutes" | integer | no | — | — |
| "created_at" | schema | yes | — | — |
| "created_by" | text | no | — | — |
| "updated_at" | schema | yes | — | — |
| "started_at" | schema | no | — | — |
| "closed_at" | schema | no | — | — |
| "close_reason" | text | no | — | — |
| "closed_by_session" | text | no | — | — |
| "lease_expires_at" | schema | no | — | — |
| "heartbeat_at" | schema | no | — | — |
| "lease_granted_node" | text | no | — | — |
| "due_at" | schema | no | — | — |
| "defer_until" | schema | no | — | — |
| "external_ref" | text | no | — | — |
| "source_system" | text | no | — | — |
| "metadata" | schema | no | — | — |
| "compaction_level" | integer | no | — | — |
| "compacted_at" | schema | no | — | — |
| "compacted_at_commit" | text | no | — | — |
| "original_size" | integer | no | — | — |
| "labels" | array of (text) | no | — | — |
| "dependencies" | array of (ref "#/$defs/Dependency") | no | — | — |
| "comments" | array of (ref "#/$defs/Comment") | no | — | — |
| "sender" | text | no | — | — |
| "ephemeral" | boolean | no | — | — |
| "no_history" | boolean | no | — | — |
| "wisp_type" | text | no | — | — |
| "storage_class" | text | no | — | — |
| "arrival_seq" | schema | no | — | — |
| "pinned" | boolean | no | — | — |
| "is_template" | boolean | no | — | — |
| "bonded_from" | array of (ref "#/$defs/BondRef") | no | — | — |
| "await_type" | text | no | — | — |
| "await_id" | text | no | — | — |
| "timeout" | schema | no | — | — |
| "waiters" | array of (text) | no | — | — |
| "source_formula" | text | no | — | — |
| "source_location" | text | no | — | — |
| "mol_type" | text | no | — | — |
| "work_type" | text | no | — | — |
| "event_kind" | text | no | — | — |
| "actor" | text | no | — | — |
| "target" | text | no | — | — |
| "payload" | text | no | — | — |
| "depth" | integer | yes | — | "How far the walk was from the root when it reached this node. The root is 0.\\n\\nFor a `both` walk each half measures its own depth from the root, so a depth does not say which half a node came from and nothing else on the node does either." |
| "parent_id" | text | yes | — | "The node this one was reached FROM, empty on the root. A node is expanded ONCE per walk, under the first path that got there; each later parent of a shared child gets its own stub element (`deduped: true`) naming that parent here." |
| "edge_from_parent" | text | no | — | "The dependency type of the edge that led here, e.g. `blocks`, `parent-child`, `discovered-from`. Absent on the root. Not a closed vocabulary." |
| "truncated" | boolean | yes | — | "ALWAYS FALSE. No implementation sets it: a node beyond `max_depth` is ABSENT from the answer rather than present and flagged, so a client cannot tell a tree that ended from one that was cut. It is documented rather than removed because it is on the wire today." |
| "deduped" | boolean | no | — | "True on a STUB: a row that records only the edge from `parent_id` into an issue already expanded earlier in the same answer, with no descendants of its own. Absent, never false, on every other row. Drop the rows carrying it to get each issue once." |

#### Advanced

```json-schema
{
  "properties": {
    "issue_type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    },
    "started_at": {
      "type": "string",
      "format": "date-time"
    },
    "closed_at": {
      "type": "string",
      "format": "date-time"
    },
    "lease_expires_at": {
      "type": "string",
      "format": "date-time"
    },
    "heartbeat_at": {
      "type": "string",
      "format": "date-time"
    },
    "due_at": {
      "type": "string",
      "format": "date-time"
    },
    "defer_until": {
      "type": "string",
      "format": "date-time"
    },
    "metadata": {
      "type": "object",
      "additionalProperties": true
    },
    "compacted_at": {
      "type": "string",
      "format": "date-time"
    },
    "arrival_seq": {
      "type": "integer",
      "format": "int64"
    },
    "timeout": {
      "type": "integer",
      "format": "int64"
    }
  }
}
```

<!-- bdp-schema:end TreeNode bundle=issue-callables -->

<!-- bdp-schema:start Dependency bundle=issue-callables -->
### Schema: "Dependency"

Value: object

Required order: ["issue_id", "depends_on_id", "type", "created_at"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A dependency edge between two issues." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | no | — | — |
| "issue_id" | text | yes | — | — |
| "depends_on_id" | text | yes | — | — |
| "type" | schema | yes | — | "A Link Type reference (§2). Edge type. Not a closed vocabulary." |
| "created_at" | schema | yes | — | — |
| "created_by" | text | no | — | — |
| "metadata" | text | no | — | "Free-form edge annotation. A STRING, unlike `Issue.metadata`." |
| "thread_id" | text | no | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    }
  }
}
```

<!-- bdp-schema:end Dependency bundle=issue-callables -->

<!-- bdp-schema:start Comment bundle=issue-callables -->
### Schema: "Comment"

Value: object

Required order: ["id", "issue_id", "author", "text", "created_at"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | — |
| "issue_id" | text | yes | — | — |
| "author" | text | yes | — | — |
| "text" | text | yes | — | — |
| "created_at" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "created_at": {
      "type": "string",
      "format": "date-time"
    }
  }
}
```

<!-- bdp-schema:end Comment bundle=issue-callables -->

<!-- bdp-schema:start BondRef bundle=issue-callables -->
### Schema: "BondRef"

Value: object

Required order: ["source_id", "bond_type"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A constituent of a compound molecule." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "source_id" | text | yes | — | — |
| "bond_type" | text | yes | — | — |
| "bond_point" | text | no | — | — |

<!-- bdp-schema:end BondRef bundle=issue-callables -->

<!-- bdp-schema:start Statistics bundle=issue-callables -->
### Schema: "Statistics"

Value: object

Required order: ["total_issues", "open_issues", "in_progress_issues", "closed_issues", "blocked_issues", "deferred_issues", "ready_issues", "pinned_issues", "epics_eligible_for_closure", "average_lead_time_hours"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Workspace summary counts. Two of them are DEPENDENCY-AWARE and two are structurally always zero; both facts are stated on the properties themselves, because every number here is the same JSON type and nothing else on the wire distinguishes them.\\n\\nThis is the struct `bd status --json` marshals under `summary`, pinned so the two surfaces are one compatibility domain." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "total_issues" | integer | yes | — | "Every row in the workspace-wide answer's scan, INCLUDING closed and pinned ones. The status counts below do not sum to it: a row whose status is none of the four falls into no bucket, and `pinned_issues` counts a flag that overlaps all of them." |
| "open_issues" | integer | yes | — | — |
| "in_progress_issues" | integer | yes | — | — |
| "closed_issues" | integer | yes | — | — |
| "deferred_issues" | integer | yes | — | — |
| "blocked_issues" | schema | yes | — | "Rows the dependency graph blocks — the transitive is_blocked flag, NOT the count of rows whose status is `blocked`. An open row with an unfinished blocker is counted here and its status is still `open`.\\n\\nNULL when `skip_blocked` was honored, always together with `ready_issues`. The two are nil together or populated together; there is no state in which one is knowable and the other is not.\\n\\nWhen `assignee` is set this is a different number: the count of that actor's rows whose STATUS is `blocked`, and never null." |
| "ready_issues" | schema | yes | — | "ARITHMETIC, not a query: `open_issues` minus `blocked_issues`, clamped at zero. It is NOT the cardinality of `GET /v0/beads/ready`, which applies type exclusions, the deferral window and a limit that none of this touches.\\n\\nNULL under the same conditions as `blocked_issues`.\\n\\nWhen `assignee` is set this is the real ready-work count for that actor, and never null." |
| "pinned_issues" | integer | yes | — | "Rows carrying the pinned flag, overlapping every status bucket. Always 0 when `assignee` is set: that answer tallies the five statuses and nothing else." |
| "epics_eligible_for_closure" | integer | yes | — | "ALWAYS 0. No implementation computes it, on any backend or either surface. It is documented rather than dropped because this schema is pinned to the struct both surfaces marshal, and a caller reading a 0 here is reading an absent computation rather than an answer." |
| "average_lead_time_hours" | number | yes | — | "ALWAYS 0, for the reason above." |
| "gate_issues" | integer | no | — | "Gate rows, which the default `bd list` suppresses on account of what they are rather than on any filter the caller passed.\\n\\nALREADY INCLUDED in `total_issues`, which counts the database rather than the listing — so this is a breakdown of that total, never an addition to it. It is broken out so the two surfaces can be reconciled instead of silently disagreeing about how many issues exist." |
| "template_issues" | integer | no | — | "Template rows, suppressed by the default `bd list` on the same terms as `gate_issues` and likewise already counted in `total_issues`.\\n\\nDo not sum the two: a row can be both a gate and a template, and would be counted once in each." |

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

<!-- bdp-schema:end Statistics bundle=issue-callables -->

<!-- bdp-schema:start CycleMember bundle=issue-callables -->
### Schema: "CycleMember"

Value: object

Required order: ["id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One node on a dependency cycle.\\n\\n`id` is always present, and its presence is what proves the node is on the cycle. `issue` is the row behind it, and is ABSENT — never null — when this workspace holds no record for that id: a target in another repository's namespace, an `external:` reference, or a row whose edges outlived it. That absence means the node cannot be DESCRIBED here, never that it is not really on the cycle.\\n\\n`issue` is spelled as a bare `$ref` with no sibling keywords, following the codegen note at the top of this document." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | — |
| "issue" | ref "#/$defs/Issue" | no | — | — |

<!-- bdp-schema:end CycleMember bundle=issue-callables -->

<!-- bdp-schema:start Cycle bundle=issue-callables -->
### Schema: "Cycle"

Value: object

Required order: ["members", "partial"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One circular blocking dependency: its members in EDGE ORDER, so `members[i]` blocks on `members[i+1]` and the last member blocks on the first. The closing edge is implied and is not repeated as a final member.\\n\\nThe rotation is canonical — the lowest id comes first — which is what makes two snapshots of an unchanged workspace comparable." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "members" | array of (ref "#/$defs/CycleMember") | yes | — | "The nodes, in edge order, starting at the lowest id. Never empty." |
| "partial" | boolean | yes | — | "True when at least one member has no `issue`. It is always present, including when false: a consumer must be able to read \\"this path is complete\\" from the answer rather than from the absence of a key.\\n\\n`members` is complete either way. This flag says the DESCRIPTIONS beside the ids are not." |

<!-- bdp-schema:end Cycle bundle=issue-callables -->

<!-- bdp-schema:start IssueBlocking bundle=issue-callables -->
### Schema: "IssueBlocking"

Value: object

Required order: ["id", "blocked_by", "blocks"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One issue's derived blocking decoration.\\n\\n`blocked_by` and `blocks` are ASCENDING BY ID with repeats collapsed, and both are always present — an empty array, never null and never absent, so a client reads \\"nothing blocks this\\" from the answer rather than from a missing key. `parent` is absent when the issue has none and when the parent it has is closed." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "The annotated id, spelled exactly as the request spelled it." |
| "blocked_by" | array of (text) | yes | — | "The OPEN issues this one is blocked by: the targets of its `blocks` edges whose own status is not closed." |
| "blocks" | array of (text) | yes | — | "The issues this one blocks. Empty when this issue is itself closed, which is the same rule `blocked_by` applies from the other end." |
| "parent" | text | no | — | "This issue's parent id. AT MOST ONE is reported; where an issue carries several `parent-child` edges, which one appears here is not specified. A client that needs every structural edge reads them from `GET /v0/beads/dependencies`." |
| "is_blocked" | boolean | no | — | "The issue's stored, transitive is_blocked flag — present only when the request carried `is_blocked=true` (capability `dependencies.blocking.isBlocked`) and the id names a row. Its absence never means \\"not blocked\\"." |

<!-- bdp-schema:end IssueBlocking bundle=issue-callables -->

<!-- bdp-schema:start ContextResponse bundle=issue-callables -->
### Schema: "ContextResponse"

Value: object

Required order: ["api_version", "bd_version", "schema_version", "backend", "dolt_mode", "database", "project_id", "capabilities", "wire_revision", "min_client_wire_revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The server's identity handshake. In particular the workspace's sync remote is EXCLUDED, in this and every future version, because remote URLs routinely embed credentials — as are the database bind host/port (advertising them invites clients to bypass this API and dial the database directly) and the loopback/non-loopback bind mode.\\n\\nTWO MEMBERS ARE OPTIONAL, and they are the only two that describe the SERVER's filesystem rather than the workspace's logical identity: `beads_dir` and `repo_root`. A client must be able to read them as absent. Everything a remote caller identifies a workspace by is elsewhere and stays required — `project_id`, `database`, `backend`, `dolt_mode` — and an absolute host path is not something a remote caller can act on in any case: it cannot open it. `bd serve` publishes both, so a client reading a `bd serve` today sees no change; what the relaxation buys is that a deployment which does not want to disclose its filesystem layout can withhold them and still serve a body that conforms to this document." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "api_version" | text | yes | — | "The path major this server serves. `v0` for this document." |
| "bd_version" | text | yes | — | "The release version of the serving binary. The only field a client may compare as a version, and only for behavioral changes tied to a release." |
| "schema_version" | integer | yes | — | "The shared JSON schema version — the same constant the CLI's stdout JSON envelope reports. Diagnostic only: it can move for CLI-only reasons with no HTTP wire change, so clients MUST NOT branch on it." |
| "backend" | text | yes | — | "Storage backend name." |
| "dolt_mode" | text | yes | — | "Which storage mode this workspace is served from." |
| "database" | text | yes | — | "Logical database name (not a host or a DSN)." |
| "beads_dir" | text | no | — | "Absolute path of the served workspace's `.beads` directory, when the server discloses it. A host path: `bd serve` publishes it because it is a single-workspace server's most legible workspace-identity handshake for the operator reading it, and disclosing it to network peers is part of what that operator accepts when binding beyond loopback.\\n\\nOPTIONAL, and absent means only that this server does not disclose its filesystem layout — never that it has no workspace. A client MUST NOT require it, MUST NOT treat absence as an error, and has no use for the value beyond display: it is a path on the SERVER's filesystem, which the client cannot open. Identify the workspace by `project_id` and `database`, which are required." |
| "repo_root" | text | no | — | "Absolute path of the served repository root, when the server discloses it. OPTIONAL on the same terms as `beads_dir`; see it." |
| "project_id" | text | yes | — | "Logical project identifier." |
| "capabilities" | array of (text) | yes | — | "The tokens this server advertises: the OPERATIONS it implements, derived from its route table, and the server-wide BEHAVIORS it enforces. v0's operation vocabulary is `ready.list`, `ready.count`, `blocked.list`, `issues.list`, `issues.query`, `issues.count`, `issues.get`, `issues.related`, `issues.create`, `issues.addComment`, `issues.batchClose`, `issues.claim`, `issues.claimNext`, `issues.release`, `issues.heartbeat`, `issues.close`, `issues.reopen`, `issues.update`, `issues.sweep`, `issues.delete`, `issues.batchGet`, `issues.reclaim`, `issues.batchCreate`, `issues.batchApply`, `stats.get`, `config.list`, `config.get`, `config.set`, `config.unset`, `dependencies.cycles`, `dependencies.list`, `dependencies.count`, `dependencies.blocking`, `dependencies.tree`, `dependencies.add`, `dependencies.remove`, `memories.list`, `memories.get`, `memories.remember`, `memories.forget`, `events.list`, `events.watch`, `issues.casMetadata`, `issues.advanceMolecule`; the behavior tokens are `project.enforce`, which announces that a `Bd-Project-Id` stamp for the wrong workspace is refused here rather than silently ignored, `issues.batchApplyLarge`, which announces that `POST /v0/beads/issues:batchApply` accepts the RAISED envelope — up to 1000 items (`ApplyBatchRequest.items.maxItems`), a 16 MiB body, and (for a request over 100 items) a run budget that EXTENDS to an operator-configured ceiling (`bd serve --large-apply-ceiling`, 5 minutes by default) — rather than the original 100-item, 4 MiB bound. The ceiling is a flat whole-run budget, not a value scaled by item count: a 101-item request and a 1000-item request both get the same extended budget. A request at or under 100 items is unaffected either way and keeps the server's ordinary deadline exactly as before. A client that checks for this token before sending a plan over 100 items learns whether THIS server accepts it without paying for a round trip an older server would refuse anyway, and `issues.list.sort`, which announces that `GET /v0/beads/issues` accepts the `sort` query parameter (two closed, pageable total orders — see that parameter) rather than silently answering `unknown_parameter`, and `issues.count.scope`, which announces that `GET /v0/beads/issues:count` accepts `parent`, `no_parent`, `exclude_type`, and `exclude_status` (see those parameters) rather than silently answering `unknown_parameter` for all four, `issues.sweep.wispsPlane`, which announces that `POST /v0/beads/issues:sweep` accepts the `wisps-plane` value of `tier` rather than silently answering `invalid_value`, `issues.sweep.liveDependents`, which announces that the same operation accepts `protect_live_dependents` and answers `skipped.live_dependent` rather than silently answering `unknown_parameter`, `issues.sweep.limit`, which announces that it accepts `limit` and answers `remaining` rather than silently answering `unknown_parameter`, `issues.sweep.retainIds`, which announces that the same operation accepts `retain_ids` and answers `retain_ids` rather than silently answering `unknown_parameter` — and, with it, that EVERY create on this surface refuses an id a retaining sweep retired with `410` `idempotency_expired` rather than re-creating it, `issues.sweep.retainedTypes`, which announces that the same operation holds back every candidate whose issue type the workspace's types.retained setting names unless the request sets `retain_ids`, and answers `skipped.retention_required` — an older server deletes those beads without retiring their ids, `issues.batchApply.depAddLineage`, which announces that a `dep_add` item on `POST /v0/beads/issues:batchApply` accepts `has_spawner` and `thread_id` (see `ApplyDepAddItem`) rather than a `400` naming the member unknown, and `issues.update.allowTemplate`, which announces that `PATCH /v0/beads/issues/{id}` accepts `allow_template` (see `UpdateIssueRequest`) rather than a `400` naming the member unknown, and `issues.update.persistence`, which announces that `PATCH /v0/beads/issues/{id}` accepts a `persistence` member in its `patch` (see `IssuePatchBody`), the plane move behind `bd promote`, rather than a `400` naming the member unknown, and `issues.create.defaultPriority`, which announces that a create (`POST /v0/beads/issues`, `issues:batchCreate` and `issues:batchApply` create items) with no `priority` member stores the default P2 rather than P0, and `issues.close.autoCloseMolecule`, which announces that `POST /v0/beads/issues/{id}:close` and `POST /v0/beads/issues:batchClose` accept `auto_close_molecule` and answer `auto_closed_molecule` and `molecule_auto_close_refusal` rather than a `400` naming the member unknown, `issues.list.search`, which announces that `GET /v0/beads/issues` accepts `q`, `bd search`'s free text (see that parameter), rather than silently answering `unknown_parameter`, `issues.list.noAssignee`, `issues.list.title` and `issues.list.ids`, which announce that `GET /v0/beads/issues` accepts `no_assignee`, `title` and the repeatable `id` respectively (`bd list --no-assignee`, `--title` and `--id`; see those parameters) rather than answering `unknown_parameter`, `dependencies.blocking.isBlocked`, which announces that `GET /v0/beads/dependencies/blocking` accepts `is_blocked` and answers each item's stored, transitive `is_blocked` flag (see that parameter) rather than silently answering `unknown_parameter`, and `issues.update.claim`, which announces that `PATCH /v0/beads/issues/{id}` accepts `claim` (see `UpdateIssueRequest`) and resolves the claimed id on both planes, so a wisp is claimable there, rather than a `400` naming the member unknown, and `issues.create.gates`, which announces that `POST /v0/beads/issues` and `issues:batchApply` create items accept the gate members `await_type`, `await_id`, `timeout` and `waiters` (see `CreateIssueRequest`), and `issues.update.gates`, which announces that `PATCH /v0/beads/issues/{id}`'s `patch` and an `issues:batchApply` update item's `patch` accept `await_id` and `waiters` (see `IssuePatchBody`), each rather than a `400` naming the member unknown, and `issues.list.filters`, which announces that `GET /v0/beads/issues` accepts the rest of `bd list`'s filter vocabulary (the updated, closed, defer and due bounds, the priority range, the text, external-ref, label-pattern, label-regex and spec matches, and the empty-description, no-labels, no-parent, exclude-type, exclude-status, pinned, no-pinned, deferred, overdue, mol-type and wisp-type filters; see those parameters) rather than answering `unknown_parameter`, and `issues.arrivalSeq`, which announces that every Issue-shaped schema carries `arrival_seq`, the commit-ordered create sequence storage stamps on a wisp-plane record (see `Issue.arrival_seq`; build-level like the others — records are stamped only while the workspace journals, which `GET /v0/beads/events` reports by answering `409 events_journal_disabled` when it does not), and `issues.delete.containmentCascade`, which announces that `issues:delete`'s `cascade` deletes only the named beads' parent-child descendants and orphans every other dependent (see `DeleteIssuesRequest.cascade`; a server without it deletes every transitive dependent, so a client refuses to send `cascade` to one). One behavior token is CONDITIONAL rather than build-level: `policy.external_dependencies` announces that this server's ready, blocked-listing, claim, claim-next, close, blocking and dependency-tree operations already apply bd's external-dependency policy (an issue blocked by an unsatisfied `external:<project>:<capability>` dependency is neither ready, claimable nor closable without force, and the blocked listing lists it with that dependency in its `blocked_by`). A server advertises it only when it enforces that policy; a client that sees it must not apply the policy again, and a client that does not see it applies the policy itself. The list grows additively, and an operation never appears here unless it is fully implemented. This is how a client checks for an operation or a behavior — never the version string.\\n\\nTHIS LIST IS BUILD-LEVEL, NOT WORKSPACE-LEVEL, apart from the conditional `policy.external_dependencies` above, which depends on how this server composed its roles rather than on the build. It says which operations this binary serves, and for every entry but two that is the whole answer. `events.list` and `events.watch` are the exceptions: the durable events journal is a per-workspace setting that is OFF by default, so a server that advertises them may still refuse every request to both with 409 `events_journal_disabled` — correctly, because the operations exist and the workspace has no journal. A consumer of either MUST treat the capability as \\"this server speaks it\\" and the 409 as \\"not on this workspace\\", and must not read the capability as a promise that records will arrive." |
| "wire_revision" | integer | yes | — | "A counter bumped on every release whose wire format changed in a way an unaware client could MISDECODE: an existing member's JSON type or meaning changed, or a member was removed or renamed. Adding a brand-new member to an existing schema, or a brand-new operation, is ADDITIVE and never bumps it — an old client simply never asks for the new member and is unaffected. That promise does not extend to a new REQUIRED request input (a request-body member or a parameter): it misdecodes nothing, so it bumps nothing, but an old client that never sends it is refused. The drift gate below records a new required parameter or body member as an ordinary addition and asks for no bump, so keeping old clients working through one is that change's own review's job.\\n\\nRevision history, and it only ever grows by appending a row:\\n\\n* `0` — every server before 1.3.0. `revision` and\\n  `expected_version` were JSON integers, and this field did not\\n  exist: an absent `wire_revision` together with a `bd_version`\\n  below `1.3.0` IS a `0`.\\n* `1` — 1.3.0 up to, but not including, the release that adds this\\n  field. `revision` and `expected_version` moved to DECIMAL-STRING\\n  tokens (#6053) under the same `api_version: \\"v0\\"`, with nothing\\n  in the handshake to tell an integer-expecting client the shape\\n  had moved underneath it. That silent gap is the whole reason\\n  this field exists.\\n* `2` — the first release whose `ContextResponse` carries\\n  `wire_revision` and `min_client_wire_revision` at all. Still\\n  current: S4 widened `SweepRequest.tier`'s enum to add\\n  `wisps-plane` and added `protect_live_dependents` and `limit`\\n  alongside it, and none of the three bumped this counter.\\n  `SweepRequest` is a REQUEST-body-only schema — no response ever\\n  carries it — so nothing decodes it out of a server reply; the\\n  new enum member and the two new fields are each something only\\n  an UPDATED CLIENT chooses to send, behind their own behavior\\n  tokens (`issues.sweep.wispsPlane`, `issues.sweep.liveDependents`,\\n  `issues.sweep.limit`). An old client that never sends any of the\\n  three has nothing to misdecode, which is exactly the additive\\n  case this field exists to NOT gate. The wireshape drift gate\\n  (`internal/httpapi/wireshape`) tracks, per member, whether it is\\n  reachable from a request body, a response, or both, and treats\\n  an enum WIDENING as additive only on a request-only member —\\n  the identical widening on a response-side (or request+response)\\n  member still counts as changed and still demands a bump, since\\n  an existing client decoding a response must keep recognizing\\n  every value the server might send it.\\n\\nPRESENCE, not just value: a generated client whose JSON decoder zero-values a missing integer field cannot tell, by looking at a decoded `0` alone, whether the server SENT `0` or sent nothing. This is never actually ambiguous in practice, because `0` and `1` are PERMANENTLY RETIRED values — they describe servers that predate this field or carried the brief interim string shape, and no server that implements this field (`CurrentWireRevision` starts at `2` and only increases) will ever legitimately send a literal `0` or `1`. A decoded `0` can therefore only mean \\"this server omitted the field,\\" and a client inferring from `bd_version` per the paragraph below is doing exactly the right thing in that case, never guessing at a value the field could have meant on its own. A client that wants presence as a first-class fact rather than an inference anyway should decode `wire_revision` into a nullable type, or check for the JSON key's presence directly, instead of relying on this retirement guarantee.\\n\\nA client talking to a server that omits this member entirely is talking to a pre-signal server. `bd_version` is a HINT for that case, never proof: compare it as semver WITH PRE-RELEASE identifiers, and treat `>= 1.3.0-rc.1` — not the release cutoff `1.3.0` itself — as a hint toward `1`, anything below as a hint toward `0`. The release cutoff is wrong on its own because a `1.3.0-rc.N` pre-release build already carries the `1` shape and sorts BELOW `1.3.0`.\\n\\nKnown exceptions make even that corrected hint unreliable, which is why it is advisory rather than authoritative:\\n\\n* Builds from `main` up to commit `b3ef65c85` report\\n  `bd_version: \\"1.2.2\\"` — below the `1.3.0-rc.1` hint cutoff —\\n  while already sending the string-typed shape (`1`, not `0`).\\n* The bd-enterprise compatibility line at commit `d3ab32773462`\\n  reports `bd_version: \\"1.1.0\\"` while also sending the\\n  string-typed shape.\\n\\nBecause builds like these exist, a client MUST NOT trust the inferred revision to pick a decoder. Instead it MUST do ONE of: accept `revision` and `expected_version` as EITHER a JSON string OR a JSON number whenever `wire_revision` is absent, or probe the actual shape directly (for instance by inspecting the JSON type of a `revision` value already in hand). A client MUST NEVER refuse a request solely because the inferred revision is `0` — `0` here means only \\"this is an unreliable hint,\\" never a confirmed fact to gate decoding on by itself. A client that still cannot cope with either shape after probing must refuse to proceed rather than guess, exactly as it would for a `wire_revision` it read directly and does not understand.\\n\\nThis document's own drift gate is `TestWireShapeDigest` (`internal/httpapi/wireshape`): a golden digest of every EXISTING response member AND request body member's (schema, member, type, format, enum, required, nullable), plus the item shape of an array member and the value shape of an `additionalProperties` map, recursing through `$ref` and through a schema's own `allOf` or `oneOf`. The same digest also covers every operation PARAMETER (query, path and header) across every operation, keyed by operationId + location + name rather than by schema, recording its type, item shape (for an array parameter), enum, required, style, explode and default — style and explode as their effective values, OpenAPI's defaults filled in where the document leaves them unset. It fails CI the moment any one of these — member or parameter — changes without this field's Go constant (`CurrentWireRevision`, `internal/httpapi/wire_revision.go`) increasing to match. Regenerate the golden with `go run ./internal/httpapi/wireshape/cmd/gendigest` after a deliberate, revision-bumped change, and commit the result — see that package's doc.go for the exact command. A purely additive member, parameter or operation also changes the golden (it is appended to, never frozen in place) but needs no revision bump to pass; the command itself refuses to write a changed or removed entry at an unbumped revision, refuses any write at a LOWER revision than the golden records, and refuses to create a golden that does not exist yet unless run with `-init`. The digest is a boundary, not the whole wire: value constraints such as `maxLength`, `maximum`, `pattern` or `maxItems` are outside it, on members and parameters alike, and so is a composition keyword on a single member's own value (this document uses none); an object-typed parameter, or one described by `content` rather than `schema`, is recorded only as its container. Narrowing a constraint trips no gate, so such a change must be weighed against this counter in its own review.\\n\\nEvery request PARAMETER (query, path or header) and every request BODY MEMBER, added to an EXISTING operation after this document, must carry a capability token in its own description, exactly as `capabilities` members do above — `TestNewParameterOnExistingOperationHasABehaviorToken` enforces it against two frozen baselines (`internal/httpapi/testdata/pretoken_parameters.json` for parameters, `pretoken_request_body_members.json` for body members) of every parameter and body member this document already had the day each rule was written. A member on its baseline is grandfathered and never needs a token; any member not on it — present now or added later, on an operation that already existed when the relevant baseline was frozen — must carry one today. A BRAND-NEW operation (one absent from the third frozen file, `pretoken_operations.json`) is exempt entirely: its own review decides its capability story, not a baseline written before it existed. The token itself must also be one `Capabilities()` actually serves — a backticked string merely shaped like a token proves nothing on its own. All three baselines are written once and never regenerated: only a pre-existing, untokened member or operation ever belongs on them, a newly tokened member satisfies the rule without needing an entry at all, and `TestPretokenBaselinesNeverGrow` pins their sizes so nothing can hand-add a new exemption instead of a token. `issues.list.sort` is the first deliberate use of the parameter rule; it also closes the one gap the rule was written to catch, since `sort` itself shipped (#5666) with no token at all." |
| "min_client_wire_revision" | integer | yes | — | "The OLDEST client `wire_revision` this server still answers correctly. A client whose own compiled `wire_revision` is below this number should refuse to dial at all, the same way it refuses an unknown `api_version`: nothing it does with a response shaped for this revision is safe to assume.\\n\\nA client MAY declare the revision it was built for on every request with the optional `Bd-Wire-Revision` header (see the document-level rule above). When it does, and the declared value is below this member, the server refuses with `400` / `code: invalid_argument` / `param: \\"Bd-Wire-Revision\\"` / `reason: \\"wire_revision_unsupported\\"` rather than risk serving a body the caller has already said it cannot decode. The header is OPTIONAL and an absent one is served exactly as today — this is additive wire surface, not a new precondition on requests already in the field, exactly as `Bd-Project-Id` is." |

<!-- bdp-schema:end ContextResponse bundle=issue-callables -->

<!-- bdp-schema:start IssueCount bundle=issue-callables -->
### Schema: "IssueCount"

Value: object

Required order: ["total"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The size of a matching set, and its buckets when `group_by` asked for them. It carries no items and no cursor: this is a number about a set, and the operations that return rows are `GET /v0/beads/issues` and `GET /v0/beads/issues:query`.\\n\\nONE SCHEMA FOR BOTH SHAPES, because the grouped answer is the scalar answer plus one member rather than a different answer. See the operation's own description for why that is one operation and not two." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "total" | schema | yes | — | "How many issues match. Never negative; `0` when nothing matches, which is a 200 rather than a 404 — a question about a set has an answer even when the set is empty, and a client polling for work would otherwise have to classify an error to read a zero.\\n\\nUnder `group_by` this is still the cardinality of the WHOLE matching set and NOT the sum of `groups`. The two differ for `label`, whose buckets overlap; see the operation description." |
| "groups" | schema | no | — | "Bucket key to cardinality, PRESENT exactly when the request carried `group_by` and ABSENT otherwise. That absence is the answer to \\"you did not ask for buckets\\"; an empty OBJECT is the answer to \\"nothing matched\\", and the two are deliberately different — a client must be able to tell a scalar count from a grouped count of an empty set without re-reading its own request.\\n\\nBuckets with no rows are absent rather than present at zero. The dimensions are open-ended — any assignee, any label, any custom status — so there is no closed set of keys to enumerate and a client reads an absent key as zero. The KEY normalization is part of the contract and is documented on `group_by`." |

#### Advanced

```json-schema
{
  "properties": {
    "total": {
      "type": "integer",
      "format": "int64"
    },
    "groups": {
      "type": "object",
      "additionalProperties": {
        "type": "integer"
      }
    }
  }
}
```

<!-- bdp-schema:end IssueCount bundle=issue-callables -->

<!-- bdp-schema:start ReadyCount bundle=issue-callables -->
### Schema: "ReadyCount"

Value: object

Required order: ["total"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The size of a ready set. It carries no items, no `has_more` and no cursor: this is a number about a set, and the operation that returns rows is `GET /v0/beads/ready`.\\n\\nThere is no canonical struct here — the CLI publishes this number inside its own stdout envelope's `pagination` member, which is not a wire type — so pinning would weld this body to a CLI presentation type instead of preventing a drift." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "total" | schema | yes | — | "How many items `GET /v0/beads/ready` would return for these filters with `limit=0`. Never negative; 0 when nothing is ready, which is a 200 rather than a 404 — a question about a set has an answer even when the set is empty." |

#### Advanced

```json-schema
{
  "properties": {
    "total": {
      "type": "integer",
      "format": "int64"
    }
  }
}
```

<!-- bdp-schema:end ReadyCount bundle=issue-callables -->

<!-- bdp-schema:start DeleteIssuesResult bundle=issue-callables -->
### Schema: "DeleteIssuesResult"

Value: object

Required order: ["dry_run", "deleted", "dependencies", "labels", "events", "references_updated"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "What one delete did. Every number describes the SAME snapshot, because the guard, the deletion and the reference rewrite ran in one transaction.\\n\\n`bd delete --json` publishes these numbers under its own per-shape keys (`deleted_count`, `dependencies_removed`, and a scalar `deleted` on the single-id form), which are a stdout presentation rather than a wire type, so pinning would weld this body to one of them." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "dry_run" | boolean | yes | — | "Echoes the request, so a result carries whether its numbers describe beads that are gone or beads that would go." |
| "deleted" | integer | yes | — | "How many beads were deleted, or under `dry_run` would be. Under `cascade` this counts the whole closure, so it is normally larger than `ids` and it — not the request length — is the number to show." |
| "dependencies" | integer | yes | — | "Dependency edge rows removed with them, in either direction. Reported because a delete's visible effect is much larger than its bead count." |
| "labels" | integer | yes | — | "Label rows removed with the deleted beads." |
| "events" | integer | yes | — | "Event rows removed with the deleted beads." |
| "references_updated" | integer | yes | — | "How many SURVIVING beads had their text rewritten — beads, not occurrences. Always 0 under `dry_run`, because a preview rewrites nothing." |
| "orphaned" | array of (text) | no | — | "The surviving beads that depended on something this request deleted, in ascending id order. Present when the request carried `cascade` (a cascade follows parent-child edges only, so a bead joined to the deleted tree by any other edge survives it) or `force` without `cascade`, and some bead was orphaned; absent otherwise.\\n\\nDIRECT dependents only. A bead two edges away lost no edge." |
| "deleted_ids" | array of (text) | no | — | "The beads `deleted` counts, in ascending id order without duplicates: under `cascade`, the whole parent-child closure. Under `dry_run` it names the beads that would go, so a preview and the deletion that follows it can be compared id for id.\\n\\nOptional, because a server older than this member does not send it; a client reading such a server gets no names, never wrong ones." |

<!-- bdp-schema:end DeleteIssuesResult bundle=issue-callables -->

<!-- bdp-schema:start BatchGetIssuesResult bundle=issue-callables -->
### Schema: "BatchGetIssuesResult"

Value: object

Required order: ["issues", "missing"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The issues that resolved, hydrated, plus the ids that did not — both read from the SAME snapshot. Never a `404`: an id naming no stored row is reported in `missing`, not refused, the same set-read answer `DependencyEdges` and `EdgeCounts` give." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issues" | array of (ref "#/$defs/BatchGetIssue") | yes | — | "One entry per requested id that resolved, in the REQUEST's order (the caller's first mention of each distinct id), never the storage engine's natural order. Each issue carries its current `revision`, so a caller that goes on to write one back has the optimistic-concurrency token a lifecycle write wants without a second round trip. Empty array (never null) when nothing resolved.\\n\\nHYDRATION IS LABELS ONLY: no dependencies, dependents or comments — use `GET /v0/beads/issues/{id}` (`IssueDetails`) for those." |
| "missing" | array of (text) | yes | — | "The requested ids that resolved to no stored row, in the same first-mention order as the request. An id here contributes no entry to `issues`, and the two arrays' lengths always sum to the number of DISTINCT ids the request named. Empty array (never null) when every named id resolved." |

<!-- bdp-schema:end BatchGetIssuesResult bundle=issue-callables -->

<!-- bdp-schema:start ReclaimIssuesResult bundle=issue-callables -->
### Schema: "ReclaimIssuesResult"

Value: object

Required order: ["reclaimed"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Every row the sweep reverted, in the order the sweep found them." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "reclaimed" | array of (ref "#/$defs/ReclaimedLease") | yes | — | "One entry per reverted row. Empty array (never null) when nothing was stale in scope." |

<!-- bdp-schema:end ReclaimIssuesResult bundle=issue-callables -->

<!-- bdp-schema:start ReclaimedLease bundle=issue-callables -->
### Schema: "ReclaimedLease"

Value: object

Required order: ["id", "previous_owner", "revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One row a lease sweep reverted." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "The reverted issue's id." |
| "previous_owner" | text | yes | — | "The assignee the stale lease was taken from; empty when the row carried none." |
| "revision" | text | yes | — | "The row's NEW revision, minted by the revert: the optimistic-concurrency token a guarded write after the reclaim needs. A decimal string, like every `revision` on this surface." |

<!-- bdp-schema:end ReclaimedLease bundle=issue-callables -->

<!-- bdp-schema:start SweepResult bundle=issue-callables -->
### Schema: "SweepResult"

Value: object

Required order: ["dry_run", "swept", "dependencies", "labels", "events", "skipped"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "What one sweep did. Every number describes the SAME snapshot, because the selection and the deletion ran in one transaction.\\n\\nThe CLI publishes these numbers under its own per-command keys (`purged_count`, `pruned_count`), which are a stdout presentation rather than a wire type, so pinning would weld this body to one of them." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "dry_run" | boolean | yes | — | "Echoes the request, so a result carries whether its numbers describe beads that are gone or beads that would go." |
| "swept" | integer | yes | — | "How many beads were deleted, or under `dry_run` would be." |
| "dependencies" | integer | yes | — | "Dependency edge rows removed with them. Reported because a sweep's visible effect is much larger than its bead count." |
| "labels" | integer | yes | — | "Label rows removed with the swept beads." |
| "events" | integer | yes | — | "Event rows removed with the swept beads." |
| "skipped" | ref "#/$defs/SweepSkips" | yes | — | — |
| "referenced_ids" | array of (text) | no | — | "A BOUNDED SAMPLE of the ids `skipped.referenced` counts — at most 100, in the order the candidate query returned them. It is a sample, not the set: compare its length against 100 to tell a truncated one from a complete one. Absent when nothing was protected." |
| "remaining" | schema | no | — | "How many beads this sweep's own selection left unswept because `limit` cut it off, oldest-closed-first. Always 0 when `limit` was absent, zero, or at least as large as the matching set — never a dropped count, a 0 here means nothing was left over. Present only behind the `issues.sweep.limit` behavior token." |
| "retain_ids" | boolean | no | — | "Echoes the request's `retain_ids`: `true` means every bead `swept` counts is now a retired id (under `dry_run`, would be). Present only behind the `issues.sweep.retainIds` behavior token." |

#### Advanced

```json-schema
{
  "properties": {
    "remaining": {
      "type": "integer",
      "format": "int64"
    }
  }
}
```

<!-- bdp-schema:end SweepResult bundle=issue-callables -->

<!-- bdp-schema:start SweepSkips bundle=issue-callables -->
### Schema: "SweepSkips"

Value: object

Required order: ["pinned", "referenced", "not_closed", "unknown_closed_at", "closed_at_or_after_cutoff", "unreadable"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The candidates a sweep declined to delete, bucketed by WHY. They are separate counters rather than one number because they mean different things: `pinned`, `referenced`, `live_dependent` and `retention_required` are PROTECTIONS, and the other four are the sweep declining to trust its own input." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "pinned" | integer | yes | — | "Candidates protected by the pinned flag. No request member overrides it — a caller who wants a pinned bead gone unpins it first." |
| "referenced" | integer | yes | — | "Candidates protected by `protect_referenced`. Always 0 when that member is false or absent, so a 0 read without having asked says nothing about whether beads are cited." |
| "not_closed" | integer | yes | — | "Candidates the tier query returned that the recheck found were not closed. A NON-ZERO VALUE HERE IS A DEFENSE FIRING, not a normal outcome: the query asked for exactly the beads this excludes." |
| "unknown_closed_at" | integer | yes | — | "Closed candidates carrying no close timestamp. See `not_closed`." |
| "closed_at_or_after_cutoff" | integer | yes | — | "Candidates whose close timestamp did not satisfy `closed_before`. See `not_closed`." |
| "unreadable" | integer | yes | — | "Rows the tier query returned as nothing at all. A defense of the same kind, on a shape rather than a value." |
| "live_dependent" | integer | no | — | "Candidates protected by `protect_live_dependents`. Always 0 when that member is false or absent. Present only behind the `issues.sweep.liveDependents` behavior token." |
| "retention_required" | integer | no | — | "Candidates held back because their issue type is named in the workspace's `types.retained` setting and the request did not set `retain_ids`: such a bead's id is an idempotency key, so only a retaining sweep may delete it. Always 0 when `retain_ids` is true. A PROTECTION, like `pinned`; a caller that wants those beads gone re-runs with `retain_ids`. Present only behind the `issues.sweep.retainedTypes` behavior token." |

<!-- bdp-schema:end SweepSkips bundle=issue-callables -->

<!-- bdp-schema:start ReadyPage bundle=issue-callables -->
### Schema: "ReadyPage"

Value: object

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/IssueWithCounts") | yes | — | "Empty array (never null) when nothing is ready." |
| "has_more" | boolean | yes | — | "True when the limit truncated the result. There is no cursor on this operation; narrow the filters or raise the limit." |

<!-- bdp-schema:end ReadyPage bundle=issue-callables -->

<!-- bdp-schema:start BlockedIssue bundle=issue-callables -->
### Schema: "BlockedIssue"

Value: object

Required order: ["id", "title", "priority", "created_at", "updated_at", "blocked_by_count", "blocked_by"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "An `Issue` plus the blockers bd names for it. This is the element type of `/v0/beads/blocked`, matching what `bd blocked --json` emits. Property semantics are documented on `Issue`." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | — |
| "title" | text | yes | — | — |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "acceptance_criteria" | text | no | — | — |
| "notes" | text | no | — | — |
| "spec_id" | text | no | — | — |
| "status" | text | no | — | — |
| "priority" | integer | yes | — | — |
| "issue_type" | schema | no | — | "A Bead Type reference (§2)." |
| "is_blocked" | boolean | no | — | — |
| "assignee" | text | no | — | — |
| "owner" | text | no | — | — |
| "estimated_minutes" | integer | no | — | — |
| "created_at" | schema | yes | — | — |
| "created_by" | text | no | — | — |
| "updated_at" | schema | yes | — | — |
| "started_at" | schema | no | — | — |
| "closed_at" | schema | no | — | — |
| "close_reason" | text | no | — | — |
| "closed_by_session" | text | no | — | — |
| "lease_expires_at" | schema | no | — | — |
| "heartbeat_at" | schema | no | — | — |
| "lease_granted_node" | text | no | — | — |
| "due_at" | schema | no | — | — |
| "defer_until" | schema | no | — | — |
| "external_ref" | text | no | — | — |
| "source_system" | text | no | — | — |
| "metadata" | schema | no | — | — |
| "compaction_level" | integer | no | — | — |
| "compacted_at" | schema | no | — | — |
| "compacted_at_commit" | text | no | — | — |
| "original_size" | integer | no | — | — |
| "labels" | array of (text) | no | — | — |
| "dependencies" | array of (ref "#/$defs/Dependency") | no | — | — |
| "comments" | array of (ref "#/$defs/Comment") | no | — | "The issue's comment bodies. On a listing they are populated only when the caller opts in (`bd list --include-comments`); absent otherwise, which is what `comment_count` and `comments_omitted` report about." |
| "sender" | text | no | — | — |
| "ephemeral" | boolean | no | — | — |
| "no_history" | boolean | no | — | — |
| "wisp_type" | text | no | — | — |
| "storage_class" | text | no | — | — |
| "arrival_seq" | schema | no | — | — |
| "pinned" | boolean | no | — | — |
| "is_template" | boolean | no | — | — |
| "bonded_from" | array of (ref "#/$defs/BondRef") | no | — | — |
| "await_type" | text | no | — | — |
| "await_id" | text | no | — | — |
| "timeout" | schema | no | — | — |
| "waiters" | array of (text) | no | — | — |
| "source_formula" | text | no | — | — |
| "source_location" | text | no | — | — |
| "mol_type" | text | no | — | — |
| "work_type" | text | no | — | — |
| "event_kind" | text | no | — | — |
| "actor" | text | no | — | — |
| "target" | text | no | — | — |
| "payload" | text | no | — | — |
| "blocked_by_count" | integer | yes | — | "The length of `blocked_by`." |
| "blocked_by" | array of (text) | yes | — | "The ids bd names as this issue's blockers: its active blocking targets, else its parent, plus any unsatisfied `external:` refs where the external-dependency policy applies. Never null." |

#### Advanced

```json-schema
{
  "properties": {
    "issue_type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    },
    "started_at": {
      "type": "string",
      "format": "date-time"
    },
    "closed_at": {
      "type": "string",
      "format": "date-time"
    },
    "lease_expires_at": {
      "type": "string",
      "format": "date-time"
    },
    "heartbeat_at": {
      "type": "string",
      "format": "date-time"
    },
    "due_at": {
      "type": "string",
      "format": "date-time"
    },
    "defer_until": {
      "type": "string",
      "format": "date-time"
    },
    "metadata": {
      "type": "object",
      "additionalProperties": true
    },
    "compacted_at": {
      "type": "string",
      "format": "date-time"
    },
    "arrival_seq": {
      "type": "integer",
      "format": "int64"
    },
    "timeout": {
      "type": "integer",
      "format": "int64"
    }
  }
}
```

<!-- bdp-schema:end BlockedIssue bundle=issue-callables -->

<!-- bdp-schema:start BlockedPage bundle=issue-callables -->
### Schema: "BlockedPage"

Value: object

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/BlockedIssue") | yes | — | "Empty array (never null) when nothing is blocked." |
| "has_more" | boolean | yes | — | "Always false in v0: this operation takes no limit, so the listing is never truncated. Present so that adding a bound later is additive." |

<!-- bdp-schema:end BlockedPage bundle=issue-callables -->

<!-- bdp-schema:start CyclesPage bundle=issue-callables -->
### Schema: "CyclesPage"

Value: object

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/Cycle") | yes | — | "Empty array (never null) when the workspace has no cycles. Its LENGTH is the total: a cycle whose members this workspace cannot describe is still counted here, so the number cannot shrink because a row went missing." |
| "has_more" | boolean | yes | — | "Always false in v0: this operation takes no limit, so the report is never truncated. Present so that adding a bound later is additive." |

<!-- bdp-schema:end CyclesPage bundle=issue-callables -->

<!-- bdp-schema:start DependencyTreePage bundle=issue-callables -->
### Schema: "DependencyTreePage"

Value: object

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/TreeNode") | yes | — | "The walked nodes in DEPTH-FIRST PRE-ORDER: a node appears before every node it led to, and a subtree is contiguous. Never null.\\n\\nIt is empty only when a `status` filter matched nothing — the root is kept in a filtered answer solely as an ancestor of a match, never for its own sake. Without `status` the root is always the first element, which is what lets a client tell \\"this issue depends on nothing\\" from \\"this issue is not there\\" (a 404)." |
| "has_more" | boolean | yes | — | "Always false in v0: this operation takes no limit, so the walk is bounded by `max_depth` rather than truncated after the fact. Present so that adding a bound later is additive." |

<!-- bdp-schema:end DependencyTreePage bundle=issue-callables -->

<!-- bdp-schema:start IssuesPage bundle=issue-callables -->
### Schema: "IssuesPage"

Value: object

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/IssueWithCounts") | yes | — | "Empty array (never null) when nothing matches." |
| "has_more" | boolean | yes | — | — |
| "next_cursor" | text | no | — | "Present if and only if `has_more` is true. Pass it back verbatim as `cursor` to fetch the next page. Opaque and server-private." |

<!-- bdp-schema:end IssuesPage bundle=issue-callables -->

<!-- bdp-schema:start EventRecord bundle=issue-callables -->
### Schema: "EventRecord"

Value: object

Required order: ["seq", "ts", "op", "issue_id", "issue"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One record of the durable events journal: a single committed issue mutation, as a replaying consumer receives it.\\n\\nTHIS IS THE CLI'S RECORD. A committed golden fixture pins that encoding field by field.\\n\\n`issue` is the full issue state AFTER the mutation and is ALWAYS PRESENT, carrying the literal `null` on a delete — where there is no surviving row to describe. That is the one place this document's general \\"treat null as absent\\" rule does not apply to a member's meaning: a consumer must be able to tell a delete from a payload the server failed to record, so the member is emitted rather than omitted. `dep` and `comment` are the opposite: they are ABSENT on the ops that have no such half, because their absence says the op has none, not that one was empty." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "seq" | schema | yes | — | "Counter-assigned inside the mutation's own transaction: gapless, strictly increasing in commit order, never reused and never reset. This is the value to pass back as `since`. It is scoped to ONE replica — see the operation description." |
| "ts" | text | yes | — | "UTC insert time, stamped inside the committing transaction and normalized to RFC 3339. It is NOT monotone in `seq`: two writers against one SQL server, or a clock stepped back by NTP, can commit an earlier `seq` with a later timestamp. Order by `seq`, never by this." |
| "op" | text | yes | — | "What was done: `create`, `update`, `close`, `delete`, `dep_add`, `dep_remove` or `comment`. The set is closed in v0; a client MUST default-branch on an unknown value rather than fail, so that adding one stays additive." |
| "issue_id" | text | yes | — | "The mutated issue's canonical id." |
| "actor" | text | no | — | "The acting identity that performed the mutation, as resolved for the audit-events table; on a `comment` record it is the comment's author (the same value as `comment.author`). Absent when the mutation path has no actor — derived maintenance, deletes (other than a rename's synthetic `delete` record), and records written before the journal recorded actors. An absent actor is never user attribution: read it as system/unknown, not as a conflicting writer." |
| "issue" | schema | yes | — | "Under §2, it is an `Issue`, and §2's rule for `Issue` applies to it. The full issue state after the mutation — the same object shape `Issue` describes — or `null` on a delete. Always present. A post-image of a wisp-plane record carries its `arrival_seq`, and the `create` record that stamped it has `seq` equal to it." |
| "dep" | object | no | — | "Under §2, its `kind` is renamed `type`, a Link Type reference (§2). On `dep_add` and `dep_remove` only: `{\\"kind\\",\\"target\\",\\"metadata\\"}` for the edge. Absent on every other op.\\n\\n`metadata` differs in PROVENANCE between the two: on `dep_add` it is the value being written as the caller supplied it, on `dep_remove` it is the stored column read back just before the delete. The two can differ byte for byte while meaning the same thing, so compare parsed values rather than strings." |
| "comment" | object | no | — | "On `comment` only: `{\\"id\\",\\"author\\",\\"text\\",\\"created_at\\",\\"source\\"}`. Absent on every other op." |

#### Advanced

```json-schema
{
  "properties": {
    "seq": {
      "type": "integer",
      "format": "int64"
    },
    "issue": {
      "type": [
        "object",
        "null"
      ]
    }
  }
}
```

<!-- bdp-schema:end EventRecord bundle=issue-callables -->

<!-- bdp-schema:start EventsPage bundle=issue-callables -->
### Schema: "EventsPage"

Value: object

Required order: ["records", "head"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One page of the journal plus the position of its end.\\n\\nTHERE IS NO `has_more`, and that is deliberate rather than an omission. Every other page on this surface reports truncation with a boolean because its ordering is a query's; here the answer is a number the client already needs for its next request. Compare the last record's `seq` with `head`: equal means caught up, lower means keep reading. A full page proves nothing either way, and a `has_more` computed from the limit would be a second, weaker way to ask the same question." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "records" | array of (ref "#/$defs/EventRecord") | yes | — | "Records with `seq` strictly greater than the requested `since`, in ASCENDING `seq` order and contiguous — a gap in the retained window is a 410, never a quietly shortened list. Empty array (never null) when the caller is caught up." |
| "head" | schema | yes | — | "The highest `seq` this journal has ever assigned, read in the same transaction as the records above.\\n\\nIt is the journal's HISTORY, not its contents: pruning deletes rows and never touches the counter, so a fully pruned journal still reports the head it reached. `0` means no mutation has ever been journaled here — which, given that a disabled journal is refused with 409 rather than answered, means an enabled journal on a workspace that has not been written to yet.\\n\\nBecause it is read after the rows within one transaction, it is always greater than or equal to the last record's `seq`; it may be greater simply because a mutation committed while the page was being read, which is the ordinary signal to poll again." |

#### Advanced

```json-schema
{
  "properties": {
    "head": {
      "type": "integer",
      "format": "int64"
    }
  }
}
```

<!-- bdp-schema:end EventsPage bundle=issue-callables -->

<!-- bdp-schema:start QueryPage bundle=issue-callables -->
### Schema: "QueryPage"

Value: object

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A page of query results. It is `ReadyPage`'s shape rather than `IssuesPage`'s, and the missing member is the point: a page of this operation carries no `next_cursor`, because a cursor is a keyset position in a database order and a predicate query's matching set is assembled outside the database." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/IssueWithCounts") | yes | — | "Empty array (never null) when the expression matched nothing." |
| "has_more" | boolean | yes | — | "True when `limit` truncated the result. It is exact for every expression, including the ones evaluated outside the database: those are matched against every candidate row, so the count of matches is known before the page is cut. There is no cursor — raise `limit` or narrow the expression." |

<!-- bdp-schema:end QueryPage bundle=issue-callables -->

<!-- bdp-schema:start Setting bundle=issue-callables -->
### Schema: "Setting"

Value: object

Required order: ["key", "redacted"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One entry of the workspace's stored settings plane.\\n\\n(Envelopes and page wrappers are unpinned as a class, for a different reason: they are new wire surface with no prior implementation. A setting has no such struct: the CLI marshals an ad-hoc `map[string]string` per verb, so there is nothing to pin TO, and minting a type to pin to would mean changing what `bd config get --json` prints in order to satisfy a rule about not changing it.\\n\\nThe two surfaces are still one shape where they overlap — `key` and `value` are spelled as the CLI spells them — and they diverge in exactly one deliberate place, `redacted`, which exists because a bearer on this surface is optional, shared and surface-wide — it cannot decide that one caller may read a credential and another may not — while the CLI requires access to the database anyway." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The setting's key, echoed verbatim." |
| "value" | text | no | — | "The stored value, verbatim.\\n\\nABSENT MEANS ONE OF TWO THINGS, and `redacted` says which. With `redacted: false` the workspace stores nothing for this key OR stores the empty string; those are indistinguishable through this surface and through the CLI. With `redacted: true` a value may well be stored and is withheld.\\n\\nIt is never emitted as an empty string and never transformed: a value that is not the stored value is omitted rather than masked, so a client can never mistake a placeholder for configuration." |
| "redacted" | boolean | yes | — | "True when `value` is withheld because the KEY marks the setting as credential-bearing — the name contains `token`, `secret`, `password`, or an API-key spelling. It is a decision about the key alone: no value is inspected, so a credential stored under an innocuous name is NOT protected by this and must not be stored in this plane at all.\\n\\nAlways present, including when false, so a client never has to infer redaction from an absent member." |

<!-- bdp-schema:end Setting bundle=issue-callables -->

<!-- bdp-schema:start Memory bundle=issue-callables -->
### Schema: "Memory"

Value: object

Required order: ["key", "value"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One entry of the workspace's persistent memory plane.\\n\\nIT HAS NO `redacted` MEMBER, and that is the deliberate difference from `Setting`. Redaction there is a decision about the KEY NAME, which works because settings keys are configured names; memory keys are derived from the content, so the same rule would withhold a memory about credentials and serve one containing a credential under an innocuous slug. A configured bearer would not close that either — it admits a client to the whole surface rather than to particular keys — so this schema states the exposure rather than implying a protection it does not have." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The memory's key, echoed verbatim." |
| "value" | text | yes | — | "The stored content, verbatim: newlines, surrounding space and unicode as stored, never truncated and never withheld.\\n\\nAlways present. It is the empty string only where a row was written out of band with an empty value — a row `GET /v0/beads/memories/{key}` answers `200` for, and `GET /v0/beads/memories` enumerates, the same as any other memory." |

<!-- bdp-schema:end Memory bundle=issue-callables -->

<!-- bdp-schema:start MemoriesPage bundle=issue-callables -->
### Schema: "MemoriesPage"

Value: object

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/Memory") | yes | — | "The stored memories, ordered by key. Empty array (never null) when the workspace holds none, or when `q` matched none." |
| "has_more" | boolean | yes | — | "Always false in v0: the whole plane is returned in one page. It is present so that a later revision can page this collection without changing the response shape." |
| "next_cursor" | text | no | — | "Present if and only if `has_more` is true, which is never in v0." |

<!-- bdp-schema:end MemoriesPage bundle=issue-callables -->

<!-- bdp-schema:start RememberedMemory bundle=issue-callables -->
### Schema: "RememberedMemory"

Value: object

Required order: ["key", "value", "replaced"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One stored memory, plus whether storing it overwrote a previous value.\\n\\nIt is `Memory`'s shape with `replaced` added rather than a composition of it, because this document repeats property lists instead of using `allOf` (see the note at the top of the file)." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key the memory now lives under: the one the request supplied, or the one derived from `content`. Recall it under exactly these bytes." |
| "value" | text | yes | — | "The stored content, echoed verbatim. Always present, and never withheld — this plane has no redaction; see the operation description." |
| "replaced" | boolean | yes | — | "True when a previous value existed under `key` and this request overwrote it; false when the key was new. It is observed in the same transaction as the write, so it describes the row this request wrote.\\n\\nA previous value that was the EMPTY STRING reports true: the ROW existed, and `GET /v0/beads/memories/{key}` would have answered `200` for it too, with an empty `value` — this member and that endpoint agree on what counts as present, because both read it off the row rather than off the value it happened to hold." |

<!-- bdp-schema:end RememberedMemory bundle=issue-callables -->

<!-- bdp-schema:start RemovedSetting bundle=issue-callables -->
### Schema: "RemovedSetting"

Value: object

Required order: ["key"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The outcome of removing one setting.\\n\\nIT CARRIES THE KEY AND NOTHING ELSE, and the absence is the contract rather than an unfinished shape. There is no `removed` flag because the storage seam discards the affected-row count on every implementation, so the member would be a value one of them had to invent — and no `value`, because reporting what was there would publish, on the one operation that withholds nothing, exactly the credential `GET /v0/beads/config/{key}` redacts." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | text | yes | — | "The key that now holds nothing, echoed verbatim." |

<!-- bdp-schema:end RemovedSetting bundle=issue-callables -->

<!-- bdp-schema:start SettingsPage bundle=issue-callables -->
### Schema: "SettingsPage"

Value: object

Required order: ["items", "has_more"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/Setting") | yes | — | "The stored settings, ordered by key. Empty array (never null) when the workspace stores none." |
| "has_more" | boolean | yes | — | "Always false in v0: the whole plane is returned in one page. It is present so that a later revision can page this collection without changing the response shape." |
| "next_cursor" | text | no | — | "Present if and only if `has_more` is true, which is never in v0." |

<!-- bdp-schema:end SettingsPage bundle=issue-callables -->

<!-- bdp-schema:start StatsResponse bundle=issue-callables -->
### Schema: "StatsResponse"

Value: object

Required order: ["summary", "blocked_count_skipped"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The same envelope `bd status --json` prints, minus one member: the CLI also carries `recent_activity`, which every shipped code path leaves absent, so it is not published here." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "summary" | ref "#/$defs/Statistics" | yes | — | — |
| "blocked_count_skipped" | boolean | yes | — | "True when the summary came back without the blocked-set scan, which is exactly `summary.blocked_issues == null`. It is DERIVED from the answer rather than echoed from the request: `skip_blocked` is a hint, and a backend with no cheaper path answers with the full numbers and this flag false." |

<!-- bdp-schema:end StatsResponse bundle=issue-callables -->

<!-- bdp-schema:start DependencyEdges bundle=issue-callables -->
### Schema: "DependencyEdges"

Value: object

Required order: ["items", "missing"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The stored edges of the named issues, plus the ids that named nothing. It is NOT a page: this operation has no limit and no cursor, because the number of issues asked about is what bounds it." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/Dependency") | yes | — | "Every matching edge, flattened across the named issues rather than keyed by source — the same flat array `bd dep list a b c --json` emits, so the two surfaces are one compatibility domain. Group by `issue_id` to recover the per-source view. Empty array (never null) when nothing matches.\\n\\nThe order is by the named issues in the order the request named them, and within each issue by target id." |
| "missing" | array of (text) | yes | — | "The requested `issue_id` values that name neither an issue nor a wisp, in the order they were named. Empty array (never null) when every named issue exists.\\n\\nAn id here contributes no `items`, and the absence of an id here is NOT a claim that it has edges — an issue that exists and depends on nothing is in neither list." |

<!-- bdp-schema:end DependencyEdges bundle=issue-callables -->

<!-- bdp-schema:start EdgeCounts bundle=issue-callables -->
### Schema: "EdgeCounts"

Value: object

Required order: ["anchors"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Each anchor's edge cardinality — the body of `GET /v0/beads/dependencies:count`. It is NOT a page and carries no total: the answer is per anchor, and a sum across anchors would double-count every edge whose two ends were both named.\\n\\nThe role answers with `issueops.EdgeCountResult`, whose members carry no JSON tags at all because nothing marshals it." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "anchors" | array of (ref "#/$defs/AnchorEdgeCount") | yes | — | "One entry per DISTINCT requested `issue_id`, in the order the request first named it. Empty array (never null) when the request named no anchors this server accepted — which it cannot, since `issue_id` is required and bounded below at one.\\n\\nA repeated id appears ONCE. The collapse happens before anything is counted, so a caller that summed the entries would not count the same edges twice." |

<!-- bdp-schema:end EdgeCounts bundle=issue-callables -->

<!-- bdp-schema:start AnchorEdgeCount bundle=issue-callables -->
### Schema: "AnchorEdgeCount"

Value: object

Required order: ["id", "count", "missing"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One anchor's edge cardinality, or the report that it is not there." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "The anchor, spelled exactly as the request spelled it. It is not re-canonicalized: there is no fuzzy, prefix or substring resolution on this surface, so what comes back is what went out." |
| "count" | schema | yes | — | "How many stored edges match, in the requested direction, after the type and status filters. Never negative.\\n\\nIt SPANS BOTH DEPENDENCY PLANES and is a SUM over them rather than a distinct count of edge rows — a durable issue's dependent count includes the wisps that depend on it, and a wisp's dependency count includes the durable issues it depends on. `issueops.AnchorEdgeCount.Count` states the rule, the one state that can make the sum differ from a distinct count, and why this role answers with the sum. Nothing is restated here.\\n\\nALWAYS PRESENT, including as 0, and 0 is the COMMON answer: most issues have no edges in at least one direction. It is 0 for a missing anchor too, which is exactly why `missing` is beside it.\\n\\nDECODE IT AS A 64-BIT INTEGER. The member is `format: int64` and a workspace's graph is not bounded by 2^53; a lossy parser would answer a number NEAR the count, which on a cardinality is worse than an error because nothing downstream can tell." |
| "missing" | boolean | yes | — | "True when no issue and no wisp carries this id.\\n\\nALWAYS PRESENT, including as `false`. It is the member that keeps this from being a question a caller cannot tell it got wrong: a count of 0 is otherwise indistinguishable from a typo, and an absent boolean would be ambiguous between \\"present\\" and \\"this producer does not report misses\\".\\n\\nA missing anchor counts 0 whatever rows are still keyed to it — a dependency row whose source has been deleted is orphaned data, and counting it would contradict this flag.\\n\\nDANGLING EDGES ARE NOT MISSING ANCHORS. This is about the ANCHOR. An edge whose OTHER end names nothing is counted like any other edge, and nothing here reports on it." |

#### Advanced

```json-schema
{
  "properties": {
    "count": {
      "type": "integer",
      "format": "int64"
    }
  }
}
```

<!-- bdp-schema:end AnchorEdgeCount bundle=issue-callables -->

<!-- bdp-schema:start BlockingAnnotations bundle=issue-callables -->
### Schema: "BlockingAnnotations"

Value: object

Required order: ["items"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The blocking decoration of the named issues. It is NOT a page: this operation has no limit and no cursor, because the number of issues asked about is what bounds it." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/IssueBlocking") | yes | — | "One entry per DISTINCT requested id, in the order the request first named it — so a client can zip this against the ids it sent. Empty array (never null) when the request named none.\\n\\nThere is no `missing` beside it, unlike `DependencyEdges`: this operation probes no id's existence, so every requested id has an entry and an id that names nothing is simply bare." |

<!-- bdp-schema:end BlockingAnnotations bundle=issue-callables -->

<!-- bdp-schema:start RelatedIssues bundle=issue-callables -->
### Schema: "RelatedIssues"

Value: object

Required order: ["items"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One issue's neighbors — the body of `GET /v0/beads/issues/{id}/related`. It is NOT a page: this operation has no limit and no cursor, and it names ONE anchor, so there is nothing for a `has_more` to be about.\\n\\nThere is no `missing` beside `items`, unlike `DependencyEdges`. That member exists because a batch cannot report an absent anchor any other way without discarding the anchors it did find; here the single absent anchor is a 404.\\n\\nThe role answers with a bare slice of `issueops.RelatedIssue`, and THAT element is pinned — see `IssueWithDependencyMetadata`." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/IssueWithDependencyMetadata") | yes | — | "The neighbors, ascending by id with the edge type breaking a tie. Empty array (never null) when this issue has none in the requested direction, or when the `type` filter rejected every edge.\\n\\nEach element is a full issue plus `dependency_type`, the type of the edge that led to it — the same element `GET /v0/beads/issues/{id}` carries under `dependencies` and `dependents`, so the two surfaces are one compatibility domain.\\n\\nAN EDGE WITH NO FAR END IN THIS DATABASE CONTRIBUTES NOTHING here: an `external:` reference, an id in another repository's namespace and an id whose issue was deleted out from under its edges are all silently absent, with no placeholder row and no error. The length of this array is a NEIGHBOR count, never an edge count." |

<!-- bdp-schema:end RelatedIssues bundle=issue-callables -->

<!-- bdp-schema:start BatchCreateItem bundle=issue-callables -->
### Schema: "BatchCreateItem"

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
| "title" | schema | yes | — | — |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "acceptance_criteria" | text | no | — | — |
| "priority" | schema | no | — | "0 is P0/critical. Absent means the create default, P2 (`2`), on a server advertising `issues.create.defaultPriority`; such a server never reads an absent member as `0`. An older server stores P0 for an absent member, so a client that does not see the token sends `2` explicitly." |
| "issue_type" | schema | no | — | "A Bead Type reference (§2). Issue type. Spelled `issue_type` rather than `type`, matching the member `Issue` carries, and validated against the built-ins plus the workspace's configured custom types — an unknown one is a `400`." |
| "assignee" | schema | no | — | — |
| "labels" | schema | no | — | — |
| "dependencies" | schema | no | — | "The edges this issue is created carrying. They are written in the same transaction as the issue, so this operation never publishes an issue whose declared relationships are not there yet." |

#### Advanced

```json-schema
{
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "priority": {
      "type": "integer",
      "minimum": 0,
      "maximum": 4
    },
    "issue_type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
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
    "dependencies": {
      "type": "array",
      "maxItems": 100,
      "items": {
        "$ref": "#/$defs/BatchCreateDependency"
      }
    }
  }
}
```

<!-- bdp-schema:end BatchCreateItem bundle=issue-callables -->

<!-- bdp-schema:start BatchCreateDependency bundle=issue-callables -->
### Schema: "BatchCreateDependency"

Value: object

Other fields: not allowed

Required order: ["target_id", "type"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "target_id" | schema | yes | — | "The far end of the edge: an issue this workspace holds, an `external:` reference, or an id whose prefix belongs to another repository. Anything else is a `400` and nothing is created.\\n\\nNOT AN ITEM OF THIS REQUEST. The server assigns every id and an item carries no name, so there is nothing here a caller could write to address one; see the operation's description for the operation that can." |
| "type" | schema | yes | — | "A Link Type reference (§2). The edge type, from the same OPEN vocabulary `Dependency.type` carries. It is spelled `type` because that is the member an edge carries everywhere else on this surface." |

#### Advanced

```json-schema
{
  "properties": {
    "target_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    }
  }
}
```

<!-- bdp-schema:end BatchCreateDependency bundle=issue-callables -->

<!-- bdp-schema:start BatchCreateResponse bundle=issue-callables -->
### Schema: "BatchCreateResponse"

Value: object

Required order: ["items"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/Issue") | yes | — | "One entry per requested item, in REQUEST ORDER, each the stored issue with its generated id and its labels. Never null and never shorter than the request: a partial outcome does not exist on this operation.\\n\\nThere is no `has_more` and no `next_cursor`. This is not a page — the client already knows how many items it sent — and publishing a paging envelope over a fixed-length answer would invite a client to look for a second page that can never exist." |

<!-- bdp-schema:end BatchCreateResponse bundle=issue-callables -->

<!-- bdp-schema:start ApplyItem bundle=issue-callables -->
### Schema: "ApplyItem"

Value: object

Other fields: not allowed

Required order: ["kind"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One item of a plan: a `kind` naming what it does, plus exactly one payload member matching it.\\n\\nIT IS A TAGGED SINGLE-SHAPE OBJECT rather than a polymorphic one, and the spelling is deliberate. So the union is carried as four OPTIONAL members with a required tag rather than as a schema alternation.\\n\\nWHAT A CLIENT MUST DO, since no validator can enforce it from this schema alone: send `kind`, send the ONE member `kind` names, and send no other. An item carrying no payload does nothing; an item carrying a payload its `kind` does not name has two halves that disagree; an item carrying two payloads cannot say which it meant. All three are a `400` and nothing in the request is written. A generated client's type will make all four members constructible at once — that is the cost of the spelling, and checking it is the client's.\\n\\nREADING one is the same rule from the other side: dispatch on `kind` and read only that member. The other three are absent." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "kind" | schema | yes | — | "Which member below is read. A CLOSED set, unlike a dependency `type`: every value here is a verb this operation implements, and an unknown one is a request the server cannot execute rather than a workspace's own vocabulary." |
| "create" | ref "#/$defs/ApplyCreateItem" | no | — | — |
| "update" | ref "#/$defs/ApplyUpdateItem" | no | — | — |
| "close" | ref "#/$defs/ApplyCloseItem" | no | — | — |
| "dep_add" | ref "#/$defs/ApplyDepAddItem" | no | — | — |

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

<!-- bdp-schema:end ApplyItem bundle=issue-callables -->

<!-- bdp-schema:start Ref bundle=issue-callables -->
### Schema: "Ref"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Names ONE issue, either by an id that already exists or by the `key` a create item earlier in the same request gave itself.\\n\\nEXACTLY ONE OF THE TWO IS SET, and both cases the schema cannot express are a `400`: both members set is a caller that cannot say which it meant, and neither set is a reference to nothing. (Spelling that as a schema alternation would need `oneOf`, which this document does not use — see `ApplyItem`.)\\n\\nA KEY REACHES BACKWARD ONLY where the ref ADDRESSES a row — an `update.target`, a `close.target`, either endpoint of a `dep_add`. The one exception is `create.metadata_refs`, whose values may reach forward or name their own item's key; the operation's description says why." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | schema | no | — | "The `key` a create item in THIS REQUEST gave itself. It is not an id, it is not stored anywhere, and it is resolved to the id the request minted — which the response's `keys` member reports." |
| "id" | schema | no | — | "An id that already exists, EXACTLY. There is no fuzzy, prefix or cross-repo resolution on this surface." |

#### Advanced

```json-schema
{
  "properties": {
    "key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    }
  }
}
```

<!-- bdp-schema:end Ref bundle=issue-callables -->

<!-- bdp-schema:start ApplyCreateItem bundle=issue-callables -->
### Schema: "ApplyCreateItem"

Value: object

Other fields: not allowed

Required order: ["title"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Creates one issue and optionally NAMES it, so later items can reach the row without knowing an id the request has not minted yet.\\n\\nIt publishes the whole create vocabulary rather than `POST /v0/beads/issues:batchCreate`'s narrow one, and the additions are the point: `status`, `sender`, `metadata`, `ephemeral` and `no_history` are the members whose absence there makes that operation unusable for a caller composing a real plan.\\n\\nTHE EDGES ARE NOT HERE. An issue's dependencies and its parent are `dep_add` ITEMS, so the order of every edge in the request is total and there is exactly one spelling for an edge. An item carrying comments or dependencies on the issue is a `400`.\\n\\n`metadata` is the issue's own metadata document and must be a JSON OBJECT where it is present at all. It is stored as sent; the resolved ids `metadata_refs` splices are written over its top-level keys after every id in the request exists." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "key" | schema | no | — | "This item's name inside the request. OPTIONAL — an item nothing refers to needs no name — and unique across the request's create items; a repeat is a `400`. It is what a later `Ref.key` resolves to, and the response's `keys` member is where the id it was bound to is read." |
| "id" | schema | no | — | "An explicit id for the new row, CREATE-ONLY: an id that already names a stored row is a `409` `already_exists` and the whole request is refused — never an adoption and never an overwrite. To act on a row that already exists, send an `update` item referencing it by `{\\"id\\": …}`. The id is checked against the workspace's configured issue prefix unless the request sets `force_id_prefix`.\\n\\nAbsent is the ordinary case and the server mints one. This is the member `POST /v0/beads/issues:batchCreate` deliberately does not publish, which is why that operation can never adopt or overwrite a stored row and this one can be refused for trying." |
| "title" | schema | yes | — | — |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "acceptance_criteria" | text | no | — | — |
| "notes" | text | no | — | — |
| "issue_type" | schema | no | — | "A Bead Type reference (§2). Issue type. Spelled `issue_type` rather than `type`, matching the member `Issue` carries, and validated against the built-ins plus the workspace's configured custom types by the ROLE — this server cannot read that vocabulary without a transaction, so it checks only what this schema declares and an unknown one arrives as a `400`." |
| "status" | schema | no | — | "The status the issue is created in, from this workspace's own configured vocabulary. Absent means the workspace default." |
| "priority" | schema | no | — | "0 is P0/critical. Absent means the create default, P2 (`2`), on a server advertising `issues.create.defaultPriority`; such a server never reads an absent member as `0`. An older server stores P0 for an absent member, so a client that does not see the token sends `2` explicitly." |
| "assignee" | schema | no | — | — |
| "owner" | schema | no | — | "The human owner, which is a different member from `assignee`: the assignee is who is working it now, the owner is who it is attributed to." |
| "labels" | schema | no | — | "The complete label set the issue is created with. Authoritative, not a patch — a create has nothing to add to." |
| "estimated_minutes" | integer | no | — | "An estimate in minutes. Absent leaves it unset." |
| "external_ref" | schema | no | — | — |
| "due_at" | schema | no | — | "RFC 3339." |
| "defer_until" | schema | no | — | "RFC 3339. The issue is hidden from ready work until then." |
| "sender" | schema | no | — | "Who sent this, for the message-shaped rows a plan creates. Stored verbatim and interpreted by nothing on this surface." |
| "metadata" | ref "#/$defs/MetadataValue" | no | — | — |
| "ephemeral" | schema | no | — | "Creates the issue on the EPHEMERAL plane rather than the durable one. Per item, exactly as it is for `POST /v0/beads/issues:batchCreate`, so one request may create durable issues and ephemeral ones together.\\n\\nThe two planes hold their edges in different tables, so a `dep_add` between two rows this request creates on OPPOSITE planes is refused with everything else the request asked for. Mutually exclusive with `no_history`." |
| "no_history" | schema | no | — | "Creates the issue on the ephemeral plane WITHOUT history, and without the garbage collection an ordinary ephemeral row is eligible for. Mutually exclusive with `ephemeral`." |
| "await_type" | schema | no | — | "The gate's await condition type (`gh:run`, `gh:pr`, `timer`, `human`, `bead`, or a formula-defined type). Free-form: there is no vocabulary, and any issue type may carry it, as a local create allows. At most 32 characters, the stored column's width; a longer value is a `400` naming this member. Requires the behavior token `issues.create.gates`." |
| "await_id" | schema | no | — | "The gate's condition identifier (a run id, a PR number, a `bead:<id>`). Opaque here; at most 255 characters, the stored column's width, and a longer value is a `400` naming this member. Requires the behavior token `issues.create.gates`." |
| "timeout" | schema | no | — | "The gate's timeout in NANOSECONDS, the encoding `Issue.timeout` reads back. A negative value is a `400` naming this member. Requires the behavior token `issues.create.gates`." |
| "waiters" | array of (text) | no | — | "The addresses woken when the gate clears, stored as sent: duplicates are kept and nothing is trimmed, as a local create stores them. The list's JSON encoding must fit the stored TEXT column (65535 bytes); a larger one is a `400` naming this member. Requires the behavior token `issues.create.gates`." |
| "metadata_refs" | schema | no | — | "Splices resolved ids into this issue's metadata: each entry writes the id its `Ref` resolves to as the WHOLE VALUE of one top-level metadata key.\\n\\nIT IS THE ONE PLACE A KEY MAY REACH FORWARD, or name this item's own `key` — see the operation's description. A ref here that names a key NO item declares is still a `400`.\\n\\nIT IS A TYPED MAP, NOT TEMPLATING. A `${key}` placeholder inside a JSON string would have no escape for a literal dollar-brace, would collide with every other templating language a caller's own values might carry, and could not be type-checked at all. This is one key, one whole value, one level deep.\\n\\nThe splice is applied AFTER the row is created, so a consumer of the event stream sees a create and then an update on the spliced row." |

#### Advanced

```json-schema
{
  "properties": {
    "key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "issue_type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "status": {
      "type": "string",
      "maxLength": 255
    },
    "priority": {
      "type": "integer",
      "minimum": 0,
      "maximum": 4
    },
    "assignee": {
      "type": "string",
      "maxLength": 255
    },
    "owner": {
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
    "external_ref": {
      "type": "string",
      "maxLength": 255
    },
    "due_at": {
      "type": "string",
      "format": "date-time"
    },
    "defer_until": {
      "type": "string",
      "format": "date-time"
    },
    "sender": {
      "type": "string",
      "maxLength": 255
    },
    "ephemeral": {
      "type": "boolean",
      "default": false
    },
    "no_history": {
      "type": "boolean",
      "default": false
    },
    "await_type": {
      "type": "string",
      "maxLength": 32
    },
    "await_id": {
      "type": "string",
      "maxLength": 255
    },
    "timeout": {
      "type": "integer",
      "format": "int64",
      "minimum": 0
    },
    "metadata_refs": {
      "type": "object",
      "additionalProperties": {
        "$ref": "#/$defs/Ref"
      }
    }
  }
}
```

<!-- bdp-schema:end ApplyCreateItem bundle=issue-callables -->

<!-- bdp-schema:start ApplyUpdateItem bundle=issue-callables -->
### Schema: "ApplyUpdateItem"

Value: object

Other fields: not allowed

Required order: ["target", "patch"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Patches one existing issue, under `PATCH /v0/beads/issues/{id}`'s rules.\\n\\nThe two carry the same preconditions and the same force flags; what is this operation's alone is that its guards evaluate AS-MODIFIED — against the row as earlier items of this same request have already changed it — and that a miss takes the whole plan down rather than one write." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "target" | ref "#/$defs/Ref" | yes | — | — |
| "patch" | ref "#/$defs/ApplyPatchBody" | yes | — | — |
| "expected_version" | text | no | — | "Requires the row's `revision` to equal this value before the patch. A miss refuses the WHOLE request with `409 precondition_failed`.\\n\\nIT IS A `400`, NOT A `409`, ON A ROW THIS REQUEST HAS ALREADY WRITTEN — including one an earlier item created. The token is minted by the write, so mid-request there is no value a caller could send: the pre-request token is stale by construction and a row this request just created never had one the caller could read. Refusing statically says so; answering with a mismatch would send the caller looking for a concurrent writer that does not exist.\\n\\n`expected_status` and `expected_assignee` carry no such rule, because a caller CAN know what its own earlier item set them to.\\n\\nIT IS A STRING, and it must be the `revision` string a response carried, verbatim. A JSON number — or any other type — is a `400` naming this member. The token spans the FULL 64-bit range, so a number would be rounded past 2^53 by an IEEE-754-double parser and the guard would miss a row nothing else touched; a string round-trips exactly in every consumer." |
| "expected_status" | schema | no | — | "Requires the issue's status to equal this value, evaluated AS-MODIFIED — against the row as this request has already changed it at this item's position. A miss refuses the whole request with `409 precondition_failed`." |
| "expected_assignee" | schema | no | — | "Requires the issue's assignee to equal this value, evaluated as-modified. A match AUTHORIZES the requested `patch.assignee` transfer: this compare-and-set replaces the ordinary anti-steal fence, so it must not be combined with `force_assignee_transfer`. A miss refuses the whole request with `409 precondition_failed`." |
| "force_close_policy" | schema | no | — | "Bypasses ONLY close policy — the open-children refusal and the live blocker refusal — for a `patch.status` that crosses into the workspace's done category. It has no effect without such a status change, and it never bypasses validation, the preconditions above, or the assignee fence." |
| "force_assignee_transfer" | schema | no | — | "Bypasses ONLY a genuine transfer away from a live foreign in-progress owner. Reasserting the exact current assignee is idempotent and needs no force. It requires `patch.assignee` — a request setting it without one is a `400` — and it must be false when `expected_assignee` is sent." |
| "force_notes_overwrite" | schema | no | — | "Bypasses ONLY the refusal on a `patch.notes` that would replace existing non-empty notes with different non-empty content (an explicit clear is not fenced). It requires `patch.notes` — an item setting it without one is a `400` — and, UNLIKE `force_assignee_transfer`, it has no `expected_assignee` exemption: there is no compare-and-set that authorizes a notes overwrite, so combining the two is legal and each answers its own question." |

#### Advanced

```json-schema
{
  "properties": {
    "expected_status": {
      "type": "string",
      "maxLength": 255
    },
    "expected_assignee": {
      "type": "string",
      "maxLength": 255
    },
    "force_close_policy": {
      "type": "boolean",
      "default": false
    },
    "force_assignee_transfer": {
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

<!-- bdp-schema:end ApplyUpdateItem bundle=issue-callables -->

<!-- bdp-schema:start ApplyPatchBody bundle=issue-callables -->
### Schema: "ApplyPatchBody"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The fields an `update` item writes. Every member is optional and PRESENCE is the signal: a member present is written, a member absent is untouched. An empty object is a `400` — a write that writes nothing is a client bug.\\n\\nIt mirrors `IssuePatchBody` member for member and diverges in exactly two places now that `PATCH /v0/beads/issues/{id}` publishes `status`, `assignee` and the same `metadata` algebra.\\n\\n`owner` is published here and not there, which is an accident of order rather than a decision: nothing has asked for it on the single patch.\\n\\n`labels` is a full patch rather than a complete replacement, and that one is a real difference: a plan has to be able to REMOVE one label without knowing the rest of the set, because it edits a set it did not compose. A caller patching one row it just read already knows the set.\\n\\n`parent_id` is deliberately absent, and its absence is this operation's one-edge-one-spelling rule: a parent is a `dep_add` item of type `parent-child`, so the order of every edge in the request stays total. The single patch has no ordering to express and publishes it directly. `persistence` is absent here — moving a row between planes mid-plan is a different act from writing its fields, and nothing has asked for it here. The single patch publishes it (`IssuePatchBody.persistence`, behind `issues.update.persistence`), where the move is the patch's last step." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "title" | schema | no | — | "Must not be blank after trimming; the length bound is what the column holds." |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "acceptance_criteria" | text | no | — | — |
| "notes" | text | no | — | "Replaces the notes. Mutually exclusive with `append_notes`; sending both is a `400`. Replacing EXISTING non-empty notes with different non-empty content is refused with `409 notes_overwrite_refused` unless `force_notes_overwrite` is set; an explicit clear (empty string) is not fenced." |
| "append_notes" | text | no | — | "Appends to the notes rather than replacing them. Mutually exclusive with `notes`." |
| "priority" | schema | no | — | — |
| "issue_type" | schema | no | — | "A Bead Type reference (§2). The issue type, from this workspace's own configured vocabulary. A type outside it is refused by the ROLE and reaches the client as a `400`." |
| "status" | schema | no | — | "The issue's status, from this workspace's own configured vocabulary.\\n\\nA STATUS THAT CROSSES INTO THE DONE CATEGORY ANSWERS TO CLOSE POLICY: the item is refused with `409 not_closable` for open children or a live blocker unless `force_close_policy` is set. A done-to-done change and a move OUT of the done category are unaffected — which is how a plan reopens a row, since there is no reopen item." |
| "assignee" | schema | no | — | "The assignee. A transfer away from a live foreign in-progress owner is refused with `409 already_claimed` unless `force_assignee_transfer` is set or `expected_assignee` matched." |
| "owner" | schema | no | — | — |
| "labels" | ref "#/$defs/ApplyLabelPatch" | no | — | — |
| "estimated_minutes" | schema | no | — | "Explicit `null` CLEARS the estimate." |
| "external_ref" | schema | no | — | "Explicit `null` CLEARS the reference." |
| "due_at" | schema | no | — | "RFC 3339. Explicit `null` CLEARS the due date." |
| "defer_until" | schema | no | — | "RFC 3339. Explicit `null` CLEARS the deferral." |
| "metadata" | ref "#/$defs/ApplyMetadataPatch" | no | — | — |
| "await_id" | schema | no | — | "Replaces the gate's condition identifier; the empty string clears it. Not nullable. At most 255 characters, the stored column's width; a longer value is a `400` naming this member. Requires the behavior token `issues.update.gates`." |
| "waiters" | array of (text) | no | — | "A WHOLE-VALUE replacement of the gate's waiter list; `[]` clears it. Not nullable. Stored as sent (duplicates kept: deduplicating is the caller's, as `bd gate add-waiter` does). The list's JSON encoding must fit the stored TEXT column (65535 bytes); a larger one is a `400` naming this member. Requires the behavior token `issues.update.gates`." |

#### Advanced

```json-schema
{
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "priority": {
      "type": "integer",
      "minimum": 0,
      "maximum": 4
    },
    "issue_type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "status": {
      "type": "string",
      "maxLength": 255
    },
    "assignee": {
      "type": "string",
      "maxLength": 255
    },
    "owner": {
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
    "due_at": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time"
    },
    "defer_until": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time"
    },
    "await_id": {
      "type": "string",
      "maxLength": 255
    }
  }
}
```

<!-- bdp-schema:end ApplyPatchBody bundle=issue-callables -->

<!-- bdp-schema:start ApplyLabelPatch bundle=issue-callables -->
### Schema: "ApplyLabelPatch"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "An ordered label edit: `replace` first, then `add`, then `remove`, so REMOVAL WINS when the same label appears in more than one member.\\n\\nIt is the full patch rather than `IssuePatchBody.labels`' complete replacement because a plan edits a set it did not compose: replacing would mean reading the labels back first, and the read this operation exists to avoid is exactly that one.\\n\\nRepetition is free in both directions — a label named twice in one member is applied once, and removing a label the issue does not carry is a no-op. An EMPTY-STRING entry is dropped rather than refused: a label row holding \\"\\" renders as nothing and matches nothing, so refusing the whole request for one stray entry would fail an otherwise-good edit." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "replace" | schema | no | — | "The complete starting label set. An empty array CLEARS every label; omitting the member leaves the current set as the starting point." |
| "add" | schema | no | — | "Labels to add after any replacement." |
| "remove" | schema | no | — | "Labels to remove after replacement and addition." |

#### Advanced

```json-schema
{
  "properties": {
    "replace": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 255
      }
    },
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
    }
  }
}
```

<!-- bdp-schema:end ApplyLabelPatch bundle=issue-callables -->

<!-- bdp-schema:start ApplyMetadataPatch bundle=issue-callables -->
### Schema: "ApplyMetadataPatch"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A metadata edit. `replace` is mutually exclusive with the other three; without it the edits apply as `merge`, then `set` in key order, then `unset`, so UNSETTING A KEY WINS over setting or merging it. Sending `replace` beside any of the others is a `400`.\\n\\n`replace` replaces the whole document. Present holding `null`, `{}` or an empty value CLEARS metadata — and clearing STORES THE EMPTY JSON DOCUMENT rather than SQL null, so \\"created with no metadata\\" and \\"given metadata and then cleared\\" are the same stored value; a reader must treat absent, empty and `{}` as one value on the way out. `merge` must be a nonempty JSON OBJECT and is merged into the current document." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "replace" | ref "#/$defs/MetadataValue" | no | — | — |
| "merge" | ref "#/$defs/MetadataValue" | no | — | — |
| "set" | schema | no | — | "Individual top-level keys to write, in deterministic key order. A value present holding `null` writes JSON null; a key is removed with `unset`, never by sending a null here." |
| "unset" | schema | no | — | "Top-level keys to remove, applied after every other edit." |

#### Advanced

```json-schema
{
  "properties": {
    "set": {
      "type": "object",
      "additionalProperties": {
        "$ref": "#/$defs/MetadataValue"
      }
    },
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

<!-- bdp-schema:end ApplyMetadataPatch bundle=issue-callables -->

<!-- bdp-schema:start ApplyCloseItem bundle=issue-callables -->
### Schema: "ApplyCloseItem"

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
| "target" | ref "#/$defs/Ref" | yes | — | — |
| "reason" | schema | no | — | "Why the issue is closed, stored and read back as `close_reason`. THE FIRST CLOSE WINS: an idempotent re-close writes neither this nor `session`." |
| "session" | schema | no | — | "The working session that closed the issue, stored and read back as `closed_by_session`, under the same first-close-wins rule." |
| "force" | schema | no | — | "Bypasses close policy — the open-children refusal and the live-blocker refusal — and the pin and the assignee guard, and nothing else: never the template guard.\\n\\nCLOSE POLICY EVALUATES AT THIS ITEM, against the row as this request has already changed it. A LATER item that gives a closed parent an open child is NOT refused: the policy is a gate on the closing act, not an invariant the store maintains." |
| "expected_version" | text | no | — | "Requires the row's `revision` to equal this value, evaluated as-modified and checked before the idempotent close. A miss refuses the whole request with `409 precondition_failed`, and `ApplyUpdateItem.expected_version`'s already-written rule applies here identically.\\n\\nTHERE IS DELIBERATELY NO `expected_status` HERE. A close is idempotent — re-closing a closed issue is `changed: false` — so a guard spelled to refuse an already-closed row is asking for a REFUSAL where this verb answers with a no-op. That belongs on an `update` item whose `patch.status` crosses into the done category.\\n\\nIT IS A STRING, and it must be the `revision` string a response carried, verbatim. A JSON number — or any other type — is a `400` naming this member. The token spans the FULL 64-bit range, so a number would be rounded past 2^53 by an IEEE-754-double parser and the guard would miss a row nothing else touched; a string round-trips exactly in every consumer." |

#### Advanced

```json-schema
{
  "properties": {
    "reason": {
      "type": "string",
      "maxLength": 255
    },
    "session": {
      "type": "string",
      "maxLength": 255
    },
    "force": {
      "type": "boolean",
      "default": false
    }
  }
}
```

<!-- bdp-schema:end ApplyCloseItem bundle=issue-callables -->

<!-- bdp-schema:start ApplyDepAddItem bundle=issue-callables -->
### Schema: "ApplyDepAddItem"

Value: object

Other fields: not allowed

Required order: ["source", "target", "type"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Asserts ONE dependency edge, under `POST /v0/beads/dependencies:add`'s rules. An edge from a row to itself is a `400`.\\n\\nA TARGET NEED NOT BE A ROW THIS DATABASE HOLDS: an `external:` reference and an id belonging to another repository are legitimate targets, so only an absence this database can SEE is refused. A SOURCE has no such latitude — an edge follows its source, so a source this database holds no row for has no plane to land in.\\n\\n`metadata` is the edge's type-specific JSON blob, and an OBJECT where it is present at all. Most edge types carry none.\\n\\nA WAITS-FOR EDGE IS NORMALIZED RATHER THAN STORED AS ASKED. An absent, empty or `{}` `metadata` on a `waits-for` edge is STORED as `{\\"gate\\":\\"all-children\\"}`, because a stored waits-for row must be self-describing: readers predating the gate's introduction do not default a missing one, so an empty gate is a row those readers get wrong. A metadata that names a gate keeps it, along with the spawner and also-blocks members a caller may carry, and a gate that is neither `all-children` nor `any-children` is a `400`. Nothing else about that member is interpreted.\\n\\nTHERE IS NO TYPED `waits_for` MEMBER, and that is the shape rather than an omission: every measured caller already carries the gate as metadata, a typed spelling lowers to these same bytes, and the blob carries members a two-field typed member could not express. One spelling, and it is this one.\\n\\n`has_spawner` and `thread_id` require `issues.batchApply.depAddLineage`: a client naming either on a server that has not advertised the token refuses locally before the dial rather than sending bytes an older server would answer with its own `400` for an unknown member." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "source" | ref "#/$defs/Ref" | yes | — | — |
| "target" | ref "#/$defs/Ref" | yes | — | — |
| "type" | schema | yes | — | "A Link Type reference (§2). The edge type, from the same OPEN vocabulary `Dependency.type` carries: checked for BEING a storable value, never for membership of a known-types list, so a workspace's own type passes." |
| "metadata" | ref "#/$defs/MetadataValue" | no | — | — |
| "has_spawner" | boolean | no | — | "Gated by `issues.batchApply.depAddLineage`. Ignored for every `type` but `waits-for`: on a `waits-for` edge, `true` stamps `metadata.spawner_id` with this item's `target` (the id `bd create --graph`'s spawner_key/spawner_id resolved to), so a reader learns which spawned row to watch without re-deriving it from the graph plan. Absent or `false` leaves `metadata` exactly as given." |
| "thread_id" | schema | no | — | "Gated by `issues.batchApply.depAddLineage`. A plain column on the stored edge, separate from `metadata`'s blob — the graph-plan thread this edge belongs to, for a reader that groups edges by thread without parsing every edge's metadata." |

#### Advanced

```json-schema
{
  "properties": {
    "type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "thread_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    }
  }
}
```

<!-- bdp-schema:end ApplyDepAddItem bundle=issue-callables -->

<!-- bdp-schema:start ApplyBatchResponse bundle=issue-callables -->
### Schema: "ApplyBatchResponse"

Value: object

Required order: ["keys", "items"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "keys" | schema | yes | — | "Each create item's `key` mapped to the id it was bound to. It is the one fact the request cannot carry and every caller needs.\\n\\nIt carries only the keys the request NAMED: an unnamed create item is in `items` and not here. A request whose create items named nothing answers with an empty object, never `null`." |
| "items" | array of (ref "#/$defs/ApplyItemResult") | yes | — | "One entry per requested item, in REQUEST ORDER. Never null and never shorter than the request: a batch that could not apply every item applied none, so there is no index with nothing to put at it.\\n\\nThere is no `has_more` and no `next_cursor`. This is not a page — the client already knows how many items it sent." |

#### Advanced

```json-schema
{
  "properties": {
    "keys": {
      "type": "object",
      "additionalProperties": {
        "type": "string"
      }
    }
  }
}
```

<!-- bdp-schema:end ApplyBatchResponse bundle=issue-callables -->

<!-- bdp-schema:start ApplyItemResult bundle=issue-callables -->
### Schema: "ApplyItemResult"

Value: object

Required order: ["kind", "issue_id", "changed", "revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "What ONE item did, at the index the item occupied.\\n\\nIT IS LEAN, AND CARRIES NO ISSUE. Every other write on this surface answers with the stored row; this one answers with ids and a revision, and a client that wants the rows reads them back. A hundred hydrated issues with their labels and edges is a response an order of magnitude larger than the request that produced it, and no client needs all of them: the ids are what a plan's next step is composed from. The library contract behind this operation DOES carry a post-item snapshot, because its completion hooks hand a script the row it is being told about — and hooks never fire on this surface at all, which is exactly why the snapshot stops here." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "kind" | schema | yes | — | "Echoes the item's kind, so a caller walking the results does not have to walk the request alongside them." |
| "issue_id" | text | yes | — | "The row the item acted on: the minted or explicit id for a `create`, the resolved target for an `update` or a `close`, and the edge's SOURCE for a `dep_add`." |
| "depends_on_id" | text | no | — | "The edge's target. Present for `dep_add` and ABSENT for every other kind, which act on a row rather than on a pair." |
| "changed" | boolean | yes | — | "Whether this item persisted a semantic mutation. A `create` is always true. An `update` and a `close` follow their own operations' `changed`/`already_closed` answers, and a `dep_add` is false for an idempotent re-add of an edge that already existed with the same type." |
| "revision" | text | yes | — | "The row's optimistic-concurrency token AFTER the item, and the value an `expected_version` guard is composed from. The same member the CLI's detail view publishes under this name; it is not a new word.\\n\\nIT IS EQUALITY-ONLY: compare it, never order or interpret it. A change signals the row was mutated since you read it, and nothing more — it is a random value the engine rewrites, not a counter.\\n\\nITS COVERAGE IS PARTIAL, and the partiality is inherited rather than introduced: the token is rewritten by claim, close, unclaim and the generic update path, and NOT by the direct-update paths that rewrite text without touching it. A client needing complete change detection combines it with `updated_at`, `status` and the label set.\\n\\nIt is ALWAYS PRESENT, including as 0. Zero is a real value — a legacy row backfilled and not mutated since — and a `dep_add` is 0 too, because an edge acts on no single row's version. An absent member would be ambiguous between the two.\\n\\nIT IS A STRING, the token's decimal spelling — `\\"-3819021935081927\\"`, or `\\"0\\"` for a legacy migration-0054 row. Send it back verbatim as an `expected_version`; do not parse it into a number. A JSON number would not survive the trip: the token spans the FULL 64-bit range, and an IEEE-754-double parser — JavaScript's `JSON.parse`, Go's `any`, Python's `float` — rounds anything past 2^53 to a value NEAR the token that is not it, so a guard composed from it is refused against a row nothing else touched. A string round-trips exactly in every consumer." |

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

<!-- bdp-schema:end ApplyItemResult bundle=issue-callables -->

<!-- bdp-schema:start DependencyEdge bundle=issue-callables -->
### Schema: "DependencyEdge"

Value: object

Other fields: not allowed

Required order: ["issue_id", "depends_on_id", "type"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One directed edge, as a REQUEST names it. It is not `Dependency`, which is the stored row `GET /v0/beads/dependencies` returns and carries the columns storage assigned; this is the three members a caller supplies." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue_id" | schema | yes | — | "The edge's SOURCE — the issue that depends on the other end. An EXACT canonical id, and one this database holds: an edge follows its source, so a source that names nothing is a `400`." |
| "depends_on_id" | schema | yes | — | "The edge's TARGET — the issue depended upon. An exact canonical id, an `external:` reference, or an id belonging to another repository. Only an absence this database can SEE is refused. It must differ from `issue_id`." |
| "type" | schema | yes | — | "A Link Type reference (§2). The edge type, from the same OPEN vocabulary `Dependency.type` carries: checked for being a storable value, never for membership of a known-types list, so a workspace's own type passes." |

#### Advanced

```json-schema
{
  "properties": {
    "issue_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "depends_on_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    }
  }
}
```

<!-- bdp-schema:end DependencyEdge bundle=issue-callables -->

<!-- bdp-schema:start AddDependenciesResponse bundle=issue-callables -->
### Schema: "AddDependenciesResponse"

Value: object

Required order: ["added"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "added" | array of (ref "#/$defs/DependencyEdge") | yes | — | "The request's edges, in REQUEST ORDER. It echoes the request because all-or-nothing means it is either every edge or the call failed, so a caller reporting what landed reads the result and never has to know which of the two it is safe to read. An idempotent same-type re-add is echoed like any other edge; the response does not say which edges were genuinely new, because nothing a client does depends on that.\\n\\nNever null and never shorter than the request: a partial outcome does not exist on this operation." |

<!-- bdp-schema:end AddDependenciesResponse bundle=issue-callables -->

<!-- bdp-schema:start RemoveDependencyResponse bundle=issue-callables -->
### Schema: "RemoveDependencyResponse"

Value: object

Required order: ["removed"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "removed" | boolean | yes | — | "True when an edge was there and is now gone. FALSE IS A SUCCESS, not a refusal: it says this pair carried no such edge, which is the same graph a second removal leaves. Nothing was written for it." |

<!-- bdp-schema:end RemoveDependencyResponse bundle=issue-callables -->

<!-- bdp-schema:start ClaimResponse bundle=issue-callables -->
### Schema: "ClaimResponse"

Value: object

Required order: ["issue", "already_claimed"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue" | ref "#/$defs/Issue" | yes | — | — |
| "already_claimed" | boolean | yes | — | "True when the caller already held the issue and this call changed nothing — the idempotent re-claim. A claim held by a DIFFERENT actor is a 409, not a 200 with this flag." |

<!-- bdp-schema:end ClaimResponse bundle=issue-callables -->

<!-- bdp-schema:start HeartbeatIssueResponse bundle=issue-callables -->
### Schema: "HeartbeatIssueResponse"

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
| "id" | text | yes | — | "The issue whose lease was refreshed." |
| "holder" | text | yes | — | "The lease holder after the refresh (the request's `actor`)." |
| "heartbeat_at" | schema | yes | — | "The server clock, in UTC, the refresh stamped on the lease." |
| "lease_expires_at" | schema | yes | — | "`heartbeat_at` plus the server's lease TTL: the deadline the next heartbeat must beat before a reclaim may revert the claim." |
| "rearmed" | boolean | yes | — | "True when the actor held the claim but no lease row existed for it (a claim hand-doled through `updateIssue`), so the heartbeat granted a fresh lease instead of refreshing one. A re-arm is recorded as a mutation of the issue: its `revision` is reminted, `updated_at` moves and an event is recorded, so re-read the issue before a guarded write. False for every refresh, which writes only the lease." |

#### Advanced

```json-schema
{
  "properties": {
    "heartbeat_at": {
      "type": "string",
      "format": "date-time"
    },
    "lease_expires_at": {
      "type": "string",
      "format": "date-time"
    }
  }
}
```

<!-- bdp-schema:end HeartbeatIssueResponse bundle=issue-callables -->

<!-- bdp-schema:start ReleaseIssueResponse bundle=issue-callables -->
### Schema: "ReleaseIssueResponse"

Value: object

Required order: ["issue", "changed", "revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue" | ref "#/$defs/Issue" | yes | — | — |
| "changed" | boolean | yes | — | "Whether the release WROTE the row. It is TRUE on every 200 this operation returns, because every shape that would not write is refused above it — an unheld row is a 409, not an idempotent no-op. DO NOT WRITE A `changed: false` BRANCH: no request reaches one.\\n\\nIt is published rather than omitted because `claimIssue` and `updateIssue` publish the same fact, and a caller holding all three should not have to read them two ways. It is also the negative space that answers \\"where is the `already_released` member\\" — there is none, and the operation description says why." |
| "revision" | text | yes | — | "The row's optimistic-concurrency token AFTER the release, spelled the way `UpdateIssueResponse.revision` spells it and carrying the same promise: a read-modify-write loop composes its next `expected_version` from THIS value, never from one it composed itself.\\n\\nA release REMINTS the token by design, so a caller that guarded a following write on a version it read BEFORE the release will miss. That is the point — a concurrent reclaim or close conflicts rather than silently merging — and this member is how the caller stays in step.\\n\\nIT IS A STRING, the token's decimal spelling — `\\"-3819021935081927\\"`, or `\\"0\\"` for a legacy migration-0054 row. Send it back verbatim as an `expected_version`; do not parse it into a number. A JSON number would not survive the trip: the token spans the FULL 64-bit range, and an IEEE-754-double parser — JavaScript's `JSON.parse`, Go's `any`, Python's `float` — rounds anything past 2^53 to a value NEAR the token that is not it, so a guard composed from it is refused against a row nothing else touched. A string round-trips exactly in every consumer." |

<!-- bdp-schema:end ReleaseIssueResponse bundle=issue-callables -->

<!-- bdp-schema:start ClaimNextResponse bundle=issue-callables -->
### Schema: "ClaimNextResponse"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The outcome of one atomic take of ready work.\\n\\n`claimed` IS ABSENT WHEN NOTHING WAS ELIGIBLE, and its absence is the whole signal — there is no boolean beside it, because a second member carrying the same fact is a second member that can disagree with the first. A polling client branches on presence.\\n\\nIT IS ALSO THE ONLY MEMBER, deliberately. A count of what was scanned, or how many rows a racing agent had already taken, would describe a moment inside a transaction that has committed and is not a fact about the claim.\\n\\nThe row is `IssueWithCounts` — the element type `GET /v0/beads/ready` returns and `bd ready --json` emits — hydrated INSIDE the transaction that committed the claim, so its counts describe the state the claim produced rather than a later one. It is not an `Issue` because the listing this replaces answers with counts, and a client swapping the composed pair for this operation should not lose a field doing it." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "claimed" | ref "#/$defs/IssueWithCounts" | no | — | — |

<!-- bdp-schema:end ClaimNextResponse bundle=issue-callables -->

<!-- bdp-schema:start BatchCloseItem bundle=issue-callables -->
### Schema: "BatchCloseItem"

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
| "id" | schema | yes | — | "Exact canonical issue id, resolved across BOTH planes. No fuzzy, prefix or substring resolution — `IssueID`'s rule.\\n\\nA DUPLICATE is admissible; see the operation description." |
| "reason" | schema | no | — | "Why THIS issue is closed. It is per item rather than per request because `bd close a b c --reason x --reason y --reason z` has always mapped them positionally, and one request-wide reason could not express it. `CloseIssueRequest.reason`'s rules and first-close-wins." |

#### Advanced

```json-schema
{
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "reason": {
      "type": "string",
      "maxLength": 255
    }
  }
}
```

<!-- bdp-schema:end BatchCloseItem bundle=issue-callables -->

<!-- bdp-schema:start BatchCloseResponse bundle=issue-callables -->
### Schema: "BatchCloseResponse"

Value: object

Required order: ["outcomes"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "outcomes" | array of (ref "#/$defs/CloseOutcome") | yes | — | "Exactly one entry per requested item, in REQUEST ORDER — including for items that refused, so a client walks this against its own argument list without matching ids back up." |

<!-- bdp-schema:end BatchCloseResponse bundle=issue-callables -->

<!-- bdp-schema:start CloseOutcome bundle=issue-callables -->
### Schema: "CloseOutcome"

Value: object

Required order: ["issue_id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "What happened to ONE requested item.\\n\\n`code` IS THE DISCRIMINATOR. Present means the item REFUSED and nothing was written for it; absent means it succeeded, and `issue`, `already_closed` and `open_children` are all present. A client branches on `code` first and reads nothing else until it has." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue_id" | text | yes | — | "The id the caller asked for, echoed verbatim so an outcome can be read without indexing back into the request." |
| "issue" | ref "#/$defs/Issue" | no | — | — |
| "already_closed" | boolean | no | — | "True when the issue was already closed and this item changed nothing — the idempotent re-close, spelled the way `CloseIssueResponse.already_closed` spells it. Present only on a successful item.\\n\\nA BATCH WHOSE ITEMS ARE ALL `true` LANDED NOTHING, and records no history entry: a per-item success that changed nothing is not work the caller did." |
| "open_children" | integer | no | — | "How many open children the transaction observed for this item.\\n\\nITS MEANING FOLLOWS `code`, and both readings are the ones the single close already publishes. On a SUCCESSFUL item it is always present and is `CloseIssueResponse.open_children` — the number a forced close bypassed, reported even for an idempotent re-close, and `0` for an unforced close that got that far. On a REFUSED item its PRESENCE is the discriminator between the two `not_closable` refusals, exactly as it is on a problem document: present means open children, absent means a live blocker." |
| "blockers" | array of (ref "#/$defs/Blocker") | no | — | "With `not_closable` on the live-blocker refusal: the blockers that refused THIS item, exactly as `Problem.blockers` carries them for the single close, and optional for the same reason. Absent on a successful item and on every other refusal." |
| "assignee" | text | no | — | "With `not_assignee`: the issue's assignee the refusing transaction observed, exactly as `Problem.assignee` carries it for the single close. Absent on a successful item and on every other refusal." |
| "code" | text | no | — | "This item's refusal, from `Problem.code`'s vocabulary and restricted to `not_found` (the id names no row in either plane), `not_closable` (close policy refused it: open children, or a live blocker — see `open_children`), and the close guards `template_read_only`, `issue_pinned` and `not_assignee` (see `assignee`), exactly as the single close answers them. ABSENT means the item succeeded.\\n\\nIt is the problem vocabulary rather than a second one because an item refusal and a request refusal are the same question asked at two scopes, and a client that had to learn two vocabularies to classify one condition would be classifying the SCOPE rather than the condition." |
| "detail" | text | no | — | "Prose for a refusal, never load-bearing and present only with `code`. It reflects the request and this server's own words rather than the role's message, for the reason `Problem.detail` gives." |
| "auto_closed_molecule" | ref "#/$defs/Issue" | no | — | — |
| "molecule_auto_close_refusal" | text | no | — | "`CloseIssueResponse.molecule_auto_close_refusal` for this item, under `issues.close.autoCloseMolecule`; `auto_closed_molecule` beside it is `CloseIssueResponse.auto_closed_molecule`. Present only on a successful item." |

<!-- bdp-schema:end CloseOutcome bundle=issue-callables -->

<!-- bdp-schema:start Blocker bundle=issue-callables -->
### Schema: "Blocker"

Value: object

Required order: ["id", "kind"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One live blocker named by a blocked-issue refusal." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | text | yes | — | "The blocker: a local issue id, or the full `external:<project>:<capability>` reference." |
| "kind" | text | yes | — | "`local` for an issue this database holds, which clears when it closes; `external` for an `external:` reference, which clears when the named project ships the capability. The set may grow; default-branch on unknown values." |
| "type" | schema | no | — | "A Link Type reference (§2). The blocking edge's dependency type (`blocks`, `waits-for`, `conditional-blocks`). ABSENT when the refusal did not report it, which is the case for an `external:` blocker." |

#### Advanced

```json-schema
{
  "properties": {
    "type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    }
  }
}
```

<!-- bdp-schema:end Blocker bundle=issue-callables -->

<!-- bdp-schema:start AdvanceMoleculeResponse bundle=issue-callables -->
### Schema: "AdvanceMoleculeResponse"

Value: object

Required order: ["closed_step", "complete", "claimed"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "closed_step" | ref "#/$defs/Issue" | yes | — | — |
| "molecule_id" | text | no | — | "The step's molecule root. ABSENT when the step belongs to no molecule, and then nothing else below is set." |
| "complete" | boolean | yes | — | "Every step of the molecule is closed; `next_step` is then absent." |
| "next_step" | ref "#/$defs/Issue" | no | — | — |
| "claimed" | boolean | yes | — | "`next_step` was claimed for `actor`, and is the post-claim row." |

<!-- bdp-schema:end AdvanceMoleculeResponse bundle=issue-callables -->

<!-- bdp-schema:start CloseIssueResponse bundle=issue-callables -->
### Schema: "CloseIssueResponse"

Value: object

Required order: ["issue", "already_closed", "open_children", "revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue" | ref "#/$defs/Issue" | yes | — | — |
| "already_closed" | boolean | yes | — | "True when the issue was already closed and this call changed nothing — the idempotent re-close, mirroring `ClaimResponse.already_claimed`. The response still carries the row, and `reason`/`session` were not rewritten." |
| "open_children" | integer | yes | — | "How many open children the close observed. Reported by a FORCED close — including an idempotent re-close — because a caller that bypassed the guard is exactly the caller that wants the number. An unforced close that got this far had none, so it reports 0." |
| "revision" | text | yes | — | "The row's optimistic-concurrency token AFTER this close, spelled the way `UpdateIssueResponse.revision` spells it.\\n\\nIt is here because `expected_version` is: a guard whose token no response carries is a guard a caller cannot fill, and a close-then-reopen or close-then-delete chain has to compose its next expectation from the value the close ANSWERED with. An idempotent re-close carries one too — the row still has a version, and a caller that guarded a replay needs the token whether or not the replay wrote.\\n\\nIT IS A STRING, the token's decimal spelling — `\\"-3819021935081927\\"`, or `\\"0\\"` for a legacy migration-0054 row. Send it back verbatim as an `expected_version`; do not parse it into a number. A JSON number would not survive the trip: the token spans the FULL 64-bit range, and an IEEE-754-double parser — JavaScript's `JSON.parse`, Go's `any`, Python's `float` — rounds anything past 2^53 to a value NEAR the token that is not it, so a guard composed from it is refused against a row nothing else touched. A string round-trips exactly in every consumer." |
| "auto_closed_molecule" | ref "#/$defs/Issue" | no | — | — |
| "molecule_auto_close_refusal" | text | no | — | "With `issues.close.autoCloseMolecule` and `auto_close_molecule`: why the molecule root this close completed stayed open — the root's own close policy refused it (a live blocker on the root), or a close guard did (a template, a pinned root, a root assigned to another actor). Prose; absent when nothing was refused. `auto_closed_molecule`, beside it, is the root the close also closed, absent when none was." |

<!-- bdp-schema:end CloseIssueResponse bundle=issue-callables -->

<!-- bdp-schema:start ReopenIssueResponse bundle=issue-callables -->
### Schema: "ReopenIssueResponse"

Value: object

Required order: ["issue", "already_open", "revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue" | ref "#/$defs/Issue" | yes | — | — |
| "already_open" | boolean | yes | — | "True when the issue was not in a done status and this call changed nothing — idempotent, mirroring `CloseIssueResponse.already_closed` and `ClaimResponse.already_claimed`. The response still carries the row." |
| "revision" | text | yes | — | "The row's optimistic-concurrency token AFTER this reopen, spelled the way `CloseIssueResponse.revision` spells it and here for the same reason: a recovery flow that reopens and then re-closes composes its next `expected_version` from this value. DECODE IT AS A 64-BIT INTEGER.\\n\\nIT IS A STRING, the token's decimal spelling — `\\"-3819021935081927\\"`, or `\\"0\\"` for a legacy migration-0054 row. Send it back verbatim as an `expected_version`; do not parse it into a number. A JSON number would not survive the trip: the token spans the FULL 64-bit range, and an IEEE-754-double parser — JavaScript's `JSON.parse`, Go's `any`, Python's `float` — rounds anything past 2^53 to a value NEAR the token that is not it, so a guard composed from it is refused against a row nothing else touched. A string round-trips exactly in every consumer." |

<!-- bdp-schema:end ReopenIssueResponse bundle=issue-callables -->

<!-- bdp-schema:start MetadataValue bundle=issue-callables -->
### Schema: "MetadataValue"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One metadata value: ANY JSON value — string, number, boolean, null, array or object — because typed values enter through the explicit JSON metadata path and persist in older rows. It is not a string, and a client must not decode it as one.\\n\\nWhere a member of this type is OMITTED, the key is absent; where it is present holding `null`, the key exists and holds null. Those are different states and this surface reports both." |

<!-- bdp-schema:end MetadataValue bundle=issue-callables -->

<!-- bdp-schema:start CompareAndSetMetadataResponse bundle=issue-callables -->
### Schema: "CompareAndSetMetadataResponse"

Value: object

Required order: ["swapped"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "swapped" | boolean | yes | — | "Whether the precondition held and the transition applied. THIS IS THE VERDICT and the only member to dispatch on. False is a lost race — an answer, not a failure — and the response is still a 200." |
| "current" | ref "#/$defs/MetadataValue" | no | — | — |

<!-- bdp-schema:end CompareAndSetMetadataResponse bundle=issue-callables -->

<!-- bdp-schema:start IssuePatchBody bundle=issue-callables -->
### Schema: "IssuePatchBody"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The fields to write. Every member is optional and PRESENCE is the signal: a member present is written, a member absent is untouched. An empty object is a `400` — a write that writes nothing is a client bug — except on `updateIssue` beside `claim: true`, where the claim is the write.\\n\\nThis is a deliberate SUBSET of the fields an issue carries; the members it does not spell are future surface rather than oversights, and `updateIssue`'s own description says which and why.\\n\\nIt now agrees with `ApplyPatchBody` on every member it publishes, and the two differ only in the SHAPE of two of them: `labels` is complete replacement here and an ordered add/remove/replace patch there, because that operation edits a set it did not compose. Everything else — down to the `metadata` algebra and the four nullable members — is one definition, so a caller cannot get a different answer for the same edit depending on which operation it sent." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "title" | schema | no | — | "The issue's title. Must not be blank after trimming; the length bound is what the column holds." |
| "description" | text | no | — | — |
| "design" | text | no | — | — |
| "acceptance_criteria" | text | no | — | — |
| "notes" | text | no | — | "Replaces the notes. Mutually exclusive with `append_notes`; sending both is a `400`. Replacing EXISTING non-empty notes with different non-empty content is refused with `409 notes_overwrite_refused` unless `force_notes_overwrite` is set; an explicit clear (empty string) is not fenced." |
| "append_notes" | text | no | — | "Appends to the notes rather than replacing them. Mutually exclusive with `notes`." |
| "priority" | schema | no | — | — |
| "issue_type" | schema | no | — | "A Bead Type reference (§2). The issue type, from this workspace's own configured vocabulary. A type outside it is refused by the ROLE and reaches the client as a `400` — this server cannot read the vocabulary without a transaction, so it checks only what this schema declares." |
| "status" | schema | no | — | "The issue's status, from this workspace's own configured vocabulary.\\n\\nA STATUS THAT CROSSES INTO THE DONE CATEGORY ANSWERS TO CLOSE POLICY: the update is refused with `409 not_closable` for open children or a live blocker unless `force_close_policy` is set. A done-to-done change and a move OUT of the done category are unaffected.\\n\\nIT IS NOT A SECOND SPELLING OF `{id}:close` AND `{id}:reopen`. Those two carry semantics a status write has nowhere to put — the reason and session under first-close-wins, the done-status normalization, the `already_closed`/`already_open` idempotence flags — and they remain the operations to reach for when what you mean is \\"close this\\". This member is for the edit that moves a status ALONGSIDE other fields in one transaction, which is the thing two calls cannot do. `ApplyPatchBody.status` has meant exactly this since `issues:batchApply` landed." |
| "assignee" | schema | no | — | "The assignee. A transfer away from a live foreign in-progress owner is refused with `409 already_claimed` unless `force_assignee_transfer` is set or `expected_assignee` matched. Setting it to the empty string unassigns.\\n\\n`{id}:claim` remains the operation that ACQUIRES work: it carries its own eligibility rules and sets the status with the assignee in one act. This member is the raw write, fenced." |
| "parent_id" | schema | no | — | "Replaces the issue's parents atomically: a nonempty value makes THAT issue the only parent, and an EMPTY STRING removes every parent-child edge the issue has. Labels are not inherited — that is a create-time choice (`CreateIssueRequest.inherit_labels_from_parent`) and a reparent does not re-run it.\\n\\nIT IS A GRAPH EDIT, and it earns the graph's refusals: a new parent this workspace holds no row for is a `400`, a pair that already carries an edge of another type is `409 dependency_exists`, and a move under the issue's own descendant is `409 dependency_cycle` — the PLAIN one, carrying no `issue_id`/`blocker_id`/ `blocker_is_ancestor`, because the hierarchy refusal answers only to blocking edges and this member writes a `parent-child` edge. Naming the issue itself is a `400`. One call rather than a remove-then-add pair, which is the whole reason it is here: the two-call spelling leaves the issue parentless if the second call fails." |
| "labels" | schema | no | — | "COMPLETE REPLACEMENT of the label set. An empty array clears every label.\\n\\nIt is the REPLACE half of the same ordered edit `ApplyPatchBody` spells as `labels.replace`, and `add_labels`/`remove_labels` are the other two. All three may travel together and are applied in that order — replace, then add, then remove — so REMOVAL WINS when one label appears in more than one of them. That is the role's own algebra, not this operation's arrangement of it.\\n\\nTHE SHAPE DIFFERS FROM `ApplyPatchBody`'s, which nests the three under one `labels` object, and the difference is historical rather than meaningful. This member shipped as a bare array; nesting it now would RE-TYPE a published member, which is the one kind of change this document has no additive route for. Two flat siblings is the shape that could be added — and it is the shape `notes` and `append_notes` already use for the same replace/increment pair." |
| "add_labels" | schema | no | — | "Labels to add, applied AFTER any `labels` replacement.\\n\\nIT IS NOT MUTUALLY EXCLUSIVE WITH `labels`, and that is the difference from `append_notes`, which is. The role defines an order over all three label edits, so sending a replacement and an addition together has a defined result; notes have no such algebra, so there the two are a contradiction and are refused.\\n\\nIT IS WHY THIS PAIR EXISTS. A caller that reads a row, adds one label and writes the whole set back silently drops any label another writer added in between — and `bd label add` and every agent that tags work concurrently are exactly that caller. A replacement can only be composed safely by a writer that knows it is alone.\\n\\nRepetition is free: a label named twice is applied once, and adding one the issue already carries changes no labels. (Whether the RESPONSE reports `changed: false` is a fact about the whole patch — see `remove_labels`.) An EMPTY-STRING entry is DROPPED rather than refused — a label row carrying `\\"\\"` renders as nothing and matches nothing, so writing one would only store junk, and refusing the whole update would let one stray entry fail an otherwise-good edit." |
| "remove_labels" | schema | no | — | "Labels to remove, applied AFTER `labels` and `add_labels`, so REMOVAL WINS over both.\\n\\nRemoving a label the issue does not carry CHANGES NO LABELS; it is not a `404` and not a conflict. Whether the RESPONSE reports `changed: false` is a fact about the whole patch, not about this member — a request that also moved a title changed the row. The same repetition and empty-string rules as `add_labels` apply, and a value longer than the column is refused here as it is there — the length rule is about what a label may BE, not about whether this particular row happens to carry one." |
| "estimated_minutes" | schema | no | — | "Explicit `null` CLEARS the estimate." |
| "external_ref" | schema | no | — | "Explicit `null` CLEARS the reference." |
| "due_at" | schema | no | — | "RFC 3339. Explicit `null` CLEARS the due date." |
| "defer_until" | schema | no | — | "RFC 3339. Explicit `null` CLEARS the deferral." |
| "metadata" | ref "#/$defs/ApplyMetadataPatch" | no | — | — |
| "await_id" | schema | no | — | "Replaces the gate's condition identifier; the empty string clears it. Not nullable. At most 255 characters, the stored column's width; a longer value is a `400` naming this member. Requires the behavior token `issues.update.gates`." |
| "waiters" | array of (text) | no | — | "A WHOLE-VALUE replacement of the gate's waiter list; `[]` clears it. Not nullable. Stored as sent (duplicates kept: deduplicating is the caller's, as `bd gate add-waiter` does). The list's JSON encoding must fit the stored TEXT column (65535 bytes); a larger one is a `400` naming this member. Requires the behavior token `issues.update.gates`." |
| "persistence" | schema | no | — | "One of `persistent`, `ephemeral` or `no_history`; any other value is a `400` naming the member. Selects the issue's complete persistence state, moving the row between the durable and the wisp plane when the state changes plane. `persistent` promotes a wisp: the row keeps its id, and its labels, dependencies, events and comments move with it, all in this update's one transaction (`bd promote`, `bd update --persistent`). `ephemeral` and `no_history` select the wisp retention modes (`bd update --ephemeral` / `--no-history`); demoting a durable row that has retained snapshots is refused. The current mode is a no-op that reports `changed: false`.\\n\\nA PLANE MOVE IS AN AGGREGATE MIGRATION, not a field write, and it is applied LAST, after every other member of the patch, so the edit and the move commit together or not at all. Advertised by the `issues.update.persistence` capability token; a server that predates the member refuses it as an unknown parameter, and a client that does not see the token refuses the move before the dial rather than sending it." |

#### Advanced

```json-schema
{
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "priority": {
      "type": "integer",
      "minimum": 0,
      "maximum": 4
    },
    "issue_type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "status": {
      "type": "string",
      "maxLength": 255
    },
    "assignee": {
      "type": "string",
      "maxLength": 255
    },
    "parent_id": {
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
    "add_labels": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 255
      }
    },
    "remove_labels": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 255
      }
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
    "due_at": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time"
    },
    "defer_until": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time"
    },
    "await_id": {
      "type": "string",
      "maxLength": 255
    },
    "persistence": {
      "type": "string",
      "maxLength": 255
    }
  }
}
```

<!-- bdp-schema:end IssuePatchBody bundle=issue-callables -->

<!-- bdp-schema:start UpdateIssueResponse bundle=issue-callables -->
### Schema: "UpdateIssueResponse"

Value: object

Required order: ["issue", "changed", "revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "issue" | ref "#/$defs/Issue" | yes | — | — |
| "changed" | boolean | yes | — | "Whether the request persisted a semantic mutation. A same-value patch is a 200 with `changed: false` rather than an error — idempotent, like every replay answer on this surface." |
| "revision" | text | yes | — | "The row's optimistic-concurrency token AFTER this write, spelled the way `ApplyItemResult.revision` spells it.\\n\\nIt is here because `expected_version` is: a guard whose token no response carries is a guard a caller cannot fill. A read-modify-write loop composes its next expectation from THIS value and never from a number it incremented itself, for the reason `compareAndSetMetadata` gives about a value the store renormalizes. `GET /v0/beads/issues/{id}`'s `revision` is the read that publishes the same token, and this member agrees with it.\\n\\nIT IS A STRING, the token's decimal spelling — `\\"-3819021935081927\\"`, or `\\"0\\"` for a legacy migration-0054 row. Send it back verbatim as an `expected_version`; do not parse it into a number. A JSON number would not survive the trip: the token spans the FULL 64-bit range, and an IEEE-754-double parser — JavaScript's `JSON.parse`, Go's `any`, Python's `float` — rounds anything past 2^53 to a value NEAR the token that is not it, so a guard composed from it is refused against a row nothing else touched. A string round-trips exactly in every consumer." |

<!-- bdp-schema:end UpdateIssueResponse bundle=issue-callables -->

<!-- bdp-schema:start CreateIssueDependency bundle=issue-callables -->
### Schema: "CreateIssueDependency"

Value: object

Other fields: not allowed

Required order: ["target_id", "type"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One edge created with the issue. It carries `reverse` where `BatchCreateDependency` does not, because that operation's items have no id a target could point back at and this one's issue does." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "target_id" | schema | yes | — | "The other endpoint of the edge." |
| "type" | schema | yes | — | "A Link Type reference (§2). The edge type, from the same OPEN vocabulary `Dependency.type` carries: checked for BEING a storable value, never for membership of a known-types list, so a workspace's own type passes." |
| "reverse" | schema | no | — | "Writes the edge from `target_id` TO the new issue rather than from it. It is what lets a create declare an edge that points INTO the row being minted — the id no caller could have spelled beforehand — and it is the member that makes `dependency_cycle` reachable on this operation at all." |
| "metadata" | ref "#/$defs/MetadataValue" | no | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "target_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "type": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://.+",
      "x-bdp-type-reference": true
    },
    "reverse": {
      "type": "boolean",
      "default": false
    }
  }
}
```

<!-- bdp-schema:end CreateIssueDependency bundle=issue-callables -->

<!-- bdp-schema:start CreateIssueWaitsFor bundle=issue-callables -->
### Schema: "CreateIssueWaitsFor"

Value: object

Other fields: not allowed

Required order: ["spawner_id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A typed `waits-for` edge from the new issue to a spawner whose children gate it. It records a readiness primitive; it does not define scheduling or execution policy.\\n\\nIT IS A TYPED MEMBER HERE AND A METADATA BLOB ON `POST /v0/beads/issues:batchApply`, and the difference follows the ROLE rather than taste: `CreateRequest.WaitsFor` is a typed field that gets the gate defaulted and the \\"must not duplicate an explicit edge\\" check, while that operation's `dep_add` item is one generic edge with no typed field to reach. One spelling per operation, and each is its role's." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "spawner_id" | schema | yes | — | "The dependency target whose children are observed. It must not duplicate an edge `dependencies` or `parent_id` already spells." |
| "gate" | schema | no | — | "The readiness condition: `all-children` or `any-children`. Absent or empty defaults to `all-children`. A value that is neither is refused by the ROLE and reaches the client as a `400`." |

#### Advanced

```json-schema
{
  "properties": {
    "spawner_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "gate": {
      "type": "string",
      "maxLength": 255
    }
  }
}
```

<!-- bdp-schema:end CreateIssueWaitsFor bundle=issue-callables -->

<!-- bdp-schema:start Problem bundle=issue-callables -->
### Schema: "Problem"

Value: object

Required order: ["status", "title", "code", "request_id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "RFC 9457 problem detail. This is the only error shape on this surface. The core declares `type`; this server never emits it, so `about:blank` is implied throughout." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "type" | schema | no | — | "RFC 9457 problem type. This server never emits it, so `about:blank` is implied. A deployment that hosts problem documentation MAY supply it: one stable URI per status+code pair, dereferencing to documentation for that pair. It restates identity that `code` already carries, so a client MUST NOT dispatch on it and a server MUST NOT use it to subdivide a code." |
| "status" | integer | yes | — | "The HTTP status code, repeated in the body." |
| "title" | text | yes | — | "The status phrase. Human-facing; never dispatch on it." |
| "code" | text | yes | — | "The stable machine-readable reason, and the ONLY member a client may dispatch on. v0's vocabulary: `invalid_argument` (400, also emitted by the Host-header middleware on any route), `invalid_cursor` (400), `unauthenticated` (401, only on a server configured with a token file), `not_found` (404), `already_claimed` (409), `not_claimable` (409), `not_closable` (409), `not_releasable` (409), `lease_not_held` (409), `template_read_only` (409), `issue_pinned` (409), `not_assignee` (409), `dependency_cycle` (409), `dependency_exists` (409), `already_exists` (409), `precondition_failed` (409), `events_journal_disabled` (409), `events_journal_truncated` (410), `idempotency_expired` (410), `busy` (503), `db_unavailable` (503), `events_watch_saturated` (503), `internal` (500). Renaming or removing a status+code pair is a breaking change; ADDING one is not, so clients MUST default-branch on unknown values and fall back to the status class (unknown 4xx → client bug, fail loud; unknown 503 → retry per `Retry-After`; other unknown 5xx → server fault)." |
| "detail" | text | no | — | "Optional prose, never load-bearing. For 5xx codes it is a FIXED string per code and carries nothing about the underlying failure: driver and dial errors routinely embed the DSN, database user and host:port, and this API supports binding beyond loopback. It is fixed for `unauthenticated` too, and for the mirror-image reason: the caller's own input there is a credential, so echoing it would write the token into every client log and proxy trace on the way back. Other 4xx details reflect the caller's own input back and are specific." |
| "param" | text | no | — | "With `invalid_argument`: the offending query parameter, body member or header name. Present on every 400 except a body that fails to parse at all.\\n\\nWith `precondition_failed`: the body member carrying the guard that missed. It is the same spelling a 400 on the same operation would use, so a client reads one member to find the offending input whichever way the request was refused.\\n\\nWith `idempotency_expired`: the body member that named the retired id — `id` on `POST /v0/beads/issues`, `items[i].create.id` on `issues:batchApply`." |
| "reason" | text | no | — | "With `invalid_argument`: `unknown_parameter` (this server does not know that parameter — version skew; degrade or fall back), `invalid_value` (the value is not one this server will act on: malformed, out of vocabulary, or — for `limit=0` under `--allow-non-loopback` — legal but refused in this server's configuration; `detail` says which), `project_mismatch` (the `Bd-Project-Id` header named a project this server does not serve — a document-level refusal like the Host-header 400, raised on every enforced route, and the one that carries `server_project_id`; see the document-level rule), or `wire_revision_unsupported` (the `Bd-Wire-Revision` header named a revision below `ContextResponse.min_client_wire_revision` — also a document-level refusal, raised on every route including the identity handshake, and the one that carries `min_wire_revision`; see the document-level rule and `ContextResponse.wire_revision`). Either way the recovery is to send something different, never to retry the same request. With `lease_not_held`: `ephemeral` (the id names a wisp, which is never leased; its `issue_status` may be `in_progress`). The set may grow; default-branch on unknown values." |
| "assignee" | text | no | — | "With `already_claimed`: the actor currently holding the issue, read inside the transaction that refused. With `not_assignee`: the issue's assignee the refusing close observed — always present on that code.\\n\\nIT IS OPTIONAL ON EVERY OPERATION BUT THE CLAIM. `POST /v0/beads/issues/{id}:claim` always carries it, because its conflict path reads the row it lost to. `PATCH /v0/beads/issues/{id}` and `POST /v0/beads/issues:batchApply` carry it only when the refusing transaction reported a holder, and `POST /v0/beads/issues/{id}:release` never does — the ownership fence refuses without naming anyone. An absent member means \\"this refusal could not name the holder\\", never \\"nobody holds it\\"; re-read the row." |
| "issue_status" | text | no | — | "With `already_claimed` or `not_claimable`: the issue's status at the moment of refusal." |
| "open_children" | integer | no | — | "With `not_closable`: how many open children the transaction that refused the close observed, read inside that transaction rather than parsed out of `detail`.\\n\\nPRESENT ONLY for the open-children refusal. The other `not_closable` refusal is a live blocker and carries `blockers` instead, so member presence — not prose — is how a client tells the two apart. Both are bypassed by `force`." |
| "blockers" | array of (ref "#/$defs/Blocker") | no | — | "With `not_closable`, and ONLY on the live-blocker refusal: the live blockers that refused the close, in the order the refusing check reported them, read from the refusal's typed list rather than parsed out of any message. Never present together with `open_children`.\\n\\nA client renders the direct CLI's sentence from it: `cannot close blocked issue: <id> is blocked by [<b1> <b2> …]`, each blocker spelled `id` when its `type` is absent or `blocks` and `id (type)` otherwise — the sentence `detail` already begins with when this member is present.\\n\\nIT IS OPTIONAL. A refusal that could not name its blockers omits it and keeps the generic `detail`; absence means \\"this refusal did not name them\\", never \\"nothing blocks it\\". Re-read the issue's dependencies then." |
| "existing_type" | text | no | — | "With `dependency_exists`: the type of the edge the pair already carries, read inside the refusing transaction." |
| "requested_type" | text | no | — | "With `dependency_exists`: the type the request asked for. Together with `existing_type` it is the whole refusal, so a client never parses either out of `detail`." |
| "issue_id" | text | no | — | "With `dependency_cycle`, and ONLY on the hierarchy refusal: the issue the requested blocking edge would have gated. Its PRESENCE is the discriminator — absent means a plain scheduling cycle, present means the edge pointed at the issue's own ancestor or descendant.\\n\\nThe conflicting hierarchy may exist only inside the rolled-back batch, so no read after the fact can recover it: the refusing transaction is the only place this member can come from." |
| "blocker_id" | text | no | — | "With `dependency_cycle`, hierarchy refusal only: the ancestor or descendant the edge named as blocker. See `issue_id`." |
| "blocker_is_ancestor" | boolean | no | — | "With `dependency_cycle`, hierarchy refusal only: true when `blocker_id` is an ANCESTOR of `issue_id` (which cannot close until its descendants finish, so the gate would never clear), false when it is a DESCENDANT (waiting on your own subtree is a close gate, not a blocks edge — use a waits-for gate over the children). Both polarities are reported; this member is never omitted to mean false. See `issue_id`." |
| "expected_version" | text | no | — | "With `precondition_failed`: the row `revision` the request guarded on, echoed from the request itself.\\n\\nTHE EXPECTED/ACTUAL PAIRS ARE SPLIT BY TYPE rather than carried as one polymorphic `expected`/`actual`, and the reason is this document's: a member that is \\"a version or a status or an assignee\\" is a schema alternation, and no composition keyword is available to spell one here (see `ApplyItem`). Three typed pairs cost three member names and are readable by a generated client without a cast.\\n\\nIT IS A STRING, and it must be the `revision` string a response carried, verbatim. A JSON number — or any other type — is a `400` naming this member. The token spans the FULL 64-bit range, so a number would be rounded past 2^53 by an IEEE-754-double parser and the guard would miss a row nothing else touched; a string round-trips exactly in every consumer." |
| "actual_version" | text | no | — | "With `precondition_failed`: the `revision` the row was found holding, read inside the transaction that refused the guard.\\n\\nPRESENT ONLY WHERE THE REFUSING OPERATION CAN REPORT IT. An all-or-nothing operation rolls its transaction back, so a value read after the fact would describe a row the refusal never saw; where the role behind an operation does not carry the observed value, this member is omitted rather than reconstructed. Its absence therefore means \\"this server cannot tell you what it found\\", never \\"it found zero\\".\\n\\nNO v0 OPERATION EMITS IT TODAY, nor `actual_status` or `actual_assignee`. Every operation that publishes a guard refuses all-or-nothing, and none of the roles behind them carries the observed value out of the rolled-back transaction. The three members are declared so that an operation whose role CAN report what it found is an addition rather than a wire change — a client must not wait for them, and must never read their absence as a value.\\n\\nIT IS A STRING, and it must be the `revision` string a response carried, verbatim. A JSON number — or any other type — is a `400` naming this member. The token spans the FULL 64-bit range, so a number would be rounded past 2^53 by an IEEE-754-double parser and the guard would miss a row nothing else touched; a string round-trips exactly in every consumer." |
| "expected_status" | text | no | — | "With `precondition_failed`: the status the request guarded on, echoed from the request. See `expected_version`." |
| "actual_status" | text | no | — | "With `precondition_failed`: the status the row was found holding. Present under `actual_version`'s rule." |
| "expected_assignee" | text | no | — | "With `precondition_failed`: the assignee the request guarded on, echoed from the request. See `expected_version`." |
| "actual_assignee" | text | no | — | "With `precondition_failed`: the assignee the row was found holding. Present under `actual_version`'s rule." |
| "item_index" | integer | no | — | "On a batch operation whose items are heterogeneous: the position in `items` of the item that earned the refusal, read from the role's own typed error rather than parsed out of `detail`.\\n\\nThe request is all or nothing, so there is no per-item result array for a client to find the offender in — these four `item_*` members are the only place it exists." |
| "item_kind" | text | no | — | "The `kind` of the item at `item_index`, so a client can dispatch on what the item was doing without walking its own request back." |
| "item_key" | text | no | — | "The refused item's own `key`, or the key its target ref named. ABSENT when the item named nothing symbolically, which is a real state rather than a gap: not every item has a key." |
| "item_issue_id" | text | no | — | "The id the refused item was acting on, where one had been resolved before the refusal. ABSENT when the refusal happened before resolution — a create whose id was never minted, or a ref that resolved to nothing.\\n\\nIT IS NOT `issue_id`, and the divergence is load-bearing rather than verbose: `issue_id` is a PRESENCE-DISCRIMINATING member of the `dependency_cycle` hierarchy refusal, so a batch operation reusing it would make that discriminator fire on refusals it says nothing about." |
| "declared_later" | boolean | no | — | "With `invalid_argument` on a batch operation whose items may name each other: whether the unresolvable key IS declared by the request, at a LATER index.\\n\\nTrue is an ORDERING mistake — a key reaches backward only — and false is a key nothing in the request declares, which is a typo or a missing item. A client acts differently on each. Both polarities are emitted and the member is never omitted to mean false: an absent member says the refusal was not about a key at all." |
| "since" | schema | no | — | "With `events_journal_truncated`: the checkpoint the reported window begins after.\\n\\nIt is NOT always the value the request sent. In the ordinary case — the prefix you asked for was pruned — it IS your checkpoint. When the prefix is intact but the retained window has an interior hole, it is instead the last seq the server could serve contiguously from your checkpoint, and `floor` is where the next intact stretch begins. It never reports a value BELOW what you sent, so echoing it back can never re-deliver records you already hold." |
| "floor" | schema | no | — | "With `events_journal_truncated`: the lowest seq still retained, or `head + 1` when the journal retains nothing at all. Resuming from `floor - 1` continues with a known, explicit gap." |
| "head" | schema | no | — | "With `events_journal_truncated`: the highest seq this journal has ever assigned. It never decreases under a prune, so `floor > head` means the journal was pruned empty and the caller is at the end of its history. Emitted even when zero." |
| "closed_at" | schema | no | — | "With `idempotency_expired`: when the bead a retaining sweep retired had closed, as its tombstone recorded it. It dates the create that used the id, which already happened and never runs again." |
| "request_id" | text | yes | — | "Opaque correlation id for this request, echoed in the server's request log line. Never a dispatch key and never a retry key. (This server mints per-process ids that do not survive a restart; a deployment may substitute any identifier with the same log-correlation property, such as an edge trace id.)" |
| "server_project_id" | text | no | — | "With `invalid_argument` / `reason: \\"project_mismatch\\"` ONLY: the project id this server actually serves, so a client that stamped a `Bd-Project-Id` can tell a wrong-server refusal from a malformed one without parsing `detail`. It is set on that refusal and on no other, and never on a refusal raised before the stamp is checked — the Host gate, or a deployment's authentication layer — so its PRESENCE is the signal that this specific check fired." |
| "min_wire_revision" | integer | no | — | "With `invalid_argument` / `reason: \\"wire_revision_unsupported\\"` ONLY: this server's own `ContextResponse.min_client_wire_revision`, so a client that declared a `Bd-Wire-Revision` can log exactly how far behind it is without re-deriving the number from `bd_version`. It is set on that refusal and on no other." |
| "wire_revision" | integer | no | — | "With `invalid_argument` / `reason: \\"wire_revision_unsupported\\"` ONLY: this server's own current `ContextResponse.wire_revision`, alongside `min_wire_revision`, so a client logging the refusal has both ends of the supported range without a second request to `GET /v0/beads/context`. It is set on that refusal and on no other." |
| "bd_version" | text | no | — | "With `invalid_argument` / `reason: \\"wire_revision_unsupported\\"` ONLY: this server's own `ContextResponse.bd_version`, for a client that logs or reports the refusal and wants the release string alongside the two wire-revision numbers rather than a second request to fetch it. It is set on that refusal and on no other." |

#### Advanced

```json-schema
{
  "properties": {
    "type": {
      "type": "string",
      "format": "uri"
    },
    "since": {
      "type": "integer",
      "format": "int64"
    },
    "floor": {
      "type": "integer",
      "format": "int64"
    },
    "head": {
      "type": "integer",
      "format": "int64"
    },
    "closed_at": {
      "type": "string",
      "format": "date-time"
    }
  }
}
```

<!-- bdp-schema:end Problem bundle=issue-callables -->

## 10. Obsolescence

The fragments of §9 extract to `specs/types/issue/issue-callables-preview-1.schema.json`.
This edition replaces the command-shaped draft archived at
`specs/history/issue-callables-reshaped-20261105/`, which is history, not authority.
