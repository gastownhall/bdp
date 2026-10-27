# Batch selections: review choices and paired examples

**Author proposal for morning review, October 26, 2026.** This accompanies the
[batch overview](overview/06-batch.md). It does not amend the retained
[version-1 batch](../../specs/profiles/write/atomic-batch.md), held schemas,
runtime pins or implementations. The proposed version-2 names below make the
examples concrete; they are not adopted capability fields or an advertised service.

## Settled behavior

Donna selected a single atomic decision covering selection and writes.
Selections see earlier staged creates and updates. A named selection captures
its ID set once; later members consume that set without implicitly reevaluating it.
The existing final-publication, net-no-op and retained keyed-outcome model is
the intended foundation.

Donna proposed `--dry-run-mode batch` for operation emission and `--dry-run-mode
bdp` (possibly named http) for request emission. The overview uses those proposed
spellings so we can review one coherent surface. Their exact format, discovery
behavior and replacement of the earlier emit flags are still explicit design work.

## Concrete candidate encoding

The example wrapper has `capabilityVersion:"2"` and `operations`. This is a
proposal under the existing optional atomic-batch capability identity, not a
change to version 1. A new implementation must select an advertised version and
its complete admitted grammar. Version 1 continues to mean exactly its six CRUD
records with its existing capture semantics.

The examples preserve ordinary create/update/delete fields. They add:

| Candidate form | Meaning in these examples |
| --- | --- |
| `select` member with `name` and `query` | Evaluate one logical Resource collection in the authorized staged view; bind its distinct identities. |
| `query:{ir,profile,selection}` | Reuse the existing read AST's selection nodes and List/Query admission, with the batch-specific restrictions below. This is a selector envelope, not an ordinary paged read request. |
| `{binding:NAME}` in a Resource operand | Resolve an earlier typed binding. No arbitrary JSON path or string substitution. |
| `updateBead.bead` / `deleteBead.bead` bound to a Bead set | Apply the ordinary operation to each selected target as part of the same decision. Link forms require a Link set. |
| Creation `name` | Bind the one new identity, consumable as a singleton mutation target or single Link endpoint. |

The CLI's `--name` is accepted on creates and named selection members in this
proposal. Query aliases such as `edge` are local to their read expression; batch
names such as `ready-links` belong to the batch document. Neither is a persisted
alias. Property strings containing `@name` remain literal data.

The `query` selector envelope deliberately has no read result/delivery controls:
no Resource-body response request, masks, sort, paging cursor or count. Its output
is a typed identity set. The checker can validate the shared selection shape by
placing it in an ordinary resource-result AST request, but that does not make the
ordinary read transport or public Resource-edition model its transaction contract.

The paired files are:
- [Prepare CLI](overview/examples/csv-review.bdp) and [native input](overview/examples/csv-review.batch.json).
- [Cleanup CLI](overview/examples/csv-cleanup.bdp) and [native input](overview/examples/csv-cleanup.batch.json).
- [Empty-set CLI](overview/examples/csv-empty.bdp) and [native input](overview/examples/csv-empty.batch.json).

A service may support transaction-scoped List without Query. An unsupported
selector/profile refuses the whole request; clients never perform the read on
the side or silently drop clauses. The full representation must remain renderable
through the ordinary command signatures and shared expression language.

## Staged values are not public revisions

New and modified staged objects do not yet have a new published revision.
These examples select by identity, Type, properties and current relationship
content. They do not invent an edition token for a staged value.

For the first slice, this draft proposes refusing selection expressions requiring
a staged public revision, edition equality of unpublished states, historical
acquisition or cross-authority evaluation. Ordinary `id()` and field/Type tests
can still be admitted. An existing literal write guard continues to compare
that target's committed pre-batch baseline; the examples do not change the
version-1 guard rule or capture a future revision.

Precisely which staged Query operations are admitted needs review with the read
contract. Reusing the AST does not automatically make every standalone Query
valid in a transaction. In particular, dropping a historical pin to obtain a
writable current identity is not an acceptable implicit lowering.

## Proposed defaults exercised by the story

- A complete empty selection is a known-kind empty set. Set update/delete
  succeeds without Resource effects. Unknown/forward/wrong-kind bindings fail.
