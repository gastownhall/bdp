# `bd` baseline observations

Non-normative baseline evidence.

`observations/` pins what one exact `bd` binary actually does on the read paths the
BDP readiness proof depends on: version, list, show, dependencies, and ready.
Everything here is black-box command output. Nothing reads `bd`'s database, and
nothing here binds a BDP wire shape, schema `$id`, or problem URI.

## `bd ready` is an oracle, not an implementation

`bdpbd` **must not** delegate readiness to `bd ready`. Readiness is client-owned
domain behavior computed from generic BDP Beads and Links, exactly as it will be
against `bdptest`, which has no `bd` behind it at all. If the adapter forwarded
the question to `bd`, the Wave 3 proof would compare `bd` against itself.

These observations exist so the client's own computation can be *checked* against
`bd`'s answer over a corpus that can actually tell a wrong implementation apart
from a right one — see "What each case discriminates" below.

## The pinned binary

`observations/00-identity.json` splits identity into two groups, because they mean
different things when `verify` runs on another machine.

**Portable** — the release. Comparable on any host; a difference here is drift.

| field | value |
| --- | --- |
| `bd version --json` | `version 1.0.5`, `schema_version 1`, `branch v1.0.5`, `build Homebrew` |
| `bd --version` | `bd version 1.0.5 (Homebrew)` |

**Host-local** — this machine's copy of that release. These cannot match anywhere
but the capture host, so `verify` reports a difference as a note and does not fail.

| field | value |
| --- | --- |
| resolved from `PATH` | `/opt/homebrew/bin/bd` |
| real path | `/opt/homebrew/Cellar/beads/1.0.5/bin/beads` |
| SHA-256 | `2fff6a2dc534cf8b56ec1f7a0c98b1e8509a0a5408905c420769a7213ee34707` |

### Provenance is deliberately incomplete, and drift-checked

What is observable on the capture host, and nothing more:

```
brew info --json=v2 beads          # tap homebrew/core; installed keg 1.0.5
/opt/homebrew/Cellar/beads/1.0.5/INSTALL_RECEIPT.json
                                   # {"source":{"tap":"homebrew/core","spec":"stable",
                                   #   "versions":{"stable":"1.0.5"}},"poured_from_bottle":true}
```

So: a `homebrew/core` bottle for `beads` 1.0.5, poured rather than built locally.

**Which sources produced that bottle is unverified.** `bd version --json` reports
a `branch` and a `build` channel, but those are claims the binary makes about
itself, not proof; the receipt records no upstream URL for the installed version,
and the formula's current metadata describes 1.1.2, not 1.0.5.
`gastownhall/beads` is cited by this project as *design evidence*; this
baseline does not assert it as the origin of this binary, and no command run here
would prove it either way.

The observation file carries that caveat inline as `source_provenance`, and
`verify` compares it like the portable group rather than ignoring it: if a future
`bd` starts proving its origin, that is a change to read, not to re-capture past.

## Reproducing

```
pnpm baseline:verify                   # fail if the installed bd drifts
node scripts/bd-baseline.mjs capture   # rewrite observations/
```

Both need a local `bd`. **`verify` is deliberately not in CI**: the Linux CI image
has no `bd`, and installing one there would either pin a different build or make
the oracle depend on whatever the runner resolves. It is a local gate, run by hand
before touching this evidence.

### Isolation

The script creates a throwaway workspace *and* a throwaway `HOME` under the system
temp directory, pins the git identity `bd` reads for `owner`, seeds the topology,
captures the outputs, and deletes both directories.

