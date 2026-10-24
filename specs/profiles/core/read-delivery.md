# Selected v0.1 ordinary read delivery

This candidate amends [Core reads](core.md#collection-retrieval-and-selection)
under the [selected v0.1 binding](contract-binding.md). Its companion
[CLI design](../../../docs/cli-design/reads-and-paging.md) translates these
HTTP/query rules without adding a wire envelope. Inherited v0 contracts and
schema bytes are held. This is staged source, not an implementation claim.

## One Resource or one selected population

Canonical point reads, actual `view=properties` and optional Bead
`include=links` retain their distinct native representations. A display mask
is not a native view. A Bead aggregate embeds only one bounded incident Link
page; its `limit` and `direction` do not imply automatic traversal or filters
on every embedded Resource. Current record/aggregate validators retain their
actual native meaning.

Ordinary Bead and Link inventories return full records in the existing stable
snapshot order. Structural `type` and `conformsTo` MAY combine and mean AND:
nominal identity and recorded exact family membership are separate predicates.
Type operands MUST be unpinned absolute identities. Missing family authority
MUST refuse, never silently switch to nominal equality. Raw Selectors see the
actual Type Reference union; they do not dereference or flatten it.

`GET BEAD?view=links` also admits Link predicates `type`, `conformsTo`,
`source`, `target`, `endpoint` and `selector`, plus `direction`, `limit` and
`cursor`. URI incidence and direction select the population, then predicates
combine with AND before pagination. `endpoint` itself compares source OR
target; a self-Link is returned once. Unsupported/repeated parameters keep
the existing `invalid-parameter` refusal. Only an in-Scope Bead has this view;
external endpoint matching uses `endpoint` on the Link inventory. This does
not add selection parameters to `include=links`.

## Declare collection kind and owning Scope

A successful top-level Bead/Link Resource collection response MUST carry:

- `BDP-Collection-Kind: bead` or `BDP-Collection-Kind: link`, identifying its
  actual items, even when the page is empty;
- a `Link` with `rel="service-desc"` naming the owning Scope's machine
  discovery document under the existing discovery-link rules.

`BDP-Collection-Kind` has exactly one lowercase token, not a list.
These fields are required on every continuation response and corresponding
successful HEAD/304. An incident Link view declares collection kind `link`
while existing `BDP-Resource-Kind: bead` still identifies its Bead point
subject. An ordinary inventory need not invent a point subject. A properties
view retains only its point-kind requirement even if ordinary property data
contains `items` or `next`. An aggregate does not acquire a collection-kind
header for its nested page. Type summaries are not Bead/Link Resource
collections; this amendment assigns them no invented Resource kind.

Clients MUST validate the actual kind against any command/operation assertion
before emitting a successful representation. Path spelling, first-item shape,
properties named `type`/`source`, or an empty page MUST NOT substitute for the
kind declaration. Cross-origin services MUST expose `BDP-Collection-Kind` in
addition to existing applicable fields.

An absolute continuation's binding is established by retained verified context
or its verified owning `service-desc`, not by stripping path components or
assuming that an ambient default Scope owns it. The binding retains selected
contract, authority and authorization context; the URL itself is not an
access grant. Discovery/following redirects MUST NOT forward credentials to
another origin without independent authorization. A caller asserting an
explicit Scope may verify the binding, never reselect it.

## Resize pages without changing the snapshot

For ordinary Bead/Link inventories and incident Link views, native `limit`
is a positive per-page upper bound. It is independent of a consumer's total
delivery cap. A provider MUST NOT return more items than requested; it MAY
return fewer, including an empty page with a nonnull continuation. Such a page
is not exhaustion. Continuations MUST make progress through the fixed result
or refuse under the existing bounds/cursor rules; a client need not loop
forever through the same non-progressing state.

A client MAY replace or append **only `limit`** on an issued native `next`
URL. It MUST preserve the cursor value and every other issued query component,
path and context; it MUST NOT derive cursor internals, reconstruct the
selection, change direction/filters/order, or select a newer snapshot.
Parsing URI syntax to replace that single query member is allowed; rewriting
unrelated query encoding/order or re-signing a private URL is not required or
permitted by this rule. Issuers, including URL-signing schemes, MUST support
this advertised-contract resizing without invalidating the continuation's
snapshot or authorization fence. Duplicate/invalid limit still refuses.

This lets a client request `min(pageSize, remainingTotal)` for each fetch and
stop at a native boundary without dropping an overfetched tail. The response's
issued `next` is the lossless continuation at that page's end; `null` means
authoritative end. A total cap cannot justify returning a token after rows
the consumer did not deliver. A short page with a next URL cannot justify
inventing `null`. The first observed end wins over a coincident cap/page stop.

If a stream fails inside an acquired page and the exact emitted boundary has
no native continuation, the adapter MUST omit continuation rather than skip
undelivered rows or claim exhaustion. A native continuation after a fully
emitted page MAY be retained. A private tail cache is not a newly assigned
BDP cursor or authorization grant. Expiry/foreign-view failures MUST remain
explicit; no silent restart on newer state.

These resizing/delivery rules do not adopt History, Event or Type-inventory
cursor semantics. Snapshot pagination does not establish a general historical
read, replay/replica bootstrap, freshness guarantee or future availability of
every captured revision.

## Exact reads and HTTP controls stay distinct

The existing advertised application History capability selects a complete
record with `GET`/`HEAD RESOURCE?revision=TOKEN`. Query decoding is the existing
form-query convention, once; literal plus is `%2B`. No other query member may
combine with `revision`. Actual properties/aggregate/collection queries do
not become exact reads by fetching a full record and extracting it. Unsupported
History remains an explicit refusal; no current/nearest revision fallback.
Narrow exact Type-definition transport remains separately owned; this source
does not invent that transport or require general application History for it.

HTTP preconditions and HEAD describe one native representation. They do not
apply once to an arbitrarily assembled/masked multi-page output. Authentication,
query/cursor and applicable History erasure/expiry checks precede 304. GET 304
is successful and bodyless, not an empty Resource collection. HEAD follows the
corresponding GET decision with no body. Bodyless 406/412 retain actual HTTP
meaning without a fabricated BDP Problem. Resource revision guards remain
mutation input, and clients MUST NOT manufacture entity tags from revision
tokens. A client output envelope is not an HTTP response representation.
