---
title: "BDP reference CLI specification — design draft"
description: "Current TypeScript reference CLI behavior, proposed generic commands, and protocol dependencies."
---

# BDP reference CLI design

**Status: non-normative proposal; implementation not started.**

This document describes the proposed generic TypeScript reference client executable,
`bdp`. The protocol authority is [specs/](../../specs/README.md), including
[Core](../../specs/profiles/core/core.md) and
[Write](../../specs/profiles/write/write.md). This document defines neither a new
protocol profile nor a domain contract. Its command spellings, flags and output
forms are review proposals.

Source baseline: public `gastownhall/bdp` main
`3ab9cdf5d45a2ea49a84ab191eac77c9aeaa19d0`. The existing executable implements a
readiness demonstration, not this command catalog. This design deliberately carries
no legacy command or output compatibility obligation. The proposed executable has
no Issue, Memory, workflow or domain-specific commands or flags. Arbitrary JSON
properties remain ordinary data.

**Shared format:** follows Cleo's October17 format handoff: authority, principles,
decision states, implemented inventory, topic sections, protocol mapping, proposed
allocation and acceptance scenarios. The compared product document is uncommitted
atop `c67855b4f7c1e4fb24409eb22d142a52d19ab92f`, SHA-256
`d9af1f9b6b6c3509da3ef6f795ed64659e40225008d572a883d74221a7898dda`.
That base commit does not contain the compared document. Shared format does not
imply identical commands or shared implementation status.

## Authority and evidence

| Record | Meaning here |
| --- | --- |
| Protocol authority | `specs/` only. This implementation-adjacent document is non-normative. |
| Source baseline | Public BDP main `3ab9cdf5d45a2ea49a84ab191eac77c9aeaa19d0`. |
| Implemented | Actual executable or SDK source; not proof of every server capability. |
| Accepted direction | Explicit Donna decisions: generic reference scope/no compatibility obligation, plus settled product semantics distinguished from their pending protocol adoption. |
| Proposed | Concrete commands/options/output rules below; not yet approved or implemented. |
| Open | An unresolved choice; no permission to invent a hidden default. |
| Protocol gap | A client feature needs a missing/adopted wire form or qualified protocol seam. CLI syntax cannot substitute for it. |
| Product comparison | Cleo's local draft records accepted October17 product decisions; its subsequent edits remain her authority. |

## Design principles

| Principle | Consequence for the interface |
| --- | --- |
| Exercise the protocol directly. | Expose generic Bead/Link reads and writes, not Issue or Memory workflows. |
| Keep data arbitrary. | Preserve all admitted JSON properties and metadata; property names do not become domain flags. |
| Make selection explicit. | Identity, historical state, Type affiliation and write guard are different inputs. |
| Capabilities are server contracts. | Missing operations refuse; there is no fallback to a semantically different operation. |
| Preserve uncertainty. | Pending receipts, partial traversal and unknown delivery outcomes never look like committed complete success. |
| Prefer one reviewed path. | Begin writes with exact JSON requests; convenience syntax must map to the same contract later. |
| No legacy obligation. | Do not preserve the old readiness/lifecycle surface just to avoid changing the reference demo. |
| Keep clients comparable. | Share acceptance scenarios and the product spec's evidence format without importing its domain policy. |

## Accepted direction and open design

| ID | State | Direction |
| --- | --- | --- |
| REF-01 | Accepted assignment | Generic reference CLI only; no domain-specific commands or flags. |
| REF-02 | Accepted assignment | No legacy command/flag/output compatibility requirement. |
| REF-03 | Proposed | Symmetric `bead` and `link` command groups; explicitly compare product polymorphic reads before deciding. |
| REF-04 | Proposed | JSON request files for mutations, one authority for body members; stdin via `-`. |
| REF-05 | Proposed | Versioned finite-result JSON envelope, human text from the same result model. |
| REF-06 | Proposed | One page by default; explicit bounded all-pages traversal, no fresh-process cursor promise. |
| REF-07 | Accepted semantic boundary | Batch is atomic; no downgrade to the current non-atomic sequence API. |
| REF-08 | Wire propagation required | Accepted semantic Type changes/re-pins must have adopted protocol forms before CLI exposure. |
| REF-09 | Open | Product historical-base update contract and shared property-edit conveniences need design; no CLI-only revert/update-base primitive here. |

## Implemented command surface

| Command | Implemented scope and flags | Output / boundary | Reference CLI disposition |
| --- | --- | --- | --- |
| `bdp --help`, `bdp --version` | Recognized only as sole argument | Text; no command-specific help tree | Replace with consistent root/nested help. |
| `bdp` | Loads config and emits start/stop diagnostics | Successful lifecycle smoke, no data operation | Replace with help. |
| `bdp --config FILE` | Advertised in help but rejected without the ready command | Usage mismatch | Require a command and make usage truthful. |
| `bdp bd ready [--json]` | Domain readiness computation through generic Read | Readiness text/JSON, startup diagnostics on stderr | Outside this generic design; no preservation or compatibility wrapper required. |
| Generic resource/history/write commands | Not exposed | SDK presence is not CLI support | Proposed below, gated by protocol and server support. |

