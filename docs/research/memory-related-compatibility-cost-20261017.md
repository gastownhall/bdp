# Cost and compatibility of widening `related` for Memory

Read-only assessment for Donna's October 17 review comment. **Keep the current
Association direction unless Donna rules otherwise.** It isolates the new Memory
contract from existing Issue workflows. Widening an existing relationship could
still be a reasonable later simplification, but changing an endpoint predicate
alone would leave storage, ownership, history and query contracts inconsistent.
No runtime, schema, catalog, selector or user review comments were changed for this assessment.

## Exact evidence and limits

Inspected final Preview 2 `703bb13e91aa2cab2092443319139006d74242c8` from existing
read-only Git objects, and compared 26 source blobs with the stored, complete
GitHub tree for qualified PR113 source
`b9eebc31f8e0f21b9a6154652476ed87027e9cad`. Twenty blobs are identical. Six legacy
CLI/domain/types files differ; their exact PR113 blobs were downloaded and their
diffs inspected. Those changes include actor selection, hierarchy-rule extraction,
thread-aware re-add history and readiness details. They do not make native
Dependency endpoints generic Beads. This is a source assessment, not a fresh
installed-binary qualification or an audit of later Preview 3 implementation.

The evidence manifest, copied source and six diffs are retained in the author's
audit packet; source links below identify the immutable public inputs.
The proposal comparison uses Memory at
`9048dc746b1b37210d2b5654d6cd44a55401b0f1`, before Donna's uncommitted comments.

## Three meanings must be distinguished

| Existing or proposed relationship | Actual contract |
|---|---|
| Native Dependency `related` | Issue-domain relationship. Preview 2 stores every native dependency kind under one nominal `preview-dependency` Type with `dep_type`; source and target must be durable Issues, source owns the Link, and one ordered pair has one Dependency. The future fixed nominal mapping must preserve this behavior. |
| Private experimental `preview-related` | Already accepts live local Issue and Memory endpoints. It is a separate informational Type, has independent multiedge identity, optional `note`, Memory-source ownership and no Issue-source ownership. `preview-related-memory` is an alias for this private Type. It is not the native Dependency child named `related`. |
| Proposed Association / `association` | Separately named Memory-domain relationship, requiring at least one Memory-family endpoint. Full proposed endpoint/property/pin rules remain under review. It does not replace either existing contract implicitly. |

