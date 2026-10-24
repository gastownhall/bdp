# Required Events: CLI and mutation correspondence

Paired with [Core Events](../../specs/profiles/core/events.md) and the [accepted
decisions](event-decisions-20261022.md). This is concrete draft source, not an
implemented client. Postimage default and finite-JSON polling are author choices
within the accepted minimum; neither needs another human ruling.

## Small command surface

```text
bdp events [RESOURCE] [--from retained|now | --after TOKEN]
           [--representation postimage|delta] [--page-size N] [--follow]
bdp link events RESOURCE [same options]
```

No Resource means the default/explicit Scope's discovered `events` URL. A Resource
means its canonical URL with `view=events`; root is generic, `link` asserts Link.
Scope defaults and whole Scope-defined names follow the existing Reference rules.
The Resource operand must be unpinned: revision suffixes and `--revision` are not
Event resume selectors. No fabricated `events/` path or stripping of kind prefixes.

Default is `--from retained --representation postimage`, one finite native page.
`--from now` captures the current boundary and returns an empty page plus its
cursor; with `--follow` it starts observing after that boundary. `--after TOKEN`
uses a previously issued source cursor. Explicit `--from` and `--after` conflict,
even when the caller believes them equivalent. Event IDs are not resume cursors.

| CLI input | Native query/behavior |
| --- | --- |
| omitted start | `from=retained` |
| `--from now` | `from=now` |
| `--after TOKEN` | `after=TOKEN`; preserve the opaque token |
| omitted representation | `representation=postimage` |
| `--representation delta` | `representation=delta`; refuse unsupported mode |
| `--page-size N` | Initial native `limit=N` |
| `--follow` | Drain issued `next` pages, then poll with the completed page's cursor |

The CLI supplies `Accept: application/vnd.bdp.v0.1+json`. It verifies selected
contract, source, representation and coverage before reporting data. A delta
request never silently falls back. The native page's absolute `next` is followed
unchanged; its issued context/limit cannot be resized. `--follow` has no total
Event cap, implicit restart from now, or independent streaming-log requirement.
Finite JSON is the baseline wire transport. An SSE adapter needs a future explicit
binding; plain `text/event-stream` does not select this contract.
The shared finite-read HTTP controls apply where admitted, including `--head` and
conditional headers. Bodyless HEAD/304 use the existing metadata/read framing,
never an empty caught-up page or fabricated cursor. These controls conflict with
`--follow`; no conditional-response loop substitutes for Event continuation.

Ordinary list predicates, Type filters, output masks, provenance suppression,
JSONPath/Pointer property selection, History selectors and replica checkpoint
flags are outside this cut. Output formatting is still available; hiding terminal
fields is not a promise to suppress them over the wire.

## One vocabulary in both directions

An Event's `effect` uses the same `operation` discriminator and field names as a
batch member. Its surrounding envelope records an authority's published fact.

| Mutation intent | Realized delta Event `effect` |
| --- | --- |
| `createBead` / `createLink` | Same name, allocated absolute `id`, recorded `type`, complete initial `properties`/`metadata`, and Link `source`/`target` |
| `updateBead` / `updateLink` | Same name and absolute `bead`/`link`; changed `type`, `properties` or `propertiesChange`, `metadata` or `metadataChange` |
| `deleteBead` / `deleteLink` | Same name and absolute `bead`/`link`, plus `deleted` identity/context |

The envelope carries actual `previousRevision`/`revision`, Event identity, source,
observation time and known transaction association. Delta property changes use the
existing patch semantics and **`propertiesChange`**, avoiding the old Event-only
`change` synonym. A replacement stays a replacement; the producer may normalize
an authored patch to an equivalent realized patch/replacement. Neither mode echoes
CLI quoting or promises the author's original edit spelling.

For example, the emitted batch operation for:

```text
bdp update task-42 --type Task@=definition-r4 --if-revision resource-r7 --emit-operation
```

contains the authored Type pin and `expectedRevision`. Its resulting delta fact is:

```json
{
  "id":"event-8",
  "source":"https://work.example/acme/observations",
  "time":"2026-10-23T02:00:00Z",
  "origin":"write",
  "transaction":"commit-8",
  "representation":"delta",
  "previousRevision":"resource-r7",
  "revision":"resource-r8",
  "effect":{
    "operation":"updateBead",
    "bead":"https://work.example/acme/task-42",
    "type":{"uri":"https://work.example/acme/Task","revision":"definition-r4"}
  }
}
```

