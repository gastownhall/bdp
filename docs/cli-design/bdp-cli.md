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
An unwrapped absolute HTTP URL stays literal, including raw @; use an explicit
selector flag for an absolute URL. Exact JSON string/Reference forms or the full
canonical URL keep literal identities containing @ selectable. `--id` is always
literal. See [reference parsing](scope-and-references.md#revision-selectors).

| Position | Flag | Meaning |
| --- | --- | --- |
| show | --revision TOKEN | Exact historical revision query, not a guard or ordinal |
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
| show REF [--revision TOKEN] | One current or exact Resource; [reads](reads-and-paging.md) |
| link show REF [--revision TOKEN] | Same read with actual Link assertion |
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

--emit-operation on six ordinary CRUD commands and --emit-batch on batch produce
literal selected native input without network/key/ID allocation or admission claim.
Local ordinals and allocator-only --id-root cannot be silently resolved by the
offline compiler; use exact tokens and explicit IDs, or receive an explicit refusal.
Create --name is a batch/operation-emission label; ordinary singleton execution
refuses it rather than inventing a body field. Delete rendering preserves --force. Display framing/masks and execution/retry keys
conflict with emission. Shared native fields, presence, exact values, guards, Type
pins, patch/replacement intent and capture names survive compile/render; unsupported
versions refuse rather than rewrite. Future parameterization needs explicit versioned
syntax; current strings/@name never acquire new interpolation meaning.

## Optional History delivery, without a new History promise

versions and link versions require an unpinned subject and actual advertised
complete application History; suffix/--revision selection refuses on enumeration.
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