The distinctions are visible in the [native and informational descriptors](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/internal/storage/graphstore/schema.go#L74),
[exact CLI dispatch](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/cmd/bd/graph_preview_links.go#L145)
and [Association proposal](https://github.com/gastownhall/bdp/blob/9048dc746b1b37210d2b5654d6cd44a55401b0f1/specs/types/memory/memory.md#L339).
Bare `--type related` selects a native Dependency; it does not select the
informational Type. The similarly named `bd relate` creates reciprocal
`relates-to` Dependencies, a separate existing behavior.

## Relative effort by implementation seam

“Small”, “moderate” and “broad” describe affected contracts and qualification,
not estimates of elapsed time. Association still needs the planned shared
payload, Reference, deletion/restore and Memory catalog implementation; this
comparison concerns the additional cost of unifying existing relationships.

| Seam | Preserve Dependency + new Association | Widen native `related` to Memory |
|---|---|---|
| Admission and fixed catalog | **Small additional seam:** register a new fixed nominal Type and accepted Memory pair rules. Reuse informational machinery while preserving existing selectors. | **Moderate contract decision:** select endpoint rules for `related` and its base. If it continues to conform to Dependency with Issue-only endpoints, adding Memory endpoints contradicts that base contract. Merely having an Issue-shaped payload does not establish Issue membership. No general Type engine is required to expose or resolve this contradiction. |
| Backing storage/read integrity | Reuse graph informational backing and extend for specialized Memory affiliation as already planned. | **Broad if truly one contract:** native writes call `requireIssueInTx`, execute Issue dependency operations and join native Issue backing IDs on reads. Memory endpoints need another backing route or a generalized Dependency representation. A descriptor edit alone cannot make a native row represent them. |
| Ownership and source revisions | Keep Issue-owned Dependencies and Memory-owned informational Links separate. | **Moderate to broad:** decide whether Issue→Memory is Issue-owned like Dependency, or unowned like current informational Links. Choose guard/no-op/version effects for each source family, and update owned-set counts, deletion cleanup and retained membership accordingly. |
| Pair identity and mutation | Independent informational multiedges retain their own identity; Dependency pair uniqueness is untouched. | **Moderate contract work:** keep one Dependency per ordered pair, or permit informational parallels? Native reassertion is a no-op, conflicting kind/ID is refused, and pair-based removal identifies one edge. Informational multiedges use independent IDs and ambiguity handling. One spelling cannot silently choose both meanings for the same pair. |
| CLI and read APIs | Add `association`; keep `related`, `relates-to`, `bd relate` and Dependency `supersedes` dispatch unchanged. | **Moderate surface audit:** define dispatch for bare `related`, explicit nominal URLs, Link-ID operations, pair deletion, filters and JSON. Endpoint-dependent routing could preserve old Issue pairs, but is an explicit overloaded-command contract. Existing Relations returns Issues, not arbitrary Beads. |
| Readiness and workflow | New informational Type stays outside scheduling. | **Small predicate change may be unnecessary; moderate regression work remains:** `related` already does not affect readiness. Preserve blocking/hierarchy/close behavior and prove wider records cannot enter Issue-only graph projections or alter counts unexpectedly. |
| History, reopening and migration | New Type has a distinct contract; preserve all old snapshots and identities. | **Moderate to broad, depending on persistence policy:** current historical decoders distinguish Issue-owned native Links from Memory-owned informational Links. Unifying current identity/backing must preserve old affiliation, ownership and exact reads. Fresh-only Preview 3 can avoid an in-place preview data migration if that policy is expressly selected; it does not eliminate behavioral compatibility checks. |

Key code evidence: [native creation and pair/no-op rules](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/internal/storage/graphstore/dependencies.go#L39),
[native Issue-backed read joins](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/internal/storage/graphstore/dependencies.go#L250),
[informational create](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/internal/storage/graphstore/informational.go#L44),
[Memory source revision recording](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/internal/storage/graphstore/informational.go#L351),
[retained ownership validation](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/internal/storage/graphstore/history_exact.go#L244),
[Issue-only Relations contract](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/issueops/relations.go#L9)
and [blocking graph projection](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/cmd/bd/graph_preview_dependency_projection.go#L21).
The qualified candidate also preserves [reciprocal relates-to creation](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/cmd/bd/relate.go#L104)
and adds [thread-aware same-type native re-add behavior](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/internal/storage/domain/db/dependency.go#L110).

## Smallest useful investigation if wider `related` remains attractive

1. **Choose the intended change first:** widening native Dependency `related`,
   adopting the private informational Type, or overloading one CLI spelling across
   distinct Types. These have different compatibility costs. Adopting/renaming the
   private precursor is closest to existing Memory machinery; it still does not
   turn native Dependency `related` into a shared contract.
2. Write a small four-pair decision matrix: Issue→Issue, Issue→Memory,
   Memory→Issue and Memory→Memory. Record intrinsic Type/base membership,
   backing, ownership/guard, parallel-edge policy, pins and selector/result shape.
   Compare it with current Association's deliberate rejection of Issue→Issue.
3. If the matrix is acceptable, build one isolated read/write proof using fixed
   baked-in rules. Exercise create/reassert/remove, source revisions and exact
   history for each admitted pair. Do not dispatch a second implementation lane
   before Trish incorporates the decision into the existing plan.
4. Qualify unchanged legacy Issue pairs, reciprocal `bd relate`, `relates-to`,
   Dependency `supersedes`, pair conflicts, no-ops, stable IDs, readiness and
   existing Relations responses. Add Memory-family/pin/self cases, reopen, stale
   guards, rollback, incident deletion/restore and old historical snapshots.
   Cover supported direct/proxied and storage adapters where the chosen behavior
   is exposed. A selector-only alias needs selector/identity compatibility tests;
   a generalized backing needs substantially wider storage/history tests.
5. Record a fresh-only versus upgrade policy. Installed catalog descriptors are
   fingerprint-checked and earlier preview installations are refused, not silently
   upgraded ([catalog validation](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/internal/storage/graphstore/informational_types.go#L82)).
   Changing a persisted descriptor under the same identifier without a deliberate
   generation/contract transition is not a safe migration.

## Recommendation and remaining uncertainty

Continue Association for the first Memory release. It is the smallest compatible
increment because it reuses the existing informational seam and avoids changing
Issue-domain contracts while Memory's specialized properties and lifecycle are
being implemented. No installable-Type framework, federation or BDP runtime is
needed for that route.

The low-cost alternative is potentially a carefully documented CLI convenience
or reuse of the private informational precursor, rather than a unified native
Dependency contract. Its value depends on Donna's desired user model. The true
cost of unification depends on the unresolved matrix choices above and on the
accepted Preview 3 fresh-workspace policy. Later fixed nominal Type work may
change exact files, so this assessment should guide a bounded design decision,
not be treated as a patch plan for a moving implementation.
