# Read lowering and product performance — October 26

The tested logical operators can run affordably on Dolt, PostgreSQL and SQLite.
The current generic product read path is substantially more expensive, and broad
acquisition refuses the requested 2,000-Resource population before filtering.
Keep the logical AST; prototype batched checked reads before investing in the
friendly parser or promising a provider speedup.

This is exploratory single-client evidence on one Mac, not release qualification,
a general AST compiler, or a comparison using identical physical database layouts.
The SQL harnesses implement explicit tested patterns. Current-only, authorized,
available content does not qualify historical pins, authorization failures,
proof-error ordering, concurrency, remote RTT or a complete service protocol.

## Fixture and baselines

The common deterministic fixture has exactly 1,000 Beads and 1,000 Links: 250 task
Issues plus 750 Memory Beads, actual Preview 3 Type-family closure, cycles, parallel
Links, succession and staged SubjectTo/Requires chains. Its SHA256 is
`4068a91486c8538bd4fe10b029b70b300ac975f7c64470b86cf532579b732074`.
An initial neutral Type closure was corrected and its original evidence preserved.

Dolt uses actual product tables and normal API-seeded records. SQLite/PostgreSQL
use indexed neutral tables representing the same current graph. Their different
physical schemas and driver costs prohibit treating the timings as an engine
ranking. Native Issue comparators use a smaller equivalent control population;
older binaries cannot represent all newer Memory Link Types.

| Baseline | Exact identity |
| --- | --- |
| Current fork main | `5779b6b846d358c40bdc7bad4a2fcffc779aadb6`; canonical Make build; independently verified all 5,524 tracked archive files against its Git tree |
| Installed binary | Homebrew `bd` 1.0.5, SHA256 `2fff6a2dc534cf8b56ec1f7a0c98b1e8509a0a5408905c420769a7213ee34707` |
| Qualified Preview 3 comparator | `210f8dad21945af85746a0eac74e6187d54a3735`, supplied qualified binary SHA256 `d67fc736cb5bdb2f57745ba4535a55795625a338f5beafcd9eb1ac485aeeca6a` |
| Storage versions | Dolt 2.1.8; PostgreSQL 16.2 from a transient local wheel; SQLite 3.53.1 |

## Measured results

| Workload/layer | Result | Median |
| --- | --- | ---: |
| Current Preview 3 Memory requirements | 461 Beads / 500 Links, complete checked command | 23.10 s |
| Dolt physical frontier selection | Same 500 Link IDs | 21.95 ms |
| Dolt frontier plus batched raw graph hydration / JSON assembly | Same 461 Bead / 500 Link identities, roughly 700 KB fetched | 95.39 ms |
| Dolt naive recursive view plus target-status join | 159 Link IDs | 9.03 s |
| Dolt frontier plus batched target filtering | Same 159 IDs | 62.00 ms |
| Dolt physical correlated any / all | 16 / 216 Issue IDs | 2.18 / 2.74 ms |
| PostgreSQL closure / outer target filter | 500 / 159 Link IDs | 1.72 / 1.93 ms |
| SQLite closure / outer target filter | 500 / 159 Link IDs | 1.08 / 1.49 ms |

The 95-ms raw graph prototype omits complete Type, retained/current-state,
ownership, authority and canonical framing checks. It is not an equivalent
100-ms complete provider. The current source repeatedly binds, reconstructs,
validates and hydrates selected Resources; batched validation has not yet been
implemented or timed. The experiment demonstrates affordable acquisition and
output volume, not that every remaining check is free.

Preview 3 dependency-mode List/Query medians were 62/58 ms, versus current main
64/59 ms on the same Issue selections. Generic link-mode controls were about
1,753/1,542 ms; those workspaces also include newer graph content and richer
records. Selection IDs were checked, but that comparison does not isolate one
code change or equalize all representation work.

At 1,000 Beads plus 1,000 Links, broad generic List, Count, Query and Graph refuse
their 1,000-total-Resource acquisition cap. Scoped Memory commands succeed. A fast
refusal is not included as a fast successful query.

## Correctness, failures and coverage

