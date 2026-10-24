# Canonical Memory CLI

This companion to the [generic CLI](bdp-cli.md) specifies the `bd memory`
command group and its use with ordinary Bead and Link commands. Memory is an
optional domain package, not a new requirement of Core or Write. `bd` is the
Beads executable; a different host can expose the same command contract through
its own executable when it supports the corresponding package and adapters.

**Status: authored design candidate, not a qualification or release claim.**
The walkthrough is informative. The command contract below is normative for
this CLI candidate. The [Memory Types v0.2 design](https://github.com/gastownhall/bdp/blob/21fa91d3e189bff3832bd977c3d6be49f2b5d93c/specs/types/memory/memory.md)
owns Type meanings and invariants; this document does not complete its deferred
pin, lifecycle or transaction mechanics. Every example is authored, not a
captured command run. [Sources and implementation correspondence](#sources-and-implementation-correspondence)
record the older proposal and the publication boundary.

## Walkthrough: context, replacement and obligations (informative)

Assume the selected workspace has a default Scope and the supported Memory
Types installed. Relative IDs use that Scope; it need not be repeated on every
command. Use absolute canonical URLs for identities outside the local display
context, subject to the operation's endpoint restrictions. This walkthrough
does not install Types, initialize a workspace or qualify a build.

The shell variables below stand for actual installed Type References supplied
by that workspace: `MEMORY_TYPE`, `SPECIFICATION_TYPE`, `REQUIREMENT_TYPE`,
`SCENARIO_TYPE` and `POLICY_TYPE`. They are not display names from which a Type
URI can be guessed. The named IDs are illustrative Scope-defined names; there
are no required `beads/`, `links/` or `types/` Resource prefixes.

### Connect useful context

Record the CSV design note and its encoding context using ordinary creation.
Memory requires a nonblank title and a body; the body may be empty.

```sh
bd create --id csv-design --type "$MEMORY_TYPE" \
  --properties '{"title":"CSV export design","body":"Export the selected rows as CSV."}'
bd create --id csv-encoding --type "$MEMORY_TYPE" \
  --properties '{"title":"CSV encoding","body":"Use UTF-8."}'
bd memory reference csv-design csv-encoding --id encoding-context \
  --title "Uses this encoding" --body "Context for the export design"
bd memory references csv-design
bd memory referenced-by csv-encoding
```

The References Link records its own explanation and authored direction. A
plain References Link is unowned under the v0.2 design: creating or editing it
changes the Link, not either endpoint. A second independently authored reference
between the same endpoints is a different Link, not an update of the first.

### Edit one identity or name its replacement

Maintain the same note with an ordinary update. Use a guard when the edit
depends on an observed predecessor; `ENCODING_REV` below is its exact token.

```sh
bd update csv-encoding --set-property body='Use UTF-8 without a byte-order mark.' \
  --if-revision "$ENCODING_REV"
bd show csv-encoding@2
bd show csv-encoding --revision "$ENCODING_REV"
```

`@2` uses a stable ordinal in the selected store; it requires that mapping and
retained revision to exist. `--revision` selects an exact historical revision,
as does `ID@=TOKEN`. Neither is a write guard. A suffix and `--revision` together
are an error, even if they would select the same state.

When a separately maintained guide replaces the note, create that guide and
record the change of identity:

```sh
bd create --id csv-guide --type "$MEMORY_TYPE" \
  --properties '{"title":"CSV interoperability guide","body":"Encoding, headings and spreadsheet examples."}'
bd memory supersede csv-encoding csv-guide --id encoding-replacement
bd memory successor csv-encoding
bd memory supersedes csv-guide
```

The old Memory remains readable. Existing references still identify it until
their authors change them. The retiring Memory owns the replacement Link;
recording it revises that source, not the replacement. It neither deletes the
old Memory nor changes a status label or approves the guide.

### Describe the obligations

Use Constraints for obligations. A Specification can define its detailed
Requirement and Scenario, while requiring a separately maintained Policy.

```sh
bd create --id csv-format --type "$SPECIFICATION_TYPE" \
  --properties '{"title":"CSV export format","body":"The export must meet these requirements and its own format rules."}'
bd create --id selected-rows --type "$REQUIREMENT_TYPE" \
  --properties '{"title":"Export every selected row","body":"Every selected row appears exactly once."}'
bd create --id empty-export --type "$SCENARIO_TYPE" \
  --properties '{"title":"Export an empty selection","body":"Produce headings and no data rows."}'
bd create --id customer-data --type "$POLICY_TYPE" \
  --properties '{"title":"Protect customer data","body":"Do not expose personal information in logs or sample exports."}'
bd memory defines csv-format selected-rows
bd memory defines csv-format empty-export
bd memory requires csv-format customer-data
bd memory definition csv-format
bd memory requirements csv-format
```

`definition` follows the defining tree. `requirements` also includes the
external Policy because Defines refines Requires. Every reached dependency is
necessary; finding those records does not prove they were met. The source's
own body still applies, and the graph does not assert that its children exhaust
the parent's obligations unless the author says so.

### Find the rules governing work

Assume `export-work` is an existing Issue in the workspace, whose installed
Type supports Subject To ownership and the required write operation.

```sh
bd memory subject-to export-work csv-format
bd memory constraints export-work
bd memory subjects csv-format
```

The first read starts with the Issue's explicit Subject To declaration and
follows the Specification's Requires family, including Defines. The reverse
read reports subjects declaring that Specification directly. If the
Specification itself is subject to a document-review Policy, that does not
automatically bind the Issue to the document-review process.

The result explains declared obligations and their supporting paths. It does
not execute a Policy, establish compliance or change Issue readiness. Installation,
build provenance and release acceptance belong in the release runbook.

## Shared command contract

The remainder defines the CLI candidate. Type-specific statements refer to
the v0.2 model above; where that model leaves mechanics open, command syntax
does not select them. A host must state the exact implemented Type and shared
protocol contract, and refuse behavior it cannot faithfully provide.

Use shared [Scope and Reference resolution](scope-and-references.md),
[contract binding](contract-binding.md), [object edits](object-edits.md),
[affiliations and owned state](affiliations-and-owned-state.md), and
[output](read-output.md). Omitted Scope uses the configured default; `--scope`
can override it. Resolve relative inputs before transport. An absolute Type or
endpoint URI does not silently redirect a write to another Scope. The current
Memory Types proposal requires endpoints in one Scope.

`ID@N`, `ID@=TOKEN`, `ID@current`, literal `--id` and explicit token options
retain their shared parsing rules. For local convenience operands, suffix
parsing precedes whole-ID lookup; a literal sibling cannot shadow a valid
selector. Unwrapped absolute HTTP URLs, including raw `@`, and exact JSON or
literal `--id` forms bypass that convenience parsing. Resolve an ordinal to an
exact token before transport or persistence. Exact values and full canonical
URIs survive machine output; a displayed ordinal is not a portable reference.

`--revision TOKEN` selects historical point content; `--if-revision TOKEN`
guards an ordinary Resource mutation. These are not endpoint pins. Typed
endpoint intents in the [product adapter](preview3-alignment.md#product-endpoint-pin-operations)
remain distinct from generic literal token flags and from `@=current` or
`@=unpinned`, which name exact tokens. A spelling does not authorize a pin the
selected Type forbids. No automatic repinning or revision-composition algorithm
is introduced here.

Generic owned-state rules can preserve a literal source pin older than its
owning capture. The current Beads product refuses owned-source pins; the
v0.2 Memory model leaves the detailed mechanics open. Keep these boundaries
distinct. The walkthrough uses floating sources and does not turn the product
restriction into a universal Type rule.

## Ten relationship reads

Each command requires one or more roots. Their results come from one consistent,
bounded read view. Each root has its own hop/depth allowance. Acquisition,
output and candidate-work caps are shared cumulatively across roots and stages;
adding roots does not multiply the operation's resource limits. Preserve requested
roots, including zero-hop results, and retain per-root membership, supporting
paths, selected revision context and any depth frontier.

These are derived graph questions requiring a suitable traversal/read-view
adapter. BDP's bounded collection Selector supplies neither recursive joins
nor a coherent graph snapshot merely by fetching independent pages. A host
without the required adapter refuses the question; it does not invent a new
Memory wire operation or claim that an ordinary list response answers it.

| Command | Roots | Selected Link family | Direction | Default extent |
| --- | --- | --- | --- | --- |
| `bd memory successor ID...` | Memory family | Superseded By | Outgoing | Depth 1000 |
| `bd memory supersedes ID...` | Memory family | Superseded By | Incoming | Depth 1 |
| `bd memory references ID...` | Eligible Beads | References | Outgoing | Depth 1 |
| `bd memory referenced-by ID...` | Eligible Beads | References | Incoming | Depth 1 |
| `bd memory requirements ID...` | Constraint family | Requires, including Defines | Outgoing | Depth 1000 |
| `bd memory required-by ID...` | Constraint family | Requires, including Defines | Incoming | Depth 1 |
| `bd memory definition ID...` | Constraint family | Defines | Outgoing | Depth 1000 |
| `bd memory defined-by ID...` | Constraint family | Defines | Incoming | Depth 1 |
| `bd memory constraints SUBJECT...` | Eligible subject Beads | Subject To once, then Requires family | Staged below | Bounded closure |
| `bd memory subjects CONSTRAINT...` | Constraint family | Subject To | Incoming | Direct declarations |

All family selections include supported refinements. References includes its
refinements, not just direct nominal References Links. Show each actual declared
Type. References endpoint eligibility follows the Type's correlated source/target
pairs; “eligible Beads” is not permission for arbitrary endpoint combinations.
Subject To admits any Bead source only when its installed Type and writer support
the selected contract; endpoint eligibility alone does not install ownership.

`--depth N` changes the eight ordinary family traversals' hop limit. A default
of 1000 is a bound, not unlimited traversal. `subjects` is a direct lookup;
this candidate adds no deeper Subject To mode. Stage-specific depth controls
for `constraints` remain unselected. Do not silently reinterpret an unsupported
flag combination. Shared output controls apply only through a supported graph
adapter; collection paging flags are not automatically graph paging controls.

For an ordinary family traversal, find reached Beads in the selected direction
and depth, then retain all matching Links between those reached Beads. Keep
parallel, cross and cycle-closing Links. Compute that graph separately for each
root, then aggregate; do not induce extra Links across the combined Bead union.
For edges A→B, A→C, B→D and C→D, roots A and B at depth one yield AB, AC and BD,
not CD. No individual root reached both C and D within its own budget.

Visited-identity tracking terminates repeated expansion while retaining the
actual selected Links. Requires and direct References can cycle; detecting such
a cycle does not turn it into a Defines tree or an invalid replacement chain.
`successor` retains intermediate Memories, not just a purported terminal result.
A frontier must not be reported as the terminal successor.

### Explicit obligation discovery

`constraints` performs exactly these stages for each original subject:

1. Select its explicit outgoing Subject To-family declarations once.
2. From their target Constraints, follow outgoing Requires-family Links,
   including Defines, under the selected bounded view.
3. Retain the admitted declarations, dependencies and supporting paths with
   their original subject membership.

Do not traverse a reached Constraint's Subject To declarations as obligations
of the original subject, follow an incoming Defines parent to add its rules,
or infer a governing relationship from a plain References Link. Only Links in
the admitted staged paths belong to this result; presence of both endpoints
does not admit an unrelated Link. Shared expansion must not transfer obligations
between subjects. Report discovery as **explicit declarations and their Requires
dependencies**, not all possibly applicable rules.

`subjects` selects direct incoming Subject To declarations targeted at each
requested Constraint. It neither reverses Requires to find indirect subjects nor
adds secondary Subject To Links between reached subjects. It retains its root
when there are no declarations. Neither read creates inferred stored Links.
Executable applicability predicates, their syntax and their evaluation remain
outside this command contract.

### Revisions, bounds and unavailable information

The selected Preview3 specialized adapter uses current-compatible endpoint pins
in a captured current view and refuses a mismatch. This differs from generic
graph display, which can show current Bead records alongside older stored pins.
Do not float or discard an exact pin to make a traversal succeed. Selecting a
retained root does not license substitution of its current body or traversal of
the current graph as historical evidence. General historical graph traversal and
the v0.2 model's deferred revision mechanics are not added by these signatures.

A requested invalid, inaccessible or unavailable root, incompatible endpoint
binding or acquisition-budget failure refuses the aggregate. It must not appear
as successful empty or complete discovery. An admitted depth frontier is a
visible bound on the result, not proof of terminal replacement, complete
obligations or satisfaction. Preserve the common error/completion distinction.

## Five Link creation commands

| Command | Source → target | v0.2 ownership |
| --- | --- | --- |
| `bd memory reference SOURCE TARGET` | Eligible References pair | Plain References is unowned |
| `bd memory supersede OLD NEW` | Retiring Memory → replacement Memory | Retiring source Memory |
| `bd memory requires SOURCE TARGET` | Constraint → necessary Constraint | Source Constraint |
| `bd memory defines PARENT CHILD` | Constraint → defining child Constraint | Source parent Constraint |
| `bd memory subject-to SUBJECT CONSTRAINT` | Eligible Bead → governing Constraint | Source subject under its installed ownership contract |

All five admit the same three endpoint forms:

```text
bd memory VERB SOURCE TARGET [OPTIONS]
bd memory VERB SOURCE --to TARGET [OPTIONS]
bd memory VERB --from SOURCE --to TARGET [OPTIONS]
```

Bind each endpoint once. Duplicate binding refuses even when equal; incomplete
or inverted forms such as `--from SOURCE TARGET` refuse. `supersede` always
points from old to replacement. The older `--by` spelling is not part of this
canonical grammar.

Each facade selects its corresponding installed nominal Link Type and delegates
to the common `createLink` operation and writer. It supplies no separate allocator, upsert,
transaction boundary or validation bypass. Use generic `bd link create --type`
when deliberately authoring another supported Type or refinement; these fixed
facades do not accept a Type override that changes their question or operation.
The corresponding generic Link command supplies the existing
[operation emission and atomic batch](atomic-batch.md) mapping; this companion
does not add a new Memory discriminator to the wire or new facade-emission flags.

Create inputs include shared `--id`, `--properties` and `--metadata`, plus the
named optional `--title`, `--body` and `--status` properties. Supplying a property
both by name and in `--properties` refuses; omission stays omission. References
properties are nonblank when provided. Status is descriptive text, not a
workflow, approval or activation instruction. Shared product allocation options
apply only where its authoritative writer actually supports them.

Admitted Type/endpoint pins and guards use the common operation's semantics,
not a read-then-write emulation. Product `--if-source-revision` is the explicit
owner guard where applicable; it does not create a generic BDP source-guard
field. A stale guard refuses atomically, including a would-be no-op. This CLI
does not settle still-open v0.2 per-Type pin or lifecycle mechanics.

Repeated References creation without an explicit identity creates distinct
Links for equal endpoints. Explicit-ID conflict and exact retry behavior remain
the common contract. `supersede` is create-only: an existing outgoing Superseded
By-family Link refuses even when NEW is the same. It never silently retargets
or replaces that Link. Changes use separately admitted, guarded generic Link
operations. Superseded By endpoints are distinct Memory identities and floating
under the v0.2 Type design.

Defines permits zero or one live incoming Defines-family Link per child identity,
including refusal of parallel Links from the same parent, and no defining cycle;
Superseded By enforces at most one successor per retiring Memory and no cycle.
Requires can cycle. The writer must validate the affected prospective graph
atomically under its selected shared contract. No command can claim enforcement
from read-time diagnostics alone. An owned Link change revises its source, not
its target; plain References changes revise neither endpoint.

## Ordinary CRUD, selection and output

Memory uses generic CRUD rather than another set of Type-specific shortcuts.

| Intent | Canonical shape |
| --- | --- |
| Create or set a Bead's affiliation | `bd create --type TYPE`; `bd update ID --type TYPE` |
| Merge properties or replace the writable set | `bd update ID --properties JSON`; `--replace-properties JSON` |
| Ordered property patch or literal top-level edits | `--patch-properties JSON`; `--set-property KEY=VALUE`; `--unset-property KEY` |
| Edit informational metadata | Matching `--metadata`, `--replace-metadata`, `--patch-metadata`, `--set-metadata`, `--unset-metadata` modes |
| Point content, current or retained | `bd show ID`; `bd show ID@N`; `bd show ID@=TOKEN`; `bd show ID --revision TOKEN` |
| Memory family including supported refinements | `bd list --type "$MEMORY_TYPE"` |
| One nominal Type, independent of definition pin | `bd list --exact-type "$MEMORY_TYPE"` |
| All admitted Bead Types in the selected population | `bd list --type any` |
| Generic Link authoring and selection | `bd link create SOURCE TARGET --type TYPE`; `bd link list --type TYPE`; `bd link list --exact-type TYPE` |
| Delete through the shared operation | `bd delete ID --force`; `bd link delete LINK --force` |
| Future canonical Type inventory location | `bd type list` |

Creation initializes objects. On update the merge/replacement/patch/keyed modes
are exclusive per object; properties and metadata choose independently. An
omitted Type preserves the complete affiliation. An exact owner read uses its
captured owned-Link envelopes, not a join against today's Link store.
Retyping does not discard or
convert properties and must preserve affected graph validity. These signatures
do not promise an implementation can convert native Issue backing to Memory
backing or complete the v0.2 lifecycle work. Deletion uses the selected shared
contract and introduces no independent cascade, erasure or recovery policy.

`--type` means family on filters and affiliation on writes. `--exact-type`
means nominal identity, not a definition revision. Exact and family predicates
combine with AND. `any` is the shared wildcard selection, not a stored Type.
Use actual advertised Type References, especially to distinguish a Memory
Decision from a native Issue classification with the same label. The ten
focused reads keep their declared family; these generic filters do not turn
them into arbitrary graph queries. Type-management design remains separate;
the old product `bd types` spelling is implementation correspondence below.

Relationship reads default to the shared compact graph view, without `--graph`.
Show root identities, actual Types and titles. Label Links with their actual
Types and preserve authored arrow direction even on incoming traversal.
Repeated expansion, shared descendants, parallel Links and real directed cycles
must remain distinguishable. Render Defines children before other Requires
dependencies at each Constraint. Indentation establishes neither ownership nor
readiness. Elide only the exact local Scope prefix, preserving the entire
Scope-defined name; exact stored endpoint pins remain inspectable.

The five relationship-creation commands use the common Link success renderer:
a brief acknowledgement and the shared row, including the created Link identity.
Ordinary Memory Bead creation keeps the shared Bead success renderer. Complete native mutation
results, including any real source revision outcome, survive structured output;
human rendering does not invent an endpoint revision or default to JSON.

Reuse Cleo's common output writer and supported format/descriptor combinations.
Graph machine output must preserve canonical Bead/Link records, exact References,
roots, per-root membership and supporting paths/bounds. The ordinary-read schema
in [read-output.md](read-output.md) covers six descriptors, not a graph descriptor.
This companion adds no private schema, invented `result_kind` or JSONL record
shape. Multi-root machine framing must be reconciled in the shared graph adapter
before it can claim support; silently flattening root context is not acceptable.
Unsupported format or projection combinations refuse. Diagnostics use stderr
and do not corrupt structured stdout.

Existing `remember`, `recall`, `memories` and `forget` retain their own contracts.
In particular, the product's `memories` summary is not silently replaced with
generic collection rows or a new full-body JSON result.

## Sources and implementation correspondence

This file is the proposed canonical home beside the generic CLI. The older
[accepted ten-read/five-create proposal, Beads #7758](https://github.com/gastownhall/beads/issues/7758)
and its [editable Beads source](https://github.com/donnabox/beads/blob/86e1efcf63ae84736a63975d12ebb01250eb0d50/docs/reference/bdp/cli/types/memory/memory.md)
are reconciliation inputs. On adoption, the Beads documentation should point
here or identify itself as a product mirror of an exact revision, rather than
maintain a second independent canonical command contract. This draft does not
silently replace a released documentation or runtime pin.

| Source | Role and correspondence |
| --- | --- |
| Memory Types v0.2 at BDP `21fa91d3e189bff3832bd977c3d6be49f2b5d93c`, with Donna's October 24 editorial comments | Model target: eight Bead Types and five Link Types; selected ownership and invariants, with revision/lifecycle work still deferred. The comments request this companion and its task walkthrough; they are not a new runtime dependency. |
| #7758 and Beads source `86e1efcf63ae84736a63975d12ebb01250eb0d50` | Accepted command lineage and bounded per-root graph questions. Its older `--by`, synthetic-prefix elision, `bd types` and `--patch` examples do not override the shared canonical spellings here. |
| Older Beads facade's BDP dependency `afec9117914bd1c1fe0027c2067e4d89677e40a3` | Evidence for that older catalog only. It does not qualify v0.2 References ownership or its reduced catalog; retaining or listing an older definition is not authoring availability. |
| Beads catalog at `02da6f085001ad960680aff5b1279993541c45a9`, source reviewed by Trish | Direct References is already unowned; Memory owns Subject To and Superseded By, and Constraint owns Requires. There is no identified current ownership mismatch here. This source correspondence does not qualify the whole v0.2 design. |
| [Preview3 shared CLI alignment](preview3-alignment.md) | Settled selector, from/to, Type-filter, actual-Type renderer, product pin and current-compatible traversal decisions. These are CLI/adaptor contracts, not BDP schema changes. |
| [Release evidence ledger](https://github.com/gastownhall/beads/issues/7656) | Actual source-bound implementation, checks and integration status. A source review, this paper, or an older passing suite is not an aggregate runtime PASS. |

The older product facade still documents `bd types` and an earlier catalog;
it is not proof the ten focused reads or this v0.2 model are qualified. The
canonical `bd type list` location selects no new inventory payload. Assessment
authoring, evaluation/claim commands, custom Type installation, executable
applicability, domain query languages and parameterized batches are outside
this companion. Preserving their future design space changes no existing
command or string into an implicit executable instruction.

> **Cleo — Memory correspondence:** Reuse your selection/output and mutation
> helpers. Reconcile the three endpoint forms, singular property edit flags,
> revision selectors and actual declared Type labels against the selected build.
> Direct References is unowned in both the v0.2 design and the reviewed current
> catalog. Preserve the explicit generic/product/deferred pin boundaries above;
> do not change a runtime pin or claim qualification from publication.
