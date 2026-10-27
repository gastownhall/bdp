# Canonical CLI: read output descriptors

This ordinary-read subset uses Cleo's schema version 2 contract, with the [read
commands](reads-and-paging.md) and [protocol delivery rules](../../specs/profiles/core/read-delivery.md).
The [candidate schema](read-framing.schema.json) covers only these read descriptors;
it is neither a replacement for Cleo's full registry nor a protocol schema/runtime
export. It checks framing and primary protected shape for bound v0.1 invocations;
complete native-state validation and cross-record delivery semantics are separate.
Pre-binding errors and other Cleo descriptors are outside this subset. Examples are [paper artifacts](../../fixtures/read-delivery/candidate.json),
not evidence that Preview clients or a provider implement the target.

## Preserve data and declare context

JSON envelope has numeric `schema_version:2`, actual immutable `bdp_spec`,
`result_kind`, and `outcome:success|failure`. Unknown is for indeterminate mutations,
not failed/incomplete reads, and is outside this descriptor subset. Default point
format is detail and collections table; redirection does not pick another format.
Use `--output-format default|detail|table|json|jsonl`; unsupported format/descriptor
combinations refuse before dispatch.
Collections admit default/detail/table/json/jsonl, points and metadata admit
other declared default/detail/json/jsonl forms; table is collection-only here.

| Descriptor | Data/delivery unit |
| --- | --- |
| resource | One full or explicitly projected primary Bead/Link |
| resource_collection | Native items/next shape; one primary Resource per JSONL item |
| properties | Actual properties-view object, not a Resource masquerading as one |
| scope | Advertised native machine description; no new profile binding inferred |
| reference | Canonical alias target URL, never a fetched target body |
| http_metadata | HEAD response `{httpStatus,headers}`, not a fake Resource |

Context declares effective subject URL and primary `resource_kind:bead|link` for
Resource/collection/properties/aggregate values when successful or retained as data. This is
a CLI descriptor discriminator, not a new Resource field. It follows the represented
unit: incident collections are link even though HTTP BDP-Resource-Kind identifies
the Bead subject. Actual BDP-Collection-Kind establishes item kind, including empty
pages; no URL-path or arbitrary data-property heuristic decides it.

An observational Resource delete preview may add `context.preview:"delete"`;
this is client intent, not a wire field, mutation admission or reserved identity.
It otherwise uses the ordinary Resource descriptor and read protections.

Context may record the associated native response's `httpStatus` and end-to-end
`headers`, lowercase keys/arrays of values. Exclude credentials and hop-by-hop
fields. These are native response metadata, never an ETag/status for the serialized
CLI envelope or assembled/projected collection. For a composed read they describe
the terminal associated native response, not a global validator over all items.
JSONL's header declares initial subject/unit context; its terminal can carry the
associated final response context. No extra page-control record type is invented.

GET 304 retains its normal read descriptor, success and HTTP 304 context, without
data/completion/items; it is not an empty selection. HEAD uses http_metadata and
its native status/headers even when bodyless. A 406/412 failure has CLI-originated
HTTP diagnosis and real response context, not a forged BDP Problem. Preserve any
actual BDP Problem unchanged in `error:{origin:"bdp",problem:...}`; local problems
use origin cli with stable code/message. Error framing cannot claim native payload
validation merely by carrying a Problem object.

## Common human documents and rows

Bead and Link point output use one layout: `ID [declared concrete Type]`, optional
title, selected revision/context, exact stored body, remaining Properties, then
Metadata. String `properties.title` is the optional title; string `properties.body`
is the body convention. Do not lift a nonstring value into text: keep it in the
Properties section. Other properties render in that section as exact data.
Links add source
and target with authored pins visible. Current and retained reads use that layout;
never fill a historical document with current comments/relationships. Omit empty
sections; `--long` exposes administrative detail and full URI/token/affiliation.
An abstract base must not be relabeled as a concrete declaration for appearance.