- All ten current Memory read families ran with independent ID/count oracles.
  Twenty-five generic/Memory cases produced 21 successes and four expected cap
  refusals. Seven native command controls ran across all three binaries.
- Twenty-two successful Dolt SQL patterns, typed-value and literal-wildcard checks
  are retained. A naive correlated view plan timed out; an ensuing unexecuted
  case is explicitly inconclusive. Direct physical alternatives passed.
- PostgreSQL passed all 18 tested patterns and seven JSONB checks. SQLite passed
  17 SQL patterns; its naive large-bounded recursion hit an explicit VM budget,
  while a shortest-distance BFS alternative passed. Another 120 SQLite traversal
  comparisons passed.
- Current bounded Memory output may include matching Links induced by the reached
  Beads. The proposed walk returns actually traversed Links. Bounded cases with
  different sets are not compared as equivalent; the complete 500-Link Requires
  closure matches exactly.
- Parent/label/glob/regex workloads were inventoried, not timed. No statement that
  every legacy flag or all graph queries have been implemented is warranted.

Cycles expose a plan hazard: recursive state `(node,depth)` can multiply work for
large finite depth. PostgreSQL's depth-1000 query took about 206 ms versus 1.72 ms
for deduplicated unbounded closure; SQLite's naive strategy exceeded 25 million
VM steps. A measured BFS alternative avoids that expansion but may need many
frontier round trips. The wire must not encode one physical recursive plan.

Dolt JSON functions need explicit LONGBLOB conversion and presence guards to
separate absent from null. Literal substring matching required a tested escaped
binary-LIKE lowering; LOCATE did not honor the expected case distinction in this
version. Its accepted max_execution_time setting did not enforce the tested
budget: a client timeout still required explicit cancellation of the owned query.
Delegated validation and deadlines need measured equivalence, not assumptions.

## Recommended implementation experiment

1. Establish one checked read context and resolve Type-family authority once.
2. Push inventory predicates and exact count before whole-scope acquisition.
3. Batch eligible incident-Link acquisition, endpoint facts and selected record /
   owned-Link hydration. Preserve required validation; amortize repeated work.
4. Choose physical frontier, materialized or recursive plans from actual plans and
   measurements. Keep cancellation and honest completeness above the provider.
5. Re-run these identity sets, complete records and required refusal cases through
   the checked prototype. Keep dependency mode separate and unchanged.

Do not make the friendly language implementation the prerequisite for this
experiment. The tested AST-pattern requests are enough to measure the next seam.

## Evidence and reproducibility

Full reports, exact scripts/ASTs/SQL/plans, fixtures, output captures, every timing
sample, manifests, audit corrections and cleanup receipts are retained locally at:

```text
/Users/dbox/.local/state/melinda/read-perf-20261026/
  README.md
  dolt/REPORT.md
  sqlite-postgres/REPORT.md
  evidence-review.md
  EVIDENCE.zip
```

The packet excludes databases, server binaries, credentials and full product
checkouts. Reproduction needs the pinned source/builds and fresh owned storage;
Dolt scripts retain this host's binary/workspace bindings and require explicit
adaptation on another host. No caller should run them against a personal database.
The exact initial uncommitted design-source digest is preserved separately from
its Git base; these results are not misattributed to a fully frozen spec commit.

All disposable servers are stopped. Small SQL/CLI cases use repeated warm samples;
expensive Memory closures use three, whose reported p95 is merely the largest of
three observations. No cold-cache, remote, large-ready-set, concurrency or larger-
graph performance claim is made. Static specification cases and actual provider
experiments remain distinct evidence.

The packaged `EVIDENCE.zip` SHA256 is
`8c2242f0cf981efef848a32c6ef7ff74c92eed7f018ae305ec1c36e0f5309bde`.
Its 217 members include an individual digest manifest; the final parent audit
matched 193 recorded artifact digests and confirmed both owned ports closed.

## Optimization follow-up

The [Dolt optimization investigation](dolt-optimization.md) measures direct physical
plans and a 0.61-second checked backend prototype with byte-identical output and
refusal controls. Its whole-fixture batching remains experimental; bounded,
precharged production cohorts are still required. No tested Memory operator
needed removal. This addendum has its own source/evidence packet.
