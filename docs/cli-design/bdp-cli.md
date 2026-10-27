# Canonical BDP CLI: retained candidate

This is the finite retained CLI entry, composed from the reviewed paired modules,
not the older private C1 paper or a shipping-client claim. It uses `bdp` as the
executable name with the requested `bd <verb>` / `bd link <verb>` hierarchy.
[Retained profiles](retained-profiles.md), [Core](../../specs/profiles/core/retained-core.md)
and [Write](../../specs/profiles/write/retained-write.md) define the matching protocol.
The [completion map](../design/bdp-v0.1-retained-cutline.md) identifies actual gates.
There are no domain conveniences, public request/receipt/snapshot/changes/sequence
commands, or new Type verbs. `serve` is reserved and undetailed.
The [Preview3 alignment](preview3-alignment.md) records the settled shared CLI delta,
product extensions and exact lowering limits. It changes CLI source, not the wire
contract or an implementation/release pin. The separate
[Memory CLI companion](memory-cli.md) defines an optional domain command package,
with a task walkthrough and its own explicit Type-design dependency.

## Overview authoring sections

The connected walkthrough is being written in separate sections so the Read and
Write authors can work in parallel. Read the available sections in this order:

1. Find your place — Scope, defaults and identity introduction, pending.
2. [Explore the graph](overview/02-explore-graph.md) — show, List, Links, Graph and Query.
3. [Build and revise the graph](overview/03-crud.md) — complete Bead and Link CRUD.
4. [Observe changes](overview/04-events.md) — Events, live observation and cursors.
5. [Revisions and history](overview/05-revisions.md) — edition selection, pins and guarded edits.
6. [Apply related changes atomically](overview/06-batch.md) — batch, fixed IDs, outcomes, bindings, arguments and selection; extension under review.
7. Automation — pending.

These are authored examples of the design target. The Read/Query contribution
includes [candidate protocol modules and an incorporation map](query-ir/INCORPORATION.md):
accepted behavior, proposed details and changes still needed in the retained
contract are identified separately. Publishing these drafts does not amend held
schemas, advertise new capabilities or qualify an implementation. The existing
summaries below still need the bounded reconciliation recorded in that map.

The [Read/Query review entry](read-review.md) collects the completed author
proposal: [CLI grammar and command matrix](query-language.md),
[native read binding](../../specs/profiles/core/read-operations.md), council
findings and the bounded provider experiments. Its adoption boundaries remain
explicit; it does not incorporate the newer transactional List-binding design.

The [batch overview and paired examples](overview/06-batch.md) introduce the
newer selection-binding proposal. Its [design notes](batch-selection-design.md)
separate agreed transaction visibility from proposed syntax and version-2
encoding. The retained six-CRUD batch reference below remains version 1.

## Scope, References and exact values

Use `--scope`, then BDP_SCOPE_URL, then configuration scope.url. Scope-only commands may
also take one positional Scope, conflicting with --scope even when equal.
`link create`, `link list` and product `link count` use Resource positionals;
select their Scope with --scope or the default, never a guessed positional Scope. A point
operand is a Resource, not a guessed Scope. Absolute URLs stay directly readable;
mutations use verified owning Scope/navigation. Preserve whole Scope-defined names,
without beads/links/types prefixes. [Scope routing](scope-and-references.md) controls
normalization, aliases, kind and credential boundaries.