`bd` runs with an **allowlisted environment**: `PATH` and `TMPDIR` are inherited,
`HOME`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `BD_NON_INTERACTIVE`, and `CI`
are pinned, and nothing else is passed. Dropping everything else is what scrubs
`BD_*`, `BEADS_*` (including `BEADS_ACTOR`, which would choose the audit
identity), `DOLT_*`, and Git's routing variables (`GIT_DIR`, `GIT_WORK_TREE`,
`GIT_CEILING_DIRECTORIES`, and the rest), any of which could otherwise point a
capture at a real database. An allowlist cannot miss one the way a denylist can.
`PATH` is inherited deliberately: it selects which `bd` runs, and the binary it
resolves to is recorded as host-local identity.

Every command also passes `--actor bdp-baseline` explicitly, rather than letting
`bd` walk its fallback chain of `$BEADS_ACTOR`, then git `user.name`, then
`$USER`. The recorded actor is a property of this script, not of the host.

**Cleanup and interruption.** Both temporary directories are created inside the
`try` whose `finally` removes them, so a failure anywhere after the first
`mkdtemp` — including while writing the pinned gitconfig — still cleans up, and no
failure path calls `process.exit`. A **signal is different**: Node's default
SIGINT/SIGTERM disposition terminates the process without unwinding, so Ctrl-C
during a capture leaves the two `bdp-bd-*` directories behind under the OS temp
directory. They are inert — an isolated `HOME` and a throwaway workspace, never a
real database — and are reclaimed by normal temp cleanup. No handler is installed,
because one that raced the running `bd` child could leave a half-written workspace
that looks like a finished one.

### What is normalized, and why

Only two kinds of transformation are applied; every other byte is `bd`'s own
output.

1. **ISO-8601 timestamps** become `<TIMESTAMP>`.
2. **Dependency-edge order** is sorted — see finding 5. JSON edge arrays sort by
   `(depends_on_id, type)`, top-level `dep list` results by `(id, dependency_type)`,
   the `Resolved blockers:` line in `--explain` alphabetically, and the inline
   `(blocked by: …, blocks: …)` lists in `list --flat` alphabetically within each
   label. The `dep tree` walk order is meaningful and is never reordered.

Creations are spaced just over a second apart because equal-priority beads are
ordered by descending creation time at one-second granularity — without the
spacing, the committed order would not be reproducible.

## Corpus

58 beads: 13 named beads carrying the semantics, plus 45 filler beads whose only
job is to push the population past `bd list`'s default limit.

After observations `00` through `23` are captured, the script adds one native
external dependency from `demo-a` to
`external:beads:mol-run-assignee`. Keeping that mutation last preserves every
established readiness observation while pinning three adapter-critical facts:

- `dep add --type related` spells the stored direction as `issue_id: demo-a`,
  `depends_on_id: external:beads:mol-run-assignee`, and `type: related`, without
  changing the readiness oracle through a newly blocking edge;
- `list --json` retains that exact opaque ID in the Bead's embedded
  `dependencies` array;
- single-Bead `dep list --json` omits the unresolved external dependency and
  returns `[]`, so the adapter must use embedded dependencies as its primary
  Link source.

```
  demo-a  open   P2                      demo-c  open   P1   (no links)
     ▲                                   demo-g  in_progress P2   (no links)
     │ blocks
  demo-b  open   P2                      demo-e  closed P2
     ▲                                      ▲
     │ blocks                               │ blocks
  demo-h  open   P2                      demo-d  open   P2

  demo-l  deferred P2   (no links out)
     ▲
     │ blocks
  demo-m  open   P2

  demo-i  open   P2  ──blocks──▶ demo-a (open) and demo-e (closed)
  demo-j  open   P2  ──blocks──▶ demo-e (closed) and demo-k (closed)

  demo-f  open   P2  ──related──▶ demo-a
                     ──discovered-from──▶ demo-b
                     ──tracks──▶ demo-c
```

`bd ready` returns `demo-c`, `demo-j`, `demo-f`, `demo-d`, `demo-a`. It reports
`demo-b`, `demo-h`, `demo-i`, and `demo-m` as blocked, and omits `demo-g` and
`demo-l` from both lists.

Two pairs carry the discrimination:

- **`demo-i` and `demo-j` prove the quantifier.** Both have a closed blocker, only
  `demo-j` has *no* open one, and only `demo-j` is ready. A client using "any
  blocker closed" instead of "every blocker closed" passes the rest of the corpus
  and fails here.
- **`demo-l` and `demo-m` prove that "not blocked" and "closed" are different
  things.** `demo-l` is deferred with no blockers at all and is still not ready;
  `demo-m`'s only blocker is `demo-l`, and `bd` reports it blocked even though
  `demo-l` is not open work either. A client that treated a blocker as satisfied
  once it left the `open` state would call `demo-m` ready.

### The readiness rule, and what bounds it

**A bead is ready when its own status is `open` and every `blocks` edge from it
points at a bead whose status is `closed`.**

Both halves are observed, and both are stricter than a plausible alternative:

- *the bead's own status* — `open` only. `in_progress` (`demo-g`) and `deferred`
  (`demo-l`) are both excluded, and neither appears in the blocked list either;
  they are simply absent. `bd ready --help` states the exclusion set as
  "in_progress, blocked, deferred, and hooked", pinned in `03-ready-help.txt`.
- *the blocker's status* — `closed` only. A `deferred` blocker still blocks
  (`demo-m`), so the rule is not "the blocker is not open" or "the blocker is not
  actionable".

**What this corpus does not establish.** The named beads cover `open`,
`in_progress`, `closed`, and `deferred`. `bd statuses` also lists `blocked`,
`pinned`, and `hooked` as built-in, and custom statuses are configurable. This
baseline says nothing about those three, in either position — as the bead's own
status or as a blocker's. `bd ready --help` claims `hooked` is excluded; that
claim is pinned as *text*, not confirmed by a bead. Extend the corpus before
relying on any of it.

`ready --include-deferred` is described as including "issues with future
`defer_until` timestamps". It was observed **not** to surface a status-`deferred`
bead, with or without a `defer_until` set. That flag is not used by any committed
observation and is recorded here only so it is not mistaken for an escape hatch.

### Limits are always passed explicitly

Every capture that could be truncated passes an explicit limit, so no observation
depends on a default this baseline does not control. The defaults themselves are
pinned as help text rather than asserted in prose:

- `bd list` defaults to `--limit 50` — `02-list-help.txt`. Observations `20`–`22`
  make the truncation visible; every other `list` capture passes `--limit 0`.
- `bd ready` defaults to `--limit 100` — `03-ready-help.txt`. **The corpus does not
  reach it**: only 5 beads are ready. `ready` is nonetheless always invoked with
  `--limit 0`, so the fixture cannot silently start truncating if the corpus grows.

Pinning the two help texts also means a release that changes a default, renames a
flag, or drops one fails `verify` instead of quietly changing what the oracle means.

### `--flat` is always passed explicitly

`bd list` renders a **tree by default** (`--tree` defaults to `true`), and the two
renderers do not produce the same bytes — or the same trailing summary, see
finding 1. Every deliberate `list` capture passes `--flat`, so the fixtures pin one
renderer rather than whichever one a future default selects.

## What each case discriminates

