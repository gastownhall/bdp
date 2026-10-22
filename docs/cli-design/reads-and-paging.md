# Canonical CLI: point and collection reads

Paired #280 candidate, following [Scope/references](scope-and-references.md),
[affiliations](affiliations-and-owned-state.md) and [read delivery](../../specs/profiles/core/read-delivery.md).
[Output and masking](read-output.md) reuse Cleo schema 2. This is paper source,
not shipped client/provider support or a new History/Type/Events capability.

## One point or one population

```sh
bdp show task-42
bdp show https://work.example/acme/task-42 --properties-only
bdp list --type Issue --exact-type Task
bdp link list --endpoint 'json:"urn:example:external"'
bdp link list --incident-to task-42 --direction out --type Relates
```

Default Scope applies once; absolute operands retain their own verified binding.
Root show is generic; `link show` asserts Link, independently of path spelling.
Root list selects Beads and link list selects Links. No implicit Issue/status/
Type filter, mixed-population query, traversal, endpoint-body fetch or domain view.

| CLI selection | Native request meaning |
| --- | --- |
| `show ID` | GET the Resource record |
| `show ID --properties-only` | Actual `view=properties`, not a display mask |
| `show BEAD --include-links` | Optional `include=links`; one embedded Link page |
| `--links-limit N` / `--direction in|out|both` on that aggregate | Native `limit=N` / `direction=inbound|outbound|both` |
| `list --exact-type T` | Structural `type=<absolute nominal Type URI>` |
| `list --type T` | `conformsTo=<absolute Type URI>` under recorded exact Types authority |
| Link `--source`, `--target`, `--endpoint` | Same-named structural URI predicates |
| Link `--incident-to BEAD` | That Bead's `view=links` population, with Link predicates |
| `--selector JSONPATH` | Existing bounded raw Selector, unchanged |

Exact and family predicates MAY combine and mean AND, as the wire already permits.
This deliberately replaces C1's earlier author-only mutual exclusion: an exact
nominal Type can have definition pins with different recorded family membership.
Other predicates also combine with AND; endpoint itself compares source OR target.
Family unavailable means refusal, not exact-only fallback or local scanning.

Bare filter `--type any` omits that predicate; `--exact-type any` refuses. This is
only a CLI spelling, not a forbidden Scope name or protocol Type identity. An
absolute URI ending `/any` is an explicit identity. Filter operands are unpinned;
exact Type means nominal identity, never a definition revision. Raw JSONPath sees
the Reference union without rewriting strings or dereferencing. Properties named
`type`, `source` or `metadata` remain ordinary data in their own object.

`--incident-to` requires an unpinned in-Scope Bead; no incident view is invented for an
opaque external endpoint. Use `--endpoint` for external URI matching in the Link
inventory. Both may combine, along with Type/source/target/Selector predicates.
Direction is admitted only for incident population or show's optional aggregate;
default is both, and self-links appear once. Properties-only conflicts with aggregate;
show does not accept collection filters. `--links-limit` requires aggregate and is
positive; absent it, the provider chooses its bounded embedded-page default.

## Existing exact reads and HTTP controls

`ID@REV` and `--revision REV` both express existing exact application History reads;
supplying both is an error even if equal. Wire query is `revision`, not a guard or
HTTP validator. Preserve opaque token/form-query encoding, including literal plus
as `%2B`. No current/nearest fallback. Unwrapped HTTP URLs containing raw `@` stay
literal under shared Reference rules; use bracketed URL suffix or explicit option.
The existing C1 current-read suffix conveniences stay distinct from literal flag tokens.

Actual advertised application History remains required for ordinary application
exact reads. Its existing full-record-only query forbids properties-only/aggregate/
collection/pagination combinations. HEAD is allowed. Narrow exact-definition reads
without general History remain Trish's separate transport seam: do not infer no
support from missing application History, guess a `types/` path, inline definitions
or silently apply an unadopted capability. `versions`, `type list` and Events retain
their own descriptors/contracts; this slice adopts none of their pagination/coverage.

Finite reads can send `--head`, `--if-match`, `--if-none-match`,
`--if-modified-since`, `--if-unmodified-since` where the selected request admits them.
These are actual HTTP controls, never `expectedRevision`; no quoting a Resource
revision into a manufactured ETag. Properties and aggregate use their actual native
validators. Authentication, cursor/query checks and applicable erasure checks precede
not-modified decisions. GET 304 is successful/bodyless, not an empty result; 406/412
are bodyless HTTP failures, never fabricated BDP Problems.

HEAD/conditional reads select one native representation. They suppress JSONL's
automatic unpaged default; explicit `--unpaged` refuses. `--page-size` can choose a
collection page, including a continued page. HEAD has no item-delivery budget, so
explicit total `--limit` refuses. A HEAD continuation inspects that page without
advancing a delivery checkpoint. Bodyless/metadata framing is explicit in the output
contract; it does not synthesize a Resource.

## Bounded paging and exact continuation

Reuse `--paged`, `--unpaged`, `--page-size N`, `--limit N`, `--continue VALUE`.
Page size is positive; total limit is nonnegative and zero means no total cap.
Reject conflicting modes/invalid numbers before dispatch. Human/finite JSON defaults
to one requested page of 50; JSONL defaults unpaged. A known smaller advertised
maximum bounds the default, while an explicit excessive size is not silently clamped.
Provider bounds/refusals remain authoritative. Redirection does not change format.

Wire `limit` is a per-fetch upper bound, not the CLI total. For each fetch request
at most the smaller of page size and remaining total budget. A short/empty page
with nonnull next is not exhaustion. For a valid next page, only `limit` may be
replaced/appended under the new ordinary-read contract; preserve the opaque cursor
and every other issued URL component/context. Do not decode state, reconstruct
filters or sign a private cursor. No local tail cache/new cursor is required.

`--continue` takes the complete native `next` URL (or JSONL terminal continuation),
not a guessed cursor token. Establish owning Scope/authority from retained binding
or verified service-desc, never path stripping or an unrelated ambient default.
An explicit Scope can verify that binding, not change it. No initial semantic
filters, incident operand/direction or positional Scope may reselect the cursor;
rendering/masks, per-fetch size and total delivery cap may change. Validate actual
`BDP-Collection-Kind` against the command, including empty pages; subject kind and
item kind remain distinct for incident views. Preserve credentials/authorization
boundaries; a continuation is not an authorization grant.

Stop priority is authoritative exhaustion, then a reached total cap, then requested
one-page delivery. Successful collection output preserves a native `next` exactly
at the emitted boundary; null only for observed exhaustion. If a provider overshoots
the requested limit, refuse the offending page before emitting it. Never trim a
fetched tail and return a token after undisplayed items. Expired/foreign context is
an explicit failure, not restart on a new snapshot. History/Events cursors are not
quietly given this ordinary page-size rule.

For a handled stream failure after full pages, report the last exact delivered
boundary. If interrupted within an acquired page, report delivered rows but omit
continuation when no native boundary exists there; do not claim null/exhaustion or
skip its remaining rows. A missing terminal is incomplete. Private caches cannot
become invented native continuations or new authorization grants.

> **Cleo — Read and delivery:** Keep your paging defaults, original-value masks,
> schema 2 framing, exact emitted counts and explicit incompleteness. The new
> endpoint flag/AND combination close wire coverage gaps; the collection-kind
> header makes empty/continued populations explicit. No interruption request.
