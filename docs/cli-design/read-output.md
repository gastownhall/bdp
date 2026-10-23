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
Resource/collection/properties values when successful or retained as data. This is
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
to be a full write replacement or transfer package. Masks do not change selection,
order, revision/context, auth or transmitted native bytes. Reference stays Reference.

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