Current command source: [src/main.ts](src/main.ts). SDK and protocol evidence is
listed in [Relationship to BDP](#relationship-to-bdp). Removal/replacement is future implementation work, not performed by
this documentation change.

## Identity and command dispatch

The client should let a person or script inspect a BDP Scope, read Beads and Links,
and exercise supported mutations without writing a custom SDK program. Every
operation has a visible protocol meaning. It should be useful for reference-server
verification and interoperability, including against a future Rust client.

The client does not infer business meaning from property names, run workflows,
install Types, traverse arbitrary references, or turn a missing server operation
into a series of different operations. Server capabilities and authorization remain
authoritative. Client-side validation catches malformed input; it does not prove
that a graph satisfies constraints or that a write will succeed.

### Common grammar and conventions

```text
bdp [GLOBAL_OPTIONS] COMMAND [SUBCOMMAND] [ARGUMENTS] [OPTIONS]
```

Use singular resource nouns: `bead`, `link`, `type`, `alias`, `receipt`. Commands
and long options are lowercase kebab-case. Global options may precede or follow
the command. A singleton option may appear once; repeated or conflicting input
fails before network activity. Command-scoped options appear only after the complete
command path: `bdp --limit 5 bead list` refuses, while `bdp bead list --limit 5` is
valid. `--` after a complete command terminates option parsing; every later token is
a positional operand, including one beginning with `--`. It neither supplies a
missing subcommand nor converts unexpected extra operands into input files.
No short-option aliases or abbreviations are proposed initially.

`bdp`, `bdp --help`, and `bdp COMMAND --help` print help and exit successfully without
loading credentials, contacting a server or opening an input file. `--version`
prints the client version and does not imply server protocol compatibility.
A real operation is required for config-only invocations; usage explains this.

| Global option | Meaning | Proposed default |
| --- | --- | --- |
| `--config FILE` | Read startup JSON configuration | Existing config-file selection behavior |
| `--scope URL` | Select exactly one canonical BDP Scope | Config/environment value; no implicit federation |
| `--json` | Emit the finite-command JSON envelope in [Results, errors and repeatability](#results-errors-and-repeatability) | Human text |
| `--timeout DURATION` | One deadline for protocol work, including discovery, credential acquisition and all requested pages; cleanup has a separate bound | 30 seconds; positive duration with explicit `ms`, `s` or `m` unit |
| `--verbose` | Additional bounded diagnostics on stderr | Off |
| `--help` | Print command help | Off |
| `--version` | Print executable version | Off |

For the new `--scope` flag, precedence is CLI > environment > config file >
configured local-test default. Keep existing config names rather than adding a
second settings system. Never silently switch a production operation to a test
Scope. The current config loader has no CLI Scope override input, so this precedence
requires an explicit new loader input, counted as explicit during production-mode
validation and local-test default derivation; applying an override after the loader
rejects configuration is insufficient. Proposed normalization follows the existing
Scope config reader: append a missing trailing slash, then require the canonical
Scope grammar, refusing query/fragment and invalid authority/path forms. Retain the
independently bound credential authority before applying that override.
Credentials come from the existing protected configuration/environment
surface, not a command-line token flag. `--config` names a file; it is not a
credential value.

**Proposed credential binding:** a credential source must be bound to a separately
configured canonical Scope or explicit authority policy before applying `--scope`.
A Scope override cannot silently rebind an already loaded token. If the selected
Scope falls outside that binding, refuse before sending it or obtain a separately
configured credential explicitly authorized for the selected Scope. Do not silently
retry anonymously. The precise local config spelling remains open; this adds no
BDP authentication header or new wire field. In particular a bare environment token
plus a cross-authority override is not sufficient evidence of authorization to send
that token to the new authority.

### Reference distinctions

| Concept | Representation in this draft | Meaning |
| --- | --- | --- |
| Resource identity | `ID`, canonical URL on output | Stable Bead or Link identity |
| Historical read selection | `show ID --revision R` | Select exactly one retained Resource state |
| Floating Link endpoint | URI string inside request | Follow current endpoint state under protocol rules |
| Pinned Link endpoint | `{ "uri": "...", "revision": "..." }` inside request | Preserve the specified opaque revision; not an instruction to fetch it |
| Write guard | `expectedRevision` inside request | Admit only against the observed current revision |
| Type affiliation | Current protocol `type` field | Nominal meaning; new Type-reference forms require adoption |
| HTTP ETag | Received HTTP metadata where available | Transport validator; not interchangeable syntax for any field above |
| Batch-local binding | `@name` inside the operation document | Protocol-defined local operation binding, not a URL suffix parser |

This draft uses `--revision` for historical read selection. It does not decide the
product's compact `ID@revision` or bracketed-URI grammar. Absolute URLs remain literal;
no unescaping, suffix splitting, Type-name guessing or cross-Scope routing occurs
without explicit rules. Stored/transmitted reference shapes remain those of the
adopted protocol.

Changing Type identity or its exact Type revision is accepted product/Types design
as a semantic Resource change, even with identical properties. The exact durable
ruling is [Types §2 at `a575dc3d4f7369a3dbce5987f5a5f0fea426fef1`](https://github.com/gastownhall/bdp/blob/a575dc3d4f7369a3dbce5987f5a5f0fea426fef1/specs/profiles/types/types.md#2-definitions-identity-and-affiliation),
which permits explicit Bead/Link Type replacement and requires a new Resource
revision for an effective Type-reference change. This settled semantic direction is
not reopened by the CLI review; wire adoption and detailed guards remain separate. However the source baseline's Core
still makes Type immutable and its update schema lacks the Type-change member.
This CLI must refuse unrecognized fields until the wire contract changes. It must
not emulate retyping by creating a different identity.

The same adoption boundary applies to accepted same-ID Link re-pinning. Its selected
product direction is recorded in [Memory §4.3 at `d167da3`](https://github.com/gastownhall/bdp/blob/d167da358730dde8fbe2bb6393ef5c94c4c1717d/specs/types/memory/memory.md#43-current-versus-pinned-targets).
Current main still makes endpoints/pins immutable. Wire amendment, detailed source
ownership effects and `@current` interpretation remain pending; these are not CLI
string-substitution features or permission to undo the accepted same-ID direction.

### Read Resource IDs

**Syntax**

```text
bdp bead show ID [--revision REVISION]
bdp link show ID [--revision REVISION]
```

**Inputs:** an absolute canonical in-Scope Resource URL or a Scope-relative path
beginning with the selected kind's fixed root (`beads/` or `links/`). The CLI expands
the latter against the configured canonical Scope before SDK admission. Bare names,
leading-slash paths, wrong-kind roots, alias spellings and off-Scope Resource URLs
refuse; do not probe namespaces or silently route to another authority. Alias
resolution is an explicit separate command. This same read-ID grammar applies to
versions, incident anchors and endpoint-identity filters, with Bead roots for anchors
and endpoint filters. Type IDs instead use their protocol absolute-URL grammar;
receipts require the returned canonical in-Scope receipt URL. Revision is opaque.
**Effect:** none. **Result:** one complete selected Resource representation. Omitted
revision selects current state. An explicit revision requires History and selects
that exact retained state; no fallback to current is permitted.

A missing current resource remains a not-found result even when older revisions
exist. A retained-version refusal remains distinguishable from a missing identity.
The client does not follow Link endpoints or fetch Type definitions just to show
the record. A projection that discards arbitrary properties is not a complete read.

### Aliases

**Syntax**

```text
bdp alias resolve ALIAS
bdp alias put --request FILE --idempotency-key KEY
bdp alias delete --request FILE --idempotency-key KEY
```

**Inputs:** an admitted Alias spelling for resolution; exact protocol body for writes.
**Effect:** resolve has none; put/delete change a locator. **Result:** resolved
canonical target, Read+Update alias result, or Transactional one-entry Mutation
Receipt according to discovery. Transactional alias receipts use [Atomic batch and receipts](#atomic-batch-and-receipts)'s pending/
terminal handling without inventing a Scope position or Bead revision. The pending
Transactional adapter is required here too; the Read+Update alias parser is not a
compatible fallback. The CLI does not turn aliases into
Resources, chain aliases, generate Bead revisions for alias changes, or equate an
application's human key with a BDP Alias without an adopted mapping.

## Types and affiliations

**Syntax**

```text
bdp type list [--limit COUNT] [--all --max-pages COUNT]
bdp type show TYPE_ID
```

**Inputs:** current protocol Type ID. **Effect:** none. **Result:** advertised inventory
or descriptor. Off-Scope descriptor access requires explicit safe-fetch admission and
must not inherit the selected Scope's credentials. Initial CLI may refuse it until
that policy is exposed; it must not fetch arbitrary URLs opportunistically.

No create/update/install/manage commands for Types are proposed here. Future Type
Beads can use ordinary Resource operations only after the adopted protocol and
server support establish their representation. A Type descriptor is not silently
wrapped or unwrapped to make two protocol versions look identical.

## Properties and metadata edits

### Singleton writes

**Syntax**

```text
bdp bead create --request FILE --idempotency-key KEY
bdp bead update --request FILE --idempotency-key KEY
bdp bead delete --request FILE --idempotency-key KEY
bdp link create --request FILE --idempotency-key KEY
bdp link update --request FILE --idempotency-key KEY
bdp link delete --request FILE --idempotency-key KEY
```

**Inputs:** exactly one JSON request body matching the named operation. `FILE=-`
means stdin. The operation name is supplied by the command, not repeated in the
singleton body. The request owns target IDs, properties, metadata, revisions, guards
and any provenance members permitted by that operation's current schema. No
positional target or duplicate property/guard convenience flags are introduced in
this first draft.

**Effect:** one server-admitted atomic operation. **Result:** profile-specific:
Read+Update returns its mutation/deletion result; Transactional returns a Mutation
Receipt, including for singleton operations. Preserve secondary owner revisions
where supplied. Pending/failed/completed receipt handling is the same as [Atomic batch and receipts](#atomic-batch-and-receipts); a
successful HTTP exchange is not sufficient evidence of committed mutation.

Dispatch by the discovered profile before choosing the client adapter.
`BdpReadUpdateClient.mutate()` parses Read+Update result forms and is **not** a
Transactional adapter. Supporting these commands on a Transactional server requires
a qualified receipt-aware adapter even when only one Resource is changed. Until that
adapter is available, refuse explicitly; do not fall back to an older profile or
misparse a receipt as a singleton result.

An update is the protocol's update representation, not an implicit full replacement.
`propertiesChange` and `metadataChange` retain their JSON Patch semantics. Replacing
an entire bag is explicit in the request and discards no additional fields merely
because the client does not understand them. The server validates complete resulting
state. Generic property names are arbitrary; no `--title`, `--status`, `--body`,
workflow flags or domain-specific defaults are proposed.

An omitted `expectedRevision` has the current protocol's unconditional-write meaning.
The CLI does not invent a guard by secretly reading first. If an interactive safeguard
is wanted, it needs a separately reviewed flag, not a hidden read-modify-write race.
Idempotency key and expected revision solve different problems; neither substitutes
for the other. As a proposed CLI policy, this surface requires the caller's byte-exact key with grammar
`[A-Za-z0-9_-]{1,256}` and sends it in the `Idempotency-Key` HTTP field. It never
mints, normalizes, trims or case-folds a key. Requiring an explicit supplied flag is
this CLI's design choice; BDP does not generally forbid a client from generating a
valid key for a new operation. Refuse malformed keys locally before
submission. Singleton bodies must not carry `idempotencyKey`, `operation` or `name`;
the command and HTTP field supply those carrier roles. Batch keys likewise live in
the HTTP field only: body-level and member-level `idempotencyKey` refuse locally.
Alias writes follow the same key rule. Sequence has different key-carrier semantics
but is not exposed by this proposed CLI.

### JSON input and dispatch

Requests and selectors are UTF-8 JSON documents read from a named file or explicit
stdin. No shell evaluation, file indirection inside arbitrary property strings, JSON
coercion from `key=value`, implicit template interpolation or default metadata is
performed. One stdin consumer per invocation. Empty input, malformed JSON and wrong
request roots refuse locally.

Reject duplicate JSON member names rather than silently taking the last one. Preserve
the numeric-admission rules of the protocol; do not parse and reserialize exact
request bytes through lossy JavaScript numbers before admission. Reject input that
cannot be represented under the selected protocol instead of silently changing it.
SDK request validation and bounded input acquisition must precede mutation dispatch.
Request bytes retained for recovery remain identical to those admitted.

Local input/output budgets and server-advertised limits are distinct. Disclose the
budget causing refusal. A larger client budget does not grant server capability.
Do not turn a server diagnostic limit into a promise to return the full graph.
No file is overwritten as a side effect of reading a request.

## Updating from a retained revision

The product's latest direction is an option on update to apply a retained revision,
with `--from-revision` working syntax; no new revert/undelete verb is selected. The
current Write request has no historical-base member. History reads alone do not
provide this mutation capability. Do not implement client read/replace or delete/
recreate as equivalent recovery. A future shared contract must distinguish selected
content base, current guard, actual predecessor, resulting revision, copied fields,
current provenance and ownership effects. This CLI intentionally has no proposed
wire member for that operation yet.


## Deletion: incident edges versus dependent Beads

The generic delete commands submit the adopted operation; they do not invent cascade
or force flags. At the baseline, Bead deletion refuses live incident Links and Link
deletion reports its defined ownership effects. Selected product direction for safe
floating-Link cleanup and surviving valid pins still needs coordinated Core/Write/
History semantics. It is not satisfied by a client loop over deletions or by relabeling
non-atomic sequence as batch. Recursive deletion of dependent work is domain policy
and is outside this reference client.

Current Write already returns source and resulting sourceRevision for applicable
owned-Link effects. The missing independent source-revision guard is a separate
operation-contract alignment issue; do not request a duplicate result field or
smuggle that guard into metadata, properties or the Link's own expectedRevision.


## List, query, search and count design

**Syntax**

```text
bdp bead list [--type TYPE_ID] [--conforms-to TYPE_ID]
              [--selector-file FILE] [--limit COUNT]
              [--all --max-pages COUNT]
bdp link list [--type TYPE_ID] [--conforms-to TYPE_ID]
              [--source ID | --target ID | --endpoint ID]
              [--selector-file FILE] [--limit COUNT]
              [--all --max-pages COUNT]
```

**Inputs:** `--selector-file` contains exactly one **JSON string**, whose decoded
value is the bounded JSONPath Selector defined by current Core. For example, the
complete contents of `selector.json` can be:

```json
"$[?@.properties.anyProperty.value >= 12]"
```

Pass the decoded string to the SDK's selector member. This is not a JSON object AST,
a patch document, or an invented query model; an object/array/null/number/boolean root
refuses locally. The SDK/authority enforce the selected JSONPath subset and limits.
After JSON-string decoding, the SDK percent-encodes that string into the selector
query parameter. Apply local file-byte limits before decoding, advertised selector
byte/depth/node limits to the admitted selector, and the request-target bound to the
encoded request target. Identify which bound refused; never conflate these lengths.
Structural filters and this selector combine with logical **AND**; the CLI neither
replaces a structural filter with the expression nor normalizes identity-like string
literals inside it. Property names in this example are arbitrary user data.

`--type` is exact nominal affiliation; `--conforms-to` selects declared conformance.
Both may be supplied and combine with logical AND, as in the current protocol.
Computed conformance is not a candidate-record property; a JSONPath selector cannot
substitute for `--conforms-to`. This is not a client-side filter or a newly coined
expression language.

**Effect:** none. **Result:** one protocol page by default. `--limit` applies to the
first request; subsequent requests follow admitted `next` URLs unchanged and do not
repeat limit or filters. Server caps and response semantics remain authoritative.
Delivering the requested single page is `success`/exit 0 even if its `next` is non-null;
report that continuation and `collectionComplete: false`. This is successful page
retrieval, not a claim that the collection was exhausted. `--all` requires
an explicit finite `--max-pages` bound and follows only admitted continuation links
within this command's live session. Reaching a bound before exhaustion returns an
explicit incomplete traversal, not a complete success claim.

A Link endpoint filter identifies endpoint identity, not Link identity or selected
endpoint revision. This initial CLI admits only the server's existing filter forms.
It does not invent pinned-endpoint filtering or fetch endpoint bodies to approximate
it. Combining source/target filters beyond the first grammar is a review choice,
not a protocol prohibition.

### Incident Links

```text
bdp bead links ID [--direction in|out|both]
                   [--limit COUNT] [--all --max-pages COUNT]
```

The anchor must be a Bead identity under the explicit read-ID grammar. Direction
defaults to both, which the SDK sends explicitly; in maps to wire inbound and out
to outbound. Return current incident Links preserving stored endpoint pins. This is
not an as-of-revision graph query or a synthesized whole-graph rewind. Exact outgoing
state is available only through the selected Resource's defined representation.


## List a Resource's versions

**Syntax**

```text
bdp bead versions ID [--limit COUNT] [--all --max-pages COUNT]
bdp link versions ID [--limit COUNT] [--all --max-pages COUNT]
```

**Inputs:** the explicit read-ID grammar in Identity and command dispatch. Revision
inventories require the selected server's History capability. **Effect:** none.
**Result:** server entries in server order; no derived ancestry chain or automatic
fetch of every version body. First-request limit and continuation rules match other
paged reads; History additionally rejects a continuation that changes its bound
limit. No retained-state refusal falls forward to current state.


## Results, errors and repeatability

Finite commands emit one JSON document followed by a newline under `--json`.
The proposed envelope is a CLI contract, never a new BDP Resource or Problem.
All envelopes require `cliVersion: 1` and `outcome`. Optional common members are:

- `http`: observed `{status, headers?}`. `status` is an integer. `headers`, when
  retained, is a lowercase-name/string-value map restricted to `allow`,
  `content-type`, `retry-after`, `etag`, `last-modified`, `cache-control`, and
  admitted `location`. Omit metadata the adapter did not actually observe.
- `diagnostics`: an array of bounded `{code, message}` objects for secondary
  diagnostics such as cleanup failure. No raw argv, credentials, input bodies,
  HTML error pages or untrusted exception dumps.

The following table gives the exhaustive additional top-level members for each
outcome. Members not named for that outcome are absent; the contents of an actual
protocol value or Problem retain their protocol's extension rules.

| Outcome | Additional members | Exit |
| --- | --- | --- |
| `success` | Required `data`: complete requested Resource/value, requested page, traversal or receipt view as defined below | 0 unless secondary cleanup failure makes it1 |
| `pending` | Required `data`: actual pending receipt view | 1 |
| `failed` | Required `data`: actual failed receipt view, including its disclosed Problem if present | 1 |
| `incomplete` | Required `data`: partial collection/versions/incident traversal; required `reason: "page-bound"` | 1 |
| `problem` | Required `problem`: actual server BDP Problem; optional `partial`: acquired page/traversal/receipt data | 1 |
| `http-error` | Required common `http`; optional `submission`: `not-submitted` or `unknown` for mutation delivery; optional `partial` | 1 |
| `local-error` | Required `error: {code}`; optional `submission`: `not-submitted` or `unknown` where relevant; optional `partial` | 2 for input/config/usage categories below; otherwise1 |
| `cancelled` | Required `error: {code: "cancelled"}`; optional `submission` and `partial` as above | 130 |

No top-level `error` member is used for a server Problem or a failed receipt. A
receipt's status and disclosed failure remain server data; the CLI does not invent
its Problem or collapse a failed receipt into transport failure. Optional `partial`
never means a successfully completed traversal.

Data conventions are command-specific and explicit:

| Command result | `data` shape / completeness |
| --- | --- |
| Singleton Resource, descriptor, discovery, alias or Read+Update result | Actual protocol value without property projection or invented HTTP fields |
| Default collection/versions/incident page | `{kind: "page", page: PROTOCOL_PAGE, collectionComplete: BOOLEAN}`; boolean is true only when that page has no continuation. A complete requested page is success even if the collection continues. |
| All-pages traversal | `{kind: "traversal", pages: [PROTOCOL_PAGE, ...], collectionComplete: BOOLEAN}`; preserve every original next link. Success requires exhaustion; stopping at max-pages is incomplete/page-bound. |
| Transactional mutation or receipt read | `{kind: "receipt", receipt: PROTOCOL_RECEIPT, pages: [PROTOCOL_RECEIPT_PAGE, ...], detailRequest: "first-page" or "all", detailComplete: BOOLEAN, detailStop?: "more-pages" or "page-bound" or "expired" or "withheld" or "pending"}`. DetailComplete is true only when all disclosed terminal result/problem detail was acquired. Preserve original disposition and disclosure fields inside receipt. |

A pending receipt yields pending. A failed receipt yields failed, even when failure
detail is withheld. A completed receipt yields success even when detail is paginated,
expired or withheld: detailComplete false and detailStop explain the distinction.
First-page results with next use more-pages; all-pages acquisition reaching its bound
uses page-bound. Expired/withheld detail never becomes an invented empty result list.
This receipt-disposition rule differs deliberately from collection traversal: its
primary outcome is the transaction, and bounded detail acquisition does not reverse
known success. An actual subsequent page-read error is still reported as problem/
http-error/local-error with partial receipt data retaining the known disposition.

Local error categories are proposed CLI codes, mapped from structured adapter facts:

| `error.code` | Condition | Exit |
| --- | --- | --- |
| `usage` | Unknown command/flag, missing operand, duplicate/conflicting flag | 2 |
| `configuration` | Invalid/missing required config, invalid Scope, credential binding unavailable or mismatched | 2 |
| `input-read` | Request/selector file or stdin cannot be acquired within its local bound | 2 |
| `invalid-input` | Malformed/duplicate-key JSON, wrong root/kind, invalid selector/key/request or inadmissible number | 2 |
| `unsupported` | A known unavailable capability/adapter before dispatch | 1 |
| `transport` | Local delivery failure without a valid protocol result | 1 |
| `invalid-response` | Malformed/unexpected response or provenance of response classification cannot be established | 1 |
| `timeout` | Protocol work deadline expired | 1 |
| `internal` | Local lifecycle/programming fault, including unexpected use of a closed client | 1 |

User cancellation is the separate cancelled outcome. A server-side unsupported/input
refusal remains its actual server Problem/receipt rather than being translated to
one of these local codes. `Retry-After` is observation, not an automatic retry plan.

Current Core defines HTTP-native, bodyless `405`, `406`, and unexpected internal
`500` responses without a BDP Problem body. Represent them as http-error, preserve
the observed status and applicable admitted headers, and invent no protocol
code/family/retry fields. Receiving500 after mutation submission does not prove
rollback: report submission unknown unless independent protocol evidence establishes
a disposition. Example:

```json
{
  "cliVersion": 1,
  "outcome": "http-error",
  "http": { "status": 500 },
  "submission": "unknown"
}
```

**Required SDK/adapter correction:** the legacy Read Fetch transport can manufacture
BDP-shaped Problems for local discovery/network/timeout failures and loses some
HTTP-native distinctions. The CLI cannot label every such return server-authored.
Preserve origin and observed HTTP context at the transport/adapter boundary before
claiming this output contract; never infer origin through message text, code matching
or guesses. This is an implementation dependency, not a new wire error family.

Cleanup failure never overwrites a known primary result. Add a bounded diagnostic;
if the primary outcome was success, retain success data and return exit 1. Primary
failure/cancellation retains its own exit. Thus exit 0 implies requested success and
successful required cleanup; a nonzero exit is not by itself a rollback claim.

Human output uses the same result model and shows canonical identities, revisions
and pins without abbreviation in this first design. Machine output always preserves
complete identities and exact tokens. Arbitrary values/control characters render
safely. Diagnostics go to stderr; normal success has no lifecycle/startup noise.
JSON contains no color or progress lines. Verbose mode does not weaken redaction.
No compatibility wrapper around old readiness output is required.

### Paging, cancellation, authentication and recovery

Continuation links are server navigation, not query reconstruction. They remain
unchanged and are admitted by the SDK's traversal context. Filters cannot be changed
mid-traversal. The initial CLI has no fresh-process `--cursor` feature: existing SDK
continuations are session capabilities, so copying a URL is not enough to promise
safe replay across invocations.

SIGINT cancels in-flight work and stops further page acquisition. `--timeout` is one
monotonic deadline for protocol work across discovery, authentication, operations and
all pages; it is not reset per request. Cleanup has a separate proposed maximum of
one second after work stops. This means wall-clock exit can exceed the work deadline
by that cleanup bound. The CLI/SDK adapter must propagate the remaining work budget
into every call and cap transport response deadlines at that remainder; current
independent per-response/per-call defaults must not reset or unexpectedly shorten
that configured command budget. An implementation unable to control a client's
separate close/settlement budget cannot claim this contract until adapted.

Timeout and cancellation after mutation submission can leave outcome unknown; neither
means rollback. Preserve partial traversal data with timeout/cancellation evidence;
it is never a complete traversal. Timeout is exit 1; user SIGINT is exit 130.

Credentials are scoped to the configured authority and are never forwarded to an
external Type descriptor, endpoint or arbitrary redirect. Respect SDK navigation and
redirect admission; do not auto-follow locations using an authenticated generic
Fetch. The legacy `BdpClient`/`createFetchTransport` path used for Read-profile/History work
lacks credential plumbing even though config accepts a token. By contrast,
`BdpReadUpdateClient.read()` with `createReadUpdateFetchTransport` already provides
an authenticated generic Read seam for Read+Update Scopes. Dispatch to the appropriate
qualified adapter rather than claim all SDK Read is anonymous. No command may silently
drop configured credentials: refuse explicitly until its chosen profile/History
adapter can apply them with the bound authority. Early anonymous Read exposure is
allowed only when no credential is configured/requested. This is not solved by
documenting `BDP_AUTH_TOKEN`. The binding in [Common grammar and conventions](#common-grammar-and-conventions) applies before
transport construction: rebuilding a transport for `--scope` must not make an old
credential valid for a new authority. Matching the request to the newly selected
Scope is necessary but not sufficient credential admission.

No hidden mutation retry is proposed. Recovery reuses the same operation and key
where the protocol supports it; never generate a new key after ambiguous delivery.
`Retry-After` is context, not permission to replay arbitrary state changes. Preserve
receipt/key-conflict distinctions and do not bypass capability checks by choosing an
older endpoint. Reads may be retried explicitly by the caller; automatic retry policy
can be designed later without changing write safety.

### Atomic batch and receipts

**Syntax**

```text
bdp batch --request FILE --idempotency-key KEY
bdp receipt show URI [--all --max-pages COUNT]
```

**Inputs:** exact atomic-batch request and its key, or a canonical in-Scope receipt
URI returned by the server. Local operation labels remain protocol syntax inside
that request. **Effect:** batch asks for one transaction; receipt show is read-only.
**Result:** receipt, server Problem, or HTTP-native result exactly as admitted by
the transactional contract. Singleton and alias mutations on this profile use the
same receipt-disposition rules; receipts are not limited to the `batch` command.

A pending receipt is a known nonterminal disposition, not a successful committed
transaction. Default `receipt show` reads the receipt's first representation only;
it reports any `next` and whether all disclosed result entries have been collected.
A completed receipt remains successful (exit 0), including when details are paginated,
expired or withheld. Disclosure and detail acquisition are separate from transaction
disposition and must be displayed explicitly. `--all --max-pages N` additionally
follows immutable receipt-result pages within that bound; it does not poll pending
status or resubmit the transaction. No `--limit` is invented for receipt pages.

Keep three dimensions explicit: receipt disposition (`pending/completed/failed`),
server detail disclosure (`available/expired/withheld`, when supplied), and whether
all disclosed result pages were collected. A completed receipt with expired or
withheld detail proves disposition, not complete result availability; retain
success/exit 0 and disclose incomplete/unavailable detail explicitly, never invent an
empty result set or a failed transaction. A failed receipt remains `failed` even if its detail is
withheld. A pending receipt lacks terminal detail and remains `pending`/exit 1. Detail
expiry while paging preserves acquired data and the actual `410 cursor-expired`
Problem for the failed page read, alongside the receipt's already-known committed
disposition. It does not change the transaction to failed or authorize resubmission.
Reaching a receipt-detail page bound retains the completed transaction's success
and explicitly marks the detail acquisition as bounded/partial. The output model below
separates partial data from the primary error.

A later explicit wait mode may compose bounded receipt reads without resubmitting a
batch. Pending and incomplete exit conventions are CLI proposals for review, not
new protocol receipt statuses. Normal mutation commands return only the inline
receipt response; use receipt show with all-pages options to acquire remaining
result pages explicitly. No initial batch flag pretends to change receipt page size.

Lack of batch support refuses before submission. Unsupported member behavior follows
the adopted protocol, including retained-key precedence; the CLI must not preflight
in a way that changes recovery semantics. The pending batch-subset proposal does
not authorize new discovery fields or a fabricated `operation-not-supported` wire
code in this implementation.

## Relationship to BDP

| Area | Current source evidence | Proposed work / unresolved dependency |
| --- | --- | --- |
| Executable | [src/main.ts](src/main.ts), [package.json](package.json) | Replace domain demonstration/lifecycle smoke with reviewed generic surface; no compatibility obligation |
| Read and History | [client index](../../packages/client/src/index.ts), [Read session](../../packages/client/src/read-session.ts), [History session](../../packages/client/src/history-session.ts) | Generic CLI exposure, exact paging and safe output; server support remains separate |
| Write delivery | [Read+Update client](../../packages/client/src/read-update.ts), [transport](../../packages/client/src/read-update-transport.ts) | Profile-aware dispatch: Read+Update singleton forms exist; Transactional singleton/alias/batch receipt adapter remains required. Preserve HTTP-native and unknown-submission outcomes. |
| Config | [config source](../../packages/config/src/index.ts) | Scope override, separately bound credentials, unified usage/error boundary |
| Error origin | [Read transport](../../packages/client/src/index.ts) | Structured local/server/HTTP-native origin correction needed before promising the output contract; no message-text inference |
| Atomic batch | [Write spec](../../specs/profiles/write/write.md), [batch fixtures](../../fixtures/transactional/batch.json) | Qualified client adapter and server integration; Vickie's work continues independently |
| Type mutability/pins | [Types design](../../specs/profiles/types/types.md) versus current Core/Write | Accepted design direction awaiting wire propagation; no invented CLI-only semantics |
| Server qualification | [STATUS.md](../../STATUS.md) and exact candidate receipts | Client commands must not advertise server completion from SDK presence |

Suggested implementation sequence after review: (1) generic grammar/output/help and
Read/discovery with truthful error-origin handling; (2) History and authority-bound
authenticated Read; (3) qualified Read+Update singleton writes;
(4) the Transactional adapter for singleton/alias receipts and atomic batch/receipts. Every slice names its exact protocol baseline and
runs the relevant fixture-backed acceptance cases. No source change or engine work
is authorized by this document's existence.

### Command-to-protocol mapping

| Command | BDP operation/read target | Required capability/profile | Evidence head | Unimplemented boundary |
| --- | --- | --- | --- | --- |
| discover | Scope probe/discovery and applicable operation directory | Read or cumulative profile | `3ab9cdf5` | Generic CLI output/discovery adapter |
| bead/link show | Canonical Resource GET; exact History revision read when selected | Read; History for exact selection | `3ab9cdf5` | CLI ID expansion and complete result rendering |
| bead/link list; bead links | Discovered collection or incident target with admitted filters | Read and advertised selection | `3ab9cdf5` | Selector file parsing and bounded traversal |
| bead/link versions | History versions navigation | History | `3ab9cdf5` | CLI exposure, not server qualification |
| type list/show | Type inventory/descriptor target | Current Read descriptor model | `3ab9cdf5` | Safe off-Scope policy; no Type-Bead adoption |
| bead/link create/update/delete | Named operation directory target | Read+Update result or Transactional receipt form | `3ab9cdf5` | Profile-selected CLI adapters; no new Type/re-pin fields |
| alias resolve/put/delete | Advertised alias resolution or alias operation | Read alias support / appropriate Write profile | `3ab9cdf5` | Profile-specific response and guarded credential handling |
| batch | Atomic batch operation | Transactional | `3ab9cdf5` | Qualified transactional client adapter |
| receipt show | Server-returned receipt and admitted result pages | Transactional | `3ab9cdf5` | Receipt/page adapter with disclosure and disposition separated |

Each `3ab9cdf5` entry means `3ab9cdf5d45a2ea49a84ab191eac77c9aeaa19d0` contract/source
inspection, not executed CLI/server qualification.


### Discovery

**Syntax**

```text
bdp discover
```

**Inputs:** selected Scope only. **Effect:** none. **Result:** actual discovery plus
an operation directory when the advertised profile provides one, with the origin
of each item clear. Unsupported and absent fields stay absent; the CLI does not
invent supported operations from knowledge of its own commands.

Human output distinguishes server advertisement from independently verified
conformance. JSON preserves the discovery values. This command is not a network
scan, registration, permission grant or Type installation operation.

### Product CLI comparison

This table compares direction rather than claiming parity. Cleo's local draft is
`docs/reference/graph-cli-specification-draft.md` in her Preview3 CLI spec worktree,
at SHA-256 `d9af1f9b6b6c3509da3ef6f795ed64659e40225008d572a883d74221a7898dda`,
uncommitted atop `c67855b4f7c1e4fb24409eb22d142a52d19ab92f`. Cleo's explicit
format handoff was received. Product implementation evidence remains distinct from
this BDP client's baseline and that base commit does not contain the compared draft.

| Topic | Product direction observed | Reference proposal | Decision / dependency |
| --- | --- | --- | --- |
| Reads by identity | Accepted root `show/history/compare/versions` may read Beads or Links; explicit Link paths disambiguate | Symmetric `bead show/versions` and `link show/versions` | Deliberate proposed difference; consider product-style root read aliases only for clarity, never legacy necessity. No compare operation promised here yet. |
| Mutations | Root `update/delete` Bead-only; Link mutations under `link` | Explicit `bead` and `link` groups for all writes | Same kind separation; naming needs review. |
| Properties/metadata | Coherent set/unset/patch under discussion; flags not settled | Exact request files preserve current patch semantics | Shared semantics matter; do not present product convenience grammar as accepted. |
| Historical-base edits | Working `update --from-revision` direction; no new revert/undelete verb | No historical-base mutation until corresponding protocol contract exists | Keep historical read selection and current write guard separate. |
| List/query/search | Query-first design and complete-Resource export alignment are the latest direction; existing list stays unchanged; exact query grammar remains open | Existing bounded protocol selectors and filters only | Do not present a broad product list rewrite or rich query capability as accepted/implemented. |
| Compact reference syntax | Product CLI revision-aware spelling is its own authoring/display surface | `--revision` for exact reads; structured wire Reference in writes | Compare later; avoid accidental URL suffix/label ambiguity. |
| Type catalog | Product vocabulary and replacement of preview/internal placeholders | Whatever Type identity/descriptors the server actually advertises | No hardcoded Issue/Memory vocabulary or capability assumptions. |
| Domains and compatibility | Preserve supported product workflows deliberately | Generic only; no old reference-command compatibility duty | An intentional scope difference. |
| Evidence | Implemented / accepted / proposed / open, with exact source and qualification distinctions | Reuses the handoff section sequence and table columns; adds protocol-gap classification | Format is aligned; command syntax and protocol adoption still require review. |

## Proposed command contract for the next milestone

Every row is proposed CLI surface. “SDK available” means source exists, not that
the CLI or every server supports the capability.

| Command | Intent | Required protocol support | Implementation boundary |
| --- | --- | --- | --- |
| `discover` | Inspect the selected Scope and available operations | Read discovery | SDK available; CLI absent |
| `bead show` / `link show` | Read current or exact retained state | Read; History for revision selection | SDK available; CLI absent |
| `bead list` / `link list` | Select one bounded collection or explicitly traverse its pages | Read, with advertised selector features | SDK available; CLI absent |
| `bead versions` / `link versions` | Inspect a retained-version inventory | History | SDK available; server qualification separate |
| `bead links` | Inspect current incident Links | Read incident-Link route | SDK available; CLI absent |
| `type list` / `type show` | Inspect advertised Type descriptors | Current Read Type inventory/descriptor surface | SDK available; does not adopt proposed Type-Bead representation |
| `bead create/update/delete` | Perform one explicit Bead operation | Discovered Read+Update or Transactional form | Read+Update SDK available; Transactional receipt adapter pending; CLI absent |
| `link create/update/delete` | Perform one explicit Link operation | Discovered Read+Update or Transactional form | Read+Update SDK available; Transactional receipt adapter pending; CLI absent |
| `alias resolve/put/delete` | Resolve or manage a locator | Alias discovery; profile-specific Write form for changes | Read+Update SDK available; Transactional receipt adapter pending; CLI absent |
| `batch` | Submit one atomic transaction | Transactional batch | Protocol defined; qualified generic client seam still needed |
| `receipt show` | Read a submitted transaction's disposition | Transactional receipt surface | Protocol defined; qualified client seam still needed |

No non-atomic `sequence` command is proposed. The current Write contract defines
that capability separately; omitting it from a client is not removing it from the
protocol. `batch` must never fall back to `sequence` or individual writes.

Events, streaming/watch, snapshots, set mutations outside batch, import/export and
custom query-language commands need separate command cards after their protocol,
client and server boundaries are reviewed. They are not hidden promises in this
catalog. In particular this document does not settle the product's `bd query` work.

### Work allocation

| Work | Allocation |
| --- | --- |
| Generic parser/help/Read/discovery with truthful error origin | First independent reference-client slice after design approval |
| Exact History and credential-bound reads | Client adapters plus capability-specific fixture evidence; never anonymous credential dropping |
| Read+Update singleton/alias writes | Separate qualified delivery slice using existing wire shapes |
| Transactional singletons/aliases, atomic batch and receipt detail | Receipt-aware adapter before command exposure; Vickie's server lane stays separate |
| Type/re-pin/source-guard/historical-base amendments | Shared protocol owners; no CLI-only implementation |
| Rust client | Separate startup decision; reference scenarios may inform it but this draft starts no Rust work |


### Decisions for review

| Question | Why it matters |
| --- | --- |
| Adopt symmetric resource groups or product-style polymorphic root reads? | Shared format does not require identical command names; wrong-kind behavior must remain explicit. |
| Begin with request-file writes or add generic property/guard conveniences now? | Multiple input sources need precedence/conflict rules and exact mapping to existing patches. |
| Accept this versioned result envelope and exit partition? | Scripts must distinguish transaction disposition, disclosed detail, transport failure and local input errors. |
| Keep first-page default and explicit bounded all-pages acquisition? | Avoid unbounded work and unsupported fresh-process continuation claims. |
| Which client slices should be exposed first? | Independent Read work can proceed without pretending later protocol amendments are implemented. |


### Examples

These examples illustrate proposed commands and current wire forms. They are not
claims that the executable supports them today.

```sh
bdp --scope https://work.example/team/ discover --json
bdp bead show https://work.example/team/beads/a --revision 'opaque-r1' --json
bdp link list --source https://work.example/team/beads/a --limit 20 --json
bdp bead list --selector-file selector.json --all --max-pages 5 --json
bdp bead create --request create.json --idempotency-key create-a-1 --json
bdp bead update --request update.json --idempotency-key update-a-2 --json
bdp batch --request transaction.json --idempotency-key transaction-3 --json
```

A generic create request, with no domain-specific CLI interpretation:

```json
{
  "type": "https://types.example/record",
  "properties": { "anyProperty": { "unit": "mm", "value": 12 } },
  "metadata": {}
}
```

A guarded generic update request:

```json
{
  "bead": "beads/a",
  "expectedRevision": "opaque-r1",
  "propertiesChange": [
    { "op": "replace", "path": "/anyProperty/value", "value": 13 }
  ]
}
```

The existence and admission of these illustrative Type/Resource IDs are fixture
preconditions; the client does not create a Type or infer an endpoint from them.
Provenance members are omitted here rather than fabricating an actor or timestamp.
Server requirements may require additional permitted context.

## Acceptance scenarios

These are future process-level tests using controlled HTTP fixtures. None was run
for this documentation draft.

| ID | Scenario and obligation |
| --- | --- |
| R01 | **Root and nested help:** Exit0, no config/credential/file/network access |
| R02 | **Duplicate or conflicting flags:** Local usage/exit2 before network; no raw argument echo |
| R03 | **Malformed/duplicate-key JSON or inadmissible number:** Local invalid-input/exit2; not submitted or silently normalized |
| R04 | **Credentials on allowed request and external redirect:** Sent only within allowed Scope; no leak or anonymous fallback |
| R05 | **Configured Scope A/token A with `--scope` at authority B:** Refuse before credential-bearing I/O to B unless independently configured B credentials exist; transport rebinding alone grants nothing |
| R06 | **JSON-string selector plus structural filters:** Decoded bounded JSONPath string reaches SDK; filters combine with AND; object AST refuses before I/O |
| R07 | **Read-only discovery followed by write:** Explicit unsupported result; no guessed URL or emulation |
| R08 | **Exact historical read unavailable:** Preserve History refusal; no current fallback |
| R09 | **Link with pinned endpoints:** Exact stored pins round-trip; no recursive fetch |
| R10 | **Exact Type versus conformance filter:** Distinct admitted requests, no closed-union client approximation |
| R11 | **Complete show with unknown properties:** All JSON values retained; no domain projection |
| R12 | **Guard mismatch:** Preserve protocol conflict; no read/retry to overwrite a new revision |
| R13 | **Type-change/re-pin member on old wire:** Refuse unsupported request; no delete/recreate workaround |
| R14 | **One-page and bounded multi-page reads:** First page success/exit 0 even with next; explicit collectionComplete false; all-pages max bound gives incomplete/exit 1; limit only on initial request |
| R15 | **Cancellation during paging:** No further requests; no false exhaustion/complete claim |
| R16 | **Timeout after mutation submission:** Unknown outcome preserved; no new key or automatic replay |
| R17 | **Pending batch receipt:** Pending/exit 1 rather than committed; receipt URI retained; no hidden polling |
| R18 | **Completed receipt first page versus explicit all:** Both retain successful disposition/exit 0; next and detailComplete disclose pagination; bounded detail acquisition sets detailStop page-bound without relabeling the transaction failed |
| R19 | **Completed receipt with expired/withheld detail:** Preserve success/exit 0 with detailComplete false and explicit disclosure; never fabricate empty results or rerun mutation |
| R20 | **Receipt detail expires during paging:** Actual cursor-expired server Problem/exit 1 plus partial acquired receipt data; no resubmission |
| R21 | **Transactional singleton and alias mutations:** Profile selects receipt-aware adapter; pending/terminal outcomes match batch treatment; no Read+Update result-parser fallback |
| R22 | **HTTP-native bodyless 405/406/500:** Preserve actual status; no fabricated BDP Problem; submitted-write 500 retains unknown outcome |
| R23 | **Local Read network failure versus server Problem:** Structured origin remains distinct even when the old SDK used identical Problem shapes; no text/code heuristics |
| R24 | **Unsupported batch member:** Adopted protocol semantics; no downgrade or per-member write fallback |
| R25 | **Server Problem plus cleanup failure:** Preserve primary Problem and single JSON document; bounded secondary diagnostic |
| R26 | **Successful mutation plus cleanup failure:** Preserve known commit evidence; report cleanup failure without claiming rollback |
| R27 | **Alias edit:** Locator result, no fabricated Resource revision |
| R28 | **Safe rendering:** Control characters escaped in human output; JSON remains machine-readable |
| R29 | **Option placement and read ID grammar:** Pre-command scoped flag, bare read name, alias-as-resource and wrong-kind path give usage/invalid-input exit2; valid rooted path expands once |
| R30 | **Scope override loader:** CLI Scope counts as explicit before production validation; missing trailing slash follows documented normalization; credential binding remains independent |
| R31 | **Work timeout across pages:** Shared deadline is not reset per page; separate bounded cleanup may extend wall time only within its declared maximum |
| R32 | **Credential-bearing Read on unsupported adapter:** Explicit refusal, never anonymous fallback; Read+Update read adapter applies the bound credential |
| R33 | **JSON envelope union:** Only permitted top-level fields for outcome; exact server data/extensions retained; local/HTTP/receipt failures remain distinct |
