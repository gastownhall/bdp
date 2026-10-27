# Batch selections: review choices and paired examples

**Review draft, updated October 27, 2026.** This accompanies the
[batch overview](overview/06-batch.md). It does not amend the retained
[version-1 batch](../../specs/profiles/write/atomic-batch.md), held schemas,
runtime pins or implementations. The human decision pass is complete for the
policies recorded below. Proposed version-2 names make the examples concrete; exact fields and read-grammar
integration remain authoring work, not adopted capability fields or an
advertised service.

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
and native JSON requests. JSONL is the selected default, blank lines are ignored,
and empty batches refuse.

`--dry-run-mode batch` emits members or the complete native batch without
network reads. `--dry-run-mode bdp` may perform discovery and reads needed to
construct an actual request, including local-revision resolution. Neither mode
executes a mutation, allocates identities or reserves a key. Preview framing
remains an encoding proposal.

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
| Read only | [script](overview/examples/csv-read-only.sh) | [members](overview/examples/csv-read-only.jsonl) | [request](overview/examples/csv-read-only.batch.json), [authored result](overview/examples/csv-read-only.result.json) |

A service may support transaction-scoped List without Query. An unsupported
selector/profile refuses the whole request; clients never perform the read on
the side or silently drop clauses. The full representation must remain renderable
through the ordinary command signatures and shared expression language.

## JSONL assembly and supplied arguments

The authoring grammar uses one complete member object per nonblank physical line,
without comments, a header, opening/closing array delimiters or a version field.
An emitter escapes embedded newlines inside JSON strings. Ignore whitespace-only
lines; reject arrays, scalar records, comments, multiline member records and
duplicate object keys. At least one member is required. All input and ordinary
value-file contents are frozen before submission; a valid prefix is never dispatched while
the remainder is being read. Scripts use explicit shell failure checks to avoid
submitting a prefix left behind by a failed emission. A conditional group can
suppress Bash errexit, so `set -e` alone inside that group is insufficient.

JSONL is the default authoring format, independent of filename extension. The
CLI uses a stable documented encoder version; optional `--batch-version VERSION`
pins another implemented grammar. The examples use proposed encoder 2 as their
stable default. The numeric encoding is still a proposal, not a released default.
The native request always carries its exact required version; the compiler never
chooses one from provider support or silently reinterprets input under another.

Native `--input-format json` carries its own selector and is literal wire input;
a separate version override or supplied arguments refuse in that mode. An
unsupported grammar refuses without downgrade. A later CLI cannot silently
change the meaning of existing authoring syntax.

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

For this slice, external arguments are scalar References in ordinary Bead/Link
target, Link endpoint and explicit List/Query Reference input positions.
A position's kind and revision restrictions still apply, and relative values use the outer Scope. This does not admit Type,
ID-allocation or revision-token variables, set-valued input arguments, dynamic
query text, property substitution or a general template language. Additional
positions/value kinds are deferred explicit extensions.

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

The selected first slice refuses selection expressions requiring a staged public
revision, edition equality of unpublished states, historical acquisition or
cross-Scope Resource acquisition. Ordinary `id()` and field/Type tests
can still be admitted. An existing literal write guard continues to compare
that target's committed pre-batch baseline; the examples do not change the
version-1 guard rule or capture a future revision.

Detailed transactional admission must apply these selected restrictions to the
shared read contract. Reusing the AST does not automatically make every standalone
Query valid in a transaction. In particular, dropping a historical pin to obtain a
writable current identity is not an acceptable implicit lowering.

## Selected execution and result rules

- A complete empty selection is a known-kind empty set. Set update/delete
  succeeds without Resource effects. Unknown/forward/wrong-kind bindings fail.
- Set membership deduplicates canonical identities. Returned set arrays sort by
  canonical Resource URI. Input-member order is preserved; set-array order is
  not a user-visible mutation-order tool.
- A Link endpoint accepts a binding containing exactly one live Bead. A write
  guard accepts exactly one resolved target, including a singleton set. Zero or
  multiple targets refuse instead of broadcasting the guard. Newly created
  targets still have no committed baseline revision for a literal guard.
- No generic `bd batch --if-revision` is added. A Scope-wide revision is not
  invented; structured batch preconditions await a concrete need.
- Required authorization, graph/Type rules and target liveness still apply.
  One target's refusal fails the whole batch. There is no skip-and-continue mode.
- Exceeding a bound refuses before publication. A paged prefix is not the intended
  complete set. Explicit bounded-subset selection is not specified by this slice.
- No implicit Cartesian Link creation, array element map, computed patch value,
  cascade, arbitrary loop or general template language is added.
- Each member result has an identity array, even for singleton operations;
  selection mappings include their complete captured sets. Final Resource
  outcomes appear once per mutation-affected Resource, with ordinary owner
  effects retained. Selection alone does not invent a mutation outcome or body.
  The retained version-1 result grammar remains unchanged.
- Selection-only batches are permitted with the same capability, bounds, key
  and retained outcome. They return ordered mappings, `changed:false` and no
  final mutation outcomes, with no Resource revisions or lifecycle Events.
- Once member evaluation begins, stop at the first failure and return one
  ordinary Problem with member index and permitted target detail. Whole-input
  static checks and inherited admission precedence remain in force.
- Recovery preserves the original selected sets, allocated identities and outcome.
  It does not reevaluate a committed batch against later graph state.

## Concurrency, Scope and composition

Successful execution is equivalent to some sequential ordering with competing
authoritative changes. One shared connection or a consistent starting view alone
does not prove that serializable guarantee. Explicit Resource revision guards
still protect prior observations; serializability does not compare the batch
with a human's earlier review automatically.

