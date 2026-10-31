# Product CLI surface and canonical lowering map

Source inventory and design review map, October 25, 2026. The product source is
[donnabox/beads `2c5667334`](https://github.com/donnabox/beads/tree/2c56673347b2bfb38022b3917580b58c7b2f6642),
the Preview 3 integration head inspected for this pass. The target is the
[canonical CLI draft](bdp-cli.md) in [BDP PR310](https://github.com/gastownhall/bdp/pull/310).
This document proposes translations; it does not change either implementation or
select new protocol capabilities.

The source contains **330 explicitly registered primary command paths**
(**127 top-level**), including parent groups. **186** relevant or adjacent
data/workflow paths are listed individually below, followed by **144**
platform/configuration/backend/integration paths so the inventory accounts for
every registered path. Declared aliases are recorded alongside their primary
path; a parent alias also works for that parent's children. Group rows do not
imply an extra operation.

Completeness was checked by parsing the Go command declarations and AddCommand
registrations, expanding the Memory constructors and cloned aliases, then
comparing the resulting set with the capability registry, including parents:
**no missing or extra paths**. This is a source audit, not a new runtime/help run
or an availability claim for every storage/workspace mode. Flags with materially
different behavior are called out, but a full flag-by-flag lowering proof remains
future work. Automatic framework help/completion are not Resource operations.
See [the registry's own limits](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/capability_registry.go#L21).

## Family map

Canonical targets use `bd` spellings here; the generic `bdp` executable has the
same hierarchy. “Conditional” means the data edit fits, provided the selected
Type/provider contract admits all required behavior. It does not claim that the
current product executes BDP internally.

| Product family | Candidate canonical target | Main qualification |
| --- | --- | --- |
| `create`, `new`, `q`, `create-form`, `todo add` | `create` | Native defaults/form/file parsing are client behavior; multi-record creation needs composition. |
| `show`, `view`, `recall`, `memory recall` | `show` | Expanded relationships/comments/watch have additional mappings. |
| `update`, `edit`, `assign`, `priority`, `note`, `tag` | `update` or guarded read/edit/update | Preserve Type rules, append intent and ownership conditions. |
| `delete`, `forget`, `memory forget` | `delete` | Preview, cascade, retention and source-owner effects stay explicit. |
| `list`, `count`, `search`, `memories`, `link list`, `link count` | Common `list` / `link list` basis | Donna/Melinda are defining the final options and selection/count/search semantics. |
| `link create/show/update/delete` | Corresponding `link` primitive | Ordinary edits fit; endpoint re-pinning, historical recovery and owner guards need review. |
| `dep add`, two-ID `link`, `dep … --blocks` | Typed `link create` | Preserve native direction: ordinary `link A B` means B blocks A. |
| `dep remove`, `dep relate`, `dep unrelate` | Link lookup plus delete/create, optionally `batch` | Pair multiplicity, absent-pair no-op and atomicity matter. |
| Five Memory relationship authoring verbs | Typed `link create` | Type rules supply References, succession, necessity, defining structure and applicability. |
| `label` / `state` conveniences | `show`, `update`; some `create`/Link composition | Label arrays and state-event recording need precise semantics. |
| `close`, `reopen`, `defer`, `undefer`, `todo done` | Typed lifecycle `update`, where sufficient | Additional workflow/lease/auto-wake effects cannot be silently dropped. |
| `duplicate`, `supersede`, `duplicates --auto-merge` | Selection + Link creation + lifecycle edits | Native Issue supersede also closes; it differs from Memory succession. |
| `versions`, `link versions`, `compare`, `link compare`, `history` | `versions`, exact `show`, local comparison; sometimes `events` | Complete optional History, deletion timelines and native commit/event history differ. |
| `ready`, `blocked`, `children`, `graph`, `query`, `dep tree/cycles`, Memory traversals | Future query/graph basis plus domain algorithms | Your next design pass owns traversal, joins, aggregation and acquisition consistency. |
| `update --claim`, `ready --claim`, `unclaim`, `heartbeat`, `reclaim`, `merge-slot` | Typed CAS/client algorithms or explicit coordination capability | Determine which guarantees can be built from guards; atomic selection and history-free leases are separate. |
| `batch`, related imports/creates, molecule construction | Canonical `batch` of admitted CRUD | Current product batch grammar is different; atomic scope, bounds and final results must survive compilation. |
| `gate`, `swarm`, `mol`, `human` | Query/graph + CRUD composition + domain/external logic | Some native behaviors need explicit lifecycle or retention contracts. |
| `events tail/export` | Canonical `events` candidate | Journal sequence, coverage, representation and replay require an adapter. Pruning is maintenance. |
| `comment`, `comments`, `provenance` | No faithful generic feed mapping established | Their separate feeds have different revision/history semantics. |
| `import`, `export`, `migrate issues` | Client serializer/planner over CRUD/list/Links | Whole-file atomicity, comments, source history, cross-Scope identity and snapshot consistency are separate. |
| `types`, `statuses`, `schema`, `info` | Future `type list`, Type definitions, `scope inspect` plus host information | No new Type inventory endpoint or local schema payload is invented. |
| `promote`, ephemeral/wisp modes, GC, rename, archive restore | Explicit retention/migration/host behavior | Ordinary property updates do not promise tier movement, identity rewriting or physical erasure. |

## Modes that a command-name inventory would miss

This is a general lowering map, not a finished flag-by-flag equivalence proof.
These modes materially change the operation and must remain visible in review.

| Product mode | Candidate target / unresolved boundary | Source |
| --- | --- | --- |
| `create --parent`, `--deps`, `--waits-for`, `--graph`, `--file` | Creates plus typed Links, potentially `batch`; preserve per-mode inheritance, ordering and transaction scope. | [create flags](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/create.go#L934) |
| `create --storage-class`, `--ephemeral`; `update --persistent`, `--ephemeral` | Retention/storage-plane intent; not automatically an ordinary property edit. | [create storage](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/create.go#L960), [update persistence](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/update.go#L1146) |
| `update --claim`, `--if-assignee`, `--if-status`, `--force`; `ready --claim` | Holder/field conditions and atomic work selection. Read plus revision-CAS may implement some by-ID behavior, but needs an explicit retry/authorization/lease contract; it is not the same one-request predicate. | [update conditions](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/update.go#L1113), [ready claim](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/ready.go#L820) |
| `update --parent` | Reparenting plus scalar edits; selected parent Links, identity and native parent policy must be accounted for. | [parent update](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/update.go#L1112) |
| `update --from-revision`; `link update --from-revision` | Historical base composition and same-ID recovery need a complete lifecycle contract; copying a live body's fields does not recover a deleted identity. | [Bead base](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/update.go#L1122), [Link base](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_lifecycle.go#L169) |
| `link update --source-revision`, `--target-revision` | Same-ID endpoint re-pinning/unpinning. Current generic `link update` excludes this; delete/create is not equivalent. This is not evidence that endpoint identities can be retargeted. | [Link revision inputs](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_lifecycle.go#L170) |
| Link/Memory `--if-source-revision` | An owner guard distinct from endpoint pin and Link revision guard. Its generic representation is not established. | [Memory owner guard](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph_authoring.go#L43) |
| `close --continue`, `--claim-next`, `--suggest-next`, `--force`; multi-ID close | Lifecycle checks, possible partial results, follow-on selection and claims; do not flatten into one unconditional status patch. | [close modes](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/close.go#L537) |
| `delete --cascade`, `--from-file` | Selected dependent closure / explicit multi-ID plan + deletes; atomic acquisition and whole-command atomicity must be stated. | [delete modes](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/delete.go#L619) |
| `show --children`, `--include-dependents`, `--include-comments`, `--watch` | Query/graph, comment-feed acquisition or observation plus refresh; ordinary show alone does not cover all four. | [show modes](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/show.go#L330) |
| `blocked --flags`, `--raw`; `ready --explain` | Computed external dependency policy, raw derived state and explanation evidence are different views. | [ready/blocked modes](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/ready.go#L819) |
| `duplicates --auto-merge`; label propagation/rename | Client acquisition and planning + typed writes; retain heuristics and actual per-step/transaction error behavior. | [duplicate merging](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/duplicates.go#L375), [label rename](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/label.go#L807) |

## Individual data and workflow paths

Each primary path appears once. Source links identify the actual declaration or
constructor table; the workflow analysis below supplies the nontrivial behavior.

| Registered product path | Alias / role | Canonical target or disposition | Mapping | Evidence |
| --- | --- | --- | --- | --- |
| `bd assign` | — | update admitted assignee; ownership policy retained | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/assign.go#L13) |
| `bd audit` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/audit.go#L29) |
| `bd audit label` | — | Local append-only interaction log; no canonical Resource mapping implied | Host feed | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/audit.go#L120) |
| `bd audit record` | — | Local append-only interaction log; no canonical Resource mapping implied | Host feed | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/audit.go#L46) |
| `bd batch` | — | batch after compiling native product grammar to canonical CRUD; native workflow gaps remain | Partial | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/batch.go#L34) |
| `bd blocked` | — | Common list/query/graph basis + domain predicates or local analysis | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/ready.go#L386) |
| `bd children` | — | Common list/query/graph basis + domain predicates or local analysis | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/children.go#L16) |
| `bd close` | aliases: `done` | update only under the complete typed lifecycle contract; extra flags may compose | Lifecycle review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/close.go#L23) |
| `bd comment` | — | Separate comment feed semantics; no faithful generic CRUD mapping established | Feed gap | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/comment.go#L106) |
| `bd comments` | — | Separate comment feed semantics; no faithful generic CRUD mapping established | Feed gap | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/comments.go#L60) |
| `bd comments add` | — | Separate comment feed semantics; no faithful generic CRUD mapping established | Feed gap | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/comments.go#L188) |
| `bd comments list` | — | Registered misplaced-syntax error; no successful list endpoint | Diagnostic | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/comments.go#L155) |
| `bd compare` | — | Two exact show reads + local comparison (History required) | Compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_compare.go#L15) |
| `bd cook` | — | Compile formula locally; materialized protos need create/link create + storage policy | Local + compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/cook.go#L36) |
| `bd count` | — | list under Donna/Melinda’s common selection/count/search design | List design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/count.go#L17) |
| `bd create` | aliases: `new` | create; related-record flags need composition | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/create.go#L52) |
| `bd create-form` | — | Local form → create; validation/Type rules retained | Compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/create_form.go#L214) |
| `bd defer` | — | update only under the complete typed lifecycle contract; extra flags may compose | Lifecycle review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/defer.go#L24) |
| `bd delete` | — | show preview or delete; cascade below | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/delete.go#L21) |
| `bd dep` | — | link create; --blocks form reverses operand roles | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dep.go#L216) |
| `bd dep add` | — | link create with concrete Dependency Type | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dep.go#L323) |
| `bd dep cycles` | — | Common query/graph basis + cycle analysis | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dep.go#L1339) |
| `bd dep list` | — | link list + endpoint show where required | List design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dep.go#L980) |
| `bd dep relate` | — | Two directed link create operations; batch if selected and semantics match | Compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/relate.go#L16) |
| `bd dep remove` | aliases: `rm` | link list for pair → link delete; preserve absent-pair no-op/multiplicity | Compose + guard review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dep.go#L1174) |
| `bd dep tree` | — | Common query/graph basis + dependency tree rendering | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dep.go#L1295) |
| `bd dep unrelate` | — | Find reciprocal relationships → link delete; preserve pair semantics | Compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/relate.go#L31) |
| `bd diff` | — | Dolt commit/branch history operation; not Resource versions or ordinary Core/Write | Storage history | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/diff.go#L12) |
| `bd duplicate` | — | Typed link create + close transition; preserve direction and partial/atomic behavior | Compose + lifecycle | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/duplicate.go#L13) |
| `bd duplicates` | — | Common query/graph basis + client analysis; writes/claims need separate review | Query/graph + compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/duplicates.go#L14) |
| `bd edit` | — | show → local editor → guarded update | Compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/edit.go#L15) |
| `bd epic` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/epic.go#L18) |
| `bd epic close-eligible` | — | Acquire children and aggregate; close-eligible adds qualified lifecycle updates | Query/graph + lifecycle | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/epic.go#L110) |
| `bd epic status` | — | Acquire children and aggregate; close-eligible adds qualified lifecycle updates | Query/graph + lifecycle | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/epic.go#L23) |
| `bd events` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/events.go#L32) |
| `bd events export` | — | events for compatible facts/replay; product journal export/prune/sequence are separate | Observation review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/events.go#L142) |
| `bd events prune` | — | events for compatible facts/replay; product journal export/prune/sequence are separate | Observation review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/events.go#L157) |
| `bd events tail` | — | events for compatible facts/replay; product journal export/prune/sequence are separate | Observation review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/events.go#L90) |
| `bd export` | — | list + link list + serializer; comments/snapshot boundaries | Compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/export.go#L23) |
| `bd find-duplicates` | aliases: `find-dups` | Common list/query/graph basis + domain predicates or local analysis | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/find_duplicates.go#L27) |
| `bd flatten` | — | Dolt commit/branch history operation; not Resource versions or ordinary Core/Write | Storage history | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/flatten.go#L17) |
| `bd forget` | — | delete with Memory policy | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory.go#L648) |
| `bd formula` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/formula.go#L20) |
| `bd formula convert` | — | List/read/convert local formula/schema files; no BDP endpoint needed | Local files | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/formula.go#L485) |
| `bd formula list` | — | List/read/convert local formula/schema files; no BDP endpoint needed | Local files | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/formula.go#L48) |
| `bd formula schema` | aliases: `primitives` | List/read/convert local formula/schema files; no BDP endpoint needed | Local files | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/formula_schema.go#L13) |
| `bd formula show` | — | List/read/convert local formula/schema files; no BDP endpoint needed | Local files | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/formula.go#L75) |
| `bd gate` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gate.go#L29) |
| `bd gate add-waiter` | — | create + blocking Link / typed update or close; concurrency policy explicit | Compose + lifecycle | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gate.go#L231) |
| `bd gate check` | — | Evaluate external/timer conditions → typed updates/close; external IO stays outside BDP | External + compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gate.go#L825) |
| `bd gate create` | — | create + blocking Link / typed update or close; concurrency policy explicit | Compose + lifecycle | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gate.go#L501) |
| `bd gate discover` | — | Evaluate external/timer conditions → typed updates/close; external IO stays outside BDP | External + compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gate_discover.go#L39) |
| `bd gate list` | — | show/list with gate Type and domain predicates | List/read | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gate.go#L58) |
| `bd gate resolve` | — | create + blocking Link / typed update or close; concurrency policy explicit | Compose + lifecycle | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gate.go#L765) |
| `bd gate show` | — | show/list with gate Type and domain predicates | List/read | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gate.go#L691) |
| `bd gc` | — | Selection + possible delete; decay, physical GC and retention are separate | Maintenance/retention | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gc.go#L22) |
| `bd graph` | — | Common list/query/graph basis + domain predicates or local analysis | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph.go#L44) |
| `bd graph check` | — | Common list/query/graph basis + domain predicates or local analysis | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph.go#L279) |
| `bd heartbeat` | aliases: `hb` | Ownership/lease policy; guarded update may cover some state, not all effects | Coordination review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/heartbeat.go#L13) |
| `bd history` | — | versions/events candidates; native audit/commit-history output is not identical | History/observation review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/history.go#L21) |
| `bd human` | — | list/show/update + response/comment/close semantics; queue aggregates need list/query | Compose + workflow | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/human.go#L19) |
| `bd human dismiss` | — | list/show/update + response/comment/close semantics; queue aggregates need list/query | Compose + workflow | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/human.go#L335) |
| `bd human list` | — | list/show/update + response/comment/close semantics; queue aggregates need list/query | Compose + workflow | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/human.go#L102) |
| `bd human respond` | — | list/show/update + response/comment/close semantics; queue aggregates need list/query | Compose + workflow | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/human.go#L237) |
| `bd human stats` | — | list/show/update + response/comment/close semantics; queue aggregates need list/query | Compose + workflow | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/human.go#L434) |
| `bd import` | — | Parsed create/update/link create + optional batch; import policy boundaries | Compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/import.go#L22) |
| `bd info` | — | scope inspect covers protocol discovery only; local schema/engine/release detail stays local | Discovery/host | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/info.go#L15) |
| `bd kv` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/kv.go#L207) |
| `bd kv clear` | — | Workspace key/value facility; no agreed canonical Bead model | Host data | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/kv.go#L317) |
| `bd kv get` | — | Workspace key/value facility; no agreed canonical Bead model | Host data | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/kv.go#L275) |
| `bd kv list` | — | Workspace key/value facility; no agreed canonical Bead model | Host data | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/kv.go#L366) |
| `bd kv set` | — | Workspace key/value facility; no agreed canonical Bead model | Host data | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/kv.go#L224) |
| `bd label` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/label.go#L19) |
| `bd label add` | — | update admitted label edits; guarded read/replace where needed | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/label.go#L505) |
| `bd label list` | — | show + label projection | Compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/label.go#L562) |
| `bd label list-all` | — | list + distinct label aggregation | List/query design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/label.go#L605) |
| `bd label propagate` | — | Query affected set → update, optionally batch; preserve propagation/rename semantics | Compose + query | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/label.go#L668) |
| `bd label remove` | — | update admitted label edits; guarded read/replace where needed | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/label.go#L527) |
| `bd label rename` | — | Query affected set → update, optionally batch; preserve propagation/rename semantics | Compose + query | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/label.go#L752) |
| `bd link` | — | link create; preserve native B-blocks-A direction and graph mode policy | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/link.go#L14) |
| `bd link compare` | — | Two exact link show reads + local comparison | Compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_lifecycle.go#L113) |
| `bd link count` | — | link list under common count design; no invented count flag | List design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_lifecycle.go#L53) |
| `bd link create` | — | link create; source-owner guards need review | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_lifecycle.go#L30) |
| `bd link delete` | — | link delete; preserve induced-owner results and source-guard semantics | Partial | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_lifecycle.go#L90) |
| `bd link list` | — | link list under common list/incidence design | List design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_lifecycle.go#L48) |
| `bd link show` | — | link show | Primitive | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_lifecycle.go#L58) |
| `bd link update` | — | link update for data edits; same-ID endpoint re-pinning/recovery are gaps | Partial | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_lifecycle.go#L71) |
| `bd link versions` | — | link versions with actual complete History; product deletion timeline is separate | History review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_lifecycle.go#L95) |
| `bd lint` | — | Common list/query/graph basis + domain predicates or local analysis | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/lint.go#L24) |
| `bd list` | — | list under Donna/Melinda’s common selection/count/search design | List design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/list.go#L153) |
| `bd memories` | — | list with Memory defaults and agreed search behavior | List design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory.go#L582) |
| `bd memory` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph.go#L21) |
| `bd memory constraints` | — | Common query/graph basis; preserve family/direction/depth/applicability rules | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph.go#L47) |
| `bd memory defined-by` | — | Common query/graph basis; preserve family/direction/depth/applicability rules | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph.go#L46) |
| `bd memory defines` | — | link create with defines Type; source guard/Type rules retained | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph_authoring.go#L20) |
| `bd memory definition` | — | Common query/graph basis; preserve family/direction/depth/applicability rules | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph.go#L45) |
| `bd memory forget` | — | delete selected Memory | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_alias.go#L22) |
| `bd memory memories` | — | list with Memory defaults and agreed search behavior | List design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_alias.go#L21) |
| `bd memory recall` | — | show selected Memory | Primitive | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_alias.go#L20) |
| `bd memory reference` | — | link create with references Type; source guard/Type rules retained | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph_authoring.go#L17) |
| `bd memory referenced-by` | — | Common query/graph basis; preserve family/direction/depth/applicability rules | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph.go#L40) |
| `bd memory references` | — | Common query/graph basis; preserve family/direction/depth/applicability rules | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph.go#L39) |
| `bd memory remember` | — | create or update selected Memory Type/properties; dispatch policy explicit | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_alias.go#L19) |
| `bd memory required-by` | — | Common query/graph basis; preserve family/direction/depth/applicability rules | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph.go#L44) |
| `bd memory requirements` | — | Common query/graph basis; preserve family/direction/depth/applicability rules | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph.go#L43) |
| `bd memory requires` | — | link create with requires Type; source guard/Type rules retained | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph_authoring.go#L19) |
| `bd memory subject-to` | — | link create with subject-to Type; source guard/Type rules retained | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph_authoring.go#L21) |
| `bd memory subjects` | — | Common query/graph basis; preserve family/direction/depth/applicability rules | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph.go#L48) |
| `bd memory successor` | — | Common query/graph basis; preserve family/direction/depth/applicability rules | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph.go#L41) |
| `bd memory supersede` | — | link create with superseded-by Type; source guard/Type rules retained | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph_authoring.go#L18) |
| `bd memory supersedes` | — | Common query/graph basis; preserve family/direction/depth/applicability rules | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory_graph.go#L42) |
| `bd merge-slot` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/merge_slot.go#L15) |
| `bd merge-slot acquire` | — | create/show/update candidates; holder/queue/lease guarantees need a contract | Coordination review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/merge_slot.go#L67) |
| `bd merge-slot check` | — | create/show/update candidates; holder/queue/lease guarantees need a contract | Coordination review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/merge_slot.go#L52) |
| `bd merge-slot create` | — | create/show/update candidates; holder/queue/lease guarantees need a contract | Coordination review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/merge_slot.go#L39) |
| `bd merge-slot release` | — | create/show/update candidates; holder/queue/lease guarantees need a contract | Coordination review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/merge_slot.go#L86) |
| `bd migrate issues` | — | list/show + creates/links, optional deletes; identity/reference/history rules need migration contract | Cross-Scope migration | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/migrate_issues.go#L15) |
| `bd migrate-issues` | hidden compatibility/internal path | list/show + creates/links, optional deletes; identity/reference/history rules need migration contract | Cross-Scope migration | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/migrate_issues.go#L651) |
| `bd migrate-personal` | — | list/show + creates/links, optional deletes; identity/reference/history rules need migration contract | Cross-Scope migration | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/migrate_personal.go#L39) |
| `bd mol` | aliases: `protomolecule`; group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol.go#L33) |
| `bd mol bond` | aliases: `fart` | create/update/link create/batch candidates; formula capture and persistence tiers explicit | Compose + retention | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_bond.go#L19) |
| `bd mol burn` | — | Acquire workflow graph → create/update/delete/batch; retain digest/retention policy | Compose + retention | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_burn.go#L15) |
| `bd mol current` | — | list/show + workflow traversal/aggregates; gated dispatch stays domain-owned | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_current.go#L41) |
| `bd mol distill` | — | Acquire epic graph → emit local formula | Query/graph + local | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_distill.go#L18) |
| `bd mol last-activity` | — | list/show + workflow traversal/aggregates; gated dispatch stays domain-owned | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_last_activity.go#L12) |
| `bd mol pour` | — | create/update/link create/batch candidates; formula capture and persistence tiers explicit | Compose + retention | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/pour.go#L23) |
| `bd mol progress` | — | list/show + workflow traversal/aggregates; gated dispatch stays domain-owned | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_progress.go#L16) |
| `bd mol ready` | — | list/show + workflow traversal/aggregates; gated dispatch stays domain-owned | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_ready_gated.go#L29) |
| `bd mol seed` | — | Check formula accessibility; no Resource mutation | Local files | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_seed.go#L14) |
| `bd mol show` | — | list/show + workflow traversal/aggregates; gated dispatch stays domain-owned | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_show.go#L20) |
| `bd mol squash` | — | Acquire workflow graph → create/update/delete/batch; retain digest/retention policy | Compose + retention | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_squash.go#L17) |
| `bd mol stale` | — | list/show + workflow traversal/aggregates; gated dispatch stays domain-owned | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_stale.go#L13) |
| `bd mol wisp` | — | create/update/link create/batch candidates; formula capture and persistence tiers explicit | Compose + retention | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/wisp.go#L29) |
| `bd mol wisp create` | — | create/update/link create/batch candidates; formula capture and persistence tiers explicit | Compose + retention | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/wisp.go#L117) |
| `bd mol wisp gc` | — | Acquire workflow graph → create/update/delete/batch; retain digest/retention policy | Compose + retention | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/wisp.go#L609) |
| `bd mol wisp list` | — | list/show + workflow traversal/aggregates; gated dispatch stays domain-owned | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/wisp.go#L389) |
| `bd note` | — | show → guarded update preserving append intent | Compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/note.go#L102) |
| `bd orphans` | — | Common list/query/graph basis + domain predicates or local analysis | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/orphans.go#L30) |
| `bd priority` | — | update admitted priority | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/priority.go#L12) |
| `bd promote` | — | Move ephemeral data to durable storage preserving ID/feeds; not a boolean update | Retention gap | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/promote.go#L34) |
| `bd provenance` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/provenance.go#L15) |
| `bd provenance by-ref` | — | Separate append-only provenance feed; not ordinary revision-provenance input | Feed gap | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/provenance.go#L140) |
| `bd provenance log` | — | Separate append-only provenance feed; not ordinary revision-provenance input | Feed gap | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/provenance.go#L120) |
| `bd provenance record` | — | Separate append-only provenance feed; not ordinary revision-provenance input | Feed gap | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/provenance.go#L44) |
| `bd prune` | — | Selection + possible delete; decay, physical GC and retention are separate | Maintenance/retention | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/prune.go#L10) |
| `bd purge` | — | Selection + possible delete; decay, physical GC and retention are separate | Maintenance/retention | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/purge.go#L52) |
| `bd q` | — | create with Issue defaults; print returned ID | Compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/quick.go#L18) |
| `bd query` | — | Common list/query/graph basis + domain predicates or local analysis | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/query.go#L19) |
| `bd ready` | — | Common query/graph basis + client analysis; writes/claims need separate review | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/ready.go#L20) |
| `bd recall` | — | show with Memory selection | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory.go#L707) |
| `bd reclaim` | — | Ownership/lease policy; guarded update may cover some state, not all effects | Coordination review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/reclaim.go#L19) |
| `bd recompute-blocked` | — | Query graph and repair derived blocked state; not a new general mutation primitive | Derived maintenance | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/recompute_blocked.go#L12) |
| `bd remember` | — | create or update selected Memory; explicit existing/new behavior | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/memory.go#L380) |
| `bd rename` | — | No ordinary identity-renaming operation; aliases do not reproduce rewriting histories/references | Identity migration | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/rename.go#L18) |
| `bd rename-prefix` | — | No ordinary identity-renaming operation; aliases do not reproduce rewriting histories/references | Identity migration | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/rename_prefix.go#L23) |
| `bd reopen` | — | update only under the complete typed lifecycle contract; extra flags may compose | Lifecycle review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/reopen.go#L15) |
| `bd restore` | — | Recover archived pre-compaction content → guarded update; archive access is separate | External history + compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/restore.go#L17) |
| `bd rules` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/rules.go#L631) |
| `bd rules audit` | — | Read/analyze/rewrite Claude rule files; no BDP endpoint needed | Local files | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/rules.go#L637) |
| `bd rules compact` | — | Read/analyze/rewrite Claude rule files; no BDP endpoint needed | Local files | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/rules.go#L645) |
| `bd schema` | — | scope inspect covers protocol discovery only; local schema/engine/release detail stays local | Discovery/host | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/schema.go#L25) |
| `bd search` | — | list under Donna/Melinda’s common selection/count/search design | List design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/search.go#L20) |
| `bd set-state` | — | create event Issue + parent Link + update labels; retain storage policy | Compose + policy | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/state.go#L116) |
| `bd ship` | — | list provider Issue → update capability label; cross-project resolution remains domain-owned | Compose + domain | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/ship.go#L13) |
| `bd show` | aliases: `view` | show; expanded/watch modes below | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/show.go#L29) |
| `bd stale` | — | Common list/query/graph basis + domain predicates or local analysis | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/stale.go#L14) |
| `bd state` | — | show + interpret dimension:value labels | Compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/state.go#L53) |
| `bd state list` | — | show + interpret dimension:value labels | Compose | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/state.go#L296) |
| `bd status` | aliases: `stats` | Common list/query/graph basis + domain predicates or local analysis | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/status.go#L33) |
| `bd statuses` | — | Future type list / selected Type definitions and domain configuration | Type/discovery review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/statuses.go#L29) |
| `bd supersede` | — | Typed link create + close transition; preserve direction and partial/atomic behavior | Compose + lifecycle | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/duplicate.go#L28) |
| `bd swarm` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/swarm.go#L19) |
| `bd swarm create` | — | create/link create composition after graph analysis | Compose + query | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/swarm.go#L931) |
| `bd swarm list` | — | Acquire graph + swarm analysis / list/show | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/swarm.go#L1123) |
| `bd swarm status` | — | Acquire graph + swarm analysis / list/show | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/swarm.go#L641) |
| `bd swarm validate` | — | Acquire graph + swarm analysis / list/show | Query/graph design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/swarm.go#L135) |
| `bd tag` | — | update admitted label set | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/tag.go#L12) |
| `bd todo` | — | list with TODO predicates; root convenience defaults | List design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/todo.go#L18) |
| `bd todo add` | — | create --type task with TODO defaults | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/todo.go#L50) |
| `bd todo done` | — | Typed close/update transition; multi-ID behavior retained | Lifecycle review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/todo.go#L191) |
| `bd todo list` | — | list with TODO predicates | List design | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/todo.go#L110) |
| `bd types` | — | Future type list / selected Type definitions and domain configuration | Type/discovery review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/types.go#L59) |
| `bd unclaim` | — | Ownership/lease policy; guarded update may cover some state, not all effects | Coordination review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/unclaim.go#L12) |
| `bd undefer` | — | update only under the complete typed lifecycle contract; extra flags may compose | Lifecycle review | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/undefer.go#L14) |
| `bd update` | — | update for admitted data edits; claim/history modes below | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/update.go#L79) |
| `bd versions` | — | versions when complete History is advertised; product timeline differs | Conditional | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/versions.go#L47) |

## Remaining registered platform paths

These remain product features even when no Core/Write translation is required.
External tracker synchronization may orchestrate Resource operations, but its full
credential, conflict, provider and transport behavior is not a generic BDP endpoint.
Storage history, backups, SQL, initialization, serving and migration administration
need their own explicit boundaries.

| Registered product path | Alias / role | Canonical target or disposition | Mapping | Evidence |
| --- | --- | --- | --- | --- |
| `bd admin` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/admin.go#L22) |
| `bd admin cleanup` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/cleanup.go#L21) |
| `bd admin compact` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/compact.go#L40) |
| `bd admin reset` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/reset.go#L17) |
| `bd ado` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/ado.go#L31) |
| `bd ado projects` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/ado.go#L76) |
| `bd ado pull` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/sync_push_pull.go#L39) |
| `bd ado push` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/sync_push_pull.go#L27) |
| `bd ado status` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/ado.go#L68) |
| `bd ado sync` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/ado.go#L45) |
| `bd backup` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/backup.go#L14) |
| `bd backup init` | aliases: `add` | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/backup_dolt.go#L30) |
| `bd backup remove` | aliases: `rm` | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/backup_dolt.go#L435) |
| `bd backup restore` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/backup_restore.go#L17) |
| `bd backup status` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/backup.go#L58) |
| `bd backup sync` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/backup_dolt.go#L125) |
| `bd bootstrap` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/bootstrap.go#L111) |
| `bd branch` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/branch.go#L11) |
| `bd claude-hook` | hidden compatibility/internal path | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/claude_hook.go#L58) |
| `bd codex-hook` | hidden compatibility/internal path | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/codex_hook.go#L51) |
| `bd compact` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/compact_dolt.go#L18) |
| `bd config` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/config.go#L29) |
| `bd config apply` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/config_apply.go#L37) |
| `bd config drift` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/config_drift.go#L36) |
| `bd config get` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/config.go#L560) |
| `bd config list` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/config.go#L717) |
| `bd config set` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/config.go#L161) |
| `bd config set-many` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/config.go#L1170) |
| `bd config show` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/config_show.go#L26) |
| `bd config unset` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/config.go#L912) |
| `bd config validate` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/config.go#L1013) |
| `bd conflicts` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/conflicts.go#L33) |
| `bd conflicts list` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/conflicts.go#L63) |
| `bd conflicts resolve` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/conflicts.go#L224) |
| `bd conflicts show` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/conflicts.go#L153) |
| `bd connect` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/connect.go#L33) |
| `bd context` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/context_cmd.go#L36) |
| `bd cursor-hook` | hidden compatibility/internal path | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/cursor_hook.go#L56) |
| `bd db-proxy-child` | hidden compatibility/internal path | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/db_proxy_child.go#L33) |
| `bd doctor` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/doctor.go#L69) |
| `bd dolt` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L31) |
| `bd dolt clean-databases` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L1483) |
| `bd dolt commit` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L714) |
| `bd dolt killall` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L1410) |
| `bd dolt pull` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L613) |
| `bd dolt push` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L514) |
| `bd dolt remote` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L1657) |
| `bd dolt remote add` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L1669) |
| `bd dolt remote list` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L1735) |
| `bd dolt remote remove` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L1797) |
| `bd dolt remote reset-data` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt_remote_reset_data.go#L181) |
| `bd dolt set` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L110) |
| `bd dolt show` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L100) |
| `bd dolt start` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L786) |
| `bd dolt status` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L1103) |
| `bd dolt stop` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L868) |
| `bd dolt test` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dolt.go#L165) |
| `bd federation` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/federation.go#L26) |
| `bd federation add-peer` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/federation.go#L80) |
| `bd federation list-peers` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/federation.go#L113) |
| `bd federation remove-peer` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/federation.go#L104) |
| `bd federation status` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/federation.go#L62) |
| `bd federation sync` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/federation.go#L38) |
| `bd github` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/github.go#L33) |
| `bd github pull` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/sync_push_pull.go#L117) |
| `bd github push` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/sync_push_pull.go#L105) |
| `bd github repos` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/github.go#L73) |
| `bd github status` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/github.go#L63) |
| `bd github sync` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/github.go#L47) |
| `bd gitlab` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gitlab.go#L34) |
| `bd gitlab projects` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gitlab.go#L74) |
| `bd gitlab pull` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/sync_push_pull.go#L143) |
| `bd gitlab push` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/sync_push_pull.go#L131) |
| `bd gitlab status` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gitlab.go#L64) |
| `bd gitlab sync` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gitlab.go#L48) |
| `bd hooks` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/hooks.go#L699) |
| `bd hooks install` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/hooks.go#L713) |
| `bd hooks list` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/hooks.go#L816) |
| `bd hooks run` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/hooks.go#L2406) |
| `bd hooks uninstall` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/hooks.go#L784) |
| `bd init` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/init.go#L507) |
| `bd init-safety` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/init_safety_help.go#L16) |
| `bd jira` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/jira.go#L16) |
| `bd jira pull` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/sync_push_pull.go#L65) |
| `bd jira push` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/sync_push_pull.go#L53) |
| `bd jira status` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/jira.go#L69) |
| `bd jira sync` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/jira.go#L44) |
| `bd linear` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/linear.go#L27) |
| `bd linear pull` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/sync_push_pull.go#L91) |
| `bd linear push` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/sync_push_pull.go#L79) |
| `bd linear status` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/linear.go#L161) |
| `bd linear sync` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/linear.go#L95) |
| `bd linear teams` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/linear.go#L175) |
| `bd mail` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mail.go#L16) |
| `bd metrics` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/metrics.go#L23) |
| `bd metrics example` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/metrics.go#L99) |
| `bd metrics off` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/metrics.go#L75) |
| `bd metrics on` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/metrics.go#L52) |
| `bd migrate` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/migrate.go#L22) |
| `bd migrate from-proxied-server-to-server` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/migrate_dolt_mode.go#L464) |
| `bd migrate from-proxied-server-to-shared-server` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/migrate_dolt_mode.go#L482) |
| `bd migrate from-server-to-proxied-server` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/migrate_dolt_mode.go#L430) |
| `bd migrate from-shared-server-to-proxied-server` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/migrate_dolt_mode.go#L448) |
| `bd migrate hooks` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/migrate_hooks.go#L15) |
| `bd migrate legacy-sqlite` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/legacy_sqlite_reader.go#L11) |
| `bd migrate schema` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/migrate.go#L878) |
| `bd migrate sync` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/migrate.go#L846) |
| `bd notion` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/notion.go#L88) |
| `bd notion connect` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/notion.go#L110) |
| `bd notion init` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/notion.go#L102) |
| `bd notion pull` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/sync_push_pull.go#L169) |
| `bd notion push` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/sync_push_pull.go#L157) |
| `bd notion status` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/notion.go#L94) |
| `bd notion sync` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/notion.go#L118) |
| `bd onboard` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/onboard.go#L109) |
| `bd ping` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/ping.go#L16) |
| `bd preflight` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/preflight.go#L46) |
| `bd prime` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/prime.go#L87) |
| `bd quickstart` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/quickstart.go#L11) |
| `bd repo` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/repo.go#L18) |
| `bd repo add` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/repo.go#L43) |
| `bd repo list` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/repo.go#L185) |
| `bd repo remove` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/repo.go#L109) |
| `bd repo sync` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/repo.go#L244) |
| `bd send-metrics` | hidden compatibility/internal path | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/send_metrics.go#L10) |
| `bd serve` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/serve.go#L59) |
| `bd setup` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/setup.go#L29) |
| `bd sql` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/sql.go#L15) |
| `bd sync` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/sync.go#L650) |
| `bd upgrade` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/upgrade.go#L13) |
| `bd upgrade ack` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/upgrade.go#L157) |
| `bd upgrade review` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/upgrade.go#L79) |
| `bd upgrade status` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/upgrade.go#L27) |
| `bd vc` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/vc.go#L16) |
| `bd vc commit` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/vc.go#L169) |
| `bd vc merge` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/vc.go#L61) |
| `bd vc status` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/vc.go#L254) |
| `bd version` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/version.go#L27) |
| `bd where` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/where.go#L25) |
| `bd worktree` | group | Child mappings below; no distinct canonical operation | Group | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/worktree_cmd.go#L42) |
| `bd worktree create` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/worktree_cmd.go#L63) |
| `bd worktree info` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/worktree_cmd.go#L105) |
| `bd worktree list` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/worktree_cmd.go#L85) |
| `bd worktree remove` | — | Workspace/configuration/backend/integration operation; no canonical Resource endpoint promised | Platform | [source](https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/worktree_remove_cmd.go#L93) |

## Detailed workflow evidence

The following source review explains why several convenient-looking spellings
need more than a name substitution. Candidate mappings remain design judgments.

## Issue lifecycle and convenience operations

| Product surface | Actual behavior in this source | Candidate canonical lowering and boundary | Evidence |
| --- | --- | --- | --- |
| `assign`, `priority`, `tag`, `note`; corresponding `update` flags | Set assignee, priority, add label, append notes through the native Issue writer; assignment includes a force-transfer policy. | **Primitive/conditional:** `update` with the admitted property edits. Guarded read/replace can implement appending a string or editing an array, but a property assignment alone does not establish native ownership-transfer policy. Preserve append-versus-replace intent. | [graph quick actions, lines 15–165][quick-actions] |
| `close` / `done` | Native close with blockers/children/policy checks, reason/session, possible automatic molecule-root closure. Multi-ID close reports partial refusals; `--claim-next` can commit a claim even when a sibling close refuses. `--continue` can advance a molecule using an advertised native operation. | **Contract gap unless typed lifecycle semantics are established:** not merely set `status=closed`. Batch can group known ordinary edits, but cannot reproduce native readiness selection, partial-success reporting or automatic completion by itself. `--suggest-next` adds a post-close read. | [close, lines 159–191, 367–383][close]; [native batch request, lines 136–153][close-batch] |
| `reopen` | Reopen and clear closure state, emitting a Reopened event. This is explicitly more than the status shorthand. | **Conditional primitive:** typed `update` only if the Type/provider defines the complete reopen transition and corresponding event semantics; otherwise a domain capability. | [reopen, lines 16–20, 108–118][reopen] |
| `defer`, `undefer` | Set deferred status and optional wake time; reason appends to notes. Undefer clears a stale defer time even if status is already something else, and changes status only when actually deferred. Dated deferrals auto-wake on a later ready-front read. | **Composition/contract gap:** status/time/notes edits can lower to one typed update. Server-clock wake and a ready read that performs that transition are extra lifecycle behavior; a client timer is not equivalent. | [defer, lines 25–39, 106–129][defer]; [undefer, lines 75–95][undefer] |
| `update --claim`; `ready --claim` | Atomic by-ID claim; atomic selection-and-claim of one eligible ready Issue. | **Coordination contract review:** read plus revision-guarded `update` may implement some by-ID claim behavior, subject to typed authorization, retry and lease rules. `list` then guarded `update` does not establish the same atomic ready-selection, eligibility and lease effects. Preserve the distinction between selecting work and claiming it. | [graph claim, lines 14–16, 38–48][claim]; [store claims, lines 15–34, 73–76][claim-store] |
| `unclaim` | Holder-authorized release, optional forced release or atomic `--if-assignee` compare-and-swap; clears assignee and restores open. | **Conditional client algorithm/contract review:** a revision guard is not the same condition as holder comparison. Read/check/CAS with explicit retry and Type policy may implement some holder transitions; it is not an established translation yet. A typed update is sufficient only with the required ownership predicate and release/lease semantics. | [unclaim, lines 18–33, 95–100, 162–170][unclaim] |
| `heartbeat` / `hb`, `reclaim` | Renew a held lease; reap expired leases with grace window, replica ownership and optional Issue/label/assignee scope. Ordinary graph heartbeat renewal is node-local and history-free; re-arming a missing lease is a durable mutation and advances the Resource revision. | **Contract gap/outside ordinary versioned edits:** freshness, authority, server time and replica-local leases cannot be honestly represented as generic Resource updates. Keep this capability explicit or explicitly out of scope. | [reclaim, lines 25–48, 122–128][reclaim]; [graph lease writer, lines 15–17, 45–63, 77–80][lease-store] |
| `todo add`, `todo list`, `todo done` | Task-Issue convenience commands, with create/list/close behavior. | **Primitive + conditional lifecycle:** `create --type task`, `list` with task/default predicates, and the same close qualification above. This adds no new generic primitive. | [todo command definitions, lines 51, 111, 192, 263–265][todo] |
| `children`; `epic status`; `epic close-eligible` | Read children; calculate epic child-completion status; close selected eligible epics. The latter selects first, then loops closes with per-epic errors. | **Query/graph review + composition:** parent/child Link reads and aggregation, followed by native-policy close/typed update if admitted. Do not upgrade selection-then-loop into atomic predicate evaluation. | [epic, lines 24–29, 111–157][epic]; [children, lines 17–35][children] |
| `update --parent` | Graph reparenting and compatible scalar edits share one checked native writer and canonical-Link transaction. Graph detach currently refuses because dotted identities imply a parent. | **Conditional composition:** select existing parent Link, then delete/create the parent relationship and apply supported Issue edits in `batch`; preserve ownership and parent-policy checks. This changes relationship identity. If the product promises to preserve the old Link identity, this is not equivalent. No generic move/rename follows. | [graph reparent, lines 11–17, 34–47][reparent] |
| `ship` | Find exactly the `export:CAPABILITY` Issue; require it closed unless forced; add `provides:CAPABILITY`. External dependency resolution recognizes the closed provider. | **Composition + domain interpretation:** `list` then typed label update. Cross-project capability discovery/resolution and its authorization are not generic Link CRUD. Reserved-label policy remains provider-owned. | [ship, lines 16–27, 58–87, 129–132][ship] |

## Dependencies, labels, state and comments

| Product surface | Actual behavior in this source | Candidate canonical lowering and boundary | Evidence |
| --- | --- | --- | --- |
| `dep add`, `link A B`, `dep BLOCKER --blocks BLOCKED` | Create a native typed dependency. In the ordinary shorthand `A B`, **B blocks A**. Graph relationships can carry a canonical Link ID; native dependencies remain floating, unlike informational Links. | **Primitive/conditional:** `link create --type … A B` with the native orientation and Type policy. In the `--blocks` spelling, swap the operands during lowering. Cycle/parent constraints belong to the admitted Type/provider contract. | [link, lines 18–28][link]; [graph dependency shortcut, lines 239–267][dep-shortcut] |
| `dep remove` / `dep rm`; `link delete LINK` | Native removal selects by Issue pair; registered `link delete` uses canonical Link identity and optional Link/source revision guards. `graphUnlinkCmd` is an unregistered helper, not a public command. | **Composition/contract gap:** pair lookup by `link list`, then `link delete` each selected Link. Must define multiplicity and revision conditions; two reads plus deletion cannot guarantee the same atomic pair-level match set. Source-guard intent must have an admitted representation. | [dep remove registration, lines 1175–1181][dep]; [graph unlink, lines 400–439, 485–527][unlink] |
| `dep list`, `dep tree`, `dep cycles`, `graph check`, blocking `graph` | Read adjacency, traverse and detect cycles. The graph preview blocking view acquires a complete snapshot before projecting; it does not simply issue independent pages. | **Query/graph review:** `link list`/`show` plus client traversal can compute these answers over acquired data. A consistent whole-graph snapshot, completeness and authorization gaps remain requirements to decide, not guarantees inherited from CRUD. | [dependency snapshot, lines 12–22][dependency-snapshot]; [blocking projection, lines 11–12, 98–126][blocking-projection] |
| `label add`, `label remove`, `label list`; `tag` | Patch the Issue label set or project it. | **Primitive/conditional:** `update` of admitted labels, `show` with property projection. If array-member patching is absent, read and guarded replace is a client algorithm rather than an atomic append/remove primitive. | [label registrations, lines 1002–1008][labels]; [graph label read, lines 16–32][label-read] |
| `label list-all`, `label propagate`, `label rename` | Aggregate labels; select immediate children and add a label in a transaction; rename/merge label across the native store. | **Query/graph review + composition:** acquisition then aggregate or per-Issue updates, optionally `batch`. The current native propagate selects children before its write transaction. Neither that nor an enumerated canonical batch promises atomic predicate selection. Rename must preserve duplicate-label merge behavior and report publication uncertainty honestly. | [propagate, lines 706–736][labels]; [rename, lines 807–847][label-rename] |
| `state ID DIM`, `state list ID` | Interpret labels of the form `dimension:value`. | **Primitive + client interpretation:** `show` and parse that label convention. No separate protocol state primitive is needed. | [graph state, lines 13–27, 30–58][state-read] |
| `set-state ID DIM=VALUE` | Create a closed child Issue of Type event, carrying subject retention; then swap the dimension's labels in one patch. The event create and label patch are distinct lifecycle calls. | **Composition:** `create` event + `link create` parent relationship + `update` labels. Optional batch could group admitted writes, but current implementation does not claim this entire sequence is one atomic action. Event retention and native Type support must remain expressible. Graph set-state currently refuses. | [state write, lines 219–274][state-write]; [graph admission, lines 394–410][graph-admission] |
| `comment ID TEXT`, `comments add ID TEXT`; `comments ID` | Add/read the native comment feed. Comment insertion **does not mint an Issue Resource revision or History record** in graph mode. `comments list` is a diagnostic for misplaced syntax, not a second listing contract. | **Contract gap:** updating an Issue `comments` property changes revision/event semantics; creating a comment Bead invents Resource identity/lifecycle semantics. Decide whether comments stay a product capability, gain a separately specified model or are excluded from generic Core/Write. | [comment source, lines 107–125][comment]; [comment feed writer, lines 12–13, 45][comment-feed]; [comments list diagnostic, lines 156–185][comments] |

## Multi-record and workflow operations

| Product surface | Actual behavior in this source | Candidate canonical lowering and boundary | Evidence |
| --- | --- | --- | --- |
| `duplicate ID --of OTHER`, `supersede ID --with OTHER` | Add `duplicates` / native `supersedes` dependency **and close the old Issue**. These are not just relationship synonyms. Graph mode explicitly refuses both until their atomic journeys exist. | **Composition/contract gap:** typed `link create` plus admitted lifecycle update, preferably `batch` if all effects are representable. Do not equate native Issue supersede with Memory `superseded-by` alone or silently drop the close. Current ordinary implementation makes separate calls; no new all-or-none claim. | [duplicate/supersede, lines 101–113, 171–183][duplicate]; [graph refusal, lines 394–402][graph-admission] |
| `duplicates`, `duplicates --auto-merge` | Find content-equal **non-closed** Issues, choose target using reference/structural scores; auto-merge reparents children, closes sources, then creates `related` Links, collecting per-step errors. The help's broader status wording is weaker evidence than the actual `openIssuesOf` call. | **Query/graph review + composition:** acquire records/relationships, hash/score client-side, then relationship edits and lifecycle updates. Preserve heuristic and partial-error reporting. No general identity coalescence/redirect or atomic merge primitive is established. | [duplicate selection, lines 51–75][duplicates]; [merge implementation, lines 375–458][duplicates-merge] |
| `merge-slot create`, `check`, `acquire`, `release` | Create/read coordination Issue; atomic acquisition and waiter management; holder-sensitive release. Graph routes invoke dedicated native methods. | **Contract gap:** scalar edits can encode state but not by themselves queue/lock/authorization semantics. A separately specified coordination capability or carefully defined typed compare-and-swap contract is required. | [merge-slot contract, lines 40–96][merge-slot]; [graph slot, lines 31–75][graph-slot] |
| `swarm validate`, `status`, `list` | Analyze an epic graph: cycles, connectedness, ready fronts, parallelism; inspect/discover coordinating swarm records. | **Query/graph review + client algorithm:** graph acquisition and analysis, ordinary filtered list/show. No orchestration primitive is necessary merely to calculate/render these reports. | [swarm analysis, lines 136–156][swarm]; [swarm status/list, lines 642–666, 1124–1138][swarm] |
| `swarm create` | Optionally wrap a non-epic Issue in a new epic, link it, create a coordinating molecule and link that to the epic. | **Composition:** `create`, `link create`, typed properties, with capture labels. Existing shared-reference lookup, Type registration and cardinality policy must be preserved. Do not infer global atomicity from the one command spelling. Graph preview and proxied-server route currently refuse this journey. | [swarm creation, lines 932–959, 995–1024, 1087–1099][swarm-create]; [graph admission][graph-admission] |
| `cook`; `mol pour`; `mol wisp [PROTO]` / `mol wisp create` | Compile local formula and/or instantiate template graph with variable substitution, fresh IDs, dependencies and optional attachment. Clone writes are transaction-bound. Wisp creation adds ephemeral retention behavior. | **Composition + outside Resource CRUD:** local compilation can produce named creates/Links in `batch` if member/size limits and Type semantics suffice. Client variable substitution is separate from the intentionally absent batch parameterization. Ephemeral storage/retention is not established by a generic arbitrary property. | [cook command, lines 37–50][cook]; [pour, lines 24–53][pour]; [clone transaction and creates, lines 861–878, 942–976][clone] |
| `mol bond` / alias `fart` | Combine formula/proto/molecule pairs; clone and attach where needed. Sequential/parallel/conditional relationship semantics and phase inheritance/overrides; `--ref` nests an arm and is not an ordering edge. | **Composition + domain policy:** read templates, compile/clone creates, then typed Links and updates. Need bounded consistent graph input and admitted conditional/workflow semantics. Batch can carry a compiled finite edit set, not define formula evaluation, dynamic runtime binding or retention modes. | [bond contract, lines 20–58][bond] |
| `mol show`, `current`, `progress`, `last-activity`, `stale`, `ready --gated` | Read a workflow subgraph, derive current steps/completion/activity/staleness and gate readiness. | **Query/graph review + client algorithm:** graph/read acquisition and domain evaluation. Native activity and gate conditions may rely on comments/events, storage timestamps or external facts not in ordinary Resource properties. | [mol show, lines 21–39][mol-show]; [mol current, lines 42–63][mol-current]; [mol progress, lines 17–37][mol-progress]; [mol gated, lines 30–48][mol-gated]; [activity, lines 13–31][mol-activity]; [stale, lines 14–36][mol-stale] |
| `mol seed`; `formula list`, `show`, `convert`; `mol distill` | Load/validate local formulas, enumerate/show/convert files; extract existing epic graph to a formula file, replacing selected literals with placeholders. | **Outside Resource CRUD + read composition:** filesystem/compiler operations stay client-side; distill obtains graph data first. These are not missing BDP Resource endpoints. | [seed, lines 15–32, 76–84][seed]; [formula, lines 49–97, 486–506][formula]; [distill, lines 19–41][distill] |
| `mol squash` | In one transaction create permanent digest Issue and parent Link, optionally delete ephemeral children; an ephemeral root is closed and made durable. Actual code, rather than contradictory introductory help, controls the keep/delete behavior. | **Conditional composition + retention gap:** digest creation/Link/deletion can lower to `batch` for an enumerated set. Source-consistent graph selection, complete closed-state semantics, ephemeral-to-durable movement and any history preservation need explicit contracts. | [squash transaction, lines 241–252][squash]; [actual operations, lines 276–333][squash-ops] |
| `mol burn`, `mol wisp gc` | Select workflow/wisp records and destructively remove them according to retention policy. Burn distinguishes persistent cascading deletion from ephemeral deletion; wisp bulk deletion is transaction-bound. | **Composition + retention gap:** graph/list acquisition then `delete`/`link delete`, optionally `batch`. Ordinary canonical deletion retains protocol identity/history guarantees; it does not inherently mean physical erasure, discard-with-no-trace, cascade or replica garbage collection. | [burn, lines 16–29, 375–402][burn]; [wisp gc, lines 610–640][wisp-gc] |
| `promote` | Move an ephemeral Issue into durable storage, preserving ID, labels, relationships, events/comments; append a promotion comment. | **Contract gap/outside ordinary edits:** generic `update` of a boolean cannot promise retention-plane migration or history/feed preservation. This especially matters for tiered storage expectations. | [promotion contract, lines 35–46][promote] |
| `gate create`, `list`, `show`, `resolve`, `add-waiter` | Create a native gate and its blocking edge atomically; read it; resolve by native close; atomically update waiter metadata. | **Conditional composition:** create + blocking Link in `batch`, ordinary reads, typed updates for supported metadata; native close and waiter concurrency semantics must be established. Graph gate journeys are currently unavailable. | [gate atomic creation, lines 571–608][gate-create]; [resolve, lines 770–812][gate-resolve]; [waiter update, lines 232–244, 323–325][gate-waiter] |
| `gate check`, `discover` | Read conditions from GitHub, timers and Beads; record discovered run IDs or seen-state, close resolved gates, optionally escalate. Discover queries workflow runs grouped by the gate's selected repository. | **Outside Resource CRUD + composition:** external evaluation remains client/orchestrator behavior, followed by typed update/close if supported. CRUD is not a promise of autonomous timer/GitHub monitoring or escalation delivery. | [gate evaluation, lines 826–857, 899–918][gate-check]; [discover, lines 111–133][gate-discover] |
| `import` | Ordinary importer upserts/merges exported records with timestamp policy and bounded transactions. Graph importer admits only legacy-format data into a fresh empty workspace, **one atomic transaction**, preserving public IDs and native relationship kinds; comments remain separate feed; no imported source history. | **Composition + explicit gaps:** create/update + typed Link creates in batches carry admitted graph records. Preserve-ID policy, timestamp arbitration, comment feed, all-file atomicity versus finite batch limits and fresh-workspace enforcement are separate requirements. Never claim that ordinary export is a portable graph/history round trip. | [import, lines 23–53, 89–114][import] |
| `export` | Export Issue records with labels/dependencies/comments; optional Memories and infrastructure; not Dolt branches/history/full backup. Graph export is currently unavailable. | **Query/graph review + client serializer:** `list`, `link list`, `show` and a defined export format, plus any feed access. Multiple paged reads do not promise a consistent export snapshot; missing feed/history cannot be manufactured. | [export scope, lines 24–45][export]; [graph import/export boundary, lines 30–36][import] |
| `rename-prefix` | Rewrite all Issue IDs and text references, including a repair option. This is a registered maintenance command, not `move` or `relabel`. | **Outside Core/Write/contract conflict:** canonical identities cannot be renamed by ordinary update. Alias creation can aid navigation but does not perform identity rewriting, rewrite every text reference or move whole storage histories. Explicitly exclude or specify a migration capability. | [rename-prefix, lines 24–46][rename-prefix] |

## Findings to carry into the canonical design review

1. **Endpoint pin edits are a real missing mapping.** The product already re-pins
   informational Links while preserving their ID. Canonical `link update` explicitly
   excludes endpoint/pin edits. Delete/create changes identity and is not equivalent.
   [Product Link update, lines 289–332][link-update];
   [canonical exclusion](bdp-cli.md#bd-link-update).
2. **Atomic selection differs from a guarded edit of a chosen record.** Ready-claim,
   holder conditions, lease reclaim and lock queues are the sharpest examples. A
   batch of IDs selected earlier cannot imply selection at commit time.
3. **Comments and lease heartbeats do not have ordinary revision semantics.** Mapping
   them to Resource property writes changes observable history and Events.
4. **Type/provider rules are essential to lifecycle lowering.** Closing, reopening,
   reparenting, blocking-cycle checks and typed ownership effects cannot be promised
   merely because a property object can carry the corresponding strings.
5. **Retention is distinct from data values.** Promote/wisp/squash/burn cannot inherit
   durable history, erasure or tier movement guarantees from an `ephemeral` property.
6. **Graph acquisition needs a stated consistency contract.** Several product
   reports use complete snapshots. Client traversal using independent reads is
   useful but must not be advertised as the same snapshot. Query-language and
   traversal syntax remain with Donna and Melinda.

There is no separately registered domain `merge`, `move`, `reparent`, `relabel` or
`claim` command in the audited source. Relevant behavior is in `duplicates
--auto-merge`, `update --parent`, `label rename`, `update --claim` and `ready
--claim`. `vc merge` and storage/Dolt merge commands are version-control operations,
not Issue identity merge. `graph_apply.go` and `graph_export.go` contain helpers;
they do not establish extra registered `graph apply` / `graph export` commands.
The complete command-tree inventory above confirms these negative findings. `graphUnlinkCmd` is also unregistered: neither `bd unlink` nor a plural `bd links` alias is a public path in this source.

Registration does not mean mode availability. The graph admission gate explicitly
refuses duplicate/supersede and excludes gate, set-state and many advanced workflow
journeys; proxied-server availability is independently documented by the product's
capability registry. [Graph admission, lines 394–410][graph-admission];
[capability-registry meaning, lines 21–33][capability-registry].


[quick-actions]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_issue_quick_actions.go#L15

[close]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/close.go#L159

[close-batch]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/close_direct.go#L136

[reopen]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/reopen.go#L16

[defer]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/defer.go#L25

[undefer]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/undefer.go#L75

[claim]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_issue_claim.go#L14

[claim-store]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/internal/storage/graphstore/issue_claim.go#L15

[unclaim]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/unclaim.go#L18

[reclaim]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/reclaim.go#L25

[lease-store]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/internal/storage/graphstore/issue_lease.go#L15

[todo]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/todo.go#L51

[epic]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/epic.go#L111

[children]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/children.go#L17

[reparent]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_issue_reparent.go#L11

[ship]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/ship.go#L16

[link]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/link.go#L18

[dep-shortcut]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_workflow.go#L239

[dep]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/dep.go#L1175

[unlink]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_lifecycle.go#L400

[dependency-snapshot]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_dependency_views.go#L12

[blocking-projection]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_dependency_projection.go#L11

[labels]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/label.go#L706

[label-read]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_label.go#L16

[label-rename]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/label.go#L807

[state-read]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_issue_state.go#L13

[state-write]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/state.go#L219

[graph-admission]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview.go#L394

[comment]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/comment.go#L107

[comment-feed]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_comment_write.go#L12

[comments]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/comments.go#L156

[duplicate]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/duplicate.go#L101

[duplicates]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/duplicates.go#L51

[duplicates-merge]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/duplicates.go#L375

[merge-slot]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/merge_slot.go#L40

[graph-slot]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_merge_slot.go#L31

[swarm]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/swarm.go#L136

[swarm-create]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/swarm.go#L932

[cook]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/cook.go#L37

[pour]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/pour.go#L24

[clone]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/template.go#L861

[bond]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_bond.go#L20

[mol-show]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_show.go#L21

[mol-current]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_current.go#L42

[mol-progress]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_progress.go#L17

[mol-gated]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_ready_gated.go#L30

[mol-activity]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_last_activity.go#L13

[mol-stale]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_stale.go#L14

[seed]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_seed.go#L15

[formula]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/formula.go#L49

[distill]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_distill.go#L19

[squash]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_squash.go#L241

[squash-ops]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_squash.go#L276

[burn]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/mol_burn.go#L16

[wisp-gc]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/wisp.go#L610

[promote]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/promote.go#L35

[gate-create]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gate.go#L571

[gate-resolve]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gate.go#L770

[gate-waiter]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gate.go#L374

[gate-check]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gate.go#L826

[gate-discover]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/gate_discover.go#L111

[import]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/import.go#L23

[export]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/export.go#L24

[rename-prefix]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/rename_prefix.go#L24

[link-update]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/graph_preview_links.go#L289

[capability-registry]: https://github.com/donnabox/beads/blob/2c56673347b2bfb38022b3917580b58c7b2f6642/cmd/bd/capability_registry.go#L21
