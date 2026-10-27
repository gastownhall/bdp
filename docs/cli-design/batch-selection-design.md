# Batch selections: review choices and paired examples

**Review draft, updated October 27, 2026.** This accompanies the
[batch overview](overview/06-batch.md). It does not amend the retained
[version-1 batch](../../specs/profiles/write/atomic-batch.md), held schemas,
runtime pins or implementations. The proposed version-2 names below make the
examples concrete; they are not adopted capability fields or an advertised service.

## Settled behavior

Donna selected a single atomic decision covering selection and writes.
Selections see earlier staged creates and updates. A named selection captures
its ID set once; later members consume that set without implicitly reevaluating it.
The existing final-publication, net-no-op and retained keyed-outcome model is
the intended foundation. The overview now starts with two fixed-ID creations
and a Link, then results, failure, revisions and recovery before bindings,
arguments, List and Query.

Donna selected `--batch-bind NAME` and `batch-ref::NAME` for definitions and
references. Both require batch-member emission rather than ordinary execution.
Each operand carries its own reference; no per-endpoint flag family is needed.
The spelling is explicitly reserved in batch Reference positions, even though
`batch-ref:` has URI-scheme syntax. Full HTTP URLs and property strings stay
literal under their ordinary rules.

Donna also selected `--batch-arg NAME=VALUE`, with missing and unused arguments
rejected. Parameters are implicit through use; there is no declaration block.
Raw CLI text is no longer a batch input. The overview uses JSONL member assembly
and native JSON requests; exact local grammar details below remain proposals.

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

The CLI's `--batch-bind` maps to `name` on creates and named selection members;
`batch-ref::NAME` emits an explicit `{binding:NAME}` operand. Query aliases such
as `edge` are local to their expression; batch names such as `ready-links` belong
to the batch document. Neither is a persisted alias. Property strings containing
`batch-ref::NAME` remain literal data. These CLI choices do not change the
retained version-1 wire's existing name/handle representation.

The `query` selector envelope deliberately has no read result/delivery controls:
no Resource-body response request, masks, sort, paging cursor or count. Its output
is a typed identity set. The checker can validate the shared selection shape by
placing it in an ordinary resource-result AST request, but that does not make the
ordinary read transport or public Resource-edition model its transaction contract.

The paired examples are ordinary shell assembly scripts, JSONL authoring files
and compiled native requests. No shell script is an input to `bd batch`.

| Example | Assembly script | JSONL members | Native request |
| --- | --- | --- | --- |
| Fixed IDs | [script](overview/examples/csv-basics.sh) | [members](overview/examples/csv-basics.jsonl) | [request](overview/examples/csv-basics.batch.json) |
| Guarded refusal | [script](overview/examples/csv-failure.sh) | [members](overview/examples/csv-failure.jsonl) | [request](overview/examples/csv-failure.batch.json) |
| Self-contained bindings | [script](overview/examples/csv-bindings.sh) | [members](overview/examples/csv-bindings.jsonl) | [request](overview/examples/csv-bindings.batch.json) |
| Supplied guide argument | [script](overview/examples/csv-arguments.sh) | [members](overview/examples/csv-arguments.jsonl) | [resolved request](overview/examples/csv-arguments.batch.json) |
| List and updates | [script](overview/examples/csv-review.sh) | [members](overview/examples/csv-review.jsonl) | [request](overview/examples/csv-review.batch.json) |
| Query and cleanup | [script](overview/examples/csv-cleanup.sh) | [members](overview/examples/csv-cleanup.jsonl) | [request](overview/examples/csv-cleanup.batch.json) |
| Empty set | [script](overview/examples/csv-empty.sh) | [members](overview/examples/csv-empty.jsonl) | [request](overview/examples/csv-empty.batch.json) |

A service may support transaction-scoped List without Query. An unsupported
selector/profile refuses the whole request; clients never perform the read on
the side or silently drop clauses. The full representation must remain renderable
through the ordinary command signatures and shared expression language.

## JSONL assembly and supplied arguments

The proposed authoring grammar is one complete member object per physical line,
without comments, a header, opening/closing array delimiters or a version field.
An emitter escapes embedded newlines inside JSON strings. Arrays, scalar records,
blank lines and duplicate object keys refuse. All input and ordinary value-file
contents are frozen before submission; a valid prefix is never dispatched while
the remainder is being read. Scripts use explicit shell failure checks to avoid
submitting a prefix left behind by a failed emission. A conditional group can
suppress Bash errexit, so `set -e` alone inside that group is insufficient.

The overview proposes `--input-format jsonl --batch-version VERSION` to select
the exact implemented encoder/admission grammar before compilation. The explicit
version flag is an author proposal, not a human ruling. It avoids guessing a
version from the currently advertised provider or from the last input member.
Native `--input-format json` instead carries its own required selector and is
literal wire input. Conflicting selection or an unsupported grammar refuses;
there is no downgrade or provider-dependent reinterpretation.

Individual `--dry-run-mode batch` invocations emit one member object and a newline.
On `bd batch`, the same mode emits the complete versioned native wrapper after
local argument resolution. `--dry-run-mode bdp` previews the corresponding
protocol request under a verified route. Neither mode allocates IDs, reserves a
key or validates remote admission; offline emission cannot resolve local ordinals.

In JSONL authoring, an explicit `{binding:NAME}` in an admitted operand position
names a variable. Compilation first collects all `name` definitions. A reference
to one is internal, must follow its definition, and remains a structural binding
reference in the proposed version-2 request. A name with no definition is an
implicit external argument, required through `--batch-arg NAME=VALUE`. It resolves
locally to an ordinary Reference before the wire request is frozen.

For this slice, external arguments are scalar References in the ordinary Bead/Link
target and Link endpoint positions. A position's kind and revision restrictions
still apply, and relative values use the outer Scope. This does not admit Type,
ID-allocation or revision-token variables, set-valued input arguments, dynamic
query text, property substitution or a general template language. Additional
positions/value kinds remain review work rather than acquiring implicit meaning.

Missing, unused or duplicate arguments fail. An argument cannot override an
internal definition, duplicate internal names fail, and a forward internal
reference never becomes an external argument. Wrong-kind or incompatible uses
fail as their available static/resolution information permits; service admission
still checks live Resources. Only designated operand positions participate;
an object or string in properties is never scanned for variables. Native JSON
input accepts no `--batch-arg`; already compiled bindings are internal references,
not an implicit template. Retry freezes resolved inputs and cannot add arguments.

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
  cascade, arbitrary loop or general template language is added.
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
| Wire and emission | Adopt or revise the example selector/binding encoding, explicit JSONL version selection and exact dry-run output. Resolve read-only discovery versus offline emission. |
| Supplied arguments | Confirm first-slice Reference positions and how incompatible constraints are diagnosed. Missing/unused rejection, implicit parameters and no internal override are selected. |

Richer value kinds and packaged templates remain future explicit extensions.
The selected Reference arguments do not introduce string interpolation, and
ordinary literal data must not acquire it when those extensions arrive.