| file | command | a wrong client would… |
| --- | --- | --- |
| `00-identity.json` | — | — the pinned binary, split portable vs host-local, plus the provenance caveat. |
| `01-version.json` | `bd version --json` | — pins `version` and `schema_version`. |
| `02-list-help.txt` | `bd list --help` | — pins `--limit`'s default of 50 and the `--tree`/`--flat` default. |
| `03-ready-help.txt` | `bd ready --help` | — pins `--limit`'s default of 100 and the stated status-exclusion set. |
| `04-list-named.json` | `list --all --limit 0 --sort id --flat --id <named>` | — every named bead including the closed and deferred ones, for record shape across all four statuses. |
| `05-show-unblocked.json` | `bd show demo-a --json` | — the plain record shape, returned as a one-element array. |
| `06-show-blocked.json` | `bd show demo-b --json` | — `show` inlines each blocker's full record plus `dependency_type`. |
| `07-show-closed.json` | `bd show demo-e --json` | …miss `closed_at` and `close_reason`, present only on closed beads. |
| `08-show-deferred.json` | `bd show demo-l --json` | …expect a marker field for deferral; status-based `defer` sets `status: "deferred"` and adds no `defer_until`. |
| `09-dep-list-blocked.json` | `bd dep list --json -- demo-b` | — the outgoing edges of a genuinely blocked bead. |
| `10-dep-list-empty.json` | `bd dep list --json -- demo-a` | …treat a bead's *dependents* as its own edges; `demo-a` unblocks two beads yet returns `[]`. |
| `11-dep-list-dependents.json` | `dep list --direction up --json -- demo-a` | …assume `dep list` is blocker-only; the reverse direction returns `demo-b`, `demo-i`, and the non-blocking `demo-f`. |
| `12-dep-list-non-blocking.json` | `bd dep list --json -- demo-f` | …treat every Link as blocking; `related`, `discovered-from`, and `tracks` all fail to block. |
| `13-dep-list-closed-blocker.json` | `bd dep list --json -- demo-d` | …treat any `blocks` edge as blocking; a closed blocker does not block. |
| `14-dep-list-mixed-blockers.json` | `bd dep list --json -- demo-i` | …use "any blocker closed"; one closed and one open blocker still blocks. |
| `15-dep-list-all-closed-blockers.json` | `bd dep list --json -- demo-j` | …stop at the first closed blocker; readiness needs *every* blocker closed. |
| `16-dep-list-deferred-blocker.json` | `bd dep list --json -- demo-m` | …accept any non-`open` blocker as satisfied; this blocker is `deferred` and still blocks. |
| `17-dep-tree-transitive.json` | `bd dep tree demo-h --json` | …stop at depth 1; the walk carries `depth`, `parent_id`, `truncated`, and `edge_from_parent` on non-root nodes. |
| `18-ready.json` | `bd ready --limit 0 --json` | …include `demo-g` or `demo-l`; `in_progress` and `deferred` are excluded even with no blockers. |
| `19-ready-explain.txt` | `bd ready --explain --limit 0` | — `bd`'s own rationale for each verdict, including `demo-m`'s deferred blocker. |
| `20-list-default-truncated.txt` | `bd list --sort id` | …trust a truncated page, or its footer; see finding 1. |
| `21-list-default-truncated-flat.txt` | `list --sort id --flat` | …assume the renderer is cosmetic; the same truncated page under `--flat` has no footer at all. |
| `22-list-complete.txt` | `list --all --limit 0 --sort id --flat` | — the true population the truncated pages must be read against, with an empty stderr. |
| `23-list-complete.json` | `list --all --limit 0 --sort id --flat --json` | — the same population machine-readably, which is the form an adapter would actually consume. |
| `24-dep-add-external.json` | `bd dep add demo-a external:beads:mol-run-assignee --type related --json` | …reverse native `related` direction, make the observation blocking, or normalize the opaque external ID. |
| `25-list-external.json` | `bd list --all --limit 0 --sort id --flat --id demo-a --json` | …miss the only read surface that retains unresolved external dependencies. |
| `26-dep-list-external.json` | `bd dep list --json -- demo-a` | …assume single-Bead `dep list` exposes the unresolved external edge; this release returns `[]`. |

### What the non-blocking evidence does and does not cover

Only three Link types are observed not to block: `related`, `discovered-from`, and
`tracks`. The checked-in observations do not pin the complete `bd dep add --type`
vocabulary. Treating any other Link type as non-blocking is an assumption, not
evidence; if the adapter needs one, extend the corpus first.

## Findings for the adapter

