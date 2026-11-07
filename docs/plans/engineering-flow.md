# Engineering flow

**Status: draft for Donna to read and overrule.** Written overnight on 2026-11-07 for Trish, from Britt's brief (packet 36). It is not ruled. Every unruled choice is marked "Recommended, not ruled (F-n)" where it appears, so a search for `F-` finds them all.

This is the sequence every stage of the bring-up lands through, on both sides of the pin. It sets order and checks. [The specifications](../../specs/README.md) own protocol meaning, the [stabilization plan](bdp-stabilization.md) owns bdp's work order, and the staging graph (packet 35) owns the stage list. "Packet" means a file in Britt's decision packet, which is local to Donna's machine.

Live facts were read at about 00:10 PST on 2026-11-07. They go stale. Check them before acting on them.

## Choices for Donna

| | Choice | Recommendation in one line |
| --- | --- | --- |
| F-1 | Where the plan lives | One document here, in `docs/plans/`; job detail stays beside the jobs on the fork |
| F-2 | Where the PR checklist lives | A fork-only file passed with `--body-file`, because upstream's PR template must stay as it is |
| F-3 | What "normative" means for a stage | Selected profile, on bdp `main`, inside one of Donna's declarations; front matter is not the test |
| F-4 | Red BDP completeness on staging | Yes, unadvertised and named in Donna's go; never upstream |
| F-5 | How a pin target stays reachable | Upstream pins only `gastownhall/bdp` `main`; staging may also use a `donnabox/bdp` read mirror; two writers on bdp |
| F-6 | `specRevision` against the pin | The pin check derives it from the pin, as Core defines it |
| F-7 | How a wire break lands | Expand, then a small flip PR that moves the pin, then contract |
| F-8 | What bounds the iterative review | Named checkpoints; between them nothing reopens without a failing scenario or Donna's word |
| F-9 | G1 on the fork | The fork-only commit also moves the jobs to GitHub-hosted runners |
| F-10 | G2's comparisons and record | Per PR against the merge base, nightly against `upstream-main`; records named by date; harness stays fork-only |
| F-11 | G3's driver | TypeScript on the fork until the Go driver exists |
| F-12 | Reading "applicable by discovery" | Read the kit's rows, not its exit code; a stage's declared capability may not read not applicable |
| F-13 | The reverse lane | New nightly lane at a staging commit until a beads tag carries BDP |
| F-14 | Who rebuilds staging, and when | Britt, within 24 hours of the mirror moving, with a drift check that opens an issue |
| F-15 | Who makes checks required | Britt on Donna's standing word, after each check has reported on #374; four names |
| F-16 | Where evidence lives | A fork-only `bringup-evidence` branch; PR bodies point at it |
| F-17 | Who says what is done, and who merges | Trish for the completeness row, Britt for the rest and for staging merges, Donna for the stage |
| F-18 | The found-along-the-way list | One list per stage on the evidence branch; an undecided row blocks nothing unless acceptance needs it |
| F-19 | How conformance users report back | A kit line pointing at a bdp issue form and a fixed label; Trish watches, Donna posts replies |
| F-20 | Order of the first flow work | Build alongside generic bead operations and events; land none of their slices until the jobs report |

**Recommended, not ruled (F-1):** keep this as one document here, beside the stabilization plan, with job detail in `scripts/bringup-gates/` on the fork, because one reader follows one stage across both repositories and a section per gate would scatter it. bdp is public, and this names roles and fork details, as the stabilization plan already does. It stays on a local branch until bdp access returns. The realistic alternative is keeping it in Britt's packet, which is private and available today and which no outside contributor could ever read.

## What is settled

Donna's three requirements (2026-11-06):

1. No behavioral or CLI change to support BDP that isn't explicitly curated.
2. Identical end-to-end behavior for a v0 client and service.
3. No leftover debt. In her words, "we tend to forget things".

Accepted exceptions: `--protocol` in help and the command tree; build and version strings; per-run values such as request ids; the order of repeated query values.

Also ruled:

