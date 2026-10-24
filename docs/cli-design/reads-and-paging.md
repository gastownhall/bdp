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
| Link `--from`, `--to`, `--endpoint` | Structural `source`, `target`, `endpoint` URI predicates |
| Link `--incident-to BEAD` | That Bead's `view=links` population, with Link predicates |
| `--selector JSONPATH` | Existing bounded raw Selector, unchanged |

Exact and family predicates MAY combine and mean AND, as the wire already permits.
This deliberately replaces C1's earlier author-only mutual exclusion: an exact
nominal Type can have definition pins with different recorded family membership.
Other predicates also combine with AND; endpoint itself compares source OR target.
Family unavailable means refusal, not exact-only fallback or local scanning.

Bare filter `--type any` omits that predicate; `--exact-type any` refuses. This is
only a CLI spelling, not a protocol basename-reservation rule. The earlier
absolute-URI `/any` escape is a [draft proposal](preview3-alignment.md#type-and-rendering-boundaries);
native configured-name/full-URI compatibility remains unresolved. Filter operands are unpinned;
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

## Link incidence and applicability

`link list [ID1 [ID2]]` uses Resource operands, never a positional Scope. Zero
operands select the matching current live Link inventory. One selects incidence,
default direction both. Two select ID1 → ID2, default out; in selects ID2 → ID1;
both unions those orientations. Preserve each Link's authored direction and emit a
self-Link once. `--from`/`--to` are additional AND filters. Explicit --incident-to
and positional incidence cannot both bind that role. Scope comes from --scope or
configuration. Product `link count` must use the same checked selected population.

Applicability is per endpoint, after identity resolution:

| Operand | Matching endpoint on a current live Link |
| --- | --- |
| Bare ID | Same canonical URI, regardless of pin |
| ID@current | Floating, or pinned to the checked current token |
| ID@N / ID@=TOKEN | Pinned to the selected token; floating also matches if that token is checked current |
| --all-revisions | Ignore operand revision applicability; still current live Links |

The override does not turn this into a historical Link inventory. Retained endpoint
content and current incident Links have separate acquisition times/authorities.
Never float a stored pin, substitute a current body for an unavailable pin, or
claim that selected Links existed when the historical endpoint version was made.

The existing bounded Selector expresses resolved matching before native pagination.
For endpoint field E, canonical URI U and exact token R, define these expressions
as compiler notation, not new JSONPath functions:

```text
identity(E,U) = (@.E == U || @.E.uri == U)
pinned(E,U,R) = (@.E.uri == U && @.E.revision == R)
applicable(E,U,R,current) = pinned(E,U,R) || (@.E == U && current)
```

The compiler substitutes the actual source/target singular paths and JSON string
literals. `current` is a resolved boolean, not a path comparison or new wire term.
For two operands, out is match(source,A) AND match(target,B); in reverses A/B;
both is their OR. One operand uses its selected direction. Combine any user raw
Selector with AND inside one bounded expression; quote/encode exact values rather
than interpolate executable syntax. Keep nominal/family predicates as their existing
single wire parameters. Send one native query, not separate forward/reverse requests
whose pages could belong to different snapshots. Existing source/target/endpoint
parameters remain URI-only; no repeated query parameters implement a union.

The selected adapter must establish canonical identities, local ordinal mappings
and any current-token test truthfully in its checked read context. Ordinary BDP
discovery does not advertise local ordinals or a shared transaction across a point
GET and later Link query. A remote binding cannot claim atomic current-applicability
by joining unrelated reads; unsupported resolution/consistency explicitly refuses.
Once resolved, exact pin predicates use unchanged Selector/Reference semantics.
For example, if the checked adapter established selected r4 is not current,
`link list task-42@=r4 --direction out` at Scope https://work.example/acme/
uses this ordinary selector (and the existing Link inventory URL):

```text
$[?@.source.uri == "https://work.example/acme/task-42" && @.source.revision == "r4"]
```

Server refusal for complexity/URI bounds remains a refusal; do not fetch a broad
population, hide rows locally and reuse a misleading native cursor/count.

Continuation retains the issued fully selected population, not a new ordinal/current
lookup. Do not recompute applicability on later pages. Generic BDP has no native
count request here; a product count uses its adapter or a complete same-snapshot
enumeration, never the current page size or an unreported partial count.

## Existing exact reads and HTTP controls

`ID@=TOKEN` and `--revision TOKEN` express exact application History reads;
`ID@N` first requires an authoritative stable local ordinal mapping. Supplying a
suffix and --revision is an error even if equal. The wire query is `revision`,
never an ordinal, guard or HTTP validator. Preserve opaque token/form-query encoding,
including literal plus as `%2B`. No current/nearest fallback. Unwrapped HTTP URLs
containing raw @ stay literal; use the explicit flag or exact JSON Reference.
`@current` selects current; explicit `--revision current` is the literal token.

Actual advertised application History remains required for ordinary application
exact reads. Its existing full-record-only query forbids properties-only/aggregate/
collection/pagination combinations. HEAD is allowed. Narrow exact-definition reads
without general History use the separate [interpretation binding](exact-definition-read.md): do not infer no
support from missing application History, guess a `types/` path, inline definitions
or silently apply an unadopted capability. Generic show does not fall back to that
lookup without explicit definition intent/context; public Type CLI remains deferred. `versions`, `type list` and Events retain
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
