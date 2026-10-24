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

## CLI specification

Common flags and behavior are defined first. Each command then lists all the
flags it accepts, its defaults, behavior and examples. A common flag is
available only on commands that list it. Universal `--help` is omitted from
these listings.

The command order follows the walkthrough: references, replacement, requirements
and definitions, then Subject To. Ordinary Bead and Link CRUD uses the [general CLI specification](bdp-cli.md#cli-specification).

Type meanings and invariants come from the v0.2 model linked above. Where that
model leaves revision or lifecycle mechanics open, these signatures do not
settle them. A host must identify its implemented Type and shared contract, and
refuse operations it cannot faithfully provide.

### Common flags and reference syntax

<a id="memory-references"></a>

#### Scope, IDs and revisions

Use a configured default Scope for relative IDs. An absolute URL identifies its
Resource without relying on that default. Preserve the entire Scope-defined
name; there are no required `beads/`, `links/` or `types/` prefixes. A Type or
endpoint URL does not silently redirect a write into another Scope. The current
Memory Types proposal requires endpoints in one Scope.

| Reference | Meaning |
| --- | --- |
| `note-1` | The identity, using current content where a read needs content. |
| `note-1@3` | Select local revision number 3. |
| `note-1@=saved-r1` | Select exact revision token `saved-r1`. |
| `note-1@current` | Explicitly select current content. |
| `'[https://work.example/acme/note-1]@3'` | Select a revision of an absolute URL. Quote the argument for the shell. |

Each operand carries its own selection where the command permits one. An
unwrapped absolute URL is literal, including any `@` in that URL. Bracketed URLs
require a revision suffix. Local revision numbers require a valid store-local
mapping to full tokens; failure to resolve a number is an error. The [shared reference grammar](bdp-cli.md#reference-syntax) defines the complete rules.

New local Bead and Link IDs reserve `@` for revision syntax. Already-issued
identities remain unchanged and can be addressed by their literal absolute URL.
A revision suffix never authorizes a pin forbidden by the selected Type. In
particular, selecting historical point content does not establish support for
historical graph traversal.

`--scope SCOPE` remains **Unreviewed**, as in the general CLI. It appears in the
command tables to make that status visible; this pass does not settle its
configuration or override rules.

<a id="memory-creation-ids"></a>

#### Creation IDs: `--id` and `--id-root`

| Flag | Meaning | When omitted |
| --- | --- | --- |
| `--id ID` | Choose the complete local Link ID. This value is literal. | Generate a new ID. |
| `--id-root ROOT` | Generate an ID under this local path prefix. | Use ordinary ID generation. |

These flags are mutually exclusive. ID generation and lifetime reservation use
the common writer; a deleted ID does not become reusable. `--id-root` requires a
supported allocation adapter. It does not add an `idRoot` wire field or promise
that an offline operation can reserve a name. See the [general creation-ID rules](bdp-cli.md#creation-ids).

<a id="memory-endpoints"></a>

#### Link endpoints: operands, `--from` and `--to`

All five creation commands accept exactly these forms, with the command's own
operand names substituted for `SOURCE` and `TARGET`:

```text
bd memory VERB SOURCE TARGET [OPTIONS]
bd memory VERB SOURCE --to TARGET [OPTIONS]
bd memory VERB --from SOURCE --to TARGET [OPTIONS]
```

Bind each endpoint once. Duplicate bindings are errors even when their values
are equal. A lone endpoint flag or the inverted form `--from SOURCE TARGET` is
invalid. There is no `--by`, `--source` or `--target` alternative here.

References can select endpoint revisions where their Type and writer allow that
operation. Generic owned-state rules and the Beads product's current refusal of
owned-source pins are distinct contracts. These commands do not settle the v0.2
model's deferred pin mechanics or silently repin an endpoint. Product pin
operations described in [Preview3 alignment](preview3-alignment.md#product-endpoint-pin-operations) remain
separate from literal endpoint References.

<a id="memory-creation-inputs"></a>

#### Creation properties and metadata

| Flag | Meaning | When omitted |
| --- | --- | --- |
| `--properties JSON` | Initialize the Link's declared properties. | Supply no properties through this option. |
| `--metadata JSON` | Initialize informational metadata. | Supply no metadata. |
| `--title TEXT` | Set the Link's `title` property. | Leave `title` absent. |
| `--body TEXT` | Set the Link's `body` property. | Leave `body` absent. |
| `--status TEXT` | Set its descriptive `status` property. | Leave `status` absent. |

Object inputs accept inline JSON, `@FILE` or `@-` under the [common object-input rules](object-edits.md). Read and freeze inputs before dispatch; only one input
may consume stdin. Duplicate object members, invalid Unicode and inadmissible
numbers are errors.

A property cannot be supplied both by name and in `--properties`, even with an
equal value. Omission stays omission. These relationship properties must be
nonblank when supplied. Status does not activate a rule, approve a replacement
or change a workflow. Creation accepts initialization, not update-only
replace/patch/set/unset modes.

Each command fixes its nominal installed Link Type. It accepts neither `--type`
nor `--exact-type`. Use `bd link create --type TYPE` to create another admitted
Type or refinement. Actual installed Type References, rather than guessed URI
prefixes or display names, identify those definitions.

<a id="memory-guards"></a>

#### Revision guards

`--if-revision REV` guards an existing Resource mutation; `--from-revision REV`
selects content in a separately admitted historical edit or recovery operation.
Their shared `N` / `=TOKEN` grammar is defined in the [general write-revision rules](bdp-cli.md#write-revision-flags). Neither flag is an endpoint pin, and
neither is accepted by these five Link creation commands or ten relationship
reads.

The existing Beads product option `--if-source-revision TOKEN` is a different,
conditional creation option: require that the owning source still has this exact
revision token. It is available only through an authoritative writer that
supports that source guard, and only for an owned relationship. Its existing
product token syntax does not define a new generic BDP field or a client-side
read/check/write procedure. The product's guard-parser alignment is
implementation correspondence, not a new syntax decision in this pass.

A stale admitted guard refuses the whole write atomically, including a would-be
no-op. Plain References is unowned and does not admit an owner guard.

<a id="memory-depth"></a>

#### Traversal depth: `--depth`

`--depth N` sets the hop limit for the eight ordinary family traversals. Their
per-command tables give the default. A default of 1000 is a bound, not unlimited
traversal. Each requested root gets its own hop allowance; acquisition, output
and candidate-work caps are cumulative across all roots and stages.

Find the Beads reached from each root in the selected direction and depth, then
retain all matching-family Links between those Beads. Keep parallel, cross and
cycle-closing Links. Compute this graph for each root before combining results;
do not induce extra Links across the combined Bead union. For A→B, A→C, B→D and
C→D, roots A and B at depth one retain AB, AC and BD, not CD. No individual root
reached both C and D within its allowance.

Visited identities prevent endless expansion without dropping selected Links.
Requires and direct References can cycle. Defines and Superseded By follow their
stronger Type invariants. A read must not relabel a cycle as a tree or silently
repair invalid stored relationships.

`constraints` has a staged bound whose separate depth controls remain
unselected. `subjects` is direct only. Neither command accepts `--depth` in this
candidate. Collection paging, Type filters, arbitrary Selectors and additional
direction flags are not automatically accepted by a fixed Memory question.

<a id="memory-read-view"></a>

#### Consistent reads and unavailable information

Each relationship read requires one or more roots in one consistent, bounded
read view. Preserve roots with no matching relationships, each root's
membership, supporting paths, exact stored pins and any depth frontier. Root
order cannot change the question or transfer obligations between roots.

These are derived graph questions. Ordinary BDP collection Selectors provide
neither recursive joins nor a coherent snapshot across independent pages. A host
needs a suitable traversal/read-view adapter. Without one, it refuses the
operation. The canonical correspondence below describes composition of ordinary
reads, not a new Memory wire method or an invented graph/query command.

The selected Preview3 specialized adapter requires current-compatible endpoint
pins in its captured current view and refuses a mismatch. Generic graph display
has a different contract: it may show current Bead bodies alongside older stored
pins. Do not float an exact pin, substitute today's body for a historical root,
or use today's graph as historical evidence. General historical graph traversal
is not selected by these signatures.

An invalid, inaccessible or unavailable requested root, incompatible endpoint
binding, or acquisition/work/output budget failure refuses the aggregate. It
must not become successful empty or partial discovery. An admitted depth
frontier is shown as a bound; it proves neither terminal replacement, complete
obligations nor satisfaction.

<a id="memory-output"></a>

#### Output and detail

Relationship reads default to the shared compact relationship tree; no `--graph`
flag is needed. Show root IDs, actual Types and titles. Links show their actual
Types and authored direction, even during incoming traversal. Distinguish
cycles, shared descendants and repeated expansion; preserve every selected Link.
At a Constraint, show Defines children before other Requires dependencies.
Indentation does not establish ownership or readiness.

`--long` exposes administrative details, full References and exact tokens
through the common renderer. Human shortening removes only the exact local Scope
prefix, preserving every literal segment. Redirection never changes the output
format. Diagnostics go to stderr.

Graph JSON/JSONL framing and its format/projection matrix remain **Unreviewed**.
The [ordinary-read schema](read-output.md) has six descriptors and no graph
descriptor. This companion adds no private result schema. Graph machine output
must retain roots, per-root membership, supporting paths and bounds before an
adapter can claim support. The read signatures list the common output-format
option, but its nondefault graph formats remain unreviewed. Ordinary point-read
or collection formats and field masks do not automatically apply to a graph.

Creation uses Cleo's common Link success renderer: a brief acknowledgement and
the shared row, including the new Link ID. `--output-format FORMAT` may select
only a format supported for that complete native mutation result. It does not
turn a compound Link/source result into an ordinary point-read record.
Structured output must preserve every native result component, including a
source revision when actually returned; human output invents no revision field
or extra commit stream. Unsupported format combinations refuse.

<a id="memory-exit-status"></a>

#### Errors and exit status

| Status | Meaning |
| --- | --- |
| `0` | Successful operation, including a read with no matching relationships. |
| `2` | Invalid arguments, conflicting options, invalid values or missing Scope for a relative ID. |
| `3` | A diagnosed missing requested Resource or selected revision. |
| `4` | A diagnosed revision mismatch. |
| `5` | Required operation, Type, revision lookup, allocation or read-view support is unavailable. |
| `130` | Delivery was interrupted. |
| `1` | Other failure, including access denial, graph invariant refusal, budget exhaustion, output failure or unknown write outcome. |

These are the general CLI's proposed statuses, not a renumbering of released
Preview exits. Preserve native BDP Problems. Do not classify all HTTP 409 or 422
responses as a revision mismatch. A failed display does not undo a known write;
unknown mutation disposition follows the common recovery contract, without blind
replay. Each entry below calls out its command-specific failures.

<a id="memory-common-creation"></a>

#### Common creation behavior

All five creation commands use the common Link writer, allocator and transaction
boundary. They supply no validation bypass, separate upsert or independent retry
policy. The writer validates the affected prospective graph atomically;
read-time diagnostics do not establish enforcement.

The Types inherit References' prohibition on a Link from a Bead identity to
itself. Selecting different revisions does not make two identities. Requires'
same-identity cross-revision rule remains provisional in the v0.2 Type design;
this command reference does not resolve that deferred question.

An owned Link change revises its source, not its target. Plain References is
unowned and revises neither endpoint. Subject To ownership must be declared by
the actual source Type; accepting an endpoint does not install ownership. No
command implicitly deletes a Bead, changes status, establishes compliance or
edits previously authored references.

Without an explicit ID, repeated References creation makes distinct Links for
equal endpoints. Explicit-ID conflict and exact retry follow the common writer.
The other creation commands also retain their own Type cardinality and cycle
checks; endpoint equality is never an instruction to retarget or upsert a Link.

Each per-command mapping uses the actual installed Type Reference shown as a
shell variable, not a guessed URI. The named `title`, `body` and `status` flags
become properties in the corresponding generic `bd link create` operation. IDs,
metadata and admitted endpoint pins retain their ordinary meanings. Conditional
product source guards require that same authoritative writer.

Operation emission and [atomic batch](atomic-batch.md) use the corresponding
generic Link command. These commands add no new Memory wire discriminator or
Memory-specific emission flags.

### Reference commands

#### `bd memory reference`

Create a References Link from a Bead to useful context.

##### Usage

```text
bd memory reference SOURCE TARGET [OPTIONS]
bd memory reference SOURCE --to TARGET [OPTIONS]
bd memory reference --from SOURCE --to TARGET [OPTIONS]

OPTIONS:
    [--id ID | --id-root ROOT] [--properties JSON] [--metadata JSON]
    [--title TEXT] [--body TEXT] [--status TEXT]
    [--scope SCOPE] [--output-format FORMAT] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `SOURCE` | Yes, positional or `--from` | Source Bead in an eligible References pair. |
| `TARGET` | Yes, positional or `--to` | Context Bead in that correlated pair. |

Each endpoint is a [Reference](#memory-references), subject to this Type's pin
rules.

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--from REF` | No separate binding | Supply SOURCE by flag. See [endpoint forms](#memory-endpoints). |
| `--to REF` | No separate binding | Supply TARGET by flag. |
| `--id ID` | Generated | Set the complete Link ID. See [creation IDs](#memory-creation-ids). |
| `--id-root ROOT` | Ordinary allocation | Generate under a prefix; requires allocation support. |
| `--properties JSON` | Not supplied | Initialize properties. See [creation inputs](#memory-creation-inputs). |
| `--metadata JSON` | Not supplied | Initialize informational metadata. |
| `--title TEXT` | Absent | Set the nonblank title property. |
| `--body TEXT` | Absent | Set the nonblank body property. |
| `--status TEXT` | Absent | Set descriptive, nonblank status text. |
| `--scope SCOPE` | Unreviewed | Relative-ID Scope selection; see [Scope and references](#memory-references). |
| `--output-format FORMAT` | `default` | Use a supported common mutation format. See [output](#memory-output). |
| `--long` | Off | Show full References and administrative details. |

##### Behavior

Create the installed nominal References Type. Endpoint eligibility is
correlated: Memory→Memory, Memory→Issue, Issue→Memory, or any Bead→Constraint.
It is not permission for arbitrary Bead pairs. The current proposal keeps both
endpoints in one Scope and forbids a self-Link by identity.

Direct References is unowned: neither endpoint revision changes. Parallel Links
and cycles are allowed. Equal endpoints on separate calls do not deduplicate
Links. See [common creation behavior](#memory-common-creation).

##### Results

Return the created References Link through the [common Link success renderer](#memory-output), including its identity, actual Type and endpoints.
Preserve the complete native mutation result in supported structured output.
Endpoint revision effects follow [common creation behavior](#memory-common-creation).

##### Errors and exit status

Ineligible endpoint pairs and self-Links refuse. Duplicate endpoint bindings or
properties are usage errors. An owner guard is not accepted for this unowned
relationship. Use the [common statuses](#memory-exit-status); only a successful
admitted write returns `0`. Ordinary allocation, Type, access and output
failures keep their common diagnosis.

##### Canonical CLI correspondence

```text
bd link create SOURCE TARGET --type "$REFERENCES_TYPE" [COMMON-CREATE-OPTIONS]
```

`REFERENCES_TYPE` is the installed nominal References Type Reference. All three
endpoint forms select the same operation. Named properties become fields of
`--properties`; IDs, metadata and admitted endpoint pins follow the
[shared creation mapping](#memory-common-creation). This unowned Type has no
source owner guard.

##### Examples

```sh
# Connect a design note to its encoding context.
bd memory reference csv-design csv-encoding --id encoding-context

# Name the target with --to and explain the connection.
bd memory reference csv-design --to csv-encoding --title "Encoding context"

# Name both endpoints explicitly.
bd memory reference --from csv-design --to csv-encoding

```

#### `bd memory references`

Find context referenced by one or more Beads.

##### Usage

```text
bd memory references REF... [--depth N]
    [--scope SCOPE] [--output-format FORMAT] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `REF...` | One or more | One or more Beads eligible for the selected References family. Each is a [Reference](#memory-references). |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--depth N` | `1` | Set each root's hop allowance. See [traversal depth](#memory-depth). |
| `--scope SCOPE` | Unreviewed | Relative-ID Scope selection; see [Scope and references](#memory-references). |
| `--output-format FORMAT` | `default` | Use shared graph output; nondefault formats remain [Unreviewed](#memory-output). |
| `--long` | Off | Show full References and administrative details. |

##### Behavior

Follow outgoing References-family Links from each root, using its own depth
allowance. This family includes supported refinements, which may have different
ownership from direct References. Endpoint eligibility follows each selected
Type's correlated pairs, not arbitrary Bead connectivity.

The selected family is **References, including supported refinements**. The
common [consistent-read and revision limits](#memory-read-view) apply to every
root. Type, direction, collection paging and arbitrary Selector flags are not
accepted.

##### Results

Each root and its referenced context, with all matching-family Links in that
root's reached set. Actual Types, authored arrows and any depth frontier remain
visible. Use the [shared relationship output](#memory-output), preserving
zero-hop roots, per-root membership, exact pins and bounds. No stored
relationship is created.

##### Errors and exit status

Unsupported historical root/endpoint binding or a missing read-view adapter
refuses; invalid, unavailable or inaccessible requested roots and budget
exhaustion refuse the aggregate. Use the [common statuses](#memory-exit-status).
A successful root-only result is `0`; refusal is never disguised as that result.

##### Canonical CLI correspondence

At each admitted expansion step, select Links using the equivalent of `bd link
list --from REF --type "$REFERENCES_TYPE"` and obtain the needed Beads through
`bd show`. The Type filter selects its family. The shared adapter must supply
one consistent view, apply per-root depth, retain all matching Links in each
root's reached set, and combine results under cumulative caps. A single `bd
list` or Link page does not implement this traversal. See [consistent-read requirements](#memory-read-view); independent ordinary pages alone do not
establish that view. Display controls change rendering, not the selected graph.

##### Examples

```sh
# Read the direct context for the design note.
bd memory references csv-design

# Follow context through up to three hops from each root.
bd memory references csv-design csv-guide --depth 3

```

#### `bd memory referenced-by`

Find Beads that reference one or more context Beads.

##### Usage

```text
bd memory referenced-by REF... [--depth N]
    [--scope SCOPE] [--output-format FORMAT] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `REF...` | One or more | One or more Beads eligible as targets in the selected References family. Each is a [Reference](#memory-references). |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--depth N` | `1` | Set each root's hop allowance. See [traversal depth](#memory-depth). |
| `--scope SCOPE` | Unreviewed | Relative-ID Scope selection; see [Scope and references](#memory-references). |
| `--output-format FORMAT` | `default` | Use shared graph output; nondefault formats remain [Unreviewed](#memory-output). |
| `--long` | Off | Show full References and administrative details. |

##### Behavior

Follow incoming References-family Links from each root. Incoming traversal
changes the search direction, not the stored arrow: the referring source still
points to the referenced target. Retain all matching Links admitted for each
root, including parallel and cycle-closing Links.

The selected family is **References, including supported refinements**. The
common [consistent-read and revision limits](#memory-read-view) apply to every
root. Type, direction, collection paging and arbitrary Selector flags are not
accepted.

##### Results

Each requested context Bead and the Beads that refer to it within the selected
depth. Shared referrers preserve their membership under each root. Use the
[shared relationship output](#memory-output), preserving zero-hop roots,
per-root membership, exact pins and bounds. No stored relationship is created.

##### Errors and exit status

Unsupported historical root/endpoint binding or a missing read-view adapter
refuses; invalid, unavailable or inaccessible requested roots and budget
exhaustion refuse the aggregate. Use the [common statuses](#memory-exit-status).
A successful root-only result is `0`; refusal is never disguised as that result.

##### Canonical CLI correspondence

At each admitted expansion step, select Links using the equivalent of `bd link
list --to REF --type "$REFERENCES_TYPE"` and obtain the needed Beads through `bd
show`. The Type filter selects its family. The shared adapter must supply one
consistent view, apply per-root depth, retain all matching Links in each root's
reached set, and combine results under cumulative caps. A single `bd list` or
Link page does not implement this traversal. See [consistent-read requirements](#memory-read-view); independent ordinary pages alone do not
establish that view. Display controls change rendering, not the selected graph.

##### Examples

```sh
# Find direct references to the encoding note.
bd memory referenced-by csv-encoding

```

### Replacement commands

#### `bd memory supersede`

Record that one Memory has been replaced by another identity.

##### Usage

```text
bd memory supersede OLD NEW [OPTIONS]
bd memory supersede OLD --to NEW [OPTIONS]
bd memory supersede --from OLD --to NEW [OPTIONS]

OPTIONS:
    [--id ID | --id-root ROOT] [--properties JSON] [--metadata JSON]
    [--title TEXT] [--body TEXT] [--status TEXT] [--if-source-revision TOKEN]
    [--scope SCOPE] [--output-format FORMAT] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `OLD` | Yes, positional or `--from` | Retiring Memory or supported refinement. |
| `NEW` | Yes, positional or `--to` | Replacement Memory or supported refinement. |

Each endpoint is a [Reference](#memory-references), subject to this Type's pin
rules.

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--from REF` | No separate binding | Supply OLD by flag. See [endpoint forms](#memory-endpoints). |
| `--to REF` | No separate binding | Supply NEW by flag. |
| `--id ID` | Generated | Set the complete Link ID. See [creation IDs](#memory-creation-ids). |
| `--id-root ROOT` | Ordinary allocation | Generate under a prefix; requires allocation support. |
| `--properties JSON` | Not supplied | Initialize properties. See [creation inputs](#memory-creation-inputs). |
| `--metadata JSON` | Not supplied | Initialize informational metadata. |
| `--title TEXT` | Absent | Set the nonblank title property. |
| `--body TEXT` | Absent | Set the nonblank body property. |
| `--status TEXT` | Absent | Set descriptive, nonblank status text. |
| `--if-source-revision TOKEN` | No source guard | Conditional product owner guard; see [revision guards](#memory-guards). |
| `--scope SCOPE` | Unreviewed | Relative-ID Scope selection; see [Scope and references](#memory-references). |
| `--output-format FORMAT` | `default` | Use a supported common mutation format. See [output](#memory-output). |
| `--long` | Off | Show full References and administrative details. |

##### Behavior

Create OLD→NEW using the installed nominal Superseded By Type. Both endpoints
are distinct Memory identities and floating under the v0.2 design. OLD owns the
Link; recording it revises OLD, not NEW.

OLD may have at most one outgoing Superseded By-family Link. An existing one
refuses even when it already names NEW. The prospective replacement graph must
remain acyclic. This command never retargets, silently replaces or treats an
existing successor as a no-op. Common exact retry is a separate writer contract.
The old Memory stays readable and existing references remain unchanged.

##### Results

Return the created Superseded By Link through the [common Link success renderer](#memory-output), including its identity, actual Type and endpoints.
Preserve the complete native mutation result in supported structured output.
Endpoint revision effects follow [common creation behavior](#memory-common-creation).

##### Errors and exit status

Pinned or ineligible endpoints, an existing outgoing successor, or a prospective
cycle refuse. A stale admitted source guard is a revision mismatch. Use the
[common statuses](#memory-exit-status); only a successful admitted write returns
`0`. Ordinary allocation, Type, access and output failures keep their common
diagnosis.

##### Canonical CLI correspondence

```text
bd link create OLD NEW --type "$SUPERSEDED_BY_TYPE" [COMMON-CREATE-OPTIONS]
```

`SUPERSEDED_BY_TYPE` is the installed nominal Superseded By Type Reference. All
three endpoint forms select the same operation. Named properties become fields
of `--properties`; IDs, metadata, endpoint pins and supported owner guards
follow the [shared creation mapping](#memory-common-creation).

##### Examples

```sh
# Record the guide as the replacement for the old note.
bd memory supersede csv-encoding csv-guide --id encoding-replacement

# Use the same old-to-new direction with flag-bound endpoints.
bd memory supersede --from csv-encoding --to csv-guide

```

#### `bd memory successor`

Follow the recorded replacements of one or more Memories.

##### Usage

```text
bd memory successor REF... [--depth N]
    [--scope SCOPE] [--output-format FORMAT] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `REF...` | One or more | One or more Memory Beads or supported refinements. Each is a [Reference](#memory-references). |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--depth N` | `1000` | Set each root's hop allowance. See [traversal depth](#memory-depth). |
| `--scope SCOPE` | Unreviewed | Relative-ID Scope selection; see [Scope and references](#memory-references). |
| `--output-format FORMAT` | `default` | Use shared graph output; nondefault formats remain [Unreviewed](#memory-output). |
| `--long` | Off | Show full References and administrative details. |

##### Behavior

Follow outgoing Superseded By-family Links from each original Memory. Retain
every intermediate Memory and selected Link. This is replacement across
identities, not the version history of one identity.

The default depth is bounded. A frontier cannot be presented as the terminal
successor; the read neither rewrites existing references nor approves the
replacement.

The selected family is **Superseded By, including supported refinements**. The
common [consistent-read and revision limits](#memory-read-view) apply to every
root. Type, direction, collection paging and arbitrary Selector flags are not
accepted.

##### Results

The replacement paths from each root, including intermediate Memories and any
bound encountered. A root with no replacement is still shown. Use the [shared relationship output](#memory-output), preserving zero-hop roots, per-root
membership, exact pins and bounds. No stored relationship is created.

##### Errors and exit status

Unsupported historical root/endpoint binding or a missing read-view adapter
refuses; invalid, unavailable or inaccessible requested roots and budget
exhaustion refuse the aggregate. Use the [common statuses](#memory-exit-status).
A successful root-only result is `0`; refusal is never disguised as that result.

##### Canonical CLI correspondence

At each admitted expansion step, select Links using the equivalent of `bd link
list --from REF --type "$SUPERSEDED_BY_TYPE"` and obtain the needed Beads
through `bd show`. The Type filter selects its family. The shared adapter must
supply one consistent view, apply per-root depth, retain all matching Links in
each root's reached set, and combine results under cumulative caps. A single `bd
list` or Link page does not implement this traversal. See [consistent-read requirements](#memory-read-view); independent ordinary pages alone do not
establish that view. Display controls change rendering, not the selected graph.

##### Examples

```sh
# Follow the encoding note's recorded replacement path.
bd memory successor csv-encoding

```

#### `bd memory supersedes`

Find Memories directly replaced by the requested Memories.

##### Usage

```text
bd memory supersedes REF... [--depth N]
    [--scope SCOPE] [--output-format FORMAT] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `REF...` | One or more | One or more replacement Memory Beads or supported refinements. Each is a [Reference](#memory-references). |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--depth N` | `1` | Set each root's hop allowance. See [traversal depth](#memory-depth). |
| `--scope SCOPE` | Unreviewed | Relative-ID Scope selection; see [Scope and references](#memory-references). |
| `--output-format FORMAT` | `default` | Use shared graph output; nondefault formats remain [Unreviewed](#memory-output). |
| `--long` | Off | Show full References and administrative details. |

##### Behavior

Follow incoming Superseded By-family Links. At the default depth, the result
shows direct predecessors of each requested replacement. With a larger depth,
follow earlier predecessors under the same bounded read rules. Keep the stored
old→replacement arrows and per-root membership.

The selected family is **Superseded By, including supported refinements**. The
common [consistent-read and revision limits](#memory-read-view) apply to every
root. Type, direction, collection paging and arbitrary Selector flags are not
accepted.

##### Results

Each replacement root and its selected predecessor Memories. These are separate
identities, not earlier revisions of the root. Use the [shared relationship output](#memory-output), preserving zero-hop roots, per-root membership, exact
pins and bounds. No stored relationship is created.

##### Errors and exit status

Unsupported historical root/endpoint binding or a missing read-view adapter
refuses; invalid, unavailable or inaccessible requested roots and budget
exhaustion refuse the aggregate. Use the [common statuses](#memory-exit-status).
A successful root-only result is `0`; refusal is never disguised as that result.

##### Canonical CLI correspondence

At each admitted expansion step, select Links using the equivalent of `bd link
list --to REF --type "$SUPERSEDED_BY_TYPE"` and obtain the needed Beads through
`bd show`. The Type filter selects its family. The shared adapter must supply
one consistent view, apply per-root depth, retain all matching Links in each
root's reached set, and combine results under cumulative caps. A single `bd
list` or Link page does not implement this traversal. See [consistent-read requirements](#memory-read-view); independent ordinary pages alone do not
establish that view. Display controls change rendering, not the selected graph.

##### Examples

```sh
# Find the Memories directly replaced by the guide.
bd memory supersedes csv-guide

```

### Requirement and definition commands

#### `bd memory requires`

Record that one Constraint requires another Constraint.

##### Usage

```text
bd memory requires SOURCE TARGET [OPTIONS]
bd memory requires SOURCE --to TARGET [OPTIONS]
bd memory requires --from SOURCE --to TARGET [OPTIONS]

OPTIONS:
    [--id ID | --id-root ROOT] [--properties JSON] [--metadata JSON]
    [--title TEXT] [--body TEXT] [--status TEXT] [--if-source-revision TOKEN]
    [--scope SCOPE] [--output-format FORMAT] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `SOURCE` | Yes, positional or `--from` | Constraint whose obligations include the dependency. |
| `TARGET` | Yes, positional or `--to` | Necessary Constraint, maintained independently. |

Each endpoint is a [Reference](#memory-references), subject to this Type's pin
rules.

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--from REF` | No separate binding | Supply SOURCE by flag. See [endpoint forms](#memory-endpoints). |
| `--to REF` | No separate binding | Supply TARGET by flag. |
| `--id ID` | Generated | Set the complete Link ID. See [creation IDs](#memory-creation-ids). |
| `--id-root ROOT` | Ordinary allocation | Generate under a prefix; requires allocation support. |
| `--properties JSON` | Not supplied | Initialize properties. See [creation inputs](#memory-creation-inputs). |
| `--metadata JSON` | Not supplied | Initialize informational metadata. |
| `--title TEXT` | Absent | Set the nonblank title property. |
| `--body TEXT` | Absent | Set the nonblank body property. |
| `--status TEXT` | Absent | Set descriptive, nonblank status text. |
| `--if-source-revision TOKEN` | No source guard | Conditional product owner guard; see [revision guards](#memory-guards). |
| `--scope SCOPE` | Unreviewed | Relative-ID Scope selection; see [Scope and references](#memory-references). |
| `--output-format FORMAT` | `default` | Use a supported common mutation format. See [output](#memory-output). |
| `--long` | Off | Show full References and administrative details. |

##### Behavior

Create SOURCE→TARGET using the installed nominal Requires Type. Both endpoints
must be Constraints or admitted refinements. SOURCE owns the Link and TARGET
remains independently maintained. A Requires cycle is permitted; a read must
terminate repeated expansion while preserving its selected edges.

The Link states a necessary dependency. It does not execute either Constraint,
prove satisfaction or turn the target into a defining child. See [common creation behavior](#memory-common-creation).

##### Results

Return the created Requires Link through the [common Link success renderer](#memory-output), including its identity, actual Type and endpoints.
Preserve the complete native mutation result in supported structured output.
Endpoint revision effects follow [common creation behavior](#memory-common-creation).

##### Errors and exit status

Ineligible Constraint endpoints, same-identity self-Links or unsupported
pin/ownership combinations refuse. A cycle through distinct Constraint identities
alone is not an error. A stale admitted source guard is a revision mismatch.
Use the [common statuses](#memory-exit-status); only a successful admitted write returns `0`. Ordinary allocation, Type, access and
output failures keep their common diagnosis.

##### Canonical CLI correspondence

```text
bd link create SOURCE TARGET --type "$REQUIRES_TYPE" [COMMON-CREATE-OPTIONS]
```

`REQUIRES_TYPE` is the installed nominal Requires Type Reference. All three
endpoint forms select the same operation. Named properties become fields of
`--properties`; IDs, metadata, endpoint pins and supported owner guards follow
the [shared creation mapping](#memory-common-creation).

##### Examples

```sh
# Require an independently maintained data-handling Policy.
bd memory requires csv-format customer-data --title "Protect exported data"

```

#### `bd memory requirements`

Discover the required Constraints of one or more Constraints.

##### Usage

```text
bd memory requirements REF... [--depth N]
    [--scope SCOPE] [--output-format FORMAT] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `REF...` | One or more | One or more Constraint Beads or supported refinements. Each is a [Reference](#memory-references). |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--depth N` | `1000` | Set each root's hop allowance. See [traversal depth](#memory-depth). |
| `--scope SCOPE` | Unreviewed | Relative-ID Scope selection; see [Scope and references](#memory-references). |
| `--output-format FORMAT` | `default` | Use shared graph output; nondefault formats remain [Unreviewed](#memory-output). |
| `--long` | Off | Show full References and administrative details. |

##### Behavior

Follow outgoing Requires-family Links, including Defines. This includes both
defining children and separately maintained requirements. The root's own body
continues to apply; reached dependencies do not replace it.

Requires can cycle. Use visited identities to terminate expansion while keeping
all admitted cross, parallel and cycle-closing Links. Show Defines children
before other Requires dependencies at each node.

The selected family is **Requires, including Defines and other supported
refinements**. The common [consistent-read and revision limits](#memory-read-view) apply to every root. Type, direction, collection
paging and arbitrary Selector flags are not accepted.

##### Results

Each Constraint root and its bounded dependency graph. The result records
necessary dependencies, not proof that any requirement has been met. Use the
[shared relationship output](#memory-output), preserving zero-hop roots,
per-root membership, exact pins and bounds. No stored relationship is created.

##### Errors and exit status

Unsupported historical root/endpoint binding or a missing read-view adapter
refuses; invalid, unavailable or inaccessible requested roots and budget
exhaustion refuse the aggregate. Use the [common statuses](#memory-exit-status).
A successful root-only result is `0`; refusal is never disguised as that result.

##### Canonical CLI correspondence

At each admitted expansion step, select Links using the equivalent of `bd link
list --from REF --type "$REQUIRES_TYPE"` and obtain the needed Beads through `bd
show`. The Type filter selects its family. The shared adapter must supply one
consistent view, apply per-root depth, retain all matching Links in each root's
reached set, and combine results under cumulative caps. A single `bd list` or
Link page does not implement this traversal. See [consistent-read requirements](#memory-read-view); independent ordinary pages alone do not
establish that view. Display controls change rendering, not the selected graph.

##### Examples

```sh
# Read both defining details and external required Policies.
bd memory requirements csv-format

```

#### `bd memory required-by`

Find Constraints that depend on the requested Constraints.

##### Usage

```text
bd memory required-by REF... [--depth N]
    [--scope SCOPE] [--output-format FORMAT] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `REF...` | One or more | One or more Constraint Beads or supported refinements. Each is a [Reference](#memory-references). |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--depth N` | `1` | Set each root's hop allowance. See [traversal depth](#memory-depth). |
| `--scope SCOPE` | Unreviewed | Relative-ID Scope selection; see [Scope and references](#memory-references). |
| `--output-format FORMAT` | `default` | Use shared graph output; nondefault formats remain [Unreviewed](#memory-output). |
| `--long` | Off | Show full References and administrative details. |

##### Behavior

Follow incoming Requires-family Links, including Defines. At depth one, return
immediate dependents; a larger depth follows their dependents in turn. The
stored requiring→required direction remains visible. A direct dependent is not
automatically an original work subject or a compliance result.

The selected family is **Requires, including Defines and other supported
refinements**. The common [consistent-read and revision limits](#memory-read-view) apply to every root. Type, direction, collection
paging and arbitrary Selector flags are not accepted.

##### Results

Each requested Constraint and its selected dependents, with actual Link Types
showing defining and other requiring relationships. Use the [shared relationship output](#memory-output), preserving zero-hop roots, per-root membership, exact
pins and bounds. No stored relationship is created.

##### Errors and exit status

Unsupported historical root/endpoint binding or a missing read-view adapter
refuses; invalid, unavailable or inaccessible requested roots and budget
exhaustion refuse the aggregate. Use the [common statuses](#memory-exit-status).
A successful root-only result is `0`; refusal is never disguised as that result.

##### Canonical CLI correspondence

At each admitted expansion step, select Links using the equivalent of `bd link
list --to REF --type "$REQUIRES_TYPE"` and obtain the needed Beads through `bd
show`. The Type filter selects its family. The shared adapter must supply one
consistent view, apply per-root depth, retain all matching Links in each root's
reached set, and combine results under cumulative caps. A single `bd list` or
Link page does not implement this traversal. See [consistent-read requirements](#memory-read-view); independent ordinary pages alone do not
establish that view. Display controls change rendering, not the selected graph.

##### Examples

```sh
# Find Constraints that directly require the data-handling Policy.
bd memory required-by customer-data

```

#### `bd memory defines`

Add a Constraint as a defining child of another Constraint.

##### Usage

```text
bd memory defines PARENT CHILD [OPTIONS]
bd memory defines PARENT --to CHILD [OPTIONS]
bd memory defines --from PARENT --to CHILD [OPTIONS]

OPTIONS:
    [--id ID | --id-root ROOT] [--properties JSON] [--metadata JSON]
    [--title TEXT] [--body TEXT] [--status TEXT] [--if-source-revision TOKEN]
    [--scope SCOPE] [--output-format FORMAT] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `PARENT` | Yes, positional or `--from` | Parent Constraint that owns the defining Link. |
| `CHILD` | Yes, positional or `--to` | Constraint being defined as this parent's child. |

Each endpoint is a [Reference](#memory-references), subject to this Type's pin
rules.

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--from REF` | No separate binding | Supply PARENT by flag. See [endpoint forms](#memory-endpoints). |
| `--to REF` | No separate binding | Supply CHILD by flag. |
| `--id ID` | Generated | Set the complete Link ID. See [creation IDs](#memory-creation-ids). |
| `--id-root ROOT` | Ordinary allocation | Generate under a prefix; requires allocation support. |
| `--properties JSON` | Not supplied | Initialize properties. See [creation inputs](#memory-creation-inputs). |
| `--metadata JSON` | Not supplied | Initialize informational metadata. |
| `--title TEXT` | Absent | Set the nonblank title property. |
| `--body TEXT` | Absent | Set the nonblank body property. |
| `--status TEXT` | Absent | Set descriptive, nonblank status text. |
| `--if-source-revision TOKEN` | No source guard | Conditional product owner guard; see [revision guards](#memory-guards). |
| `--scope SCOPE` | Unreviewed | Relative-ID Scope selection; see [Scope and references](#memory-references). |
| `--output-format FORMAT` | `default` | Use a supported common mutation format. See [output](#memory-output). |
| `--long` | Off | Show full References and administrative details. |

##### Behavior

Create PARENT→CHILD using the installed nominal Defines Type, a refinement of
Requires. PARENT owns the Link; CHILD remains its own Bead identity.

Each child identity may have zero or one live incoming Defines-family Link. A
second incoming Link refuses even if it comes from the same parent. The
prospective Defines graph must remain acyclic. Creating a child relationship
does not assert that the children exhaust the parent's obligations; the parent's
own body still applies.

##### Results

Return the created Defines Link through the [common Link success renderer](#memory-output), including its identity, actual Type and endpoints.
Preserve the complete native mutation result in supported structured output.
Endpoint revision effects follow [common creation behavior](#memory-common-creation).

##### Errors and exit status

A second live incoming Defines-family Link or a prospective defining cycle
refuses. Ineligible endpoints and unsupported pin/ownership combinations also
refuse; stale admitted source guards are revision mismatches. Use the [common statuses](#memory-exit-status); only a successful admitted write returns `0`.
Ordinary allocation, Type, access and output failures keep their common
diagnosis.

##### Canonical CLI correspondence

```text
bd link create PARENT CHILD --type "$DEFINES_TYPE" [COMMON-CREATE-OPTIONS]
```

`DEFINES_TYPE` is the installed nominal Defines Type Reference. All three
endpoint forms select the same operation. Named properties become fields of
`--properties`; IDs, metadata, endpoint pins and supported owner guards follow
the [shared creation mapping](#memory-common-creation).

##### Examples

```sh
# Make the selected-row Requirement a defining child.
bd memory defines csv-format selected-rows

# Add the empty-export Scenario as another defining child.
bd memory defines csv-format --to empty-export

```

#### `bd memory definition`

Read the defining children of one or more Constraints.

##### Usage

```text
bd memory definition REF... [--depth N]
    [--scope SCOPE] [--output-format FORMAT] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `REF...` | One or more | One or more Constraint Beads or supported refinements. Each is a [Reference](#memory-references). |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--depth N` | `1000` | Set each root's hop allowance. See [traversal depth](#memory-depth). |
| `--scope SCOPE` | Unreviewed | Relative-ID Scope selection; see [Scope and references](#memory-references). |
| `--output-format FORMAT` | `default` | Use shared graph output; nondefault formats remain [Unreviewed](#memory-output). |
| `--long` | Off | Show full References and administrative details. |

##### Behavior

Follow outgoing Defines-family Links through the defining tree. Do not include
plain Requires Links to independently maintained Constraints. Each child has at
most one live defining parent under the Type invariant.

This read shows the authored decomposition. The parent's own text still applies,
and the tree does not assert that its leaves exhaust its obligations.

The selected family is **Defines, including supported refinements**. The common
[consistent-read and revision limits](#memory-read-view) apply to every root.
Type, direction, collection paging and arbitrary Selector flags are not
accepted.

##### Results

Each root and its bounded Defines-family tree, with actual Types and any depth
frontier. External Requires dependencies are absent unless separately reached
through Defines. Use the [shared relationship output](#memory-output),
preserving zero-hop roots, per-root membership, exact pins and bounds. No stored
relationship is created.

##### Errors and exit status

Unsupported historical root/endpoint binding or a missing read-view adapter
refuses; invalid, unavailable or inaccessible requested roots and budget
exhaustion refuse the aggregate. Use the [common statuses](#memory-exit-status).
A successful root-only result is `0`; refusal is never disguised as that result.

##### Canonical CLI correspondence

At each admitted expansion step, select Links using the equivalent of `bd link
list --from REF --type "$DEFINES_TYPE"` and obtain the needed Beads through `bd
show`. The Type filter selects its family. The shared adapter must supply one
consistent view, apply per-root depth, retain all matching Links in each root's
reached set, and combine results under cumulative caps. A single `bd list` or
Link page does not implement this traversal. See [consistent-read requirements](#memory-read-view); independent ordinary pages alone do not
establish that view. Display controls change rendering, not the selected graph.

##### Examples

```sh
# Read the Specification's Requirement and Scenario decomposition.
bd memory definition csv-format

```

#### `bd memory defined-by`

Find the defining parents of the requested Constraints.

##### Usage

```text
bd memory defined-by REF... [--depth N]
    [--scope SCOPE] [--output-format FORMAT] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `REF...` | One or more | One or more child Constraint Beads or supported refinements. Each is a [Reference](#memory-references). |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--depth N` | `1` | Set each root's hop allowance. See [traversal depth](#memory-depth). |
| `--scope SCOPE` | Unreviewed | Relative-ID Scope selection; see [Scope and references](#memory-references). |
| `--output-format FORMAT` | `default` | Use shared graph output; nondefault formats remain [Unreviewed](#memory-output). |
| `--long` | Off | Show full References and administrative details. |

##### Behavior

Follow incoming Defines-family Links. At the default depth, return each child's
direct defining parent, if present. A greater depth follows ancestors. Keep the
parent→child arrows; this is not an outgoing requirements query. The
one-live-incoming-Link invariant applies per child identity.

The selected family is **Defines, including supported refinements**. The common
[consistent-read and revision limits](#memory-read-view) apply to every root.
Type, direction, collection paging and arbitrary Selector flags are not
accepted.

##### Results

Each child root and its selected defining ancestors. A child without a defining
parent remains a successful root-only result. Use the [shared relationship output](#memory-output), preserving zero-hop roots, per-root membership, exact
pins and bounds. No stored relationship is created.

##### Errors and exit status

Unsupported historical root/endpoint binding or a missing read-view adapter
refuses; invalid, unavailable or inaccessible requested roots and budget
exhaustion refuse the aggregate. Use the [common statuses](#memory-exit-status).
A successful root-only result is `0`; refusal is never disguised as that result.

##### Canonical CLI correspondence

At each admitted expansion step, select Links using the equivalent of `bd link
list --to REF --type "$DEFINES_TYPE"` and obtain the needed Beads through `bd
show`. The Type filter selects its family. The shared adapter must supply one
consistent view, apply per-root depth, retain all matching Links in each root's
reached set, and combine results under cumulative caps. A single `bd list` or
Link page does not implement this traversal. See [consistent-read requirements](#memory-read-view); independent ordinary pages alone do not
establish that view. Display controls change rendering, not the selected graph.

##### Examples

```sh
# Find the Specification that defines the selected-row Requirement.
bd memory defined-by selected-rows

```

### Subject To commands

#### `bd memory subject-to`

Declare that a Bead is subject to a Constraint.

##### Usage

```text
bd memory subject-to SUBJECT CONSTRAINT [OPTIONS]
bd memory subject-to SUBJECT --to CONSTRAINT [OPTIONS]
bd memory subject-to --from SUBJECT --to CONSTRAINT [OPTIONS]

OPTIONS:
    [--id ID | --id-root ROOT] [--properties JSON] [--metadata JSON]
    [--title TEXT] [--body TEXT] [--status TEXT] [--if-source-revision TOKEN]
    [--scope SCOPE] [--output-format FORMAT] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `SUBJECT` | Yes, positional or `--from` | Bead explicitly governed by the declaration. |
| `CONSTRAINT` | Yes, positional or `--to` | Constraint or admitted refinement that governs it. |

Each endpoint is a [Reference](#memory-references), subject to this Type's pin
rules.

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--from REF` | No separate binding | Supply SUBJECT by flag. See [endpoint forms](#memory-endpoints). |
| `--to REF` | No separate binding | Supply CONSTRAINT by flag. |
| `--id ID` | Generated | Set the complete Link ID. See [creation IDs](#memory-creation-ids). |
| `--id-root ROOT` | Ordinary allocation | Generate under a prefix; requires allocation support. |
| `--properties JSON` | Not supplied | Initialize properties. See [creation inputs](#memory-creation-inputs). |
| `--metadata JSON` | Not supplied | Initialize informational metadata. |
| `--title TEXT` | Absent | Set the nonblank title property. |
| `--body TEXT` | Absent | Set the nonblank body property. |
| `--status TEXT` | Absent | Set descriptive, nonblank status text. |
| `--if-source-revision TOKEN` | No source guard | Conditional product owner guard; see [revision guards](#memory-guards). |
| `--scope SCOPE` | Unreviewed | Relative-ID Scope selection; see [Scope and references](#memory-references). |
| `--output-format FORMAT` | `default` | Use a supported common mutation format. See [output](#memory-output). |
| `--long` | Off | Show full References and administrative details. |

##### Behavior

Create SUBJECT→CONSTRAINT using the installed nominal Subject To Type. The
source can be any Bead whose installed Type and writer support this contract;
the target must be a Constraint or admitted refinement.

The subject owns the Link only under its actual installed ownership declaration.
Endpoint eligibility alone does not add ownership. For example, native Issue
support must be present in the Issue Type and authoritative writer. Recording a
declaration neither executes the Constraint nor establishes compliance or
changes readiness.

##### Results

Return the created Subject To Link through the [common Link success renderer](#memory-output), including its identity, actual Type and endpoints.
Preserve the complete native mutation result in supported structured output.
Endpoint revision effects follow [common creation behavior](#memory-common-creation).

##### Errors and exit status

An ineligible target, same-identity self-Link, missing source ownership support
for the selected operation, or unsupported endpoint binding refuses. An admitted
source guard applies only to an owned relationship; stale guards are revision
mismatches. Use the [common statuses](#memory-exit-status); only a successful admitted write
returns `0`. Ordinary allocation, Type, access and output failures keep their
common diagnosis.

##### Canonical CLI correspondence

```text
bd link create SUBJECT CONSTRAINT --type "$SUBJECT_TO_TYPE" [COMMON-CREATE-OPTIONS]
```

`SUBJECT_TO_TYPE` is the installed nominal Subject To Type Reference. All three
endpoint forms select the same operation. Named properties become fields of
`--properties`; IDs, metadata, endpoint pins and supported owner guards follow
the [shared creation mapping](#memory-common-creation).

##### Examples

```sh
# Declare which Specification governs the export Issue.
bd memory subject-to export-work csv-format

# Name both endpoints and explain the declaration.
bd memory subject-to --from export-work --to csv-format --title "Export contract"

```

#### `bd memory constraints`

Discover a subject's explicit governing Constraints and their dependencies.

##### Usage

```text
bd memory constraints SUBJECT...
    [--scope SCOPE] [--output-format FORMAT] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `SUBJECT...` | One or more | One or more subject Beads whose installed Types support the selected Subject To contract. Each is a [Reference](#memory-references). |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Relative-ID Scope selection; see [Scope and references](#memory-references). |
| `--output-format FORMAT` | `default` | Use shared graph output; nondefault formats remain [Unreviewed](#memory-output). |
| `--long` | Off | Show full References and administrative details. |

##### Behavior

For each original SUBJECT, perform these stages in the same bounded view:

1. Select its explicit outgoing Subject To-family declarations once.
2. From their target Constraints, follow outgoing Requires-family Links,
   including Defines.
3. Retain those declarations, dependencies and supporting paths with their
   original subject membership.

Do not add a reached Constraint's own Subject To declarations, walk an incoming
Defines parent, or infer an obligation from References. Only Links in admitted
staged paths belong to the result; two reached endpoints do not admit an
unrelated Link. Shared expansion cannot transfer obligations between subjects.
Separate stage-depth controls remain unselected; the shared adapter must state
and enforce its bounded view.

The selected family is **Subject To once, then outgoing Requires including
Defines**. The common [consistent-read and revision limits](#memory-read-view)
apply to every root. Type, direction, collection paging and arbitrary Selector
flags are not accepted.

##### Results

Each original subject, its explicit declarations and their Requires
dependencies, preserving supporting paths and bounds. This is not a claim to
discover every possibly applicable rule or establish satisfaction. Use the
[shared relationship output](#memory-output), preserving zero-hop roots,
per-root membership, exact pins and bounds. No stored relationship is created.

##### Errors and exit status

`--depth` is not accepted. Unsupported historical root/endpoint binding or a
missing read-view adapter refuses; invalid, unavailable or inaccessible
requested roots and budget exhaustion refuse the aggregate. Use the [common statuses](#memory-exit-status). A successful root-only result is `0`; refusal is
never disguised as that result.

##### Canonical CLI correspondence

First use the equivalent of `bd link list --from SUBJECT --type
"$SUBJECT_TO_TYPE"`. Then compose outgoing `bd link list --from CONSTRAINT
--type "$REQUIRES_TYPE"` and needed `bd show` reads from those declaration
targets. Keep the two stages and original subject membership distinct. A
suitable common adapter supplies the coherent bounded view; there is no single
recursive Selector or new wire operation behind this spelling. See
[consistent-read requirements](#memory-read-view); independent ordinary pages
alone do not establish that view. Display controls change rendering, not the
selected graph.

##### Examples

```sh
# Discover the export Issue's explicit obligations.
bd memory constraints export-work

# Keep the declarations for two subjects distinguishable.
bd memory constraints export-work review-work

```

#### `bd memory subjects`

Find Beads directly declaring that they are subject to a Constraint.

##### Usage

```text
bd memory subjects CONSTRAINT...
    [--scope SCOPE] [--output-format FORMAT] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `CONSTRAINT...` | One or more | One or more Constraint Beads or supported refinements. Each is a [Reference](#memory-references). |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Relative-ID Scope selection; see [Scope and references](#memory-references). |
| `--output-format FORMAT` | `default` | Use shared graph output; nondefault formats remain [Unreviewed](#memory-output). |
| `--long` | Off | Show full References and administrative details. |

##### Behavior

Select direct incoming Subject To-family declarations targeted at each requested
CONSTRAINT. This is a direct lookup, with no deeper Subject To mode. Do not
reverse Requires to invent indirect subjects or include secondary Subject To
Links between reached subjects. Keep requested roots with no declarations. The
read creates no inferred stored Link.

The selected family is **Subject To, including supported refinements**. The
common [consistent-read and revision limits](#memory-read-view) apply to every
root. Type, direction, collection paging and arbitrary Selector flags are not
accepted.

##### Results

Each requested Constraint, its direct subject Beads and their authored
declarations. It does not claim every subject indirectly governed through
another Constraint. Use the [shared relationship output](#memory-output),
preserving zero-hop roots, per-root membership, exact pins and bounds. No stored
relationship is created.

##### Errors and exit status

`--depth` is not accepted. Unsupported historical root/endpoint binding or a
missing read-view adapter refuses; invalid, unavailable or inaccessible
requested roots and budget exhaustion refuse the aggregate. Use the [common statuses](#memory-exit-status). A successful root-only result is `0`; refusal is
never disguised as that result.

##### Canonical CLI correspondence

Use the equivalent of `bd link list --to CONSTRAINT --type "$SUBJECT_TO_TYPE"`
and the needed `bd show` reads, within one captured bounded view. Do not add
reverse Requires traversal or a second Subject To stage. The generic commands'
wire mappings remain in the general CLI specification. See [consistent-read requirements](#memory-read-view); independent ordinary pages alone do not
establish that view. Display controls change rendering, not the selected graph.

##### Examples

```sh
# Find work directly subject to the export Specification.
bd memory subjects csv-format

```

### Ordinary Bead and Link commands

Memory Beads use the [general CLI](bdp-cli.md#cli-specification), rather than a
second CRUD command set. The same applies when editing or deleting one of the
Links created above.

| Intent | Canonical shape |
| --- | --- |
| Create a Bead with an installed Memory Type | `bd create --type TYPE --properties JSON` |
| Change the Type of an existing Bead | `bd update REF --type TYPE` |
| Merge or replace properties | `bd update REF --properties JSON`; `--replace-properties JSON` |
| Patch or edit named properties | `--patch-properties JSON`; `--set-property KEY=VALUE`; `--unset-property KEY` |
| Edit informational metadata | Matching `--metadata`, `--replace-metadata`, `--patch-metadata`, `--set-metadata` and `--unset-metadata` modes |
| Read current or saved content | `bd show REF`; `bd show REF@N`; `bd show REF@=TOKEN` |
| List a Memory family, including refinements | `bd list --type "$MEMORY_TYPE"` |
| List exactly one nominal Type | `bd list --exact-type "$MEMORY_TYPE"` |
| List every admitted Bead Type | `bd list --type any` |
| Create another Link Type or refinement | `bd link create SOURCE TARGET --type TYPE` |
| Read or edit a Link by its identity | `bd link show REF`; `bd link update REF` with ordinary edits |
| List Links by family or exact Type | `bd link list --type TYPE`; `bd link list --exact-type TYPE` |
| Read one identity's available revisions | `bd versions REF`; `bd link versions REF` |
| Delete through the shared operation | `bd delete REF --force`; `bd link delete REF --force` |
| Future Type inventory location | `bd type list` |

Creation initializes objects. On update, merge/replacement/patch/keyed modes are
exclusive per object; properties and metadata choose independently. Omitted Type
preserves the exact affiliation. Retyping neither discards properties nor
bypasses graph validity. It does not promise a native Issue can be converted
into a different backing model. An exact owner read uses its captured owned-Link
envelopes, not today's Link store. Deletion adds no independent cascade, erasure
or recovery policy.

On filters, `--type` means this Type and its refinements; `--exact-type` means
this nominal identity. Neither filter accepts a Type-definition revision. They
combine with AND. `--type any` is the shared wildcard, not a stored Type. On
writes, `--type` sets the affiliation and can use the common revision syntax.
Use actual Type References: a Memory Decision and a native Issue classification
with the same display label are not interchangeable.

For ordinary Resource edits, `--if-revision` supplies a write guard using the
[general revision grammar](bdp-cli.md#write-revision-flags). A selected
historical Reference is a read selection, not a mutation guard. The focused
Memory reads retain their fixed questions; generic filtering does not turn them
into an arbitrary query language.

Existing `remember`, `recall`, `memories` and `forget` retain their separate
contracts and are not added to this command reference. In particular, the
product's `memories` summary is not silently replaced with full generic rows.

## Sources and implementation correspondence

This file is the proposed canonical home beside the generic CLI. The older
[accepted ten-read/five-create proposal, Beads #7758](https://github.com/gastownhall/beads/issues/7758) and its [editable Beads source](https://github.com/donnabox/beads/blob/86e1efcf63ae84736a63975d12ebb01250eb0d50/docs/reference/bdp/cli/types/memory/memory.md)
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

The older product facade still documents `bd types` and an earlier catalog; it
is not proof the ten focused reads or this v0.2 model are qualified. The
canonical `bd type list` location selects no new inventory payload. Assessment
authoring, evaluation/claim commands, custom Type installation, executable
applicability, domain query languages and parameterized batches are outside this
companion. Preserving their future design space changes no existing command or
string into an implicit executable instruction.

> **Cleo — Memory correspondence:** Reuse your selection/output and mutation
> helpers. Reconcile the three endpoint forms, singular property edit flags,
> revision selectors and actual declared Type labels against the selected build.
> Direct References is unowned in both the v0.2 design and the reviewed current
> catalog. Preserve the explicit generic/product/deferred pin boundaries above;
> do not change a runtime pin or claim qualification from publication.