Collection and creation rows share helpers and begin ID then [Type]; native Issue
status/priority remain useful product columns, and Link rows add exact endpoints.
The generic Bead table columns are ID, TYPE, TITLE; generic Link tables add
SOURCE and TARGET, and may show optional `properties.status` as STATUS when that
column is present in the selected records. Missing values render as an empty cell,
not a synthesized stored value. JSON retains absence and null distinctly.
Creation success is a brief acknowledgement plus those rows. All five product Memory
authoring verbs consume the same Link result renderer, without default JSON or
separate Link/source revision chatter. This is human rendering, not a change to the
native result or admission of new output-format/descriptor combinations.

Remove only the exact canonical local Scope prefix for human identity display,
preserving every literal segment; foreign URLs remain absolute. A stable local
ordinal may abbreviate the selected revision/pin in human output when the adapter
supplies its mapping. Otherwise show its exact token form. Full tokens, canonical
URIs and actual Type References remain in structured output and detail access.
Labels/local numbers must not become stored references or advertised portable IDs.
Diagnostics and graph omission notices use stderr, keeping JSON/JSONL stdout valid.

## Field masks are representation only

`--include POINTER` unions explicit fields; `--omit POINTER` subtracts optional
fields. Root is each primary Resource for Resource/collection, the properties
object for properties view. Framing controls are outside those roots. Pointer
syntax is RFC6901, not JSONPath/wildcards/dot paths/URI fragments. Existing exact
JSON string/file field-value escapes can carry a pointer awkward in argv; read/freeze
it before dispatch and allow only one stdin consumer. No hidden request escape.

Inside Resources, nested masks are under properties/metadata; other optional planes
revisionProvenance/ownedLinks/links are whole-plane masks. Missing optional paths or
wrong-shaped optional data are no-ops. Root inclusion selects the whole unit; root
omission refuses. Identity, Type, revision and Link endpoints are implicit protected
context, with exact Reference objects kept whole. Prohibited omissions refuse even
when targeting one pin member; includes cannot erase implicitly protected context.
Ordinary properties containing id/type/uri/revision remain data, not protocol objects.

Evaluate every path against the original value. Deduplicate/overlap harmlessly;
compact retained array elements once in original order, never pad nulls or reevaluate
shifted indexes. Keep ancestor containers. Do not remove collection members through
field masks. An optional ownedLinks/links plane may disappear as a whole; represented
embedded Resources/References retain their context, without any fetch to fill fields.
Do not preserve every Type-required property just because it was required in storage.

Explicit masks add outer/header `projection:{include?:[...],omit?:[...]}` using
requested original-value paths. Protected context is implicit, not added to include
metadata; `envelope` is not a Resource pointer. No explicit mask means no projection
object. Projected output need not validate as complete native state and cannot claim
to be a full write replacement or transfer package. Masks do not change selection, order, revision/context or authorization. Under
the proposed native projection capability the transferred Resource is already
projected; the renderer preserves that declared projection and never fills omitted
fields from another read. Earlier display-only adapters do not establish that
service capability. Reference stays Reference.

## Finite/stream completion

Finite JSON assembles/serializes before emitting success. A handled read failure
returns one failure envelope; already acquired valid rows may accompany it with
explicit error completion. No second success object or error Resource is injected.
For collection bodies, completion counts delivered primary items, not total matches:
returned, exhausted true/false/null, and stop_reason exhausted/page/limit/error.
Success exhausts only on observed native end; otherwise page/limit is a successful
prefix with its exact native next. Failure with unknown exhaustion uses null;
known undelivered rows remain false. Failure data may omit next when no exact
continuation exists, rather than inventing null. Bodyless 304 has no completion.

JSONL is exactly one header, zero or more complete item records, one terminal.
Header carries schema/spec/kind/context/projection but never an early outcome.
Terminal carries outcome, collection completion where meaningful, error/context as
needed and lossless native `continuation` when an exact emitted boundary is known.
Null continuation means delivered through authoritative end; unavailable continuation
is omitted. Handled mid-page failure does not advertise a token after its tail.
Interruption uses local interrupted and status 130 when writable; a missing terminal
or malformed output is incomplete, even if all prior item lines parsed.

`--omit envelope` removes framing, including projection/completion declarations.
Finite raw GET 304 emits no stdout with status 0; raw failure without data emits none
with nonzero status. Raw JSONL contains only data records; stderr/process status
remain necessary and saved bytes do not prove completion. Emission artifacts and
write descriptors keep their separate contracts. No Events/History/type-inventory
format or coverage is adopted by these examples.