- "The sprint is the dress rehearsal": the sprint's landing goes through these gates.
- The staging path: `bringup/<slice>`, draft PR into `bringup-staging`, then a proposal upstream. [#374](https://github.com/donnabox/beads/pull/374) is the first.
- G2 comes from the wire proof and goldens. G3 comes from the conformance scenarios.
- Upstream's `pr.yml` and `pr-risk.yml` trigger only for `main`, `release/**` and `hotfix/**`, so `bringup-staging` carries fork-only commits, replayed on each rebuild and never proposed upstream.
- Standing from packet 36 §6: nothing lands on `donnabox/beads` until Donna declares the specification stable for that stage. A ruling alone never authorizes implementation.

Standing from packet 13, as packet 36 §2 records: `upstream-main` mirrors upstream `main`, fast-forward only. `bdp.pin` carries the bdp commit until a Go module exists. The `bdp` client is the dual of `bd serve`. From packet 13 §3: a spec defect found by building is answered in the spec and never worked around in the implementation.

## 1. A stage's life

| Step | Who | What comes out | Moves on when |
| --- | --- | --- | --- |
| Drill | Donna and Britt | The stage's section in packet 35 | Donna says so |
| Spec pre-check | Trish | First pass of the completeness table (§2.3); the catalog gaps it hits (§2.4) | Each gap is answered or routed to Donna |
| Go | Donna | A declaration that the specification is stable for this stage | She declares it |
| Shred | Britt, on Donna's word | Stage epic, checklist and sub-stage tasks (packet 35 §11) | The epic exists |
| Implement | One implementer per track | `bringup/<slice>` branches | §1.1 |
| Land | Implementer, then F-17's merger | Slices squash-merged on `bringup-staging` | Required checks green, G5 done |
| Stage check | Britt and Trish | Evidence record (§7) | Donna says the stage is done on staging |
| Propose | Donna's "post" | Upstream PRs under the campaign issue, in upstream's shape | Upstream maintainers merge |
| After merge | Britt, Trish | Mirror moves, staging rebuilt, slice branch deleted; after the last slice, conformance on upstream `main` and a bdp declaration | The stage is done |

### 1.1 One slice, for the implementer

1. Branch from the fork's `upstream-main`, or from the previous slice when stacked. One issue, one layer, a few hundred lines, revertible alone. Until #374's content is upstream, a slice that needs `--protocol` or `/bdp` stacks on it.
2. Work through the stage's checklist rows (packet 35 §5). Touch each row, or mark it not applicable with a reason.
3. Found something else wrong? Add a row to the found list (§8) and leave it out of this slice.
4. Found text that doesn't fit what you are building? File a finding (§5). Keep going on the reading you have unless it stops you.
5. Run G2 by hand before you push: `python3 scripts/bringup-gates/g2_cli_surface.py --base-ref bringup-staging --dolt DOLT --out DIR`. On a difference, either fix it or write the decision record (§6.2). A record needs a ruling behind it.
6. Open a draft PR into `bringup-staging` with the checklist as its body.
7. Fill the body's evidence table at the head commit (§7), and its not-done table.
8. Mark it ready when the required checks are green at that head. Then G5.
9. When staging is rebuilt, update your branch. Strict checks are on, so the gates rerun.

Nothing fork-only goes into a slice. The upstream proposal is cut from the slice branch without the fork-only commits.

**Recommended, not ruled (F-2):** keep the checklist at `scripts/bringup-gates/PR_CHECKLIST.md` in the fork-only commit, and open PRs with `gh pr create --body-file`, because `.github/PULL_REQUEST_TEMPLATE.md` exists upstream and replacing it would conflict on every rebuild. The alternative is a `.github/PULL_REQUEST_TEMPLATE/` directory on the fork, which is more files for the same text.

## 2. The specification side of a stage

### 2.1 What the stage needs normative

**Recommended, not ruled (F-3):** text counts as normative for a stage when it is in a selected profile (not marked proposed or experimental), on bdp `main`, and inside a declaration Donna made: the tag `spec/<group>-<yyyymmdd>` plus a line in `specs/README.md`. I recommend this because the front matter can't be the test: Core, Write and Events all read `status: draft` or `editorial-draft`, and a [working-draft merge is not final approval](../spec-review/README.md). The alternative is waiting for `status: normative` in front matter, which holds every stage until Donna's full edit pass ends.

No declaration exists yet: bdp has no `spec/*` tag and `specs/README.md` has no Declarations heading. Callables and the Issue Callables are `experimental/` on `main`, with their profile text on draft PRs and local branches. The sprint's declaration has to come first.

### 2.2 From proposed text to a pin

1. Donna edits and comments in the [editing loop](../spec-review/README.md). One writer per file. Trish processes comments, checks the source and pushes. Semantic questions return to Donna.
2. The rule lands with its conformance row in the document's conformance table, and its entry in `packages/conformance/catalog/current/`. A test there holds each row to exactly one entry with the row's exact text (on Trish's local conformance branch, not yet on `main`).
3. A catalog entry is a citation. It runs nothing. The row counts as covered only when a kit case or named scenario executes it.
4. The reference implementation serves it, in the same PR or the next one, before the declaration. [Reference alignment](../spec-review/README.md#ci-and-implementation-alignment) keeps its own coverage record.
5. Trish opens each bdp PR against `main`. `ci.yml` runs only for `main` and two legacy branches, so a stacked PR gets no checks: #364 and #370 show none today.
6. Donna declares. The pin may now move there (§3).

### 2.3 BDP completeness

This is the checklist's last row, and the stage's acceptance. Trish fills the table three times: pre-check, stage check and just before the proposal.

| Operation | Text | Row and scenario | Reference | `bd serve` route | http backend method | `beadops` entry | `bdp` client verb |
| --- | --- | --- | --- | --- | --- | --- | --- |
| one line for each operation the stage exposes (packet 35 §4) | section, at the pin | row id, and the run that executed it | serves it, at the pin | | | | |

The last four columns are the dual rule: what `bd serve` serves, the `bdp` client must drive.

**Recommended, not ruled (F-4):** yes, a slice may land on `bringup-staging` with this row red against proposed text, on three conditions: the pin does not move; the capability stays unadvertised on a default `bd serve`, so nothing claims it; and Donna's go names the sections still proposed. Red is never allowed upstream. I agree with Britt's default, because events and query can't otherwise start, but it needs Donna's word: packet 36 §6 says nothing lands until she declares the specification stable, so a go that names proposed sections is what reconciles the two. The realistic alternative is keeping staging green and holding red slices on their branches as draft PRs, which is stricter but loses whole-wave testing for exactly the stages that most need it.

### 2.4 Catalog gaps: when each is needed

Packet 36 §4's list, plus the two that were added later. This plan answers none of them. "Ruled" below means Donna ruled it in Trish's session; none of the ruled items is in the specification text on `main` yet.

| Gap | Needed by | Needed before | State |
| --- | --- | --- | --- |
| Query and count have no catalog operations | query | query's drill; its completeness row starts red | Open |
| Annotations on Links | annotations | annotations' drill | Open, Trish's design. Labels stay revising "for now" (ruled), so packet 35 §1's row is out of date |
| Events table never replicates; per-clone replay | events | events' first checkpoint | Open |
| A server-sent stream in the Events profile | events | events' last checkpoint | Open |
| `beadAggregate` outside minimum Core | generic bead operations | that stage's go | Open |
| `id@revision` per resource | revision support | that stage's drill | Open |
| Pinned endpoints on Links | pinned references | that stage's drill | Part ruled 2026-11-06: a pinned Link survives deletion of its target when it keeps a live in-Scope endpoint |
| Version removal and its event | revision support, events | events' checkpoint on removals; revision support's drill | Events half ruled 2026-11-06. Historical-resolution half open |
| Aliases on the wire for memory keys | aliases | that stage's go | Ruled 2026-11-06 (packet 37). The alias inventory follows the Events work |
| User-defined Link Types | user-defined types, schema and constraints | schema and constraints' drill | Open |
| The delete design (packet 35 §7 item 11) | generic bead operations | `deleteBead` landing | Ruled. Drill complete 2026-11-07 |
| Events coverage equals Transfer coverage (item 12) | events | events' go | Ruled 2026-11-06: one generic non-Resource fact |

## 3. The pin

**Carrier.** `bdp.pin`, one line, the full bdp SHA, at the beads root. It doesn't exist yet. Until it does, `coreSpecRevision` in `internal/httpapi/bdp_core.go` is the only trace of a pin, and it names `7620a095`.

**It moves when:**

- a stage needs newly declared text;
- a wire break lands (§4);
- at every declaration that touches a profile beads implements, and otherwise at least every two weeks (packet 13 §3). Forward only.

**Who.** The beads side opens the bump PR, because Beads chooses when to upgrade its pin (stabilization plan). Trish names the target commit and reviews.

**What moves with it:**

| Thing | How |
| --- | --- |
| `bdp.pin` | Edited in the bump PR |
| `coreSpecRevision` | Derived from the pin (F-6) |
| Conformance expectations | Nothing to edit: G3 reads the rows, kit and manifests at the pin |
| `bdp` client | Nothing to edit: built from bdp at the pin |
| Wire goldens, generated types, `callables_table.go` | In the bump PR, only as the new pin requires |
| Reverse lane | Trish bumps it after the beads commit lands (§6.4) |

**A beads PR and a bdp PR that depend on each other:**

1. Work on both as drafts at the same time. The beads draft may point `bdp.pin` at the bdp branch commit while it is developed.
2. The bdp PR lands first, on `main`. bdp uses merge commits (`Merge pull request #367`), so the branch commit stays reachable from `main`. Never squash a commit a pin names.
3. The beads PR then points at that commit, passes G3 there, and lands.
4. bdp never waits on beads. The reverse lane is non-required, so no cycle can form.
5. A finding from building goes to bdp as a finding (§5), and beads bumps forward after the answer.

### 3.1 Keeping a pin target reachable

Pushes to `gastownhall/bdp` have been refused since Donna's account left the organization when a 2FA policy took effect. Live: `permissions.push` is false, and membership for `donnabox` answers 404. Three spec and client commits the sprint needs (`e89c0b0c`, `7620a095`, `01a5cf46`) exist only on this machine, and GitHub answers 422 for each. `donnabox/bdp` doesn't exist. So G3 can't check out its pin today, and #374's `coreSpecRevision` names a commit nobody else can fetch.

**Recommended, not ruled (F-5):** three rules, because the flow should never again depend on one person's access to a pin. (1) An upstream proposal may only pin a commit reachable from `gastownhall/bdp` `main`. (2) Staging may also pin a commit on `donnabox/bdp`, a public fork used only as a read mirror, tagged `pin/<sha>` so it is retained, with the matching bdp PR open or queued. G3 takes the repository from fork-only workflow config, so upstream never sees it. A loss of access then stops proposals, not staging. (3) `gastownhall/bdp` has at least two accounts with Write, one of them a dedicated account with a passkey held by Donna, and an organization owner confirms it. Creating the mirror and asking for the second account are Donna's to do or approve. The realistic alternative is what stands today: G3 waits for the re-add, which is simplest and leaves the same single point of failure in place.

**Recommended, not ruled (F-6):** the pin check derives `coreSpecRevision` as the last commit at or before the pin that changed a canonical source, and fails on any other value. [Core defines `specRevision`](../../specs/profiles/core/core.md#discovery-and-capabilities) as the latest commit that changed Core, Write, Types or Events, so it can differ from the pin. It already does: `7620a095` changes only the Issue documents, and Core's definition at that commit gives `3edfc711`. The alternative is widening Core's definition to cover selected Types such as Issue, which is a semantic change for Donna. Either way, today's value matches neither reading until she picks.

## 4. Re-pin procedure

For a pin move that changes what `bd serve` answers. Link identity is the one planned wire break, so it's the example: a Link gets its own ID, can be shown, updated and deleted on its own, and `bd serve` stops serving the projected operations (`projectedLink` and the others, packet 35 §4). Its drill hasn't happened, so details may change. It needs revision support and generic link operations landed first.

**Recommended, not ruled (F-7):** take every break in three moves, expand, flip and contract, because a pin move then stays a small reviewable PR, each side of it passes G3 at its own pin, and reverting the flip restores the old behavior. Packet 13 §3 allows "the pin change plus the smallest implementation change the new pin requires", and §8's file allowlist has no room for the second half; packet 36 §2 says "nothing else". This recommendation keeps 13 §3 and adds a declared allowance to the pin check (§6.3). It also treats reverting a flip on staging as a revert rather than a backward bump, which the "forward only" rule doesn't otherwise address. The realistic alternative is one large PR carrying implementation and pin together, which is simpler to sequence, cannot be a few hundred lines, and upstream won't review it.

| # | Side | Who | What | Must hold |
| --- | --- | --- | --- | --- |
| 1 | Both | Donna, Britt, Trish | Drill writes down what breaks, what stays and what a client sees | Donna's go |
| 2 | bdp | Trish | One PR series into `main`: any text change, conformance rows and catalog entries, kit cases, reference, `bdp` client. Commit C. Declaration | bdp CI green at C. The old pin's bytes and meaning are untouched |
| 3 | bdp | Trish | Note in the PR that the reverse lane goes red at C until step 7, and why | The lane is non-required |
| 4 | beads | Implementer | Expand slices: Link IDs allocated, new routes present but unadvertised, projection still served | G3 at the old pin green. G2 clean. A non-required G3 at C shows rows turning green |
| 5 | beads | Implementer | Flip PR `bringup/pin-<C>`: `bdp.pin` to C, derived `coreSpecRevision`, advertise the new shape, stop serving projection, goldens as needed, the http backend's calls, a decision record | Pin check. G3 at C green. G3 at the old pin recorded on the base. G2: any difference on a v0 path or in `bd` not named by the record fails |
| 6 | beads | Implementer | Contract slice: projection code removed | G2 and G3 green. Debt rows closed |
| 7 | bdp | Trish | Reverse lane moved to a commit containing the flip | Nightly green |
| 8 | Both | Trish, Britt | Completeness table and evidence at both pins | §7 |
| 9 | Upstream | Donna's "post" | Same order, one PR each, pin at `gastownhall/bdp` `main` | §3.1, F-5 |

If step 5 fails on staging, fix forward on its branch. If it lands and proves wrong, revert the flip alone: the expand slices are inert. Upstream's rule applies after a revert in a sync-critical area: stop and open an issue.

A differential run at both pins is what packet 13 §9 asks for across a graph-policy change, so it applies to every flip.

## 5. The iterative profile review

Events is built on today's issue-only Beads in the generic shape, and its profile learns from it. Transfer follows later, against real files. Building must not stall on the spec, and the spec must not chase the build.

**Recommended, not ruled (F-8):** the rules below bound it, because a finding must cost something to raise and have a date to land. The realistic alternative is a fixed two-week review with whatever has accumulated, which is simpler but gives no reason to close anything and invites exactly the weekly reopening Britt asks about.

1. **A finding is one row:** what was built, what the text says, and the scenario that shows the gap. It goes to Trish, who keeps it in the profile's open-question appendix, since one writer owns the file. Nobody else edits the profile.
2. **The drill names the checkpoints.** For events, I suggest three: first stream from the issue paths; replay and retention; coverage of every Transfer family and every removal fact.
3. **Each checkpoint is one sitting with Donna.** Trish brings the batch. What comes out is text, its scenario, and a pin.
4. **Between checkpoints, the stage builds on the reading it has,** unadvertised, and nothing reopens. The one exception is a stop finding: a slice can't be built without a ruling, or it would lose data. A stop finding goes to Donna at once and stalls only that slice.
5. **A section closed at a checkpoint reopens only on a failing scenario or Donna's word.** No scenario, no reopening.
6. **A checkpoint's findings all close before the next starts:** answered, or moved to [`specs/deferred.md`](../../specs/deferred.md) with their revisit condition.
7. **The last checkpoint ends it.** The profile section is declared, G3 reads it at the pin, the capability is advertised, and the completeness row goes green.

Transfer uses the same rules, with real exported files as its scenarios.

## 6. The gates

| Gate | What runs it | What it checks | On failure | State, 2026-11-07 |
| --- | --- | --- | --- | --- |
| G1 Upstream CI | `pr.yml` and `pr-risk.yml` on the fork; required name `CI Gate / Required` | Lint, vet, Bazel tests, migration hygiene | PR stays draft. If the same job is red on `upstream-main`, say so in the PR; never rerun to green or weaken it | Triggers fire. No job has run (§6.1) |
| G2 CLI surface | Job `G2 CLI surface` in fork-only `bringup-gates.yml` | Help tree, flag inventory, goldens and default wire behavior, base against head | Exit 1: fix, or add a decision record. Exit 2, could not compare: fix the run; no record waives it | Written, uncommitted, never run in CI |
| G3 Conformance at the pin | Job `G3 conformance at the pin`, same file | The bdp suite at `bdp.pin` against `bd serve` on a fresh workspace | Fails the PR. A spec defect becomes a finding, never a workaround | Not built. Blocked on §3.1 |
| Pin check | Job `Pin check`, same file | §6.3 | Fails the PR; split it | Not built |
| G4 Shape | Checklist, read by Britt | One issue, one layer, a few hundred lines, revertible, title names the riskiest thing | Split it | By hand |
| G5 Review | Council of Claude, Codex and Gemini; Donna for any semantic choice; upstream maintainer on the upstream PR | The diff, against the requested behavior | Fold the findings; semantic ones go to Donna | By people. GitHub requires 0 approvals, and every agent pushes as one account, so GitHub can't count this. Britt holds it |
| G6 Contract | `TestCorpusGolden` in `cmd/bd/protocol`, inside G1; G2 also reads its corpus | The `bd --json` corpus consumers vendor, byte for byte | A corpus change needs a decision record, and a named consumer impact | Exists upstream |
| Nightly | G2 and G3 dispatched on `bringup-staging` | The whole wave; F-10 | Opens a fork issue. Britt owns it | Not built |
| Drift check | §6.5 | Staging, mirror and fork-only commit current | Opens a fork issue. Britt owns it | Not built |

### 6.1 G1 on the fork

The fork-only commit `d52abf4a3` added `bringup-staging` to the triggers, and the workflows now fire on #374. They don't run. `Scope` is the first job in both, and its `runs-on` picks `blacksmith-2vcpu-ubuntu-2404` for a same-repository PR. The fork has no such runner, so run [42352965477](https://github.com/donnabox/beads/actions/runs/42352965477) has sat queued since 07:50 UTC. A PR run on this fork on 2026-11-02 did run, on `ubuntu-latest` and `windows-latest`.

**Recommended, not ruled (F-9):** extend the fork-only commit to replace the Blacksmith labels with GitHub-hosted ones in `pr.yml`, `pr-risk.yml` and `bazel.yml`, and to patch `TestSameRepoBlacksmithRunners`, which pins that expression. The fork is public, so hosted minutes cost nothing, and upstream's expression already falls back to `ubuntu-latest` for a genuine fork. The cost is a larger commit to replay, with lanes slower than upstream's. I have not tried this, and some Bazel lanes may need adjusting. Realistic alternatives: install Blacksmith on the fork, which matches upstream's speed at a cost I couldn't check; or open slice PRs from a second repository, which takes the fork path but leaves the literal Windows labels queued.

### 6.2 The CLI-surface job

What I describe is the draft in Trish's G2 worktree, read and not run.

- **Base and head.** It builds `bd` at the merge base with `bringup-staging` and at the PR head. There is no separate snapshot: the base is rebuilt each run. Packet 13 §8's committed snapshot is replaced by this.
- **Snapshots in the tree.** `cmd/bd/testdata/command_tree/` and `cmd/bd/protocol/testdata/corpus/` hold what the binary can't show: hidden commands and flags, and the `bd --json` corpus. The job reads their diff.
- **Help and flags.** Walked from both binaries, with a floor of 100 commands so that a broken walk can't pass (307 commands on 2026-11-06).
- **Wire.** `scripts/bdp-call-parity/wire_proof.py` compares default-path requests, headers, answers, stdout, stderr and exit codes.
- **Accepted.** `scripts/bringup-gates/g2_exceptions.json` holds Donna's accepted exceptions. Widening it fails unless the PR adds a decision record.
- **Findings** have IDs. A record the PR adds under `engdocs/decisions/` names what it accepts on a `G2-waives: FINDING-ID` line.
- **A PR changing the gate itself** gets a note in the report. G5 reads it.
- **Budget.** 60-minute job limit. Not yet measured in CI.

**A decision record contains:** the finding IDs; what a `bd` user sees change; the ruling, with who and when; why it is curated; how to revert it. It can be five lines. Packet 35 says proposal R31 alone produces one per row, so it has to stay this cheap. It goes upstream with its slice, because upstream has `engdocs/decisions/`.

**Recommended, not ruled (F-10):** three things. (1) Per PR, compare with the merge base as the draft does, and nightly compare the whole of `bringup-staging` with `upstream-main`, requiring every difference to be named by a record on staging; the brief says "byte-identical to the mirror", and only the nightly run measures that across a wave. (2) Name records `engdocs/decisions/YYYY-MM-DD-<slug>.md`, upstream's own form, over packet 13's `bdp-cli-conflict-*.md`. (3) Keep `scripts/bringup-gates/` and `scripts/bdp-call-parity/` fork-only: the harness is 3,700 lines in #374's branch today and can't meet upstream's size rule. That changes the draft: it runs the gate from the PR head and reads the exceptions at the merge base, and a slice branched from `upstream-main` has neither, so the job must take both from `bringup-staging`. The realistic alternative on (3) is proposing the harness upstream as its own PR, which gives upstream the proof and needs a maintainer to want it.

### 6.3 The pin check

It runs on every PR and always reports, because a required check that doesn't report blocks forever. If `bdp.pin` and the Go module line are unchanged, it passes. Otherwise it checks:

- The changed files are `bdp.pin`, `go.mod`, `go.sum`, a vendored tree, the `coreSpecRevision` line, or paths named on `Pin-requires: PATH` lines in a decision record the PR adds (F-7).
- The new pin descends from the old one.
- The new pin is fetchable from an allowed repository (F-5).
- `coreSpecRevision` matches (F-6).

### 6.4 The conformance job

**Recommended, not ruled (F-11):** yes, run the TypeScript driver on the fork's staging CI until the Go one exists, as packet 13 §8 allows, because no Go driver or `go/` directory exists on bdp and Donna's ruling already says the fork carries G3 if upstream refuses a Node step. An upstream PR then cites the staging run. The realistic alternative is building the Go driver first, which is what upstream CI will eventually need and which would hold every stage for it.

Steps, for the job as it should be built:

1. Read `bdp.pin`. Check out bdp at that commit.
2. `pnpm install --frozen-lockfile` and `pnpm build`, on the Node and pnpm versions bdp pins.
3. Build `bd` at the PR head. Install the pinned Dolt with `scripts/ci/install-dolt.sh`.
4. Make a fresh workspace, seed it with `bd`, and start `bd serve --protocol both`.
5. Run `scripts/current-provider-kit.mjs --scope URL`, with `--allow-mutation` once Write is advertised.
6. Run `scripts/bdp-client-e2e.mjs`, for the dual rule. It exits non-zero only when its harness breaks, so the job must read its anomalies.
7. Run `check_spec.py --spec` against the checkout, which compares `callables_table.go` with the declarations both ways. It is in no CI today.
8. Upload the reports. Fail as F-12 says.

`--scope` and the not-applicable handling for a Core-only provider are on Trish's local conformance branch (`aaa464bf`), not on `main`.

**Recommended, not ruled (F-12):** the job reads the kit's JSON rows, because the [kit has no exit 0 path](../current-provider-kit.md): a successful slice exits 2. A row fails the job if it is `fail` or `harness-error`, or `not-run` while required and not on the kit's own uncovered list at that pin. A `not-applicable` row passes only if the capability is absent from the stage's declared list, a small file the job reads: otherwise a bug that stops advertising a capability would turn its checks off and go green. `--scope` leaves durability and graph cases `not-run`, so a beads-side provider adapter comes with generic bead operations, the first stage that advertises Write. The realistic alternative is packet 13's plain reading, discovery alone decides what applies, which is simpler and has that hole.

**The reverse lane.** Packet 13 decided a non-required nightly lane on bdp, at a beads tag carrying BDP. What exists is the `realbd` group in bdp's PR CI, at `steveyegge/beads` `v1.0.5`, with no schedule.

**Recommended, not ruled (F-13):** add a separate nightly workflow building `bd` at a named `bringup-staging` commit until a beads tag carries BDP, and leave `realbd` alone, because no such tag exists and `realbd` covers older read obligations. Add it before the first flip at the latest. Trish moves it after each bump. It keeps a beads reference in the spec repository, which Donna reserved on. The realistic alternative is no lane until a tag exists, which leaves bdp blind to beads until upstream has merged BDP.

### 6.5 Keeping `bringup-staging` current

It drifted 40 commits behind in about four days, with empty required checks, and nothing said so.

**A rebuild:**

1. Confirm `upstream-main` matches upstream `main`. An hourly launchd job on Donna's Mac moves it; both were at `8c3eb30f3` at last read.
2. Reset staging to `upstream-main`.
3. Replay the fork-only commits.
4. Replay, in order, squashed slices that upstream hasn't merged. On a conflict, stop and report.
5. Push as an admin.
6. Read back: ahead and behind counts, and required check names (F-15).
7. Open PRs update their branches.

Step 5 hasn't been tried. The one rebuild so far was a fast-forward. Protection reads `allow_force_pushes: false`, `enforce_admins: false`. If admin force-push is refused, the choices are to lift it briefly, which is Donna's, or to merge `upstream-main` in rather than replay.

**Recommended, not ruled (F-14):** Britt owns the rebuild, on Donna's standing word, within 24 hours of the mirror moving, before any slice merges, and after any of our slices merges upstream. Every rebuild reruns G2 on each open PR, so hourly would be costly. Keep the replay commits on a protected fork branch `bringup-fork-only`, because today they live in one local worktree. Add a drift check, a scheduled fork workflow that opens one issue when staging or the mirror lags over 24 hours or the fork-only commit is missing. GitHub runs schedules only from the default branch, so this means one file on the fork's dormant `main`; it also dispatches the nightly G2 and G3. Britt reads that issue. The realistic alternatives are running the check from the hourly launchd job, which needs no change to `main` but stops when the Mac sleeps; or rebuilding only before a landing, which is cheapest and is how the drift happened.

### 6.6 Making checks required

GitHub offers a check for requiring only after it has reported. `bringup-staging` and `upstream-main` both have an empty list today. So the order for each gate is: the job lands in the fork-only commit, reports once on #374, then its name goes on the list. A rename means changing the list in the same step, because a required name that stops reporting blocks every PR.

**Recommended, not ruled (F-15):** four required names on `bringup-staging`: `CI Gate / Required`, `G2 CLI surface`, `G3 conformance at the pin`, `Pin check`. Britt adds them on Donna's standing word, and step 6 of every rebuild reads the list back and reports any difference, since an empty list is what hid the last failure. No job among them is path-filtered. Changing protection is an account setting, so the realistic alternative is Donna doing it herself each time, which keeps the authority with her and adds a wait.

## 7. Evidence and who says done

A claim counts when it carries the commit, the command or run link, the count, and what wasn't run. It must be at the current head. A number from another head is history: #374's wire proof is at `96d3b2104`, and its head is `9352c81be`. Its body says so, which is the right way to show it, and it isn't yet evidence for that head. Numbers recounted from raw captures by a second agent beat numbers the builder reports.

A stage shows:

| What | Measure |
| --- | --- |
| G1, G2, G3, pin check | Run links at the stage's head on staging |
| Identical v0 behavior | Wire proof counts at that head: compared, identical, explained, unexplained (must be 0); server requests different |
| Every `bd` change | One decision record per finding |
| The twelve checklist rows | Touched or not applicable, each with its reason |
| Export and import | `bd export \| bd import` round-trips the stage's data, and what imported before still does |
| Routing and guards | The stage's own tests, such as `bd create --type memory` never entering issueops |
| BDP completeness | The table of §2.3 at the pin, with run links |
| Proposal mapping | The R and S rows of packet 35 §10 the stage satisfies, each with its check |
| Not done | Empty, or each row a bead with an owner |

That last row is how the third requirement gets enforced. The sprint's examples: `remoteOnV0` was deleted, and `backend/http/target.go` keeps exported Protocol aliases with no in-repo caller, which is still to be decided.

**Recommended, not ruled (F-16):** keep a fork-only branch `bringup-evidence`, never rebuilt, with `stages/<stage>.md` holding the table above and the JSON reports, and raise artifact retention from 14 to 90 days for raw captures. A PR body links to it. Staging is rebuilt and CI artifacts expire, so neither can hold the record. The realistic alternatives: PR bodies alone, which is lighter and loses raw data in 14 days; or `agent-memory`, which is durable but private.

**Recommended, not ruled (F-17):** the implementer says "ready". Britt merges slices into `bringup-staging` after G5, while Donna's go stands, and answers for the eleven other checklist rows. Trish alone says the BDP completeness row is green. Donna alone says a stage is done on staging, and says "post" for the proposal. A stage is done when upstream has merged its last slice, its conformance rows pass on upstream `main`, and the declaration is made. Packet 35 §8 already has Trish reviewing the row; the rest is new. The realistic alternative is Britt saying done on staging and Donna reading only exceptions, which is faster and takes her out of a call she has kept so far.

## 8. Found along the way

Settled: work found while building that isn't the stage goes on a list, gets a yes or no per row, and takes its own PR. The sprint's list has 31 rows. On 2026-11-07 Donna answered: A1 no; B1 to B16, C1, C2, D1 to D8 and E1 to E4 yes, as separate work with one PR-ready local branch per group, out of the landing. Upstream wants one issue per PR, so a group may split when proposed.

A row carries: command or behavior, what the base does, what the fix does, source commits, files, size, and whether it worked at base.

- A yes gets its own branch, its own G2 record, and its own upstream issue. It applies on both protocols.
- A no is recorded with its reason. The source commits stay reachable.
- G2 is the guard. A fix left inside a stage's slice shows up as a finding with no record.

**Recommended, not ruled (F-18):** one list per stage at `fixes/<stage>.md` on the evidence branch; Britt asks Donna for its answers at each stage check. An undecided row blocks nothing unless the stage's acceptance depends on it. Fixes land on staging as their own slices and stay out of a stage's numbers. The realistic alternative is one bead per row in the issue graph, which fits packet 35 §11 and adds about thirty beads before the graph exists.

## 9. Conformance users reporting back

Chris, a real external provider author, was blocked because the public kit required Write right after discovery. It took two days to reach us, by a direct message. The kit's fix is on a local branch (`aaa464bf`), and no reply has gone to him. Nothing routes such a report today: bdp has only GitHub's default labels and no issue forms, and packet 13's "fixed label" was never created.

**Recommended, not ruled (F-19):** when bdp access returns, add an issue form and a `conformance-report` label on bdp, and have the kit's report and its guide name them, because the moment someone is blocked is when they read that output. Trish watches, checking at each working session, and the bar is a first answer within one working day. Until Donna lifts the message rule, Trish drafts and Donna posts. Each report becomes a kit case or a spec finding, and a read-only provider case stays in bdp's CI so that this class can't recur. The realistic alternative is a shared channel with Donna, which is lighter and leaves reports private and dependent on her reading it.

## 10. The rehearsal, as a worked example

Read 2026-11-07. "Done" means I could verify it, or Trish's decision log records it with its source.

| Step of the flow | State | Detail |
| --- | --- | --- |
| Native fixes separated from the landing | Done | 31 rows; Donna answered by group 2026-11-07; branches are local |
| Wire proof, by hand | Done, at an older head | `96d3b2104`: 1,190 of 1,193 client runs identical, 3 query order, 0 unexplained; server 0 of 570 different. Recounted from raw captures |
| Staging caught up | Done | Fast-forward to `8c3eb30f3`, then `d52abf4a3`. Read back: 1 ahead, 0 behind |
| Draft PR into staging | Done | #374, head `9352c81be`, 42 commits, 59 files |
| Upstream workflows triggered | Done | PR and PR Risk fired |
| G1 result | **Not happened** | Queued on Blacksmith, still queued at the last read, 08:21 UTC (F-9) |
| G2 as a job | **Not happened** | Written in a local worktree and uncommitted; review comes before the push |
| `bringup-gates.yml` on staging | **Not happened** | Staging's one fork-only commit changes only the two trigger lines. Pushing G2 after review is owed |
| Kit runs a Core-only provider | Partly | `aaa464bf`, local, unpushed |
| Scenario catalogs | Partly | 16 and 17 citation rows, uncommitted in the conformance worktree. No runner executes them against `bd serve` yet |
| Reference serves Callables | Partly | `2778dba1`, local, unpushed |
| Pin | **Not happened** | No `bdp.pin`. `coreSpecRevision` names a commit not on GitHub |
| G3 | **Not happened** | Needs the pin reachable (F-5) and the job built |
| Required checks | **Not happened** | Required list empty on staging, read back |
| Wire proof rerun at #374's head | **Not happened** | The merge changes only CI files, per #374's body; the rule of §7 still asks for it |
| Part B parity at head | Not verified | Owed; a detached worktree at that head exists, and I don't know its state |
| Rebuild, non-fast-forward | **Not happened** | §6.5 |
| Declaration for the sprint | **Not happened** | §2.1 |
| Donna's manual passes | **Not happened** | First and second passes not started, per #374's body |
| Merge into staging, then proposal | **Not happened** | #374 isn't in upstream's shape. Cutting 59 files into PRs of a few hundred lines is the step nobody has tried yet |

What it has taught so far, each absorbed above: upstream's triggers skip a staging branch; a branch nobody owns drifts silently; empty required checks read as green; triggers aren't runners; a pin depends on someone's access; the kit blocked an outside author; and fixes found while building want their own decisions.

## 11. Order of the first flow work

**Recommended, not ruled (F-20):** alongside, with a hard line at landing. Generic bead operations and events may drill, shred (on Donna's word) and build on branches now, but no slice of theirs lands on `bringup-staging` until G1, G2, G3 and the pin check have each reported on #374 and are required. Packet 35 §8 lists the gates before any stage, and the hub stage must not escape conformance and be retrofitted. Waiting to start would idle implementers on a blocker outside the flow, since G3 hangs on bdp access. The realistic alternatives: jobs strictly first, which is simplest and costs days if the re-add is slow; or fully alongside, which lets generic bead operations land before G3 exists.

The order inside the flow:

1. G1 running on the fork (F-9).
2. G2 reviewed and pushed in the fork-only commit, with the harness (F-10).
3. Pin target reachable (F-5), then the sprint's declaration and `bdp.pin`.
4. Pin check and G3 built, reporting on #374.
5. All four names required (F-15); the drift check and `bringup-fork-only` in place (F-14).
6. Rerun the proof at head, and finish #374's rehearsal through Donna's manual passes.
7. Nightly runs and the reverse lane (F-10, F-13).

## 12. Where this differs from the packets

| Packet says | Live fact |
| --- | --- |
| 13 §8: G2 compares with a committed snapshot; records are `bdp-cli-conflict-*.md` | Draft G2 rebuilds the base and reads goldens; any added `.md` under `engdocs/decisions/` with a `G2-waives:` line counts |
| 36 §2: byte-identical "to the mirror" | Draft G2 compares with the merge base on staging (F-10) |
| 36 §2: a pin PR "changes nothing else" | 13 §3 allows the smallest implementation change; 13 §8's allowlist doesn't (F-7) |
| 13 §5: council "per the fleet's `RULES.md`" | `RULES.md` doesn't mention it; the council is in `agent-memory` `common/rules.md` |
| 13 §3 rule 5: a non-required nightly lane | PR-time `realbd` group at `steveyegge/beads` `v1.0.5`; no schedule |
| 13 §3 rule 4: an issue "with a fixed label" | Only GitHub's default labels on bdp |
| 13 §3: declarations by tag and README line | No `spec/*` tags; no Declarations heading |
| 13 §10: "protection on `main`" | The API reports bdp `main` unprotected; the only ruleset guards tags |
| 13 §5: G1 runs in the fork on staging PRs | Queued on Blacksmith; no job has run |
| 13 §8: G3 fails on an applicable row not passing | The kit has no exit 0 path; G3 has to read rows (F-12) |
| 35 §5: profile text "normative and not proposed" | Every profile's front matter is draft (F-3) |
| 35 §1: labels attach "without revising" | Ruled 2026-11-06: labels stay revising "for now" |