Human selectors are `ID@N` for a stable store-local ordinal, `ID@=TOKEN` for an
exact portable revision token, and `ID@current` for explicit current selection.
An unwrapped absolute HTTP URL stays literal, including raw @; use the quoted
`'[URL]@REV'` form to select a revision of an absolute URL. Exact JSON string/Reference forms or the full
canonical URL keep literal identities containing @ selectable. `--id` is always
literal. See [reference parsing](scope-and-references.md#revision-selectors).

| Position | Flag | Meaning |
| --- | --- | --- |
| unpinned mutation target | --if-revision TOKEN | Exact expectedRevision guard |
| authored --type | --type-revision TOKEN | Exact Type affiliation |
| authored Link source/target | --source-revision / --target-revision TOKEN | Exact endpoint pin |

A suffix plus its corresponding explicit selector refuses even when equal.
Explicit token flags remain literal, including numeric/current spellings. Local
ordinals require a truthful selected-store mapping and resolve to full tokens
before transport or stored references; unavailable mapping refuses, never guesses.
Type/endpoint @current refuses as a pin; bare input is unpinned. Mutation targets
remain unpinned; historical edit/recovery is a separately owned product operation.
Type filter operands stay unpinned; Link incidence selectors have the explicit
[current-population applicability](reads-and-paging.md#link-incidence-and-applicability)
contract. No GET-then-write current-pin emulation is added.

Reference/token fields also accept exact `json:JSON`, `json:@FILE` or `json:@-`:
a Reference is an admitted URI string or closed {uri,revision}; a token a nonempty
string. These forms preserve delimiter-bearing/literal values without broadening
URI admission. A string beginning json: can use JSON string form. There is no raw
whole-request escape substituting for ordinary flags. Object/patch/provenance
options use inline JSON, @FILE or @-. Inputs are UTF-8, frozen before transmission,
with one stdin consumer; reject duplicate members, invalid Unicode and inadmissible
numbers rather than round them. Null, empty and omission remain distinct.

## Command inventory and native correspondence

| Usable signature | Native intent / complete source |
| --- | --- |
| scope inspect [SCOPE] | GET discovered machine description; [profiles](retained-profiles.md) |
| show REF | One current or exact Resource; [reads](reads-and-paging.md) |
| link show REF | Same read with actual Link assertion |
| list [SCOPE] [FILTERS] | Bead inventory, no domain/Type default |
| link list [ID1 [ID2]] [LINK-FILTERS] | Current Link inventory/incidence/pair, selected Scope explicit/default |
| events [RESOURCE]; link events RESOURCE | Required postimage observation, optional selected delta; [Events](events.md) |
| versions REF; link versions REF | Optional complete History versions page, below |
| create [SCOPE] --type REF [--id ID] [INITIAL-OBJECTS] | createBead singleton; product allocation adapter may admit --id-root |
| link create SOURCE TARGET --type REF [--id ID] [INITIAL-OBJECTS] | createLink; SOURCE --to TARGET or --from SOURCE --to TARGET also admitted |
| update REF [--type REF] [OBJECT-EDITS] [--if-revision TOKEN] | updateBead; at least one mutation input |
| link update REF [--type REF] [OBJECT-EDITS] [--if-revision TOKEN] | updateLink; endpoints are not update fields |
| delete REF --force [--if-revision TOKEN] | deleteBead apply |
| link delete REF --force [--if-revision TOKEN] | deleteLink apply |
| alias resolve NAME | One-step alias Location, never target body |
| alias put NAME --target REF | putAlias, canonical in-Scope unpinned Bead target |
| alias delete NAME --force | deleteAlias, explicit apply intent |
| batch [SCOPE] --file FILE [--input-format json|cli] | Optional selected atomic batch; [complete grammar](atomic-batch.md) |
| type list [SCOPE] | Deferred Type CLI placeholder; no invented inventory payload/path |

Read filters are --type (family), --exact-type (nominal), --selector, and Link
--from/--to/--endpoint or --incident-to with --direction in|out|both.
The wire still names source/target. Duplicate endpoint bindings refuse; the three
authoring forms are exact, with no inverted --from SOURCE TARGET form. Exact/family
combine with AND. Bare --type any omits its predicate. The explicit-URI /any
escape remains a [draft proposal with an unresolved native compatibility boundary](preview3-alignment.md#type-and-rendering-boundaries),
not a settled name-reservation rule. Show's --properties-only is actual view=properties;
--include-links/--links-limit/--direction is one bounded Bead aggregate. Collection
--paged/--unpaged/--page-size/--limit/--continue, HTTP controls, exact continuation,
output formats and masks have their complete [read contract](reads-and-paging.md)
and [output contract](read-output.md). No mask changes native selection or ownership.

Create initialization is --properties/--metadata. Update supports --properties
(shallow merge), --replace-properties, --patch-properties, --set-property and
--unset-property, with the corresponding metadata flags. Modes are exclusive per
object; properties and metadata choose independently. [Object edits](object-edits.md)
define scalar-or-text values, ordering, literal keys, policy and exact lowering.
[Affiliations](affiliations-and-owned-state.md) defines type-setting/pins/no-ops.
Revision provenance uses --revision-provenance JSON only on operations admitting it;
it does not make an otherwise empty update valid. No source-guard flag is invented.

Plain Resource delete without --force performs an observational point-read preview,
not mutation admission. It returns the ordinary Resource descriptor with outer
context.preview=delete. Preview reserves nothing. Mutation-only guard/provenance/key/
emission/retry inputs require apply intent; apply rechecks everything. Alias deletion
requires --force and has no Resource preview. --force never reaches the wire or
waives integrity/authorization. Bead deletion admits no induced-version provenance;
Link deletion retains the existing induced-owner input semantics.

Each ordinary applied mutation accepts --idempotency-key KEY or creates one, and
supports mutually exclusive --retry-file FILE mode. The latter loads the frozen
same command/Scope/contract/capabilities/operands/input/key and original operation
binding; no new semantic options/default resolution or changed files. Credentials
are obtained currently, not saved in reusable artifacts. Journaling precedes first
transmission. Capability/guard/conflict/unknown-result diagnoses never authorize a
fresh key automatically. [Write durability](../../specs/profiles/write/retained-write.md#standalone-key-foundation-independent-of-sequence-and-replication)
is the authority contract; retry-file is private client recovery, not a public API.

`--dry-run-mode batch` emits a member on ordinary CRUD commands and the complete
native wrapper on `bd batch`, without execution, allocation or an admission claim.
Local ordinals and allocator-only --id-root cannot be silently resolved by the
offline compiler; use exact tokens and explicit IDs, or receive an explicit refusal.
Create `--batch-bind` is a batch-member emission label; ordinary execution refuses
it. Delete rendering preserves `--force`. Display framing/masks and execution/retry
keys conflict with emission. Shared native fields, presence, exact values, guards, Type
pins, patch/replacement intent and capture names survive compile/render; unsupported
versions refuse rather than rewrite. Richer value kinds require explicit
extensions; literal strings never acquire interpolation meaning.

## Optional History delivery, without a new History promise

versions and link versions require an unpinned subject and actual advertised
complete application History; revision-selected operands refuse on enumeration.
They issue one native view=versions page, preserving subject/population/participation/
window/items/next. --page-size selects initial native limit under History bounds;
--continue takes the native same-subject URL and preserves its issued limit/context.
This cut supports one page per call: --unpaged, total --limit and display masks
refuse, and --page-size with --continue refuses. No ordinary cursor-resizing rule
is applied to History. Use next for another call; --paged is the explicit default.
Revision selection and collection predicates do not combine with versions. HEAD and
HTTP conditions follow the actual single native representation. Retained-address/
window/erasure/provenance semantics are the full existing History contract, not a
subset inferred from storage. This is not the separate exact-definition operation.

Finite JSON uses result_kind version_collection with the unchanged native page.
Human/table/detail render rows without losing context. JSONL header records the
native subject/population/participation/window in context.history. Subject
resource_kind is verified bead/link when supplied, otherwise explicit null for
unknown/nondisclosable metadata; null is not a third Resource kind. A link versions
assertion without verifiable Link kind refuses with local unverifiable_resource_kind,
without an invented kind, extra body fetch or changed native History behavior.
Every item repeats resource and that truthful kind alongside the complete
native version row (revision/lineage/body/recorded provenance); those names are not
removed by guessing optional field masks. Terminal gives delivered-row completion
and exact native continuation. Bodyless304 has no items/completion. This descriptor
is outside the six ordinary-read framing schema; no full registry implementation
or renderer execution is claimed by paper examples.
Beads may additionally show a stable local SEQ timeline including deletion events;
these are not fabricated native historyVersionsPage rows. A deleted entry has no
live Resource body to select. See [product History mapping](preview3-alignment.md#history-and-allocation-adapters).

## Honest output, errors and required Events

Default point display is a shared human document and collections use shared rows.
Create/Memory authoring success uses a brief acknowledgement plus the same row
helper; it does not default to JSON or separate Link/source revision chatter.
`--long` exposes administrative detail and full exact references/tokens.
Redirection never picks a format. --output-format default|detail|table|json|jsonl follows each declared
adapter. Mutations/aliases/batch preserve complete native results inside result_kind
mutation (batch uses its compound ordered object). JSONL mutation is one complete
compound item plus terminal, never a misleading stream of independently committed
members; use of a shared human row helper does not admit the table output format
for these single/compound results. No public receipt
replaces the result. Explicit data masks are ordinary-read representation controls,
not mutation-result rewriting. Emission is separate, not framed success.

Schema 2 uses actual selected bdp_spec independently of executable/profile/capability
versions. Before binding is established, a local diagnostic uses bdp_spec:null and
result_kind diagnostic (or the known command descriptor), failure and a CLI error;
it does not falsely claim a selected server contract or native Problem. Those
unbound diagnostics are outside the bound ordinary-read schema subset. Preserve
actual BDP Problems unchanged in error.origin=bdp; local code/message use origin=cli.
Only mutation uncertainty uses outcome unknown. A transient replay response,
including idempotency-in-progress, is not a terminal disposition for the original
key; an unresolved original outcome stays unknown with same-key recovery. A rendering failure uses failure with any known native result and
context.operation_outcome=success for a known successful decision; it never implies
rollback or unknown merely due to display.
For unknown mutation disposition, context.recovery identifies the private frozen
file and exact argv. Missing retained payload may diagnose expiry without deciding
that the original write failed. Raw --omit envelope loses self-contained projection/
completion/control metadata and requires status/stderr; it cannot prove completion.

Canonical status is 0 for success/empty/no-op/preview/304; 2 local usage/value error;
3 diagnosed missing target/revision; 4 revision-mismatch; 5 diagnosed unsupported
capability/operation; 130 interrupted delivery; 1 other failure/unknown outcome.
Dispatch by precise diagnosis, not all409/all422 responses. Native Problems stay
unchanged. Stable local categories include invalid_arguments, missing_target_scope,
scope_binding_conflict, invalid_value, unsupported_capability, retry_state_invalid,
write_outcome_unknown, interrupted, output_failed and the declared read/alias codes.
These are target author choices, not a renumbering of shipped Preview exits.

Required Event signatures are events [RESOURCE], link events RESOURCE with
--from retained|now or mutually exclusive --after TOKEN, optional --follow,
--representation postimage|delta and --page-size N. [D1/D2 are answered](event-decisions-20261022.md):
postimages required, deltas optional; declared observation coverage with bounded
replay and explicit gaps. The paired [Event CLI](events.md) and
[native source](../../specs/profiles/core/events.md) define postimage default,
finite JSON/polling, cursor/coverage and the six mutation-name delta vocabulary.
No predicate language, masks, wire provenance suppression or changes command is
added. Required unknown semantics stop progress. Actual Types/source integration
and implementation qualification remain gates.
[Final batch publication](../../specs/profiles/core/publication.md) emits facts for
final Resource transitions, with at most one new revision per affected Resource;
input mappings and unique final outcomes replace per-member postimages.

> **Cleo — Finite surface:** Scope defaults, singular property flags, exact/family
> filters, revision terminology and output roots stay as recorded in the paired
> modules. The only added ordinary-read context field is the existing C1 delete
> preview marker. History and mutation descriptors retain their compound context;
> public Type CLI remains deferred. Event output follows your schema2 framing;
> final batch/owner output follows the shared mutation descriptor; actual Types
> composition and qualification remain explicit. No interruption request.

## CLI specification

Common flags are defined in groups first. Each command then lists the flags
it accepts, along with its defaults, behavior and examples. A common flag is
available only on commands that list it.

Examples use `bd`. The generic BDP executable uses the name `bdp` and the same
command hierarchy. This section is a draft for review. Material we have not
agreed on is kept under [Unreviewed material](#unreviewed-material).

Each general command describes its BDP mapping. Domain CLI specifications,
such as Memory, will describe their equivalent canonical CLI commands. The
mapping from those canonical commands to BDP is defined here.

### Common flags and reference syntax

<a id="creation-ids"></a>

#### Creation IDs: `--id` and `--id-root`

A Scope groups Beads and Links, much like a workspace. A local ID such as
`note-1` names a Bead or Link within the current Scope. A full URL names it
without relying on that surrounding context.

| Flag | Meaning | When omitted |
| --- | --- | --- |
| `--id ID` | Create the Bead or Link with this local ID. | Choose a new ID. |
| `--id-root ROOT` | Choose a new ID beneath this local path prefix. | Use ordinary ID generation in the current Scope. |

These flags are mutually exclusive. For example, `--id-root notes` asks for a
new ID under `notes/`; it does not choose the complete ID. Newly created local
Bead and Link IDs must not contain `@`, which is reserved for revision syntax.
Already-issued identities remain unchanged.

Deleting a Bead or Link does not make its ID available for reuse. A generated
ID is its actual identity, not a shortened display name.

The complete chosen ID is sent to BDP in the existing `id` field. If the CLI
cannot safely choose and reserve an ID under the requested root, it reports
that limitation. Producing an operation without executing it cannot choose or
reserve an ID. See [ID allocation](preview3-alignment.md#history-and-allocation-adapters).

<a id="write-revision-flags"></a>

#### Write revision flags: `--if-revision` and `--from-revision`

A revision identifies one saved state of a Bead or Link. These write flags
use revisions for two different purposes:

| Flag | Meaning | When omitted |
| --- | --- | --- |
| `--if-revision REV` | Allow a write only if its target still has the selected revision. | No revision condition is supplied. |
| `--from-revision REV` | Use content from a saved revision in a command that supports historical editing or recovery. | Use the command's ordinary content inputs. |

Both flags use the same value syntax:

| Value | Meaning |
| --- | --- |
| `3` | Local revision number 3 for the Bead or Link being addressed. |
| `=saved-r1` | The exact revision token `saved-r1`. |
| `=3` | The exact token `3`, not local revision number 3. |

The CLI looks up a local revision number and uses its full token in the BDP
request. If the number cannot be resolved, the command fails. The leading `=`
marks an exact token and is removed before the token reaches BDP.

A write guard checks the current target; it does not select content to read.
For example, a historical edit might copy content from revision 3 while
requiring that the current target is still at revision 7. Those are separate
choices. Each historical-edit command defines which content it copies.

<a id="reference-syntax"></a>

#### ID and revision syntax

A Reference identifies a Bead or Link and may select one of its revisions.
Write that revision on the Reference itself:

| Reference | Meaning |
| --- | --- |
| `note-1` | Read the current state. |
| `note-1@3` | Select local revision number 3. |
| `note-1@=saved-r1` | Select exact token `saved-r1`. |
| `note-1@current` | Explicitly select the current state. |

On commands with several References, each Reference carries its own revision
selection where the command allows it. The same syntax applies to References
in flags, such as `--type task@3` when setting a Bead or Link's Type.

Local revision numbers are positive whole numbers, from 1 through
9,223,372,036,854,775,807. Their meaning is stable within the selected store.
They are not positions in a history page and need not match numbers in another
store. Use exact tokens when exchanging references between stores.

A deletion event has no saved Resource body to read. Selecting its number
fails rather than choosing a nearby live revision. Invalid suffix syntax also
fails; it is not retried as a different literal ID.

An ordinary absolute URL is read literally, including any `@` characters in
an already-issued URL. To add a revision selector, wrap the URL in brackets.

In shell commands, quote URL arguments as shown below. A simple URL can work
without quotes, but brackets and other shell characters need protection.
Quotes protect the argument from the shell; they are not part of the Reference.

| Reference | Meaning |
| --- | --- |
| `'[https://work.example/acme/note-1]@3'` | Select local revision number 3. |
| `'[https://work.example/acme/note-1]@=saved-r1'` | Select exact token `saved-r1`. |
| `'[https://work.example/acme/note-1]@current'` | Select the current state. |

The shell removes the quotes but passes the brackets to the CLI. The CLI
separates the URL from the revision selector. Brackets around a URL require
a revision suffix.

On a Link creation command, the source and target may each select a revision.
The Link's Type still determines whether those endpoint revisions are allowed.
See the [URL revision example](#show-examples).

<a id="type-selection"></a>

#### Types: `--type` and `--exact-type`

On create and update, `--type` chooses the Type of the Bead or Link being
written. On a read command, Type flags filter the results.

The installed names used in these examples include `memory`, `task` and `bug`
for Beads, and `references`, `superseded-by` and `blocks` for Links. The `issue`
and `dependency` Types are abstract: use them to select a family in a read,
and choose a concrete refinement such as `task`, `bug` or `blocks` for creation.
Each name is a local Type Reference resolved in its Scope.

| Use | Meaning |
| --- | --- |
| `create --type TYPE` | Set the new Bead or Link's Type. |
| `update ID --type TYPE` | Change the existing Bead or Link's Type. Omission leaves its Type unchanged. |
| A read filter `--type TYPE` | Select this Type and its refinements. |
| A read filter `--exact-type TYPE` | Select exactly this Type, excluding refinements. |
| A read filter `--type any` | Apply no Type filter. |

Filter arguments name a Type, without a revision suffix. `--exact-type` matches
the Type's identity, not a revision of its definition. Bare `--exact-type any`
is invalid. Family and exact filters may be combined; both must match.
If refinement filtering is unsupported, the command reports that limitation
instead of silently switching to exact matching.

Types can themselves have revisions. When creating or updating a Bead or Link,
use the shared reference syntax to choose one: `--type task@3` or
`--type task@=saved-r1`. As with any local revision number, the CLI must have a
valid mapping for that Type. See [Type selection](affiliations-and-owned-state.md).

#### Read views: properties and included Links

| Flag | Meaning |
| --- | --- |
| `--properties-only` | Return the properties view. |
| `--include-links` | Include one bounded page of Links connected to a Bead. |
| `--links-limit N` | Set that page's positive size limit. Requires `--include-links`. |
| `--direction in\|out\|both` | Choose incoming, outgoing or both directions. Defaults to `both` where allowed. |

The properties view and included Links are mutually exclusive. The direction
flag requires an incident-Link selection or an included-Link page.
Historical reads return the full saved record and do not support these views.
See [read views](reads-and-paging.md#one-point-or-one-population).

<a id="output-controls"></a>

#### Output: format, detail and field selection

| Flag | Meaning |
| --- | --- |
| `--output-format FORMAT` | Choose `default`, `detail`, `table`, `json` or `jsonl`, as allowed by the command. |
| `--long` | Show administrative details and full references in human-readable output. |
| `--include POINTER` | Include a field. Repeat to select several fields. |
| `--omit POINTER` | Omit an optional field. Repeat to omit several fields. |
| `--omit envelope` | Return raw data without the surrounding result information. |

A point read defaults to a human-readable document; a collection defaults to
a table. Redirecting output to a file does not change the format. Structured
output preserves full IDs, Type references and revision tokens.

Field selection uses JSON Pointers: for example, `/properties/title` selects
a Resource's title. In a properties-only view, use `/title` instead. Includes
are applied first, followed by omissions, using the original field paths.
A Resource's ID, Type, revision and Link endpoints remain available as context.
Field selection changes the display, not which records are selected.

The surrounding result information records errors, completion and any field
selection. If you remove it, use stderr and the command's exit status to check
whether the command completed. See [output and field selection](read-output.md).


<a id="object-inputs"></a>

#### Properties, metadata and provenance

Properties hold a Bead or Link's domain data. Metadata is a separate object.
Choose their editing modes independently:

| Intent | Properties flag | Metadata flag |
| --- | --- | --- |
| Initialize on create; shallow merge on update | `--properties JSON` | `--metadata JSON` |
| Replace the writable object on update | `--replace-properties JSON` | `--replace-metadata JSON` |
| Apply an ordered JSON Patch on update | `--patch-properties JSON` | `--patch-metadata JSON` |
| Set a literal top-level key on update | `--set-property KEY=VALUE` | `--set-metadata KEY=VALUE` |
| Remove a literal top-level key on update | `--unset-property KEY` | `--unset-metadata KEY` |

Create accepts initialization only. On update, merge, replacement, patch and
keyed editing are mutually exclusive for each object. Keyed editing may combine
set and unset. Omission leaves that object unchanged. A shallow merge replaces
each supplied top-level value; it does not merge nested objects recursively.

JSON inputs accept inline JSON, `@FILE` or `@-`. Read and freeze all input before
dispatch; only one input may consume stdin. Reject duplicate members, invalid
Unicode and numbers that cannot be represented under the selected contract.
JSON input is data, without interpolation or shell execution.

Set values are split at the first `=`. JSON null, booleans and admitted numbers
retain those values; other text is a string. Use object or patch JSON for arrays,
objects and numeric-looking strings. Keys are literal top-level names, including
any `/` or `~`. Repeated sets use the last value; unsets follow sets and removing
an absent writable key succeeds. The lowering must preserve access policy;
unsupported faithful lowering fails rather than doing a client read/modify/write.
See [complete object-edit rules](object-edits.md).

`--revision-provenance JSON` supplies attribution input where the operation
admits it. It is separate from metadata, revision selection and write guards.
It neither invents a revision nor makes an otherwise empty update valid.
Bead deletion does not accept it; Link deletion may attribute an induced owner
revision. The provider determines whether any fresh version is produced.

<a id="mutation-delivery"></a>

#### Applying, emitting and recovering a write

| Flag | Meaning | When omitted |
| --- | --- | --- |
| `--force` | Apply a Resource deletion; required for alias deletion. | A Resource delete previews its current record. |
| `--idempotency-key KEY` | Use this exact key for one applied mutation. | Generate and save a key before transmission. |
| `--retry-file FILE` | Recover the original frozen invocation with its original key. | Execute a new invocation. |
| `--dry-run-mode MODE` | Emit one compact member plus newline with `batch`, or preview the BDP request with `bdp`. | Execute the command. |
| `--batch-bind NAME` | Bind a creation result for later members; valid only with batch-member emission. | No capture label. |

Retry mode accepts only its saved file and display controls. It cannot change the
Scope, operands, Type, guard, inputs or key. It reuses the saved operation binding
and frozen bytes; it does not reread input files or resolve a new Type default.
Credentials are obtained for the current attempt. An uncertain outcome stays
uncertain until same-key recovery establishes its disposition. A failed render
does not undo a known successful write. See [Write durability](../../specs/profiles/write/retained-write.md#standalone-key-foundation-independent-of-sequence-and-replication).

MODE is `batch` or `bdp`. Member mode emits one compact JSON object and a newline;
batch-only references use `batch-ref::NAME` in admitted operand positions. The
definition flag and references refuse ordinary execution. The reviewed spelling
supersedes the older literal-command-file authoring model. See the
[batch overview](overview/06-batch.md) for composition and arguments.

Emission rejects explicit display controls, execution keys and retry mode.
Member/body emission does not fetch, allocate or reserve IDs, resolve local
revision numbers, choose Type defaults or validate server policy. BDP request
preview uses an established route; its exact discovery policy remains a review
question. No preview claims successful admission. Exact tokens
and a sufficient offline Scope binding are required. `--batch-bind` is not a singleton
body field. Emission preserves field presence, edit intent, pins and guards.
See [batch authoring and emission](batch-selection-design.md#jsonl-assembly-and-supplied-arguments).

Applied mutations accept `default`, `detail`, `json` and `jsonl` output, plus
`--long` for human detail. They do not accept table format or read field masks.
The default create display is a short acknowledgement followed by the common
Resource row. JSON retains the complete native mutation result. JSONL emits that
compound result as one item, with one header and terminal; it does not split
owner effects or batch members into separate commits.

<a id="collection-paging"></a>

#### Collection paging and filters

| Flag | Meaning | Default |
| --- | --- | --- |
| `--paged` | Deliver one native page. | For human formats and finite JSON. |
| `--unpaged` | Follow native pages until exhaustion or the total limit. | For JSONL. |
| `--page-size N` | Positive maximum records per fetch. | 50, bounded by an advertised smaller maximum. |
| `--limit N` | Maximum records delivered by this invocation; zero removes this total cap. | 0. |
| `--continue URL` | Resume at the complete previously issued native `next` URL. | Start a new selection. |
| `--selector JSONPATH` | Apply the protocol's existing bounded Selector. | No raw Selector. |

Paged and unpaged modes conflict. The CLI total limit is separate from the
protocol's per-fetch `limit`. Do not trim a fetched page and return a cursor after
undelivered records. A short or empty page with a non-null `next` is not exhaustion.
Continuation preserves the selected population, authority and opaque cursor.
Only the ordinary-read page size may change; do not rerun initial filters or
revision lookups. An explicit Scope may verify a continuation's binding, not
reselect it. History and Events define their own continuation rules.

Filters combine with AND. The raw Selector sees native Resource fields and
Reference shapes; it adds no joins, recursion or endpoint-body fetch. Masking
fields changes output only. See [selection and paging](reads-and-paging.md).
This pass specifies `list`; search, graph and query reconciliation is separate.

<a id="exit-status"></a>

#### Errors and exit status

| Status | Meaning |
| --- | --- |
| `0` | Success, including an empty selection, no-op or observational delete preview. |
| `2` | Invalid arguments, values or conflicting options. |
| `3` | A diagnosed missing target or revision. |
| `4` | A diagnosed Resource revision mismatch. |
| `5` | A diagnosed unsupported capability or operation. |
| `130` | Interrupted delivery. |
| `1` | Other failure, including access denial, output failure or an unknown write outcome. |

Use the actual diagnosis, not every HTTP 409 or 422 as a revision mismatch.
Preserve native BDP Problems unchanged with `origin:bdp`; local errors use
`origin:cli`. Diagnostics go to stderr. Before binding, output cannot claim a
selected server contract. Only an uncertain mutation uses outcome `unknown`.
An unsupported feature is not silently emulated with weaker guarantees.

### Commands

#### `bd create`

Create one Bead with a Type and optional initial properties and metadata.

##### Usage

```text
bd create [SCOPE] --type TYPE [--id ID | --id-root ROOT]
    [--properties JSON] [--metadata JSON] [--scope SCOPE] [--batch-bind NAME]
    [--revision-provenance JSON]
    [--idempotency-key KEY | --dry-run-mode batch|bdp]
    [--output-format default|detail|json|jsonl] [--long]
bd create --retry-file FILE
    [--output-format default|detail|json|jsonl] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| SCOPE | No; Unreviewed | Optional destination Scope spelling. Its use and precedence remain [unreviewed](#scope-selection). |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--type TYPE` | Required | Set the Type Reference, optionally pinned. See [Types](#type-selection). |
| `--id ID` | Authority allocation | Supply the complete local ID. See [creation IDs](#creation-ids). |
| `--id-root ROOT` | Ordinary allocation | Allocate beneath a local prefix where the adapter supports it. See [creation IDs](#creation-ids). |
| `--properties JSON` | `{}` | Initialize properties. See [object inputs](#object-inputs). |
| `--metadata JSON` | `{}` | Initialize metadata. See [object inputs](#object-inputs). |
| `--revision-provenance JSON` | No caller attribution | Supply admitted version attribution input. See [object inputs](#object-inputs). |
| `--idempotency-key KEY` | Generated and saved | Set the applied write key. See [write delivery](#mutation-delivery). |
| `--retry-file FILE` | Off | Recover only the frozen invocation; semantic flags conflict. See [write delivery](#mutation-delivery). |
| `--dry-run-mode MODE` | Off | Use `batch` to emit a member or `bdp` to preview its request. See [emission](#mutation-delivery). |
| `--batch-bind NAME` | No label | Name this creation only with batch-member emission. See [write delivery](#mutation-delivery). |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `json` or `jsonl`. See [write output](#mutation-delivery). |
| `--long` | Off | Show full references and administrative detail in human output. |

##### Behavior

Use the established destination Scope and its discovered `createBead` operation.
A Type URL does not choose that destination. Preserve the complete Scope-defined
local ID; do not insert a kind prefix. Omitted properties and metadata initialize
as empty objects. New IDs cannot contain `@` and no previously committed Resource
identity can be reused.

Under Types, an unpinned Type resolves once to the registered default at admission;
an exact Type pin stays exact. Offline emission does not perform that resolution.
`@current` is not an authored Type pin. Root-only allocation needs a suitable
adapter; it is not a wire `idRoot` field. No property editing modes, read filters
or write guard are accepted on creation.


##### Results

Return the complete native `mutationResult`, including its actual `changed`
value and Resource postimage. Preserve any native owner context. Human output
uses the shared Resource row; JSONL carries one complete compound result.
See [write output and recovery](#mutation-delivery). Emission instead returns the
unexecuted operation record and does not report mutation success.


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid or conflicting inputs
return `2`; a missing target returns `3`; revision mismatch returns `4`;
unsupported Write or a required lowering capability returns `5`. Access, integrity,
validation and other failures use their precise Problem and status `1` unless
another common diagnosis applies. An uncertain write returns `1` and preserves
same-key recovery information; it is not permission to submit a fresh write.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| Destination Scope | POST to discovered `createBead` URL with the selected media and one Idempotency-Key. |
| --type TYPE | Set `type` to the absolute URI string or exact `{uri,revision}` Reference. |
| --id ID / allocated root ID | Set the complete chosen `id`; omission leaves authority allocation. |
| --properties / --metadata | Set the existing initial object members. |
| --revision-provenance JSON | Set `revisionProvenance` input. |
| --dry-run-mode batch / --batch-bind | Emit `operation:"createBead"` and optional `name`; neither is a singleton body member. |

##### Examples

```sh
# Create a typed note with initial content.
bd create --type memory --properties '{"title":"Review","body":"Read the draft"}'

# Choose a complete local ID without adding a namespace prefix.
bd create --type memory --id notes/review

# Emit a named creation for later batch composition.
bd create --type memory@=type-r1 --id note-1 --batch-bind note --dry-run-mode batch

```

#### `bd show`

Read one Bead or Link, either current or at a saved revision.

##### Usage

```text
bd show REF
    [--scope SCOPE]
    [--properties-only | --include-links]
    [--links-limit N] [--direction in|out|both]
    [--output-format default|detail|json|jsonl] [--long]
    [--include POINTER]... [--omit POINTER|envelope]...
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `REF` | Yes | One local Bead/Link ID or absolute Resource URL, optionally selecting a revision. |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose the Scope for a relative ID. [Scope details](#scope-selection) remain unreviewed. |
| `--properties-only` | Off | Return the properties view. See [read views](#read-views-properties-and-included-links). |
| `--include-links` | Off | Include one page of connected Links for a Bead. |
| `--links-limit N` | Service's bounded page default | Limit the included-Link page. Requires `--include-links`. |
| `--direction in\|out\|both` | `both` | Choose included-Link direction. Requires `--include-links`. |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `json` or `jsonl`. See [output](#output-format-detail-and-field-selection). |
| `--long` | Off | Show administrative details in human-readable output. |
| `--include POINTER` | Whole selected value | Include fields; repeatable. See [output](#output-format-detail-and-field-selection). |
| `--omit POINTER` | No omissions | Omit optional fields; repeatable. `envelope` selects raw output. |

##### Behavior

Resolve `REF` using the shared [ID/revision syntax](#id-and-revision-syntax).
Read current content unless the Reference selects a saved revision.
An absolute URL needs no configured default Scope. The response identifies
whether the result is a Bead or Link; the spelling of its ID does not.

Historical reads require the service's History capability. If the selected
revision is unavailable, fail instead of returning current content. Historical
selection cannot be combined with properties-only or included-Link views.

`--properties-only` and `--include-links` cannot be combined. Included Links
require a Bead. The command returns the Links, without fetching the Beads at
their endpoints or traversing a graph. The included page may have more results;
success does not mean every connected Link has been returned.

The command does not accept collection filters, paging controls or write flags.
That includes `--type`, `--exact-type`, `--id`, `--id-root`, `--if-revision`
and `--from-revision`.

##### Results

The default document shows the ID, actual Type, selected revision and content.
A Link document also shows its endpoints. Empty sections are omitted. A saved
revision shows the content and owned Links recorded with it, not today's state.

Structured output uses the `resource` result format, or `properties` for the
properties view. A read with included Links is still one Bead result, with its
bounded Link page. JSON returns one result object. JSONL returns a header,
one data record and a final record reporting completion or failure.
Diagnostics go to stderr.

##### Errors and exit status

| Status | Condition |
| --- | --- |
| `0` | Successful read. |
| `2` | Invalid arguments, missing Scope for a relative ID, invalid value or conflicting options. |
| `3` | A diagnosed missing Bead, Link or saved revision. |
| `5` | Required History, local revision lookup or requested operation is unsupported. |
| `130` | Read delivery was interrupted. |
| `1` | Other failure, including access denial or output failure. |

Preserve BDP Problems in the common error format.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| Bare `REF` or `REF@current` | GET the canonical Resource URL. |
| `REF@N` | Look up local revision number N, then request `revision=TOKEN`. |
| `REF@=TOKEN` | Request the exact `revision` query value, without the CLI's leading `=`. |
| `--properties-only` | Request `view=properties`. |
| `--include-links` | Request `include=links`. |
| `--links-limit N` | Set native `limit=N` on that aggregate. |
| `--direction in\|out\|both` | Set `direction=inbound\|outbound\|both`. |
| Output format, detail and field-selection flags | Render the selected result without changing native selection. |

See [point reads](reads-and-paging.md) and [read output](read-output.md) for the
matching protocol and result rules.

<a id="show-examples"></a>

##### Examples

```sh
# Read the current note in the current Scope.
bd show note-1

# Read a note using its full URL. Quotes pass the URL unchanged through the shell.
bd show 'https://work.example/acme/note-1'

# Read local revision number 3 using a suffix.
bd show note-1@3

# Read an exact revision token using a suffix.
bd show note-1@=saved-r1

# Read that exact token and return JSON.
bd show note-1@=saved-r1 --output-format json

# Read the exact token 3, rather than local revision number 3.
bd show note-1@=3

# Select a revision of an absolute URL. Quotes protect the brackets in the shell.
bd show '[https://work.example/acme/note-1]@3'

# Include up to 20 outgoing Links.
bd show note-1 --include-links --links-limit 20 --direction out

# Show only the title from the properties view.
bd show note-1 --properties-only --include /title

```

#### `bd update`

Update one Bead, changing its Type, properties or metadata in one atomic operation.

##### Usage

```text
bd update REF [--type TYPE] [--scope SCOPE] [--if-revision REV]
    [--properties JSON | --replace-properties JSON | --patch-properties JSON
       | [--set-property KEY=VALUE]... [--unset-property KEY]...]
    [--metadata JSON | --replace-metadata JSON | --patch-metadata JSON
       | [--set-metadata KEY=VALUE]... [--unset-metadata KEY]...]
    [--revision-provenance JSON]
    [--idempotency-key KEY | --dry-run-mode batch|bdp]
    [--output-format default|detail|json|jsonl] [--long]
bd update --retry-file FILE
    [--output-format default|detail|json|jsonl] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| REF | Yes, except retry | One unpinned Bead ID or absolute Resource URL. |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--type TYPE` | Unchanged | Replace the whole Type Reference, optionally pinned. See [Types](#type-selection). |
| `--properties JSON` | Unchanged | Shallow merge supplied top-level values. See [object inputs](#object-inputs). |
| `--replace-properties JSON` | Unchanged | Replace the writable object. See [object inputs](#object-inputs). |
| `--patch-properties JSON` | Unchanged | Apply an ordered strict JSON Patch. See [object inputs](#object-inputs). |
| `--metadata JSON` | Unchanged | Shallow merge supplied top-level values. See [object inputs](#object-inputs). |
| `--replace-metadata JSON` | Unchanged | Replace the writable object. See [object inputs](#object-inputs). |
| `--patch-metadata JSON` | Unchanged | Apply an ordered strict JSON Patch. See [object inputs](#object-inputs). |
| `--set-property KEY=VALUE` | No keyed edit | Set a literal top-level key. Repeatable; see [object inputs](#object-inputs). |
| `--unset-property KEY` | No keyed edit | Remove a literal top-level key idempotently. Repeatable; see [object inputs](#object-inputs). |
| `--set-metadata KEY=VALUE` | No keyed edit | Set a literal top-level key. Repeatable; see [object inputs](#object-inputs). |
| `--unset-metadata KEY` | No keyed edit | Remove a literal top-level key idempotently. Repeatable; see [object inputs](#object-inputs). |
| `--if-revision REV` | No guard | Require the target revision; `N` or `=TOKEN`. See [write revisions](#write-revision-flags). |
| `--revision-provenance JSON` | No caller attribution | Supply admitted version attribution input. See [object inputs](#object-inputs). |
| `--idempotency-key KEY` | Generated and saved | Set the applied write key. See [write delivery](#mutation-delivery). |
| `--retry-file FILE` | Off | Recover only the frozen invocation; semantic flags conflict. See [write delivery](#mutation-delivery). |
| `--dry-run-mode MODE` | Off | Use `batch` to emit a member or `bdp` to preview its request. See [emission](#mutation-delivery). |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `json` or `jsonl`. See [write output](#mutation-delivery). |
| `--long` | Off | Show full references and administrative detail in human output. |

##### Behavior

The target must be an unpinned Bead; select a guard with `--if-revision`, not a
revision suffix on `REF`. Supply at least one Type or object mutation input.
An admitted empty patch is allowed; a guard or provenance alone is not an update.
Properties and metadata choose their editing modes independently.

Omitting Type preserves its exact existing affiliation. Explicit Type input
replaces that whole Reference; under Types, an unpinned input resolves once at
admission. A genuine unchanged result mints no revision or Event, after guards
and policy checks. A changed Type pin is an effect even with no property changes.

The provider recomputes any Type-owned Link state atomically. The client does not
expand a Type change into separate Link updates.

`--from-revision` belongs to a separately specified historical-content adapter;
ordinary update has no generic field for it.


##### Results

Return the complete native `mutationResult`, including its actual `changed`
value and Resource postimage. Preserve any native owner context. Human output
uses the shared Resource row; JSONL carries one complete compound result.
See [write output and recovery](#mutation-delivery). Emission instead returns the
unexecuted operation record and does not report mutation success.


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid or conflicting inputs
return `2`; a missing target returns `3`; revision mismatch returns `4`;
unsupported Write or a required lowering capability returns `5`. Access, integrity,
validation and other failures use their precise Problem and status `1` unless
another common diagnosis applies. An uncertain write returns `1` and preserves
same-key recovery information; it is not permission to submit a fresh write.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| REF | Set `bead` in a POST to discovered `updateBead`. |
| --type TYPE | Set the whole `type` Reference; omission remains omission. |
| --replace-properties / --replace-metadata | Set distinct `properties` / `metadata` replacement members, not root patches. |
| Merge, patch and keyed object edits | Lower to `propertiesChange` / `metadataChange` without changing edit intent or policy. |
| --if-revision REV | Resolve the target-local number or strip `=` and set exact `expectedRevision`. |
| --revision-provenance JSON | Set admitted `revisionProvenance` input. |
| --dry-run-mode batch | Emit a member with `operation:"updateBead"` and the same inputs. |

##### Examples

```sh
# Set one property while requiring the current revision.
bd update note-1 --set-property title=Reviewed --if-revision =saved-r7

# Choose replacement for properties and keyed metadata editing.
bd update note-1 --replace-properties '{"title":"Reviewed"}' --set-metadata reviewed=true

# Change the Type without manufacturing a property patch.
bd update note-1 --type task@=type-r2

```

#### `bd delete`

Preview or apply deletion of one Bead.

##### Usage

```text
bd delete REF [--scope SCOPE]
    [--output-format default|detail|json|jsonl] [--long]
bd delete REF --force [--scope SCOPE] [--if-revision REV]
    [--idempotency-key KEY | --dry-run-mode batch|bdp]
    [--output-format default|detail|json|jsonl] [--long]
bd delete --retry-file FILE
    [--output-format default|detail|json|jsonl] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| REF | Yes, except retry | One unpinned Bead ID or absolute Resource URL. |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--force` | Off | Apply deletion; without it, read the current record as an observational preview. See [write delivery](#mutation-delivery). |
| `--if-revision REV` | No guard | Require the target revision; `N` or `=TOKEN`. See [write revisions](#write-revision-flags). |
| `--idempotency-key KEY` | Generated and saved | Set the applied write key. See [write delivery](#mutation-delivery). |
| `--retry-file FILE` | Off | Recover only the frozen invocation; semantic flags conflict. See [write delivery](#mutation-delivery). |
| `--dry-run-mode MODE` | Off | Use `batch` to emit a member or `bdp` to preview its request. See [emission](#mutation-delivery). |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `json` or `jsonl`. See [write output](#mutation-delivery). |
| `--long` | Off | Show full references and administrative detail in human output. |

##### Behavior

Without `--force`, read the current Bead and mark the outer result as a delete
preview. This is neither mutation admission nor a reservation. The preview cannot
promise a later deletion will succeed. Guard, provenance, execution key, emission
and retry inputs require apply intent; a saved retry already carries that intent.

With `--force`, invoke the ordinary deletion and recheck all admission conditions.
The flag does not waive authorization, integrity or revision guards and does not
reach the wire. The target remains unpinned. Deleted canonical IDs stay reserved.

A Bead with live incident Links cannot be deleted. Remove those Links explicitly;
there is no implicit cascade. Bead deletion accepts no revision-provenance input
and creates no fictitious deleted Resource version.


##### Results

A preview returns the ordinary `resource` descriptor with
`context.preview:"delete"`. Apply returns the complete native deletion
`mutationResult`, with the deleted identity and any applicable native context,
without a new Resource body. Emission prints an unexecuted delete member;
canonical command rendering retains `--force`.


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid or conflicting inputs
return `2`; a missing target returns `3`; revision mismatch returns `4`;
unsupported Write or a required lowering capability returns `5`. Access, integrity,
validation and other failures use their precise Problem and status `1` unless
another common diagnosis applies. An uncertain write returns `1` and preserves
same-key recovery information; it is not permission to submit a fresh write.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| No --force | GET the current Resource; add only the CLI preview marker. |
| REF with --force | POST `bead` to discovered `deleteBead` with an Idempotency-Key. |
| --if-revision REV | Set exact `expectedRevision` after the shared revision conversion. |
| --force | Client apply intent only; no native field. |
| --dry-run-mode batch | Emit `operation:"deleteBead"`; do not execute it. |

##### Examples

```sh
# Inspect the current record before deciding to delete it.
bd delete note-1

# Apply deletion with an exact revision guard.
bd delete note-1 --force --if-revision =saved-r7

# Emit an explicit deletion for batch composition.
bd delete note-1 --force --dry-run-mode batch

```

#### `bd list`

List selected current Beads.

##### Usage

```text
bd list [SCOPE] [--scope SCOPE]
    [--type TYPE] [--exact-type TYPE] [--selector JSONPATH]
    [--paged | --unpaged] [--page-size N] [--limit N]
    [--output-format default|detail|table|json|jsonl] [--long]
    [--include POINTER]... [--omit POINTER|envelope]...
bd list --continue URL [--scope SCOPE]
    [--paged | --unpaged] [--page-size N] [--limit N]
    [--output-format default|detail|table|json|jsonl] [--long]
    [--include POINTER]... [--omit POINTER|envelope]...
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| SCOPE | No; Unreviewed | Optional Scope spelling; not a Bead filter. See [Scope selection](#scope-selection). |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--type TYPE` | No family filter | Select a Type and its refinements; `any` removes this predicate. See [Types](#type-selection). |
| `--exact-type TYPE` | No exact filter | Select nominal Type identity only. See [Types](#type-selection). |
| `--selector JSONPATH` | No raw Selector | Apply the existing bounded Selector. See [filters](#collection-paging). |
| `--paged` | For human/JSON | Return one native page. See [paging](#collection-paging). |
| `--unpaged` | For JSONL | Continue until exhaustion or total limit. See [paging](#collection-paging). |
| `--page-size N` | 50, subject to advertised bound | Set a positive per-fetch maximum. |
| `--limit N` | 0 | Cap total delivered records; zero means no total cap. |
| `--continue URL` | New selection | Resume the exact issued native next URL; initial selection arguments conflict. |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `table`, `json` or `jsonl`. See [output](#output-controls). |
| `--long` | Off | Show full references and administrative detail in human output. |
| `--include POINTER` | Whole selected value | Include fields; repeatable. See [output](#output-controls). |
| `--omit POINTER\|envelope` | No omissions | Omit optional fields, or return raw output; repeatable. See [output](#output-controls). |

##### Behavior

List the established Scope's current Bead inventory. There is no implicit Issue,
status or Type default and no mixed Bead/Link population. Type and raw Selector
filters combine with AND before native pagination. This is a collection read,
without graph traversal or endpoint fetching.

With `--continue`, do not supply initial operands, filters or direction. Preserve
the issued selection and validate its collection kind, even for an empty page.
Follow the [ordinary paging rules](#collection-paging), not History or Events
rules. Read masks affect display only. Unsupported family selection refuses;
it is not replaced with exact matching or a broad local scan.


##### Results

Use `resource_collection`, retaining native items and the exact continuation.
The default is the shared row table. JSONL emits complete Resource items plus
terminal completion. A successful page or total-limit prefix is not a claim that
all matches have been delivered; null continuation means observed exhaustion.
Preserve all Link endpoint pins and actual Type References in structured output.


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid selection or paging
returns `2`; diagnosed missing targets return `3`; unsupported requested
selection returns `5`. Access, consistency, stale continuation and output
failures return `1` unless a more precise common diagnosis applies.
Interrupted delivery returns `130`; incomplete output is not successful exhaustion.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| Initial population | GET the discovered Beads inventory. |
| --type / --exact-type | Set native `conformsTo` / `type` with resolved unpinned Type identity. |
| --selector JSONPATH | Set the existing bounded `selector` value. |
| --page-size / --limit | Set each request's native `limit` within the remaining CLI delivery budget. |
| --continue URL | Follow the complete native next URL, preserving context; ordinary page size alone may change. |
| Output, detail and masks | Render the same selected records without changing native selection or cursor position. |

##### Examples

```sh
# List current Beads in the established Scope.
bd list

# Select a Type family and display one page of up to 20 records.
bd list --type memory --page-size 20

# Follow pages and deliver at most 100 records as JSONL.
bd list --exact-type memory --unpaged --limit 100 --output-format jsonl

```

#### `bd versions`

Enumerate one native History page for a Bead or Link.

##### Usage

```text
bd versions REF [--scope SCOPE] [--paged] [--page-size N]
    [--output-format default|detail|table|json|jsonl] [--long]
bd versions REF --continue URL [--scope SCOPE] [--paged]
    [--output-format default|detail|table|json|jsonl] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| REF | Yes | One unpinned Bead/Link identity; not a selected historical revision. |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--paged` | On | Deliver one native History page. |
| `--page-size N` | Provider History default | Select the initial History page limit; cannot accompany continuation. |
| `--continue URL` | Initial History page | Use the native same-subject History next URL unchanged. |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `table`, `json` or `jsonl`. See [output](#output-controls). |
| `--long` | Off | Show full references and administrative detail in human output. |

##### Behavior

Require the service's complete application History capability. Revision suffixes,
collection filters, masks, `--unpaged` and a total `--limit` are not accepted.
This cut delivers one page per call. A continuation preserves its issued limit
and History context; the ordinary collection cursor-resizing rule does not apply.
An initial page size must meet the service's History bounds.

Preserve the native subject, population, participation, window and retained-address
semantics. A version listing is not a promise that all retained bodies remain
readable. A local product timeline containing deletion events is not silently
rewritten as native History versions rows.


##### Results

Use `version_collection`, preserving the native page. Each JSONL item carries
the subject, verified kind when known and the complete native version row.
The header records History context; the terminal preserves the exact delivered
boundary and native continuation. Finite human, detail and table formats show
the same version context. See [History delivery](#optional-history-delivery-without-a-new-history-promise).


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid selection or conflicting
History paging returns `2`; diagnosed missing subject/revision returns `3`;
unsupported complete History returns `5`. Access, unavailable context or an
unverifiable asserted kind returns `1` unless another precise diagnosis applies.
Interrupted delivery returns `130`.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| REF | GET the canonical subject with `view=versions`; require actual advertised complete History. |
| --page-size N | Set initial native `limit=N` under History bounds. |
| --continue URL | Follow the same-subject native next URL unchanged, including its issued limit. |
| Generic subject | Retain the actual subject kind when known; do not infer it from URI spelling. |
| Output flags | Render unchanged native History context and rows; no read masks. |

##### Examples

```sh
# Read one page of retained versions.
bd versions note-1

# Request a smaller initial History page.
bd versions note-1 --page-size 10 --output-format json

```

#### `bd link create`

Create one directed Link, with independently selected source, target and Type References.

##### Usage

```text
bd link create SOURCE TARGET --type TYPE [OPTIONS]
bd link create SOURCE --to TARGET --type TYPE [OPTIONS]
bd link create --from SOURCE --to TARGET --type TYPE [OPTIONS]
bd link create --retry-file FILE
    [--output-format default|detail|json|jsonl] [--long]

OPTIONS:
    [--scope SCOPE] [--id ID | --id-root ROOT] [--batch-bind NAME]
    [--source-revision TOKEN] [--target-revision TOKEN]
    [--properties JSON] [--metadata JSON]
    [--revision-provenance JSON]
    [--idempotency-key KEY | --dry-run-mode batch|bdp]
    [--output-format default|detail|json|jsonl] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| SOURCE | Yes, except retry | The source Bead Reference, positional or uniquely bound with --from. |
| TARGET | Yes, except retry | The target Reference, positional or uniquely bound with --to. |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--from SOURCE` | Positional source | Bind the source in the all-flag form; no duplicate binding. |
| `--to TARGET` | Positional target | Bind the target in either admitted flag form. |
| `--type TYPE` | Required | Set the Link Type Reference. See [Types](#type-selection). |
| `--source-revision TOKEN` | Unpinned unless source suffix selects a pin | Set an exact literal source token; conflicts with a source revision suffix. |
| `--target-revision TOKEN` | Unpinned unless target suffix selects a pin | Set an exact literal target token; conflicts with a target revision suffix. |
| `--id ID` | Authority allocation | Supply the complete local ID. See [creation IDs](#creation-ids). |
| `--id-root ROOT` | Ordinary allocation | Allocate beneath a local prefix where the adapter supports it. See [creation IDs](#creation-ids). |
| `--properties JSON` | `{}` | Initialize properties. See [object inputs](#object-inputs). |
| `--metadata JSON` | `{}` | Initialize metadata. See [object inputs](#object-inputs). |
| `--revision-provenance JSON` | No caller attribution | Supply admitted version attribution input. See [object inputs](#object-inputs). |
| `--idempotency-key KEY` | Generated and saved | Set the applied write key. See [write delivery](#mutation-delivery). |
| `--retry-file FILE` | Off | Recover only the frozen invocation; semantic flags conflict. See [write delivery](#mutation-delivery). |
| `--dry-run-mode MODE` | Off | Use `batch` to emit a member or `bdp` to preview its request. See [emission](#mutation-delivery). |
| `--batch-bind NAME` | No label | Name this creation only with batch-member emission. See [write delivery](#mutation-delivery). |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `json` or `jsonl`. See [write output](#mutation-delivery). |
| `--long` | Off | Show full references and administrative detail in human output. |

##### Behavior

Bind each endpoint once, using exactly one of the three forms above. Duplicate
bindings fail even when equal. A lone endpoint flag or `--from SOURCE TARGET`
is invalid. No `--source` or `--target` alias is introduced.

Each endpoint may use its own exact pin or resolvable local number through
[Reference syntax](#reference-syntax). Bare input is unpinned. `@current` cannot
author a durable generic pin. The retained explicit endpoint flags carry literal
tokens, including numeric, `current` and `unpinned` strings; unlike write-guard
flags they do not convert numbers or use an `=` marker. A suffix plus that
endpoint's token flag conflicts even if equal. Product pin-current/float edits
are separately owned adapter operations, not extra generic wire semantics.

The Link Type determines admitted endpoint kinds, Scope boundaries and pins.
Creating a Link does not generally change either endpoint revision; applicable
ownership may induce a source revision. Preserve complete endpoint identities
and pins. Allocation, initialization and offline emission follow the shared
creation and write rules. No generic source-revision guard is invented.


##### Results

Return the complete native `mutationResult`, including its actual `changed`
value and Resource postimage. Preserve any native owner context. Human output
uses the shared Resource row; JSONL carries one complete compound result.
See [write output and recovery](#mutation-delivery). Emission instead returns the
unexecuted operation record and does not report mutation success.


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid or conflicting inputs
return `2`; a missing target returns `3`; revision mismatch returns `4`;
unsupported Write or a required lowering capability returns `5`. Access, integrity,
validation and other failures use their precise Problem and status `1` unless
another common diagnosis applies. An uncertain write returns `1` and preserves
same-key recovery information; it is not permission to submit a fresh write.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| Endpoint bindings | Set existing `source` and `target` References in POST to discovered `createLink`. |
| Endpoint suffix / explicit token | Use the exact `{uri,revision}` Reference; bare input stays a URI string. |
| --type TYPE | Set whole `type` Reference. |
| --id / --id-root | Use ordinary `id` or authority allocation; `idRoot` is not a wire member. |
| --properties / --metadata / --revision-provenance | Set the existing initial object and attribution members. |
| --dry-run-mode batch / --batch-bind | Emit `operation:"createLink"` with optional creation name; no singleton name field. |

##### Examples

```sh
# Create a floating directed Link.
bd link create note-1 note-2 --type references

# Use the mixed endpoint form.
bd link create note-1 --to note-2 --type references

# Pin two endpoint revisions independently.
bd link create note-1@=note-r3 note-2@=note-r8 --type references

# Select a revision on a fully qualified target.
bd link create --from note-1 --to '[https://work.example/acme/note-2]@3' --type references

```

#### `bd link show`

Read one verified Link, either current or at a saved revision.

##### Usage

```text
bd link show REF
    [--scope SCOPE]
    [--properties-only]
    [--output-format default|detail|json|jsonl] [--long]
    [--include POINTER]... [--omit POINTER|envelope]...
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `REF` | Yes | One local Link ID or absolute Resource URL, optionally selecting a revision. |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose the Scope for a relative ID. [Scope details](#scope-selection) remain unreviewed. |
| `--properties-only` | Off | Return the properties view. See [read views](#read-views-properties-and-included-links). |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `json` or `jsonl`. See [output](#output-format-detail-and-field-selection). |
| `--long` | Off | Show administrative details in human-readable output. |
| `--include POINTER` | Whole selected value | Include fields; repeatable. See [output](#output-format-detail-and-field-selection). |
| `--omit POINTER` | No omissions | Omit optional fields; repeatable. `envelope` selects raw output. |

##### Behavior

Resolve `REF` using the shared [ID/revision syntax](#id-and-revision-syntax).
Read current content unless the Reference selects a saved revision.
An absolute URL needs no configured default Scope. The response identifies
that the result is a Link; its ID spelling cannot establish kind.

Historical reads require the service's History capability. If the selected
revision is unavailable, fail instead of returning current content. Historical
selection cannot be combined with the properties-only view.

A successful response must establish Link kind using native context. Refuse a
Bead or an unverifiable asserted kind. The Link's source and target are References;
showing them does not fetch their bodies. Included-Link aggregate flags do not
apply to a Link subject.

The command does not accept collection filters, paging controls or write flags.
That includes `--type`, `--exact-type`, `--id`, `--id-root`, `--if-revision`
and `--from-revision`.

##### Results

The default document shows the ID, actual Type, selected revision and content.
The document also shows its endpoints. Empty sections are omitted. A saved
revision shows the content recorded with it, not today's state.

Structured output uses the `resource` result format, or `properties` for the
properties view. JSON returns one result object. JSONL returns a header,
one data record and a final record reporting completion or failure.
Diagnostics go to stderr.

##### Errors and exit status

| Status | Condition |
| --- | --- |
| `0` | Successful read. |
| `2` | Invalid arguments, missing Scope for a relative ID, invalid value or conflicting options. |
| `3` | A diagnosed missing Link or saved revision. |
| `5` | Required History, local revision lookup or requested operation is unsupported. |
| `130` | Read delivery was interrupted. |
| `1` | Other failure, including access denial, output failure or an unverifiable asserted kind. |

Preserve BDP Problems in the common error format.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| Bare `REF` or `REF@current` | GET the canonical Resource URL and verify actual Link kind. |
| `REF@N` | Look up local revision number N, then request `revision=TOKEN`. |
| `REF@=TOKEN` | Request the exact `revision` query value, without the CLI's leading `=`. |
| `--properties-only` | Request `view=properties`. |
| Output format, detail and field-selection flags | Render the selected result without changing native selection. |

See [point reads](reads-and-paging.md) and [read output](read-output.md) for the
matching protocol and result rules.

<a id="link-show-examples"></a>

##### Examples

```sh
# Read the current Link in the current Scope.
bd link show rel-1

# Read a Link using its full URL. Quotes pass the URL unchanged through the shell.
bd link show 'https://work.example/acme/rel-1'

# Read local revision number 3 using a suffix.
bd link show rel-1@3

# Read an exact revision token using a suffix.
bd link show rel-1@=saved-r1

# Read that exact token and return JSON.
bd link show rel-1@=saved-r1 --output-format json

# Read the exact token 3, rather than local revision number 3.
bd link show rel-1@=3

# Select a revision of an absolute URL. Quotes protect the brackets in the shell.
bd link show '[https://work.example/acme/rel-1]@3'

# Show only the title from the properties view.
bd link show rel-1 --properties-only --include /title

```

#### `bd link update`

Update one Link, changing its Type, properties or metadata in one atomic operation.

##### Usage

```text
bd link update REF [--type TYPE] [--scope SCOPE] [--if-revision REV]
    [--properties JSON | --replace-properties JSON | --patch-properties JSON
       | [--set-property KEY=VALUE]... [--unset-property KEY]...]
    [--metadata JSON | --replace-metadata JSON | --patch-metadata JSON
       | [--set-metadata KEY=VALUE]... [--unset-metadata KEY]...]
    [--revision-provenance JSON]
    [--idempotency-key KEY | --dry-run-mode batch|bdp]
    [--output-format default|detail|json|jsonl] [--long]
bd link update --retry-file FILE
    [--output-format default|detail|json|jsonl] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| REF | Yes, except retry | One unpinned Link ID or absolute Resource URL. |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--type TYPE` | Unchanged | Replace the whole Type Reference, optionally pinned. See [Types](#type-selection). |
| `--properties JSON` | Unchanged | Shallow merge supplied top-level values. See [object inputs](#object-inputs). |
| `--replace-properties JSON` | Unchanged | Replace the writable object. See [object inputs](#object-inputs). |
| `--patch-properties JSON` | Unchanged | Apply an ordered strict JSON Patch. See [object inputs](#object-inputs). |
| `--metadata JSON` | Unchanged | Shallow merge supplied top-level values. See [object inputs](#object-inputs). |
| `--replace-metadata JSON` | Unchanged | Replace the writable object. See [object inputs](#object-inputs). |
| `--patch-metadata JSON` | Unchanged | Apply an ordered strict JSON Patch. See [object inputs](#object-inputs). |
| `--set-property KEY=VALUE` | No keyed edit | Set a literal top-level key. Repeatable; see [object inputs](#object-inputs). |
| `--unset-property KEY` | No keyed edit | Remove a literal top-level key idempotently. Repeatable; see [object inputs](#object-inputs). |
| `--set-metadata KEY=VALUE` | No keyed edit | Set a literal top-level key. Repeatable; see [object inputs](#object-inputs). |
| `--unset-metadata KEY` | No keyed edit | Remove a literal top-level key idempotently. Repeatable; see [object inputs](#object-inputs). |
| `--if-revision REV` | No guard | Require the target revision; `N` or `=TOKEN`. See [write revisions](#write-revision-flags). |
| `--revision-provenance JSON` | No caller attribution | Supply admitted version attribution input. See [object inputs](#object-inputs). |
| `--idempotency-key KEY` | Generated and saved | Set the applied write key. See [write delivery](#mutation-delivery). |
| `--retry-file FILE` | Off | Recover only the frozen invocation; semantic flags conflict. See [write delivery](#mutation-delivery). |
| `--dry-run-mode MODE` | Off | Use `batch` to emit a member or `bdp` to preview its request. See [emission](#mutation-delivery). |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `json` or `jsonl`. See [write output](#mutation-delivery). |
| `--long` | Off | Show full references and administrative detail in human output. |

##### Behavior

The target must be an unpinned Link; select a guard with `--if-revision`, not a
revision suffix on `REF`. Supply at least one Type or object mutation input.
An admitted empty patch is allowed; a guard or provenance alone is not an update.
Properties and metadata choose their editing modes independently.

Omitting Type preserves its exact existing affiliation. Explicit Type input
replaces that whole Reference; under Types, an unpinned input resolves once at
admission. A genuine unchanged result mints no revision or Event, after guards
and policy checks. A changed Type pin is an effect even with no property changes.

Endpoints are not update fields. No source/target edit or pin-edit operation is
invented by this generic command. Link Type changes can change source ownership;
the provider performs those effects atomically and reports native owner context.

`--from-revision` belongs to a separately specified historical-content adapter;
ordinary update has no generic field for it.


##### Results

Return the complete native `mutationResult`, including its actual `changed`
value and Resource postimage. Preserve any native owner context. Human output
uses the shared Resource row; JSONL carries one complete compound result.
See [write output and recovery](#mutation-delivery). Emission instead returns the
unexecuted operation record and does not report mutation success.


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid or conflicting inputs
return `2`; a missing target returns `3`; revision mismatch returns `4`;
unsupported Write or a required lowering capability returns `5`. Access, integrity,
validation and other failures use their precise Problem and status `1` unless
another common diagnosis applies. An uncertain write returns `1` and preserves
same-key recovery information; it is not permission to submit a fresh write.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| REF | Set `link` in a POST to discovered `updateLink`. |
| --type TYPE | Set the whole `type` Reference; omission remains omission. |
| --replace-properties / --replace-metadata | Set distinct `properties` / `metadata` replacement members, not root patches. |
| Merge, patch and keyed object edits | Lower to `propertiesChange` / `metadataChange` without changing edit intent or policy. |
| --if-revision REV | Resolve the target-local number or strip `=` and set exact `expectedRevision`. |
| --revision-provenance JSON | Set admitted `revisionProvenance` input. |
| --dry-run-mode batch | Emit a member with `operation:"updateLink"` and the same inputs. |

##### Examples

```sh
# Set one property while requiring the current revision.
bd link update rel-1 --set-property title=Reviewed --if-revision =saved-r7

# Choose replacement for properties and keyed metadata editing.
bd link update rel-1 --replace-properties '{"title":"Reviewed"}' --set-metadata reviewed=true

# Change the Type without manufacturing a property patch.
bd link update rel-1 --type references@=type-r2

```

#### `bd link delete`

Preview or apply deletion of one Link.

##### Usage

```text
bd link delete REF [--scope SCOPE]
    [--output-format default|detail|json|jsonl] [--long]
bd link delete REF --force [--scope SCOPE] [--if-revision REV]
    [--revision-provenance JSON]
    [--idempotency-key KEY | --dry-run-mode batch|bdp]
    [--output-format default|detail|json|jsonl] [--long]
bd link delete --retry-file FILE
    [--output-format default|detail|json|jsonl] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| REF | Yes, except retry | One unpinned Link ID or absolute Resource URL. |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--force` | Off | Apply deletion; without it, read the current record as an observational preview. See [write delivery](#mutation-delivery). |
| `--if-revision REV` | No guard | Require the target revision; `N` or `=TOKEN`. See [write revisions](#write-revision-flags). |
| `--revision-provenance JSON` | No caller attribution | Supply admitted version attribution input. See [object inputs](#object-inputs). |
| `--idempotency-key KEY` | Generated and saved | Set the applied write key. See [write delivery](#mutation-delivery). |
| `--retry-file FILE` | Off | Recover only the frozen invocation; semantic flags conflict. See [write delivery](#mutation-delivery). |
| `--dry-run-mode MODE` | Off | Use `batch` to emit a member or `bdp` to preview its request. See [emission](#mutation-delivery). |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `json` or `jsonl`. See [write output](#mutation-delivery). |
| `--long` | Off | Show full references and administrative detail in human output. |

##### Behavior

Without `--force`, read the current Link and mark the outer result as a delete
preview. This is neither mutation admission nor a reservation. The preview cannot
promise a later deletion will succeed. Guard, provenance, execution key, emission
and retry inputs require apply intent; a saved retry already carries that intent.

With `--force`, invoke the ordinary deletion and recheck all admission conditions.
The flag does not waive authorization, integrity or revision guards and does not
reach the wire. The target remains unpinned. Deleted canonical IDs stay reserved.

Deleting a Link may produce an induced source revision under ownership rules.
Preserve the result's source pair when present; deleting an unowned Link does
not imply an endpoint revision change.


##### Results

A preview returns the ordinary `resource` descriptor with
`context.preview:"delete"`. Apply returns the complete native deletion
`mutationResult`, with the deleted identity and any applicable native context,
without a new Resource body. Emission prints an unexecuted delete member;
canonical command rendering retains `--force`.


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid or conflicting inputs
return `2`; a missing target returns `3`; revision mismatch returns `4`;
unsupported Write or a required lowering capability returns `5`. Access, integrity,
validation and other failures use their precise Problem and status `1` unless
another common diagnosis applies. An uncertain write returns `1` and preserves
same-key recovery information; it is not permission to submit a fresh write.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| No --force | GET the current Resource; add only the CLI preview marker. |
| REF with --force | POST `link` to discovered `deleteLink` with an Idempotency-Key. |
| --if-revision REV | Set exact `expectedRevision` after the shared revision conversion. |
| --revision-provenance JSON | Set attribution for an induced source revision where applicable. |
| --force | Client apply intent only; no native field. |
| --dry-run-mode batch | Emit `operation:"deleteLink"`; do not execute it. |

##### Examples

```sh
# Inspect the current record before deciding to delete it.
bd link delete rel-1

# Apply deletion with an exact revision guard.
bd link delete rel-1 --force --if-revision =saved-r7

# Emit an explicit deletion for batch composition.
bd link delete rel-1 --force --dry-run-mode batch

```

#### `bd link list`

List selected current Links, optionally by endpoint incidence or a pair.

##### Usage

```text
bd link list [ID1 [ID2]] [--scope SCOPE]
    [--from REF] [--to REF] [--endpoint REF] [--incident-to BEAD]
    [--direction in|out|both] [--all-revisions]
    [--type TYPE] [--exact-type TYPE] [--selector JSONPATH]
    [--paged | --unpaged] [--page-size N] [--limit N]
    [--output-format default|detail|table|json|jsonl] [--long]
    [--include POINTER]... [--omit POINTER|envelope]...
bd link list --continue URL [--scope SCOPE]
    [--paged | --unpaged] [--page-size N] [--limit N]
    [--output-format default|detail|table|json|jsonl] [--long]
    [--include POINTER]... [--omit POINTER|envelope]...
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| ID1 | No | First endpoint: one operand selects incidence; its revision suffix affects applicability. |
| ID2 | No | Second endpoint: two operands select the authored ID1-to-ID2 orientation by default. |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--from REF` | No source filter | Match the canonical source URI; unpinned identity only. |
| `--to REF` | No target filter | Match the canonical target URI; unpinned identity only. |
| `--endpoint REF` | No endpoint filter | Match that canonical URI at either endpoint; unpinned identity only. |
| `--incident-to BEAD` | No incident population | Select the unpinned in-Scope Bead's incident-Link view; conflicts with positional incidence. |
| `--direction in\|out\|both` | `both` for incidence; `out` for a pair | Choose orientation for incident or positional selection. |
| `--all-revisions` | Off | Ignore positional endpoint revision applicability; still list current live Links. |
| `--type TYPE` | No family filter | Select a Type and its refinements; `any` removes this predicate. See [Types](#type-selection). |
| `--exact-type TYPE` | No exact filter | Select nominal Type identity only. See [Types](#type-selection). |
| `--selector JSONPATH` | No raw Selector | Apply the existing bounded Selector. See [filters](#collection-paging). |
| `--paged` | For human/JSON | Return one native page. See [paging](#collection-paging). |
| `--unpaged` | For JSONL | Continue until exhaustion or total limit. See [paging](#collection-paging). |
| `--page-size N` | 50, subject to advertised bound | Set a positive per-fetch maximum. |
| `--limit N` | 0 | Cap total delivered records; zero means no total cap. |
| `--continue URL` | New selection | Resume the exact issued native next URL; initial selection arguments conflict. |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `table`, `json` or `jsonl`. See [output](#output-controls). |
| `--long` | Off | Show full references and administrative detail in human output. |
| `--include POINTER` | Whole selected value | Include fields; repeatable. See [output](#output-controls). |
| `--omit POINTER\|envelope` | No omissions | Omit optional fields, or return raw output; repeatable. See [output](#output-controls). |

##### Behavior

With no endpoint selection, list the current live Link inventory. One positional
operand selects incidence; two select ID1 → ID2. For a pair, `in` reverses that
orientation and `both` unions both directions in one selected native query.
Preserve authored direction and return a self-Link once. `--from`, `--to`,
`--endpoint`, Type and raw Selector filters combine with AND. Direction requires
an incident or positional selection. Explicit `--incident-to` and positional
incidence cannot bind the same role.

Bare positional IDs match canonical endpoint identity regardless of pin.
`ID@current` matches floating endpoints and pins at the checked current token.
`ID@N` or `ID@=TOKEN` matches that pin; floating also matches when that selected
token is checked current. `--all-revisions` removes this applicability test,
not the current-live Link restriction. A historic endpoint selection does not
make this a historic Link inventory. Structural endpoint flags remain URI-only.

The adapter must establish any local number/current-token mapping in a suitable
checked context. Joining unrelated GET and collection reads cannot claim atomic
current applicability. If the required binding cannot be established, refuse.
Compile the resulting predicate before native pagination; do not fetch broad
pages and hide records locally. Continuation retains that resolved selection.
See [Link applicability](reads-and-paging.md#link-incidence-and-applicability).

With `--continue`, do not supply initial operands, filters or direction. Preserve
the issued selection and validate its collection kind, even for an empty page.
Follow the [ordinary paging rules](#collection-paging), not History or Events
rules. Read masks affect display only. Unsupported family selection refuses;
it is not replaced with exact matching or a broad local scan.


##### Results

Use `resource_collection`, retaining native items and the exact continuation.
The default is the shared row table. JSONL emits complete Resource items plus
terminal completion. A successful page or total-limit prefix is not a claim that
all matches have been delivered; null continuation means observed exhaustion.
Preserve all Link endpoint pins and actual Type References in structured output.


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid selection or paging
returns `2`; diagnosed missing targets return `3`; unsupported requested
selection returns `5`. Access, consistency, stale continuation and output
failures return `1` unless a more precise common diagnosis applies.
Interrupted delivery returns `130`; incomplete output is not successful exhaustion.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| Initial population | GET the discovered Links inventory, or a verified Bead `view=links` for incident population. |
| --type / --exact-type | Set native `conformsTo` / `type` with resolved unpinned Type identity. |
| --selector JSONPATH | Set the existing bounded `selector` value. |
| --from / --to / --endpoint | Set structural native `source` / `target` / `endpoint` URI predicates. |
| Positional incidence/pair and revision applicability | Compile into the existing bounded Selector, including orientation; no new endpoint wire shape. |
| --direction | Use `inbound` / `outbound` / `both` for native incident selection, or compile pair orientation into the Selector. |
| --page-size / --limit | Set each request's native `limit` within the remaining CLI delivery budget. |
| --continue URL | Follow the complete native next URL, preserving context; ordinary page size alone may change. |
| Output, detail and masks | Render the same selected records without changing native selection or cursor position. |

##### Examples

```sh
# List all current Links without endpoint or domain defaults.
bd link list

# List outgoing Links that currently apply to one exact endpoint revision.
bd link list note-1@=saved-r4 --direction out

# List the requested pair in both authored directions.
bd link list note-1 note-2 --direction both

# Match an external endpoint identity without fetching its body.
bd link list --endpoint 'urn:example:external'

```

#### `bd link versions`

Enumerate one native History page for a verified Link.

##### Usage

```text
bd link versions REF [--scope SCOPE] [--paged] [--page-size N]
    [--output-format default|detail|table|json|jsonl] [--long]
bd link versions REF --continue URL [--scope SCOPE] [--paged]
    [--output-format default|detail|table|json|jsonl] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| REF | Yes | One unpinned Link identity; not a selected historical revision. |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--paged` | On | Deliver one native History page. |
| `--page-size N` | Provider History default | Select the initial History page limit; cannot accompany continuation. |
| `--continue URL` | Initial History page | Use the native same-subject History next URL unchanged. |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `table`, `json` or `jsonl`. See [output](#output-controls). |
| `--long` | Off | Show full references and administrative detail in human output. |

##### Behavior

Require the service's complete application History capability. Revision suffixes,
collection filters, masks, `--unpaged` and a total `--limit` are not accepted.
This cut delivers one page per call. A continuation preserves its issued limit
and History context; the ordinary collection cursor-resizing rule does not apply.
An initial page size must meet the service's History bounds.

Preserve the native subject, population, participation, window and retained-address
semantics. A version listing is not a promise that all retained bodies remain
readable. A local product timeline containing deletion events is not silently
rewritten as native History versions rows.

Verify the subject is a Link from truthful native context. If that kind cannot
be established, return `unverifiable_resource_kind`; do not guess from its path
or fetch a different current body merely to manufacture evidence.


##### Results

Use `version_collection`, preserving the native page. Each JSONL item carries
the subject, verified kind when known and the complete native version row.
The header records History context; the terminal preserves the exact delivered
boundary and native continuation. Finite human, detail and table formats show
the same version context. See [History delivery](#optional-history-delivery-without-a-new-history-promise).


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid selection or conflicting
History paging returns `2`; diagnosed missing subject/revision returns `3`;
unsupported complete History returns `5`. Access, unavailable context or an
unverifiable asserted kind returns `1` unless another precise diagnosis applies.
Interrupted delivery returns `130`.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| REF | GET the canonical subject with `view=versions`; require actual advertised complete History. |
| --page-size N | Set initial native `limit=N` under History bounds. |
| --continue URL | Follow the same-subject native next URL unchanged, including its issued limit. |
| Link assertion | Verify actual Link kind. |
| Output flags | Render unchanged native History context and rows; no read masks. |

##### Examples

```sh
# Read one page of retained versions.
bd link versions rel-1

# Request a smaller initial History page.
bd link versions rel-1 --page-size 10 --output-format json

```

### Events

Events have their own start, coverage and completion rules. They are kept separate
from point reads, mutations and History enumeration.

#### `bd events`

Read a bounded Event range for a Scope, Bead or Link.

##### Usage

```text
bd events [RESOURCE] [--scope SCOPE]
    [--from retained|now | --after TOKEN]
    [--representation postimage|delta] [--page-size N] [--follow]
    [--output-format default|detail|table|json|jsonl]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| RESOURCE | No | One unpinned Bead/Link identity; omission selects the Scope source. |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--from retained\|now` | `retained` | Choose the retained range or capture the current boundary; conflicts with --after. |
| `--after TOKEN` | No saved cursor | Resume the same source using its issued opaque cursor, not an Event ID. |
| `--representation postimage\|delta` | `postimage` | Request complete published records or optional realized deltas; no fallback. |
| `--page-size N` | Provider default | Set the initial native page limit under source bounds. |
| `--follow` | Off | Drain ranges and poll after the last completely delivered page. |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `table`, `json` or `jsonl`. See [output](#output-controls). |

##### Behavior

Resource operands must be unpinned; History selection is not an Event cursor.
The default reads one retained postimage page. `--from now` captures a boundary
and returns its empty page and cursor; with follow it observes later facts.
Require and verify the source's selected contract, representation and declared
coverage. Delta is optional and unsupported delta requests refuse.

Follow drains each issued next URL unchanged, then polls with the completed
page's cursor. It has no total Event cap or silent restart from now. An empty
poll does not end follow. Finite JSON cannot complete an endless follow, so
`--follow --output-format json` is invalid; use JSONL, detail or table.

A Bead source includes its lifecycle and incident Link facts, preserving each
fact's actual mutation kind. Facts are committed postimages or realized deltas,
not later reads or commands that may be resubmitted. Explicit gaps, expired or
foreign cursors, and unknown required messages stop delivery at the last good
progress. Replaying an older completed cursor may redeliver facts.

No list predicates, Type filters, field masks, provenance suppression or History
paging flags are accepted. The finite HTTP-condition proposal remains unreviewed;
it is not part of this entry. See [the Event contract](events.md).


##### Results

Use the `events` descriptor. Finite JSON preserves the native page, coverage,
cursor and next. JSONL emits one header, complete Event items and one terminal;
the terminal retains the latest completely delivered page's progress. A page
cursor is valid only after every Event in that page was validated and emitted.
Partial page output cannot advance it. A missing terminal is incomplete.
An Event ID is not a resume cursor and null next is not the end of future Events.


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid start modes, pinned
operands or finite JSON follow return `2`; a diagnosed missing source returns `3`;
unsupported representation returns `5`. Gaps, invalid/expired cursors, unknown
required messages and other failures return `1` with their actual diagnosis.
Ctrl-C ends follow with `130`, preserving the last completely delivered progress.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| No Resource | Use discovered Scope `events` URL. |
| Resource operand | GET the canonical Resource with `view=events`; verify asserted kind where applicable. |
| --from / --after | Set native `from=retained\|now` or opaque `after=TOKEN`. |
| --representation | Set native `representation=postimage\|delta` under selected v0.1 media. |
| --page-size | Set initial `limit`; issued next URLs keep their context and limit. |
| --follow | Follow native next, then poll with the completely delivered page cursor; no new wire stream. |
| Output format | Render unchanged native facts and progress; no field projection. |

##### Examples

```sh
# Read retained facts for this Resource.
bd events note-1

# Watch new published facts with explicit streaming output.
bd events note-1 --from now --follow --output-format jsonl

# Request realized deltas when the source supports them.
bd events note-1 --representation delta

```

#### `bd link events`

Read a bounded Event range for one verified Link.

##### Usage

```text
bd link events RESOURCE [--scope SCOPE]
    [--from retained|now | --after TOKEN]
    [--representation postimage|delta] [--page-size N] [--follow]
    [--output-format default|detail|table|json|jsonl]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| RESOURCE | Yes | One unpinned Link identity. |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--from retained\|now` | `retained` | Choose the retained range or capture the current boundary; conflicts with --after. |
| `--after TOKEN` | No saved cursor | Resume the same source using its issued opaque cursor, not an Event ID. |
| `--representation postimage\|delta` | `postimage` | Request complete published records or optional realized deltas; no fallback. |
| `--page-size N` | Provider default | Set the initial native page limit under source bounds. |
| `--follow` | Off | Drain ranges and poll after the last completely delivered page. |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `table`, `json` or `jsonl`. See [output](#output-controls). |

##### Behavior

Resource operands must be unpinned; History selection is not an Event cursor.
The default reads one retained postimage page. `--from now` captures a boundary
and returns its empty page and cursor; with follow it observes later facts.
Require and verify the source's selected contract, representation and declared
coverage. Delta is optional and unsupported delta requests refuse.

Follow drains each issued next URL unchanged, then polls with the completed
page's cursor. It has no total Event cap or silent restart from now. An empty
poll does not end follow. Finite JSON cannot complete an endless follow, so
`--follow --output-format json` is invalid; use JSONL, detail or table.

A Bead source includes its lifecycle and incident Link facts, preserving each
fact's actual mutation kind. Facts are committed postimages or realized deltas,
not later reads or commands that may be resubmitted. Explicit gaps, expired or
foreign cursors, and unknown required messages stop delivery at the last good
progress. Replaying an older completed cursor may redeliver facts.

No list predicates, Type filters, field masks, provenance suppression or History
paging flags are accepted. The finite HTTP-condition proposal remains unreviewed;
it is not part of this entry. See [the Event contract](events.md).


##### Results

Use the `events` descriptor. Finite JSON preserves the native page, coverage,
cursor and next. JSONL emits one header, complete Event items and one terminal;
the terminal retains the latest completely delivered page's progress. A page
cursor is valid only after every Event in that page was validated and emitted.
Partial page output cannot advance it. A missing terminal is incomplete.
An Event ID is not a resume cursor and null next is not the end of future Events.


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid start modes, pinned
operands or finite JSON follow return `2`; a diagnosed missing source returns `3`;
unsupported representation returns `5`. Gaps, invalid/expired cursors, unknown
required messages and other failures return `1` with their actual diagnosis.
Ctrl-C ends follow with `130`, preserving the last completely delivered progress.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| RESOURCE | GET verified Link URL with `view=events`. |
| Resource operand | GET the canonical Resource with `view=events`; verify asserted kind where applicable. |
| --from / --after | Set native `from=retained\|now` or opaque `after=TOKEN`. |
| --representation | Set native `representation=postimage\|delta` under selected v0.1 media. |
| --page-size | Set initial `limit`; issued next URLs keep their context and limit. |
| --follow | Follow native next, then poll with the completely delivered page cursor; no new wire stream. |
| Output format | Render unchanged native facts and progress; no field projection. |

##### Examples

```sh
# Read retained facts for this Resource.
bd link events rel-1

# Watch new published facts with explicit streaming output.
bd link events rel-1 --from now --follow --output-format jsonl

# Request realized deltas when the source supports them.
bd link events rel-1 --representation delta

```

### Scope and aliases

#### `bd scope inspect`

Read the Scope's advertised machine description.

##### Usage

```text
bd scope inspect [SCOPE] [--scope SCOPE]
    [--output-format default|detail|json|jsonl]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| SCOPE | No; Unreviewed | Scope discovery location; positional and flag selection remain [unreviewed](#scope-selection). |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `json` or `jsonl`. See [output](#output-controls). |

##### Behavior

Use the established discovery binding and return the advertised description.
Preserve the canonical Scope, navigation URLs, profiles and capability versions.
Do not infer adoption of a new capability from a newer client, expand a missing
advertisement or guess inventory/operation suffixes. The Scope spelling and
configuration precedence proposal remains unreviewed; this entry specifies the
read after its discovery binding has been established.


##### Results

Use the `scope` descriptor and preserve the native description. Default/detail
show its advertised fields; structured output does not translate capability
versions into executable versions. This command does not accept Resource masks,
collection paging or write inputs.


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid selection or paging
returns `2`; diagnosed missing targets return `3`; unsupported requested
selection returns `5`. Access, consistency, stale continuation and output
failures return `1` unless a more precise common diagnosis applies.
Interrupted delivery returns `130`; incomplete output is not successful exhaustion.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| Established Scope discovery binding | GET the machine description under the selected contract. |
| Output format | Render the native discovery document without inventing profile or capability support. |

##### Examples

```sh
# Inspect the already established Scope.
bd scope inspect

# Preserve the advertised description as JSON.
bd scope inspect --output-format json

```

#### `bd alias resolve`

Resolve one alias to its canonical in-Scope Bead URL without fetching the Bead.

##### Usage

```text
bd alias resolve NAME [--scope SCOPE]
    [--output-format default|detail|json|jsonl]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| NAME | Yes | A complete Scope-relative alias path or absolute alias URL, not a revision-selected Reference. |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `json` or `jsonl`. See [output](#output-controls). |

##### Behavior

Resolve a relative name against the Scope itself, without automatically adding
the advertised alias base. Its complete URL must lie in the advertised alias
namespace. Expect one alias redirect to a canonical in-Scope Bead URL. Do not
follow that redirect to retrieve the Bead body.

A normal Resource 200 is `not_an_alias`, not a successful alias binding or a
fabricated BDP 404. No revision, target body, paging or field-mask operation is
introduced. Alias equality and collision use complete URLs, without stripping
path segments.


##### Results

Use the `reference` descriptor with the canonical target URL from Location.
This is a locator result, without a Resource body or target authorization grant.


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid names return `2`; a
diagnosed missing alias returns `3`; unsupported alias resolution returns `5`.
`not_an_alias`, cross-Scope/unverifiable targets, access and output failures
return `1` unless another precise diagnosis applies.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| NAME | Resolve the full alias URL and inspect its one-step HTTP 307 Location. |
| Native Location | Return the verified canonical Bead URL; do not GET its body. |
| Output format | Render a reference result, not a Resource. |

##### Examples

```sh
# Resolve a complete name admitted by this Scope.
bd alias resolve current-plan

# Resolve a fully qualified alias without guessing a kind prefix.
bd alias resolve 'https://work.example/acme/current-plan' --output-format json

```

#### `bd alias put`

Create or repoint one alias to a canonical in-Scope Bead.

##### Usage

```text
bd alias put NAME --target REF [--scope SCOPE] [--idempotency-key KEY]
    [--output-format default|detail|json|jsonl] [--long]
bd alias put --retry-file FILE
    [--output-format default|detail|json|jsonl] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| NAME | Yes, except retry | Complete relative alias path or absolute alias URL within the admitted alias namespace. |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--target REF` | Required, except retry | Canonical unpinned in-Scope Bead target; not a Link endpoint flag. |
| `--idempotency-key KEY` | Generated and saved | Set the applied write key. See [write delivery](#mutation-delivery). |
| `--retry-file FILE` | Off | Recover only the frozen invocation; semantic flags conflict. See [write delivery](#mutation-delivery). |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `json` or `jsonl`. See [write output](#mutation-delivery). |
| `--long` | Off | Show full references and administrative detail in human output. |

##### Behavior

Put exactly one alias binding using the discovered operation. Preserve the
authored alias locator and target for admission and same-key comparison. The
authority checks complete URL collisions and target eligibility. A previously
committed Resource identity cannot become an alias, even after deletion.

Repointing creates no Bead revision and does not rewrite stored References.
No revision guard, provenance, object edit, emit-operation or atomic-batch member
is admitted. The shared frozen retry rules apply; a later repoint must not rebind
the original invocation during recovery.


##### Results

Return the complete native `aliasResult`, preserving its created, updated or
deleted result shape. An alias has no Resource revision, no manufactured `changed`
member and no revision provenance. Structured output uses the shared mutation
descriptor; JSONL carries one complete result with its terminal.


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid or conflicting inputs
return `2`; a missing target returns `3`; revision mismatch returns `4`;
unsupported Write or a required lowering capability returns `5`. Access, integrity,
validation and other failures use their precise Problem and status `1` unless
another common diagnosis applies. An uncertain write returns `1` and preserves
same-key recovery information; it is not permission to submit a fresh write.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| NAME and --target REF | POST existing `alias` and `target` members to discovered `putAlias`. |
| --idempotency-key / --retry-file | Use the shared mutation key namespace and original frozen alias witnesses. |
| Output controls | Preserve native aliasResult rather than treating it as Resource CRUD. |

##### Examples

```sh
# Create or update a locator for the current plan.
bd alias put current-plan --target note-1

# Use an exact caller-supplied recovery key.
bd alias put current-plan --target note-2 --idempotency-key plan-route-2

```

#### `bd alias delete`

Remove one alias binding, leaving its Bead unchanged.

##### Usage

```text
bd alias delete NAME --force [--scope SCOPE] [--idempotency-key KEY]
    [--output-format default|detail|json|jsonl] [--long]
bd alias delete --retry-file FILE
    [--output-format default|detail|json|jsonl] [--long]
```

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| NAME | Yes, except retry | Complete admitted alias path or absolute alias URL. |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--force` | Required, except saved retry | Express explicit deletion intent; aliases have no Resource preview. |
| `--idempotency-key KEY` | Generated and saved | Set the applied write key. See [write delivery](#mutation-delivery). |
| `--retry-file FILE` | Off | Recover only the frozen invocation; semantic flags conflict. See [write delivery](#mutation-delivery). |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `json` or `jsonl`. See [write output](#mutation-delivery). |
| `--long` | Off | Show full references and administrative detail in human output. |

##### Behavior

Require explicit apply intent. This command has no observational Resource
preview: use alias resolve to inspect the binding. Remove the alias only, without
deleting or revising its target. A deleted alias locator may later be reused;
that does not release any canonical Bead or Link identity.

The shared frozen retry rules retain the original alias witnesses and key.
No Resource revision guard, provenance, object edit, emission or batch member
is added.


##### Results

Return the complete native `aliasResult`, preserving its created, updated or
deleted result shape. An alias has no Resource revision, no manufactured `changed`
member and no revision provenance. Structured output uses the shared mutation
descriptor; JSONL carries one complete result with its terminal.


##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid or conflicting inputs
return `2`; a missing target returns `3`; revision mismatch returns `4`;
unsupported Write or a required lowering capability returns `5`. Access, integrity,
validation and other failures use their precise Problem and status `1` unless
another common diagnosis applies. An uncertain write returns `1` and preserves
same-key recovery information; it is not permission to submit a fresh write.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| NAME with --force | POST existing `alias` member to discovered `deleteAlias`. |
| --force | Client apply intent only; no wire member. |
| Recovery and output controls | Use shared mutation durability and native aliasResult. |

##### Examples

```sh
# Remove the locator while preserving its target.
bd alias delete current-plan --force

# Retain the complete native deletion result as JSON.
bd alias delete current-plan --force --output-format json

```

### Atomic batch

#### `bd batch`

Apply or emit one optional atomic batch from JSONL member data or a native
versioned JSON request. The [overview](overview/06-batch.md) introduces fixed
IDs, outcomes and recovery before bindings, arguments and selections.

##### Usage

```text
bd batch [SCOPE] --file FILE --input-format jsonl --batch-version VERSION
    [--batch-arg NAME=VALUE ...] [--scope SCOPE]
    [--idempotency-key KEY | --dry-run-mode batch|bdp]
    [--output-format default|detail|json|jsonl] [--long]
bd batch [SCOPE] --file FILE [--input-format json] [--scope SCOPE]
    [--idempotency-key KEY | --dry-run-mode batch|bdp]
    [--output-format default|detail|json|jsonl] [--long]
bd batch --retry-file FILE
    [--output-format default|detail|json|jsonl] [--long]
```

The JSONL version-selection spelling and proposed version-2 encoding remain
author proposals. This section incorporates the reviewed CLI direction; it
does not amend the retained version-1 wire/schema or claim an implementation.

##### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| SCOPE | No; Unreviewed | Optional destination Scope spelling; see [Scope selection](#scope-selection). |

##### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scope SCOPE` | Unreviewed | Choose or verify the command Scope. See [Scope selection](#scope-selection). |
| `--file FILE` | Required, except retry | Read and freeze one complete input; `-` means stdin. |
| `--input-format json\|jsonl` | `json` | Choose a literal native wrapper or local JSONL member authoring. Raw CLI text is not accepted. |
| `--batch-version VERSION` | Required for JSONL; proposed | Select its exact encoder/admission grammar; native JSON already carries its selector and rejects this flag. |
| `--batch-arg NAME=VALUE` | None | Repeat to supply scalar Reference arguments required by JSONL operand use. Missing, unused and duplicate values fail. |
| `--idempotency-key KEY` | Generated and saved | Set one applied write key. See [write delivery](#mutation-delivery). |
| `--retry-file FILE` | Off | Recover only the frozen invocation; semantic flags conflict. |
| `--dry-run-mode batch\|bdp` | Off | Emit the compiled native wrapper or preview its BDP request without execution. |
| `--output-format FORMAT` | `default` | Accepts `default`, `detail`, `json` or `jsonl`. See [write output](#mutation-delivery). |
| `--long` | Off | Show full references and administrative detail in human output. |

##### Behavior

The selected version must be implemented by the compiler and advertised by the
authority for execution. Version 1 retains its six CRUD members and existing
creation-capture semantics. Named List/Query selection and set targets belong
to the explicitly proposed version-2 grammar. Unsupported selection refuses;
there is no downgrade, client-side preselection, independent-write fallback or
automatic chunking.

JSONL authoring contains one complete member object per physical line.
It has no comments, blank lines, header or array delimiters. Freeze and validate
every member and argument before sending anything. Syntax and value checks
retain the selected contract's duplicate-key, Unicode, numeric and input bounds.
Members share one Scope, authorization context, contract and key.

Ordinary commands with `--dry-run-mode batch` produce those member records.
Creates and admitted selections use `--batch-bind NAME` to define a variable;
`batch-ref::NAME` in an admitted Reference position emits a structural reference.
Names are unique and match `[A-Za-z][A-Za-z0-9_-]*`. A full HTTP URL stays a
Reference; property strings and arbitrary JSON data are never interpolated.
Using a batch definition/reference in ordinary execution fails.

Compile the complete JSONL document before classifying references. Names defined
by members are internal, must precede use and cannot be overridden by arguments.
An undefined name in an admitted operand is an implicit required external
argument. `--batch-arg NAME=VALUE` resolves that input to an ordinary Reference
under the outer Scope before constructing the native wrapper. Forward internal
references, missing/unused/duplicate arguments and invalid operand kinds refuse.
Native JSON is literal selected wire input and accepts neither supplied arguments
nor undeclared external names. Exact allowed argument positions remain in the
[batch design notes](batch-selection-design.md#jsonl-assembly-and-supplied-arguments).

One decision commits all admitted effects or none. Guards on existing targets
compare their committed pre-batch baseline. Final publication produces at most
one new revision per final changed Resource or owner; a net-zero covered state
retains its original revision. Create-then-delete still consumes identity.
Selection sees earlier staged writes and captures membership once, subject to
explicit transaction-scoped support. Precise concurrent-selection admission
remains review work.

Recovery uses the complete original frozen request, resolved arguments,
selected version, route and key. It never rereads source files or reevaluates
a committed selection. Dry-run output makes no remote admission, allocation
or key-reservation claim. BDP preview requires an established operation route;
its exact framing/read-only discovery policy remains under review.

##### Results

Preserve the complete native result: selected version, aggregate change,
ordered member identity mappings and unique final Resource outcomes.
The retained version-1 result grammar remains unchanged; exact result fields
for selections and sets are proposals for the next detailed pass.
There are no intermediate public postimages. Human output reports one decision;
JSONL output carries its complete compound result as one item.

Member emission writes one compact JSON object and a newline. Batch emission
writes one complete versioned native wrapper. Neither is a successful mutation
result. See the [retained wire result contract](../../specs/profiles/write/atomic-batch.md#final-results-not-intermediate-postimages)
and [new selection examples](overview/06-batch.md).

##### Errors and exit status

Uses the [common exit statuses](#exit-status). Invalid or conflicting inputs,
including missing or unused arguments, return `2`; a missing target returns
`3`; revision mismatch returns `4`; unsupported Write or a required capability
returns `5`. Other failures retain their precise Problem and status `1` unless
another common diagnosis applies. Member context is reported where the selected
Problem and authorization permit it. An uncertain write preserves same-key
recovery information and never authorizes a fresh execution automatically.

##### Protocol correspondence

| CLI input | Protocol request or client behavior |
| --- | --- |
| JSONL members and selected version | Validate/resolve authoring input and build the exact versioned native wrapper. |
| Native JSON | Validate the literal wrapper and required selector without interpolation. |
| `--batch-bind` / `batch-ref::NAME` | Define and consume typed batch variables; selected wire encoding preserves their identity dependencies. |
| `--batch-arg NAME=VALUE` | Resolve external Reference inputs locally; no unresolved external argument is sent. |
| Execution | POST once to the discovered atomic-batch operation with one Idempotency-Key. |
| `--dry-run-mode batch` | Emit the complete native request body without execution. |
| `--dry-run-mode bdp` | Preview the corresponding request under an established route; omit credentials. |
| Recovery / output controls | Preserve the original decision and its complete compound outcome. |

##### Examples

```sh
# Execute fixed-ID JSONL members under the retained CRUD grammar.
bd batch --file csv-basics.jsonl --input-format jsonl --batch-version 1

# Supply the guide input and inspect the resolved candidate request.
bd batch --file csv-arguments.jsonl --input-format jsonl --batch-version 2 \
  --batch-arg guide=csv-draft --dry-run-mode batch

# Execute an already authored native versioned request.
bd batch --file review.json --input-format json

# Recover an uncertain batch using its frozen original invocation.
bd batch --retry-file private-replay.json

```

### Deferred command surfaces

`bd type list` is the agreed singular command location for the future Type CLI.
Its complete invocation, inventory payload, flags and behavior remain deferred;
do not infer a `types/` Resource prefix or a new definition endpoint from this
placeholder. Type lifecycle and definition-authoring commands are outside this pass.

`bd serve` remains reserved. Its executable adapter and hosting contract are not
specified here. Search, graph and query reconciliation likewise remains separate;
the complete collection entries above specify `list` only.

### Unreviewed material

These details are retained for discussion. They are not agreed requirements.

#### Scope selection

The draft Scope flag is `--scope SCOPE`. Its configuration rules remain
unreviewed. The previous proposal chose an explicit flag first, then
`BDP_SCOPE_URL`, then configuration `scope.url`.

That proposal allowed some commands to take a positional Scope, rejected
combining it with `--scope`, and used a verified owning Scope for writes.
See [Scope selection details](scope-and-references.md#set-context-once).

#### HTTP read conditions and metadata

| Flag | Proposed HTTP meaning |
| --- | --- |
| `--head` | Use HEAD and return response metadata. |
| `--if-match ETAGS` | Send `If-Match`. |
| `--if-none-match ETAGS` | Send `If-None-Match`. |
| `--if-modified-since HTTP_DATE` | Send `If-Modified-Since`. |
| `--if-unmodified-since HTTP_DATE` | Send `If-Unmodified-Since`. |

These proposed controls use HTTP validators, not Resource revision numbers
or tokens. The proposal also covers bodyless responses and metadata output.
They are omitted from the reviewed `show` entry for this pass. See
[HTTP read details](reads-and-paging.md#existing-exact-reads-and-http-controls).

### Implementation correspondence

The reference above describes the proposed CLI. At Beads candidate
`79450c2d67ccab326b20b07cc3d66179fa148ec0`:

| Topic | Source correspondence |
| --- | --- |
| Quoted `[URL]@REV` and separate Link endpoint selection | Already supported. Unwrapped absolute URLs remain literal. |
| Reserving `@` in newly created local IDs | New design decision; that candidate still allows `@` in new local IDs. Existing identities must remain unchanged. |
| Numbers and `=TOKEN` for write guards and historical content sources | New design decision. That candidate's explicit token flags still use their literal values, without this conversion. |

Janet and Cleo checked the existing parser and cases without running a new
suite. See the [Reference parser](https://github.com/donnabox/beads/blob/79450c2d67ccab326b20b07cc3d66179fa148ec0/cmd/bd/graph_preview_reference.go)
and [revision selector](https://github.com/donnabox/beads/blob/79450c2d67ccab326b20b07cc3d66179fa148ec0/internal/clirevision/selector.go).
These notes do not change an installed build or its qualification.
