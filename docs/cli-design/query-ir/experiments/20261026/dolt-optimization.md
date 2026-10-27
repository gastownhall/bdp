# Dolt lowering and checked-read optimization follow-up

October 26–27, 2026. Melinda, following Donna's request to investigate Dolt plans
before cutting Query capabilities. Exploratory measurements; no production patch.

**Recommendation: keep the tested operators. Fix the read interface and choose
plans from measured results.** No tested Memory operation required a semantic cut.
A fact-batching prototype reduced the checked backend read to about 0.61 seconds
while producing byte-identical output. Production work remains: replace its
whole-fixture preloads with bounded, precharged, authorized acquisition cohorts.

This follows the original `../dolt/REPORT.md` and `../sqlite-postgres/REPORT.md`.
Their reports, manifests and original EVIDENCE.zip remain unchanged.

## What was measured

The same retained disposable Dolt 2.1.8 fixture contains 1,000 Beads and 1,000 Links.
Qualified source is `210f8dad21945af85746a0eac74e6187d54a3735`. No tracked product
file, installed binary, qualified source checkout, dependency-mode path or pin
changed. Go overlays supplied experimental read hooks and two catalog wrappers;
the hooks were then moved out of ordinary product source. Reproduction requires
the overlay; this is not an installed implementation.

The checked experiment calls the existing `Store.ReadCurrentFamily` for the
Requires closure. It includes current/retained, metadata, properties, Type,
ownership and canonical record checks. It reuses successful Type facts only
within that read transaction. It is **backend-method time**, excluding Store
open/close, CLI dispatch, outer output framing and final JSON serialization.
The output hash covers the whole returned CurrentFamilyRead, including canonical
records, graph, writer token, Types and owned-Link metadata—not just selected IDs.

| Checked backend variant | Samples | Median | Database acquisition |
| --- | ---: | ---: | --- |
| Original algorithms, instrumented prepared driver | 1 | 29.81 s | 45,862 read calls |
| Same algorithms, interpolated bound parameters | 3 | 23.69 s | 45,862 read calls; 222,876 returned rows |
| Transaction-local identical SELECT-result reuse | 3 | 12.16 s | 13,243 uncached read calls |
| Also reuse checked Type catalogs within the transaction | 3 | 9.03 s | Same 13,243 uncached reads; less repeated catalog construction/parsing |
| Exact-template SQL rewrites without indexes | 3 | 26.91 s | Worse plan; do not adopt |
| Same rewrites plus target/public-ID indexes | 3 | 26.97 s | Still worse; indexes removed afterward |
| Batch facts and reuse the checked context | 7 | **605.81 ms** | 945 ordinary reads plus 22 batch reads |

A final-source original-algorithm repetition took 22.19 s and again issued exactly
45,862 read calls. All original/interpolated/batch success samples returned the
same 461 Beads / 500 Links / 961 records and complete-output SHA256:
`37dc2ed8668bca2c93ee81013d45352a3a24e47880c5405eb9ac6c2b2b12889f`.

The final batch samples ranged from 604.28 to 611.75 ms. Batch reads acquired
34,250 projected row instances across 22 reused shapes, approximately 4.10 MB of
value bytes; repeated projections are not distinct Resources. Ordinary SQL fetch
time was about 174 ms and batch fetch time about 52 ms in the first sample.
These are warm local, single-client measurements, not service tail-latency claims.

### What the batching prototype does—and does not prove

It keeps the existing reader and per-record checks. An experiment-only connector
supplies the same point-lookup results from transaction-local batches, groups
identical byte/count accounting facts, and groups the original incident relation.
Successful Type catalogs are checked once and reused in that same transaction.
There are no cross-request caches, new write paths, or changes to query meaning.
Ordinary SQL is still used for shapes not covered by the experiment.

The prototype deliberately acquires whole-fixture table projections. Its extra
batch maps are not covered by the small ordinary SELECT-cache cap. It does not
establish correct pre-acquisition charging, memory bounds, authorization or
performance on a large store with a small selected neighborhood. Production must
replace these shortcuts with explicit bounded cohorts, account their actual
acquisition before decoding, and preserve orphan/integrity discovery. A 0.61-s
checked *experiment* is not a qualified 0.61-s provider or installed Memory CLI.

### Refusal and equivalence controls

Seven negative controls compare original and batched execution:

- noncanonical current metadata;
- canonical current payload disagreeing with retained state;
- retained attribution disagreeing with its actor;
- malformed Link attribution;
- altered Type fingerprint (refused on open);
- exceeded byte budget;
- exceeded selected-Link budget.