> **Cleo — Descriptors:** Schema 2, projection metadata and header/item/terminal are
> reused. Resource-kind context and bodyless descriptors make this adapter precise;
> they are explicit candidate additions, not claims about current executable pins.


## Query, graph and count correspondence

The [complete read CLI](query-language.md) and [native binding proposal](../../specs/profiles/core/read-operations.md)
reuse schema 2 and the common rendering implementation. The native operation
wrapper is decoded into an existing descriptor; it is not nested as an invented
Resource or serialized as a second CLI envelope.

- Resource results use `resource_collection`: its existing `data.items`/`next`
  receive the native result's items/next, with actual item kind in context.
  Applied native projection is the outer projection metadata; a renderer must not
  apply original array-index masks a second time to already compacted data.
- Count uses the existing `aggregate` descriptor, with data `{count:N}` and
  explicit Bead/Link unit in context. No new result kind or schema version is
  introduced. This aggregate's human default is the exact decimal count plus
  newline. There are no Resource rows or item-page completion counts.
- Graph uses the existing `graph` descriptor, with data equal to the native graph
  value (roots, Beads, Links and endpoint mappings, without the native `form` tag).
  Render through the shared graph human layout; retain actual Link IDs and
  selected edition mapping in structured data. No component paging, data masks
  or path-count interpretation is introduced by this candidate.

For this extension, context adds `evaluation` with the native evaluation object
unchanged, with its explicit `scope:"response"`. For assembled multi-page output
it describes the associated native response, not an invented merged trace or a
claim that all pages share one evaluator execution. Ordinary collection completion
separately reports the delivered prefix and exhaustion. This is a proposed descriptor-context addition to register with the
common framing owner, not a new frame type or an addition to every installed
command. It accompanies successful finite values, the JSONL header and any
retained valid data after delivery failure. A transport/delivery failure must not
rewrite an established evaluation as a false query answer. A failure before an
evaluation is established has no successful evaluation context.

Graph/count JSONL use one item for the whole value between the ordinary header
and terminal. Resources keep one item per primary Resource. Human layout,
projection metadata and completion are separate from evaluator completeness.
An incomplete delivery stream is still incomplete even when its selection was
fully evaluated. The six-descriptor schema in this directory remains its older
ordinary-read subset until these explicit graph/aggregate/context additions are
ported; schema checks against that older subset do not qualify these extensions.


### Format admission for the new result descriptors

These rows complete the extension's format matrix; they are adoption proposals
for the shared renderer registry, not runtime registration here.

| Descriptor | Admitted formats | Default / context |
| --- | --- | --- |
| `aggregate` (exact count) | default, detail, json, jsonl | Default prints decimal count and newline; detail prints `Count (beads): N` or `Count (links): N`; `context.resource_kind` names that unit |
| `graph` | default, table, detail, json, jsonl | Default is table; context identifies the operation/Scope and evaluation, with no single `resource_kind` for mixed components |

Graph table output has a Beads section (ID, TYPE, TITLE) and a Links section
(ID, TYPE, SOURCE, TARGET), in the native component order. Isolated roots remain
in Beads. Detail is the rooted tree illustration used in the overview: each
represented edge appears once per displayed root expansion, with `[cycle]` or
`[already shown]` marking stopped repeated expansion. Preserve direction and
parallel Links. `--long` includes edge IDs/full context; machine output always
retains them. A tree cannot replace the underlying selected graph or its mappings.
A graph with multiple editions of one identity displays revision qualification
where needed to distinguish them; it never merges their content.

Counts and graphs are finite compound values. Table count output refuses because
it has no Resource rows. `--omit envelope` remains a presentation-only escape for
admitted JSON output, including count; the bare token differs from data pointer
`/envelope` and never enters the native mask. Resource-mask conflict rules do not
forbid this framing escape. Versions retains its separate subject-summary layout:
Subject, Population, Participation, Window, summary table and Next, with truthful
unknown/unavailable metadata and elision of optional detail explicitly marked.
