# BDP stabilization plan

This is the current execution plan once published on main. It replaces
[issue #59](https://github.com/gastownhall/bdp/issues/59), whose decisions and
qualification history remain reference material. After publication, put a clear
superseded notice and this plan's main link at the top of #59, then close it.
An unmerged copy does not supersede the issue.

[Canonical specifications](../../specs/README.md) own protocol meaning. This plan
sets work order and completion criteria; it does not adopt a proposed capability,
qualify an implementation or change a consumer's pinned contract. Donna decides
unresolved semantics; Trish maintains this plan and coordinates the existing
owners. Concrete implementation work remains tracked through
[#320](https://github.com/gastownhall/bdp/issues/320) and bounded linked changes.

## Starting point

The November 2 main baseline is
[`a0d72b6`](https://github.com/gastownhall/bdp/commit/a0d72b6d45dd8d3059bf3cc64b22382f43b8162e).
[Callable and Package drafts #331](https://github.com/gastownhall/bdp/pull/331),
[opt-in six-CRUD atomic batch1 #339](https://github.com/gastownhall/bdp/pull/339)
and [canonical CLI #341](https://github.com/gastownhall/bdp/pull/341) are landed
with incoming and actual-main qualification recorded. Their supported subsets
and evidence boundaries still apply. Experimental publication leaves Callable
and Package decisions open; provider batch1 does not imply a complete batch CLI
or richer batch2 support. External council attempts produced no verdict and are
not recorded as completed council review.

## Work order 0: the ten-day preview

Since November 4, 2026 this work comes first, ahead of the sequence below, which
is unchanged but waits. The goal is a friends-and-family private preview of OSS
beads' current HTTP functionality over BDP, targeted for November 13, 2026. The
OSS beads implementers build the endpoint against a pinned specification; this
repository delivers the specification, the conformance kit and the reference
client and service.

| Step | Target | Content | Status |
| --- | --- | --- | --- |
| P0 | Nov 5 | Core and Write at [`d9b2dae`](https://github.com/gastownhall/bdp/commit/d9b2daee87a7e686425de83ad2599462b95aacb4), no tag, with Write's optional aliases and `idempotency` capability announced ahead of their text | Ruled by Donna; not yet sent |
| P1 | Nov 9 | P0 plus the Issue and Dependency package, the Callables profile, the amended Write, the preview manifest and the handoff document, under one tag | Proposed |
| P2 | Nov 12 | One re-pin, only for fixes found by implementing | Proposed |

The dates after P0 and the tag are Donna's to confirm. Specification work past the
pin continues on main unpinned; a specification edit never moves a consumer's pin.
The next round may break the protocol. For this sprint only, an endpoint may
advertise with documented exceptions, recorded per conformance row in the handoff
and the conformance report; an excepted row is never reported as passed, and the
reference service takes no exceptions.

## Work order and gates

1. **Land historical-source editing urgently.** Finish the coordinated
   `--from-revision` specification and BDP product implementation before Donna's
   specification review closes. Specify the native carrier, admission, exact
   historical source, current target/guard and retry meanings; qualify executable
   behavior against that contract. Preserve failures and unsupported cases rather
   than silently substituting ordinary current-state updates.
   [PR174](https://github.com/gastownhall/bdp/pull/174) is an input to reconcile.
   Existing native Beads work in
   [Beads #7719](https://github.com/gastownhall/beads/issues/7719) and
   [donnabox/beads PR141](https://github.com/donnabox/beads/pull/141) is distinct from
   public BDP wire support. Spec and implementation siblings must agree on the
   exact incoming contract and landed qualification. The selected design is an
   optional discoverable capability: body-free deletion versions, a narrow
   authorized terminal-state read, independently guarded same-ID undelete, and
   explicitly selected source/predecessor context outside base Resource records.
   Initial atomic-batch composition may refuse explicitly. Historical admission
   requires the exact complete editable source content consumed plus the
   independently authorized current protected baseline; unused old owned-Link
   captures are not a prerequisite. None of this claims completed implementation
   qualification.
2. **Put the repository on rails.** Apply the completed inventory disposition review,
   preserve genuine residuals, implement the accepted testing policy below, and
   agree the small maintenance/edit-history routine. Record the exact coalesced
   main commit, checks, supported scope and remaining work. Reduce open work only
   where its disposition is justified; a zero count is not a completion target.
3. **Complete Donna's edit pass.** Use the existing
   [VS Code editing routine](../spec-review/README.md) and canonical corpus.
   Process comments in small reviewed changes; return meaning questions to Donna.
   Keep prose, schemas, OpenAPI and executable correspondence aligned. The urgent
   `--from-revision` gate above must be satisfied before closing this review.
4. **Follow through on the selected priorities.** Immediately after stabilization
   and the edit pass, take up [Provenance PR183](https://github.com/gastownhall/bdp/pull/183)
   as the next provenance design work. Add an informative sidebar in its owning
   specification identifying the direction without adopting the whole historical
   carrier. Pick up **both Callable and Package** after Core/Write/Types and before
   deeper Memory/Issues work; preserve their unresolved design decisions.

Go is the next **client** implementation after the repository is on rails and
Donna's edit pass is complete, followed by Rust and Python. The Go client is
important to the open-source Beads integration. Reconcile this sequence into #320;
it does not select a Go CLI, server or embedding implementation. Colocation with
TypeScript is acceptable while Go is the only additional language. The general
N-language repository strategy remains open; neither a permanent monorepo nor
creation of external repositories is authorized by this plan.

## Testing and cost discipline

The additive [shadow routing experiment](../test-routing-shadow.md) documents exact-file commands, prerequisites and receiving limits; it does not replace required suites.

Keep these categories separate in commands, reports and coverage maps:

- Specification artifact consistency: prose/schema/example/link checks and
  generated projection parity. These checks qualify source artifacts.
- Interoperability and conformance: public-boundary checks against arbitrary
  implementations. A small provider adapter provisions and cleans up conditions;
  it never supplies expected answers. Missing lifecycle control leaves affected
  durability cases not-run and prevents complete durable Write qualification.
- Reference implementation correctness and reliability: unit/integration tests,
  private corruption/fault controls, storage and lifecycle tests. Packed
  installation and actual executable checks remain in the ordinary baseline.

Every required obligation in a qualification scope needs mapped evidence.
Required failures, missing coverage and unrun cases prevent a complete pass;
optional capability absence and harness failure retain distinct outcomes.

Ordinary PR CI targets five minutes, with a ten-minute maximum from runner start
through required checks including setup; report queue time separately. This is a
migration exit target, not permission to truncate today's checks. Keep a current
contract baseline. Relevant storage, transport, lifecycle and test-framework
changes also require extended gates; run extended coverage nightly and before
releases, and use broader checks when impact is unknown.

Consolidate repeated installed runs when only verifier expectations change, using
real captured observations for pure negatives. Keep real execution for changed
requests, authorization, effects, timing, crashes, cleanup or topology. Preserve
an explicit legacy route and historical evidence during transition; remove
obsolete machinery only after its obligations have reviewed replacements.
Runtime startup should depend on configuration, capabilities and runtime
validation; migrate historical hardcoded cohort admission coherently, without
bypassing an old guard piecemeal.

Track reference performance separately. Require bounded cost experiments before
accepting changes likely to affect storage, retention, validation, paging or
publication materially, alongside scheduled trends. Start trend-only; choose
regression thresholds after repeatable baselines exist. Preserve functional
semantics and the ordinary CI budget. No new performance baseline is claimed.

Reuse expensive CI results only when relevant source, suite, dependencies,
toolchain and artifact inputs are verified identical. Commit-dependent outputs
count as inputs. Check actual merge composition and retain a short main
installation/executable check; tree equality alone is insufficient.

## Inventory and deferrals

Publish `specs/deferred.md` as the central non-normative registry. Each owning
specification keeps an open-question appendix with context and alternatives,
plus pointers near the relevant text. The registry tracks deliberate deferrals
and links back; active questions are not automatically deferred. Distinguish
unselected design from delivery of an already selected optional capability.
Current mandatory rules cannot be weakened by a deferral entry.

Issue/PR closure needs an item-level record: current rule or replacement,
remaining question/task and its durable home, evidence/source pin where relevant,
and the reason the old tracker can close. Preserve applicable tests and original
receipts. Harvest historical stacks before conditional archival; do not merge
obsolete parent chains wholesale or treat accepted dispositions as completed
harvests.

Donna completed disposition review of all 12 issues and 48 PRs in the
post-landing inventory (decisions 11–78). The
[accepted disposition index](inventory-dispositions-20261102.md) links each item
to its preserved requirements, exact source and surviving work. Approved historical closures remain
conditional on item-level harvesting, preserved evidence and published residual
homes. The disposition ledger must distinguish reviewed, preserved, closed and
implemented; these statuses are not interchangeable. Revisit replication feeds,
retained Snapshot positions and publication races during Transfer. Existing
owned-Link design is explicitly scheduled for reexamination; avoid costly
expansion while preserving the currently admitted invariants. Preserve the explicit deferrals for foreign expected Type (#11),
Scope relocation (#62) and broader aliases (#299). Finish #5 item by item; map
#6 against current Memory rules and keep its pin/composition/lifecycle questions.
Replace issue #1's historical diary with Core's normative History rules,
spec-owned questions, and named optional History implementation/conformance work
under this plan and #320. Finish its requirement-to-destination map before closure. PR314 needs bounded independent security/URI-identity and consumer
review before selection; dependency updates are not a substitute.

## Maintenance and remaining decisions

Support the current BDP contract while preserving immutable consumer pins and
the BDP-owned schemas, catalogs and generated artifacts needed to interpret them.
New BDP work must not change the bytes or meaning behind an old pin. Beads chooses
when to upgrade its pin; BDP and Beads do not move in lockstep. The guarantee does
not freeze every consumer toolchain dependency.

Before stabilization is complete, agree how ordinary changes keep the backlog,
current main, specification edit history and implementation support map current.
Discovery's possible immutable implemented-spec pin still needs a concrete
contract and review; a pin alone is not conformance. Whether and how BDP CI
validates the Beads product and the N-language layout remain open. The current
open-source delete/prune/purge workflows need an explicit command-to-contract
mapping before selecting stronger all-retained-copy erasure; command names alone
are insufficient requirements.

Donna has an existing agent responsible for the Beads side. BDP work must not
start a competing Beads implementation or runtime campaign. After the accepted
dispositions and residuals are published, provide that agent a compact handoff:
selected contract and immutable source pins, CLI/SDK correspondence, qualification
receipts, limitations, and named remaining product work. Native Beads delivery,
public BDP support, draft design and verified implementation remain separate
claims.