All refuse; Read failures return zero records. Additional References, Defines and
succession closures produce byte-identical checked output in both variants.
A digest across the five touched authority/payload/version tables is identical
before and after all corruption controls. Both experimental indexes were removed,
and the original table definitions match byte-for-byte. These controls do not
qualify concurrent writers, historical pins, hidden Resources or cancellation
while a batch is being acquired.

## Lowering choices with substantial impact

### Prefer direct physical joins for this closure

The original 500-Link normalized-view closure took about 373 ms, and its outer
target-status join took about 9.03 s. Direct recursion over actual indexed
`graph_preview_links.source_path`, followed by catalog affiliation/liveness
checks, returned the same closure in about **6.7–7.0 ms** and the same 159-Link
status-filtered result in about **9.9 ms**.

This does not change `through` into `where`. Eligible Link Types restrict the
recursive step; target status is tested on the output Links. Known eligible Type
identities come from the recorded catalog closure, not URI-name guessing. Type
resolution, authority/integrity checks and final record hydration are separate
costs, not secretly included in those SQL timings.

The logical shape is:

```sql
WITH RECURSIVE reached(path) AS (
  SELECT :root_path
  UNION
  SELECT l.target_path
  FROM reached r
  JOIN graph_preview_links l ON l.source_path = r.path
  JOIN graph_preview_catalog lc ON lc.path = l.path
  WHERE lc.allocation_state = 'live'
    AND lc.type_url IN (:checked_requires_family)
)
SELECT DISTINCT l.path
FROM reached r
JOIN graph_preview_links l ON l.source_path = r.path
JOIN graph_preview_catalog lc ON lc.path = l.path
WHERE lc.allocation_state = 'live'
  AND lc.type_url IN (:checked_requires_family);
```

This is explanatory SQL. Actual parameterized SQL and arguments are preserved in
lowering-results.json. It is a current informational-Link pattern; native
Dependency branches must be included when the selected relation admits them.

### Bounded depth does not require `(node, depth)` recursion

For set-valued traversal, retain the shortest distance to a Bead and expand it
only when a shorter route permits more work. Parallel and back Links remain
separate results. A depth-1000 request need not keep re-enumerating the same cycle
at every depth. A single-adjacency BFS returned the expected bounded sets in about
1.5–1.6 ms after working-relation setup (about 19 ms, recorded separately).

That plan reads the whole small eligible working relation. Larger/sparser scopes
need frontier batches or a provider work table. It is an alternative physical
plan, not a reason to remove depth or to treat a cutoff as completeness.

### Nested quantifiers can be factored or evaluated toward a proof

| Workload | Physical SQL | Batched goal-directed plan |
| --- | ---: | ---: |
| Issues with any draft target in SubjectTo → Requires closure | 299 ms, 50 matches | 8.41 ms, same 50 |
| Issues whose reachable targets are all draft | 305 ms, 200 matches | 8.36 ms, same 200 |
| Any target with a nonexistent status | — | 10.36 ms, zero matches; relevant inputs exhausted |
| 100 different roots with outer-correlated `through` status | — | 8.20 ms, 55 matches |

Physical recursion carries `(subject,node)`, not `(subject,node,depth)`. The
application-assisted plan acquires actual SQL facts in one read transaction,
then stops an `any` only on a witness and an `all` only on a counterexample.
Negative `any` exhausts the relevant graph; empty-input `all` remains true.
The advanced correlated-through case reads each outer root's status from SQL and uses it
to prune that root's route. It does not merge all roots into one traversal.

The earlier working-relation correlated case used fixture-supplied outer
parameters; `advanced-results.json` is the authoritative stored-outer-value test.

These narrow plans omit full product validation and framing. They prove that
correlation/quantification can be executed cheaply on this fixture, not that a
general compiler or arbitrary nesting is implemented.

### Do not assume every relational-looking rewrite improves Dolt

Several alternatives failed or regressed on this version:

- Moving incident filters into UNION branches took roughly 17 seconds inside the
  checked read, versus about 1.6 seconds for that original query shape.
- Indexed temporary-table closure took about 68 ms, slower than the 7-ms physical
  plan. A correlated target-filter plan timed out at four seconds.
- A two-stage temporary-table IN/join plan failed with `expected a single index
  range`. Physical-table and batched alternatives returned the expected IDs.
- Nested CTEs over temporary working relations timed out; the physical versions
  passed in about 300 ms.

Initial failures are preserved. Cases attempted after the first disconnected
initial connection are marked inconclusive; the revised harness reconnects and
rebuilds only its own temporary tables. Timed-out owned queries were explicitly
cancelled. These are planner/engine constraints, not evidence that the logical
operators are impossible. Do not ship the slower template rewrites.

## What, if anything, should be deferred?

**No tested Memory operator needs removal on this evidence.** Keep Type-family
matching, incoming/outgoing/connected traversal, finite/unbounded depth, outer
filters, nested any/all and exact count semantics. The fixed Memory queries do
not require a general expression parser before using these plans.