An authority may internally restart an uncommitted attempt after a serialization
conflict, bounded by its execution policy. It reuses the same frozen request and
key; a new attempt may capture different sets, but captures within one attempt
remain fixed. Guard, authorization and input-validation failures are not reasons
for this restart. A terminally recorded or committed decision never restarts.

All selected, traversed, acquired and mutated Resources belong to one owning
Scope. Local Link records may retain opaque external endpoint URIs under their
ordinary Type policy; those endpoints are neither acquired nor enlisted in the
decision. Type-definition authority retains its ordinary contract; opaque data
cannot masquerade as an authorized remote Resource read. Returned Resource ID
sets are local, so local/remote grouping adds no first-slice result-order rule.

A prior create's singleton binding or a captured Bead set can seed explicit
Query roots. A captured typed set can also supply another List's candidates;
List only filters candidate-local fields, while Query may traverse. A later
selection reads those identities' then-current staged content and captures its
own membership. Explicit roots still obey ordinary kind, liveness and access
checks; failed roots are not silently dropped.

The current standalone List proposal admits an inventory scan with an optional
local filter. It does not already encode this selected captured-set input.
Melinda owns the shared read-grammar/AST reconciliation. Exact input syntax and
batch binding slots in logical read expressions remain encoding proposals;
the existing fixed-root examples are not evidence those added forms are admitted
by the held schema or implemented runtime.

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

### Concurrent capture case

Also retain a serializability case with two initially draft Beads, `A` and `B`.
One batch selects draft `B`, then sets `A` to ready. A competing batch selects
draft `A`, then sets `B` to ready. Their writes touch different Resources, so
write/write conflict detection alone is insufficient.

If both complete, they cannot both return a capture containing the other's
initially draft identity: no sequential ordering produces those two results.
One may refuse, or an internal restart may yield an empty capture after the
other commits. This is an authored provider obligation, not an executed
concurrency test. It does not require a new conditional member or batch guard.

## Completed decision pass: October 27

This table records Donna's answers in this review; it is not a second wire
specification. The overview and command reference apply the decisions, while
the named encoding proposals remain subject to detailed incorporation.

| # | Issue | Selected rule |
| --- | --- | --- |
| 1 | Concurrent execution | Serializable observable behavior. |
| 2 | Successful result | Complete member identity mappings plus unique final Resource outcomes; refuse if the bounded complete result cannot be committed. |
| 3 | Member failure | Stop at the first evaluation failure; one actionable Problem with permitted member/target detail. |
| 4 | Empty selected set | Update/delete succeeds without Resource effects when no singleton guard is supplied. |
| 5 | Set at Link endpoint | Accept exactly one live Bead; zero/multiple refuse; no fan-out. |
| 6 | Guarded set target | `--if-revision` requires exactly one resolved target and checks its committed baseline; no new outer batch guard. |
| 7 | Deleted captured target | Later update/delete refuses the whole batch; no skip. |
| 8 | External argument kinds | Scalar Resource References in target, endpoint and explicit read Reference positions; richer values deferred. |
| 9 | Historical selection | Current staged graph only; defer historical acquisition and unpublished-revision tests. |
| 10 | Provider support | Advertise transaction-scoped List and Query independently. |
| 11 | Encoder choice | Stable documented CLI default, optional explicit version pin; exact wire selector, no automatic downgrade. |
| 12 | Request preview | BDP preview may discover/read to construct the request; member emission stays offline. |
| 13 | Mapping shape | Identity arrays for every new-version member mapping; retain version-1 result unchanged. |
| 14 | Ranked subsets | Defer sorting/top-N/paging selection; first slice requires complete unordered sets. |
| 15 | Generated roots | Earlier internal bindings may supply explicit selection roots. |
| 16 | Read-only batch | Permit selections alone, with ordinary batch outcome/recovery and no mutation facts. |
| 17 | Internal restart | Bounded uncommitted serialization-conflict restart, preserving frozen input/key; never rerun a terminal decision. |
| 18 | Set result order | Canonical URI order; does not establish mutation order within a set. |
| 19 | Default input | JSONL members; native JSON wrapper explicitly selected; extension does not select format. |
| 20 | Transaction boundary | One Scope; no remote Resource acquisition or mutation. |
| 21 | External endpoint data | Preserve opaque external Link endpoints under ordinary Type policy. |
| 22 | Selection composition | List filters an earlier typed capture; Query can use captured Beads as roots. |
| 23 | Binding definitions | One definition per internal name; duplicate/forward/overriding definitions refuse. |
| 24 | Blank lines | Ignore whitespace-only lines; retain complete-object-per-nonblank-line admission. |
| 25 | Empty input | Refuse a batch containing no members. |

## Remaining incorporation work

- Specify exact version-2 selector/binding/result fields and separate advertised
  transactional selection support. The examples propose field names without
  changing a held schema or capability registry.
- Reconcile List candidate inputs and typed explicit-root binding slots with
  the shared read grammar/AST and its authored cases in Melinda's owned sources.
- Keep product lowering honest about lifecycle, label/array editing, dependency
  rules, Type authority and ordinary graph integrity; collection acquisition
  alone is not proof that a domain command lowers faithfully.
- Qualify provider serializability, staged selection, bounds, authorization,
  final publication and retained recovery before advertising support.

Richer value kinds, installed query/package conveniences, ranked subsets,
historical transactional selection and structured batch preconditions remain
future explicit extensions. Reference arguments and bindings do not introduce
string interpolation, and ordinary literal data must not acquire it later.
