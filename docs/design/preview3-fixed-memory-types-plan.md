# Preview 3: fixed Memory Type implementation

Status: implementation-plan draft, October 17, 2026. Product decisions and review
are explicitly tracked below. This is a nonnormative plan, not a new specification.
Shared design/integration owner: [BDP #59](https://github.com/gastownhall/bdp/issues/59).
Release owner: Janet, [Preview 3 plan](https://github.com/donnabox/beads/pull/110).
Memory domain owner: Melinda, [PR143](https://github.com/gastownhall/bdp/pull/143).

## Objective and boundaries

Implement the fixed Memory catalog required for the selected Memory workflows.
Preview 3 needs the landed Memory specification implemented; implementation may
use compiled tables and hand-written validators. A general extensible Type engine
is not a prerequisite. This plan separates independently dispatchable groundwork
from the complete user-visible Memory capability; catalog rows alone are not done.

No user-defined/installable Types, type-management CLI, registry, public definition
representation, federation/BDP prerequisite, cryptographic signatures, or Rust
work. Existing Issue/Dependency semantics and unrelated CLI work stay intact.
BDP amendments #152/#153 remain held and are not implementation prerequisites.

Design input is Memory PR143 at `38791e4cc6e16cf661fa839303d4ff315d49ab3d`.
It is a candidate, not a landed/adopted contract. Before product promotion, bind to
the actual accepted landing commit and review its delta. Never ship example.org
identities or illustrative revision tokens accidentally.

The standing Beads starting base is final `graph-preview2`, peeled commit
`703bb13e91aa2cab2092443319139006d74242c8`, until Janet explicitly authorizes a
qualified successor. Janet reconfirmed this starting base in her October 17 response;
PR113 hosted checks were still running and no integration-base change was authorized. Her planning branch is not a source base. Merge a subsequently
qualified base into shared work ordinarily, without rewriting shared history.

## Required subset of Type behavior

The candidate supplies Memory, Observation, Decision, Procedure, Policy and Lesson.
The latter five conform to Memory. Relationships are a new Memory association,
Guidance, AppliesTo, Supports, Challenges and Memory Supersedes; final selectors
and production identities need collision review.

Required mechanisms:

- One concrete affiliation, fixed conformance-aware membership, and explicit
  distinction between nominal selection and family matching.
- Complete-result property validation, inherited Memory requirements, preservation
  of unknown properties on targeted edits, and honest full-replacement semantics.
- Allowed endpoint pairs, self-link exclusion by canonical identity, live local
  floating endpoint checks and retained-state checks for exact endpoints.
- Domain citation pin requirements, source ownership and atomic revision effects.
- Specialized fields surviving reads, reopen, exact history, comparison and search.
- All Memory specializations excluded from Issue scheduling/readiness behavior.

All six proposed Memory relationships declare no participation minimum,
pair-uniqueness or acyclicity rule. Do not implement a generalized new engine for
those constraints merely for Memory. Existing Dependency constraints continue.
The hypothetical custom-Issue minimum/Memory deletion conflict is deferred while
user-defined Types are excluded. Operation capacity limits are a separate concern.

## Decisions before dependent implementation

| Decision | Proposed disposition / owner | Blocks |
| --- | --- | --- |
| Existing related compatibility | Donna decided to coin a new Memory name. Preserve existing related's Dependency identity, membership and behavior. Donna accepts Association (`association`) as the proposal's starting name. Melinda's full catalog remains a proposal pending Donna's review. | Final selector/identity publication, not pure validation work. |
| Other naming collisions | Dependency also has relates-to and supersedes; do not accidentally dispatch Memory Supersedes through bd supersede's Issue-closing behavior. Review all supplied names. | Final catalog/CLI wiring. |
| Retyping cutline | Donna selected: support within-Memory-family type+property updates; preserve existing Issue-family behavior; defer Issue↔Memory conversion. This is the Preview 3 product cutline, not a restriction in the general Type design. Reject unsupported cross-family conversion before any mutation. | Retyping commands and acceptance. |
| Citation inputs | Candidate requires exact targets for Supports/Challenges/Supersedes and permits floating or exact for other three. Explicit caller selection, no silent current-state pin. Confirm domain acceptance with Melinda/Donna. | Citation admission and CLI tests. |
| Query surface | Family discovery must include Memory specializations. Specify how general --type filters expose family versus nominal matching without silently changing existing commands. | Filter/CLI acceptance. |
| Catalog identity/history | Choose production IDs and an internal immutable contract binding sufficient to preserve historical meaning across binaries. Representation may remain private. No silent reinterpretation of stored records. | Persistent affiliation and upgrade tests. |
| Owned state capacity | Candidate declares no finite domain bound; existing Core requires a bound. Local product must define truthful capacity/refusal and complete reads without adopting unbounded claims. | Complete owned-state qualification; not a generic arity engine. |
| Provenance mapping | Unsigned writer claims allowed; shared actor/time/sources mapping and indirect mutation attribution must be agreed with History/Provenance owners. Deep Activity/provenance disputes stay separate. | Claims for attributable mutation workflows. |

## Source findings and consequences

The Preview 2 graphstore Memory payload is a title/body structure; its create,
patch, historical decode, query and CLI paths assume one Memory Type. Supporting
Procedure.steps or Decision.choice requires coordinated payload preservation and
catalog-based dispatch, not just new names. Endpoint fields are strings and current
Memory deletion rejects incident Links; pinned endpoints and lifecycle need shared
History work. Prior source audits are evidence about these commits, not fresh
installed behavior qualification.

The existing isolated `internal/typegraph` evaluator has no runtime callers and
uncommitted files pending parent review. Audit/reuse only what the fixed catalog
needs. Do not make dynamic definition loading or Type-as-Bead storage a dependency.
Existing catalog fingerprints and strict admission must remain meaningful; don't
turn off checks to admit new rows. Any persisted-catalog change needs an explicit
upgrade/backfill policy and tests before runtime activation.

## File-level runtime seams and owner coordination

| Surface | Files to inspect/change in the appropriate later slice |
| --- | --- |
| Closed catalog and integrity | `internal/storage/graphstore/{schema.go,informational_types.go,types_read.go}`; retain fingerprint checks and coordinate generation/upgrade policy with Janet. |
| Complete properties and mutation | `internal/storage/graphstore/{types.go,records.go,memory_update.go,memory_properties_patch.go}`; reuse existing guard/no-op/commit machinery. |
| Retained meaning and owned sets | `internal/storage/graphstore/{history_exact.go,version_history.go,history_compare.go}` and owned-history validation; coordinate Jim/Polly before editing. |
| CLI and discovery | `cmd/bd/graph_preview_{types,issue,memory,links,list,memories_projection,generic_projection}.go` and graphstore `bead_list.go`; follow Janet's independently selected output policy. |
| Endpoint admission and deletion | graphstore `informational.go`, `link_properties_patch.go`, `memory_delete.go`; coordinate retained-state resolution and terminal revisions. |
| Connected export | Iris's pending `graphstore/export_current.go` assumes current fixed types; have Iris review payload/closure changes. Import/export is not an F0 prerequisite. |

Seven central catalog/storage/CLI blobs match Preview 2 and Janet's PR113 candidate
`b9eebc31f8e0f21b9a6154652476ed87027e9cad`; this is a source comparison, not new base
permission or runtime qualification. Existing `PreviewOwnedLinkLimit=1000` must
remain enforced/reported until deliberately changed; it is not a new Memory domain
maximum. Opaque remote reference carriage does not imply remote validation.

Supporting read-only audits: [type gaps](preview3-fixed-memory-type-gaps-audit.md)
and [implementation seams](preview3-fixed-memory-code-audit.md). Their recommendations
are not additional product rulings. The more restrictive first assignment here takes
precedence over audit suggestions to finish the unused general evaluator.

## Implementation slices

| Slice | Deliverable and acceptance | Dependencies / owner boundaries |
| --- | --- | --- |
| F0: fixed contract tests and validators | Pure compiled family membership and per-Type complete-property validation against shared approved fixtures. Positive and negative cases cover inherited fields, unknown fields, replacement and category separation. Pure local endpoint pair/pin/self-link predicates consume caller-supplied resolved facts; they do not fetch or claim retained-state validation. No catalog mutation, provider, public capability advertisement or generated runtime Type definitions. | Can start against pinned candidate with injection of unresolved IDs/names. Trish's coding worker; review before treating as settled. |
| F1: complete Memory payload path | Preserve specialized and unknown properties through create, targeted update, full replacement, current read, reopen and exact history. Central family dispatch replaces single-Memory assumptions. No dropped data or relaxed strict decoding for legacy/native records. Omitted type preserves affiliation; semantic no-op creates no revision; invalid/stale/failed writes leave allocation, current state and history unchanged. | Accepted contract identity/upgrade policy; coordinate with Jim/Polly History and Janet storage/CLI ownership. One writer for these shared files. |
| F2: catalog and CLI activation | Add accepted fixed catalog, --type creation/selection, honest inventory/details, family discovery and specialized-property search. Implement selected explicit retyping atomically. Protect all existing Issue/Dependency selectors and workflow behavior. Filter before pagination; compact summaries/default discovery do not expose full specialized content, while explicit complete reads do. Preserve automatic-export exclusion; coordinate projection/export changes with Iris. | F1, landed Memory contract, resolved names/filter/retyping decisions. Existing catalog upgrade and backwards-reader behavior tested. |
| F3: informational Link admission | Enforce correlated source/target alternatives, self-link exclusions, citation pin requirements and fixed family matching. Preserve valid parallel/cyclic informational claims. Ordinary Dependency behavior stays unchanged. | Accepted domain rules, shared exact endpoint carrier/resolver. Carrying opaque external references is separate from fetching/federation; don't silently remove that distinction. |
| F4: references, ownership and lifecycle | Same-target-identity re-pinning and metadata changes preserve Link ID; owned Link changes version source atomically. Floating deletion cleanup, retained pinned citations and old owned snapshots remain correct. Test exact source-revision counts for owned changes, no-op and rollback behavior, and unchanged targets. No target revision solely from incoming links. | Trish Link lane plus Jim/Polly History; valid retained-state admission and shared writer attribution. No substitute Memory-only history system. |
| F5: full workflow qualification | Exact installed build in embedded and ordinary shared-server modes passes selected complete Memory scenarios, including errors, reopen, history and indirect effects. Janet owns release/build qualification. | F1–F4 and required provenance. Fixture success alone is not Memory support. |

F0 is deliberately bounded groundwork; it cannot be reported as implemented Memory.
F1/F2 are the first useful record workflow. F3/F4 are necessary before claiming the
relationship and historical-reference workflows complete. Do not advertise a Type's
unsupported semantics simply because its name appears in the catalog.

## First coding assignment

After plan review, dispatch one isolated Beads worker for F0 on the authorized base.
Read existing repository instructions. Own only a new pure internal package
(suggested `internal/memorytypes`) and its tests/build metadata. Use a small compiled
membership table for the fixed family. The uncommitted `internal/typegraph` files
are NOT an input dependency: parent must first review and publish an immutable
source before any deliberate reuse. Never copy an owner's mutable checkout as an
unrecorded source. Implement pure fixed-Memory property validators and local
pair/pin/self-link predicates with shared fixtures. Keep unresolved production names/IDs supplied as
inputs; do not mint them or expose provisional selectors. No CLI/store/wire/schema
or release edits, no dynamic Type loading, no merges. Return a reviewable source PR,
exact source head, meaningful validation results and explicit no-runtime-caller limit.

Tests should demonstrate inherited required fields, correct typed values, preservation
of open-root fields, closed nested records where declared, exact category separation,
and no inferred conformance from matching shape. Validate date/time semantics rather
than silently skipping format checks. Cross-check with Python schema fixtures and
reject divergence. Run repository-required targeted checks for changed files; don't
claim full product qualification from unit tests.

Before the F1 worker starts, confirm file ownership with Janet and History owners.
Produce a file-level change list and current source head; use the same validator in
all supported mutation paths. New semantics requiring Donna's ruling stop only the
dependent slice, not pure work already authorized.

## Completion record and review

Record each slice's source commit, accepted spec commit, selected behavior, commands,
results and exclusions in #59 and link Janet's release tracker. Keep semantic adoption,
implementation, and installed qualification separate. New owner overlap or a changed
base requires reconciliation; it does not authorize rebasing someone else's work.

Plan council: native review completed; three findings addressed and follow-up found
no unresolved issues. Claude review has returned; findings are awaiting disposition. Gemini excluded per earlier direction.
No implementation worker has been dispatched by this document. Open decisions are not
approval by timeout. The two read-only audits inform this plan; they are not reviews
of its final text. Main-spec and PR159 landing holds remain unaffected.