| Capability or demand | Recommendation | What is lost if deferred/restricted |
| --- | --- | --- |
| Ordinary List predicates / Type families | Keep; push selection before hydration | No supported reason to cut them |
| Current Memory relationship/requirement queries | Keep; use direct or batched physical plans | Cutting these would remove core Memory use cases |
| Finite depth and unbounded closure | Keep; avoid cycle-by-depth state | Cutting either loses useful bounded neighborhoods or complete chains without fixing the reader's repeated work |
| Exact count, negative any, true all | Keep honest completeness and work limits | Fast guaranteed answers for every input are impossible to promise; estimates or partial counts would change meaning |
| Arbitrary nesting and outer-correlated graph predicates | Stage the general compiler if necessary; do not advertise a full Query profile until supported | Loses ad hoc per-Resource comparisons across nested relationship chains; fixed Memory forms and simpler nested forms can still ship |
| Historical-incidence/federated expansion | Keep existing first-slice exclusions | Cannot walk historical/foreign neighborhoods; this is already a capability boundary, not a new performance cut |
| Full graph transfer | Keep bounded result admission | Large complete graphs cost at least their output size; smaller representations/pages would need an explicit result contract |

The language has no requirement to enumerate every path. Do not add path
enumeration or path-sensitive results to solve this implementation problem.
Those would create different cardinality and cycle issues.

There is an unavoidable scaling risk in fully general correlation: 1,000 distinct
outer candidates can demand 1,000 different closures. A shared adjacency read
reduces I/O but not every candidate's work. Outer values sometimes allow grouping
or memoization; not always. A nested predicate can multiply these contexts again.
That is a reason for measured work admission and honest capability declarations,
not evidence from this fixture that the full semantics must be weakened.

If schedule forces a cut, ship the simpler advertised profile/fixed operations and
postpone the general compiler. Do not silently accept a full-profile request and
ignore a nested clause. A first Dolt subset would need an explicit capability or
profile design; none is adopted by this report.

## Production sequence I recommend

1. Introduce one checked read context that owns the transaction, authoritative
   Type facts, identity facts and cumulative acquisition/work/result accounting.
2. Give it bounded batch primitives for allocations, directional incidence,
   current/retained record pairs and owned-Link facts, including the native
   Issue/Dependency adapters. Avoid process-wide caches and per-record rebinding.
3. Precharge each cohort and validate required mapping/orphan facts before
   decoding/returning it. Preserve cancellation, old-pin refusal, corruption and
   incomplete-answer behavior. The experiment's whole-table preload is not this
   implementation.
4. Select physical recursion, frontier batches or materialized work tables from
   measured plans; keep acquisition strategy out of the logical AST.
5. Reuse checked facts for per-record validation, then serialize once. Qualify the
   complete CLI/HTTP path and required failure/concurrency cases before promising
   latency or widening admission caps.

The existing 1,000-total-Resource broad-read cap remains a product limitation.
Predicate pushdown must happen before broad hydration; simply raising the cap
would preserve the current scaling problem. Keep dependency mode on its existing
paths throughout the adapter work.

## Evidence and reproduction

See SOURCE-AND-CHECKS.json, checked-*.json/log, negative-control-results.json,
lowering-results.json, advanced-results.json and index-experiment-receipt.json.
The fresh source baseline repeat and final seven batch samples are identified
separately from earlier instrumented helper revisions. No static AST case is
presented as an executed parser/service test.

The source packet contains the untracked Go helper plus overlay files and the
qualified originals of the two overlaid catalog files. Copy the helper into a
fresh owned qualified checkout, adapt overlay absolute paths, and use the pinned
fixture in a fresh owned Dolt database. Example after adapting paths:

```sh
CGO_ENABLED=0 go run -overlay=/ABSOLUTE/PATH/overlay.json -tags gms_pure_go \
  ./internal/readoptbench batch 7 /ABSOLUTE/PATH/results.json
```

The Python scripts use only loopback58146 and melinda_read_perf. Read before
running: negative_controls.py temporarily corrupts and restores **owned fixture**
rows; indexed_checked.py temporarily adds and removes **owned fixture** indexes.
Neither belongs against a personal/shared database. The final cleanup receipt
records the owned server shutdown. Optimization evidence is packaged separately
from the original immutable experiment packet.

Local [complete evidence packet](/Users/dbox/.local/state/melinda/read-perf-20261026/optimization/EVIDENCE.zip) SHA256: `4e5b5e36fd165982ae5f54938cd73fe5acaf17de73b2baa0fd188c9928fb8207`.
The [original experiment summary](README.md) retains its separate evidence identity.