No fake property patch accompanies this Type-only change. `expectedRevision` is
request admission; `previousRevision` is actual fact. Create bindings/`name`, alias
spellings, credentials, idempotency keys and unresolved defaults do not appear in
`effect`. Core-only providers may retain URI-only affiliation; interpreting Types
providers report the selected exact pin. Events do not freshly resolve a default.

Postimage is the same fact with `representation:"postimage"`; `effect` keeps its
operation/target and carries `resource` instead of update instructions. It is that
published transition's complete Resource, not a later GET. Both modes use deletion
identity/context; deletion does not invent a Resource revision or retain properties.

For a declared sampled source, observed r1→r4 means its last complete observation
changed from r1 to r4; it does not claim r1 immediately preceded r4 in the backend.
Delta spans those two known records without inventing skipped r2/r3. If confirmed
absence follows r4, an observation-origin deletion reports r4's last-observed
identity/affiliation/endpoints, not an unknown backend-final version or an
authoritative delete receipt. Missing required prior context or unconfirmed
absence uses the explicit gap/refusal path. See the [native interpretation](../../specs/profiles/core/events.md#observed-predecessors-and-disappearance)
and the nonempty [observed examples](../../fixtures/retained-events/candidate.json).

## Derived owners and incident Links

A Link effect can also publish an owner-Bead transition. That transition uses
`updateBead` and, in postimage mode, the actual owner Resource. Optional delta mode
carries changed authored fields in `effect` and recorded derived state separately
as `derived.ownedLinks`. This is a complete replacement of that captured map:
`{}` means an owner with no captured Links, `null` means no longer an owner, and
omission means unchanged. It handles Type changes and nominal-bucket entry/exit
without trying to express ownership exit as a fictitious Link deletion.

A derived-only `updateBead` fact is not a legal authored update. `derived` is not
a new CLI flag, public edit field or independent command. Link and owner facts
share actual commit correlation, and consumers must not resubmit either fact as
new intent. Under [selected final batch publication](../../specs/profiles/core/publication.md),
one owner captures final Link records and gets at most one new revision. One final
Resource transition produces one fact; no intermediate member has a published
version. Net-zero and allocation-only decisions have no lifecycle facts. Ordinary
per-version provenance conflicts refuse rather than silently selecting a member.

A Bead Event source includes its lifecycle and incident Link lifecycle effects.
The Link effect remains `createLink`, `updateLink` or `deleteLink`; no second
`linked`/`unlinked` delta dialect is needed. A self-Link appears once in that
source. This projection does not mutate the endpoint Bead. The complete Link
endpoints in a delete fact keep an unlink understandable after deletion.

## Output, gaps and completion

Use Cleo's schema-2 framing and the selected `bdp_spec`, with `result_kind:events`.
Finite JSON preserves the native page in `data`; context identifies the subject
and verified kind when available. Detail/table render facts without changing the
native representation. JSONL header carries source/subject, selection, policy and
coverage; each item is one complete Event. Use exactly one header, zero or more
items and one terminal. Terminal `continuation` preserves the native `next` when
known (null at this captured range's end); terminal `context.events` preserves
the latest completely delivered page's policy/coverage, `cursor` and `next`.
The cursor remains a way to request later facts even when next is null. Follow's
header describes its initial range; it does not promise that range's captured head
is the head forever. No per-poll message kind or early success is added. These
descriptors are outside the ordinary-read six-kind framing subset.

`--follow --output-format json` is a local usage error because an endless finite
envelope cannot complete; use JSONL/detail/table. Follow drains one captured range
at a time, checking the same binding on each page. Reconnection can redeliver
previously printed facts if the caller resumes from an older completed cursor;
this is not a second mutation and not an exactly-once-consumer guarantee.

Only a completely validated and successfully emitted page can advance reported
consumer progress. Page-level cursor means after **all** its Events; an Event ID,
network receipt or partially printed page is not that cursor. On interruption or
output failure, retain the last completely delivered page's cursor. A source gap,
foreign context, expired cursor or unknown required message stops delivery with
the actual Problem/error and last good progress; never print a successful catch-up
or silently start at now. An empty static interval is successful, not a gap.

An empty poll is not completion of `--follow`. Ctrl-C returns130 with interrupted
completion/status; finite successful delivery returns0. There is no durable consumer
checkpoint service or replica acquisition/erasure guarantee in this command.

> **Cleo — Event output:** This uses your existing output format contract. A native
> page and Event controls stay intact; this is not another properties-root/mask
> convention. Provenance suppression remains deferred. No interruption request.