1. **A truncated `bd list` warns only on stderr, and its footer — when there is
   one — is wrong.** At 58 beads, `bd list --sort id` prints 50 rows and the footer
   `Total: 50 issues (50 open, 0 in progress)`: a count of the page, presented as a
   count of the corpus, reading `0 in progress` even though `demo-g` is
   `in_progress` and was truncated away. Under `--flat` the same page has **no
   footer at all**, so nothing on stdout indicates truncation in either renderer.
   The only signal is the `hidden by --limit` warning on **stderr**, captured in
   both `20` and `21`. The adapter must pass an explicit limit, must read stderr,
   and must never treat a footer total as a population count.
2. **`dependency_count` is not `dependencies.length`.** `demo-f` carries three
   non-blocking dependencies and reports `dependency_count: 0`; `demo-d` reports
   `dependency_count: 1` for a `blocks` edge whose blocker is closed. The field
   counts `blocks` edges regardless of blocker status. It is not a readiness
   signal and must not be used as one.
3. **`dep list` is not a blocker list.** It returns every outgoing edge with a
   `dependency_type` discriminator, and `--direction up` returns dependents
   instead. Blocker semantics come from filtering `dependency_type: "blocks"` and
   then checking the target's status — two separate steps, neither optional.
4. **Result order is `bd`'s, not the protocol's.** `ready` orders by priority then
   descending creation time, which is what `18-ready.json` shows. Every `list`
   capture here passes `--sort id`, so **the fixtures say nothing about `list`'s
   default order** — they show only that `--sort id` is lexicographic on the whole
   id string, which is why `demo-f01` sorts between `demo-f` and `demo-g`. The tree
   renderer may also group children under parents, which this corpus has no
   parent-child edges to exercise. BDP conformance should compare sets, not
   sequences, and the adapter should pass `--sort` and `--flat` rather than infer
   an order.
5. **Dependency-edge order is nondeterministic.** The same corpus captured twice
   returns a bead's edges in different orders — observed in `dependencies` arrays,
   in `dep list` results, in the `Resolved blockers:` line of `--explain`, and in
   the inline `(blocks: …)` suffix of `list --flat`. The fixtures sort them so
   `verify` measures real drift, but the adapter must not assume any edge order.
6. **`--explain` text is for humans.** Fixed phrasing (`Reason: no blocking
   dependencies`, `Resolved blockers:`, `← blocked by <id>`) may be surfaced
   verbatim but must never be parsed.
7. **Timestamps are not reliably UTC.** A bead touched by `bd dep add` gets an
   `updated_at` in host local time carrying a `Z` suffix — observed as
   `created_at 2026-08-08T23:33:35Z` against `updated_at 2026-08-08T16:33:48Z`
   on a UTC-7 host. The committed fixtures normalize timestamps, so this is a
   recorded observation rather than something `verify` catches. The adapter must
   not treat `bd` timestamps as a trustworthy ordering or freshness source.
8. **A blocker leaving `open` is not a blocker being satisfied.** Only `closed`
   clears a `blocks` edge. `demo-m` stays blocked by a `deferred` bead, and a
   bead's own `deferred` status removes it from `ready` without putting it in the
   blocked list. "Not ready" and "blocked" are distinct answers, and an adapter
   that collapses them will misreport both `demo-l` and `demo-g`.

## Out of scope

Write paths, `bd`'s internal database, BDP wire behavior, and the AI, gate,
molecule, and swarm subcommands. Read+Update needs its own baseline once the
mutation contract is settled.

## Rebaselining

A candidate `bd` release is not adopted by editing this file. Install it, run
`verify`, and:

- **host-local note only** — expected on any machine but the capture host; not
  drift.
- **portable identity or provenance drift** — the binary is a different release,
  or it now says something different about where it came from. Read the shape
  drift, if any, before recapturing.
- **shape drift on any file above** — a finding to raise on the project
  tracker. Recapture only after it is reviewed, so a silent upgrade cannot
  move the oracle.