- Set membership deduplicates canonical identities. Operation order is preserved;
  identity order within a set does not become a user-visible mutation-order tool.
- Required authorization, graph/Type rules and target liveness still apply.
  One target's refusal fails the whole batch. There is no skip-and-continue mode.
- Exceeding a bound refuses before publication. A paged prefix is not the intended
  complete set. Explicit bounded-subset selection is not specified by this slice.
- No implicit Cartesian Link creation, array element map, computed patch value,
  cascade, arbitrary loop or parameterized-template language is added.
- Results must expose each input member's identity mapping, including each
  selection, and one final outcome per affected Resource. A selected but unchanged
  Resource need not acquire a fake mutation outcome just because it was read.
  Exact result field names are intentionally left for the next spec pass.
- Recovery preserves the original selected sets, allocated identities and outcome.
  It does not reevaluate a committed batch against later graph state.

## Provider acceptance case: staged reads and fixed captures

Retain this case for every provider claiming transaction-scoped selection. It
tests the already-selected visibility behavior, independently of the candidate
wire spelling. The following is an authored acceptance scenario, not an executed
provider test or a claim that a particular adapter supports it.

Start with one Bead, `existing`, whose status is `draft`. No other Bead matches
that predicate. Use a deterministic, ordinary refusal for the final member,
such as updating an identity known not to exist.

| Member | Expected staged observation or effect |
| --- | --- |
| Create `new` with status `draft`. | The new identity is available to later members without publishing a Resource revision. |
| Select Beads with status `draft` as `before`. | The captured set is exactly `{existing, new}`. This proves selection observes the earlier create. |
| Update `new` to status `ready`. | The earlier capture remains `{existing, new}`. |
| Select Beads with status `draft` as `after`. | The new capture is exactly `{existing}`. This proves a fresh selection observes the earlier update. |
| Update `before`, setting metadata `visited` to `true`. | Both Beads receive the staged edit, including `new`, which no longer matches the original predicate. This proves consuming a capture does not reevaluate it. |
| Force the final member to refuse. | The whole batch refuses; none of these Resource changes is published. |

Run a successful control with the same starting state and the final refusal
member omitted. It must return those two captured sets and publish `existing`
as `draft` with `visited:true`, and `new` as `ready` with `visited:true`. The new
Bead has one final published revision rather than a visible draft intermediate
state. This control exposes the staged semantics without relying on failed
requests returning intermediate bindings.

Run the refusal variant from a fresh copy of the starting state. After refusal,
`existing` retains its original content and revision, and no new Bead or Resource
lifecycle Event from this attempt is published. Diagnostic or audit records and
retained failure outcomes are distinct from committed Resource effects. Neither
test variant permits intermediate committed states to become visible to another
reader. Instrumented evidence may supplement these observations, but a forced
failure alone cannot prove which sets were captured internally.

An adapter may use native staged reads, an authorized transaction-local overlay,
or another equivalent implementation. Atomicity by itself does not establish
read-your-writes behavior. Publishing intermediate commits and compensating
after an error does not meet this acceptance case.

## Morning review

| Issue | Decision to make |
| --- | --- |
| Binding values and target positions | One identity versus an identity set; empty sets; singleton sets as endpoints; duplicate targets and liveness after deletion. |
| Selection support | List/Query transaction subsets, staging semantics, admission of pins/revision tests and how support is advertised. |
| Concurrency | The observable consistency/conflict rule for predicates, negative tests and relationship changes. A common SQL transaction alone does not select the policy. |
| Guards | Per-target revisions or another explicit set precondition; no single token silently reused as a set guard. |
| Product lowering | Preserve lifecycle, label-set/array edits, native dependency rules and explicit incident-Link removal. Acquisition alone is not the entire command. |
| Results and errors | Identity sets per member, final Resource outcomes, stable indices/diagnostics, retained recovery and authorization of replayed detail. |
| Wire and emission | Adopt or revise the example selector/binding encoding, capability/version dispatch and exact dry-run output. Resolve read-only discovery versus offline emission. |

Templates/parameters remain a future explicitly selected extension. The present
binding syntax must not acquire new interpolation behavior when that arrives.
