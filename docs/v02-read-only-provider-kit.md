# Core v0.2 read-only provider qualification

Run the updated provider kit against an isolated, quiescent read-only scope:

```sh
pnpm install --frozen-lockfile
pnpm build
node scripts/current-provider-kit.mjs --spec v0.2 --profile read-only \
  --scope https://provider.example/ --allow-refusal-probes
node --test scripts/v02-provider-kit.node-test.mjs
```

The default entry point retains its existing v0.1 behavior when `--spec` is absent.
The v0.2 profile follows `specs/src/core/core.lumen` and the stdlib source at
`5ea7cb385deb3027742984c0ef8a7f2442a91260`, the current PR403 head. It uses structured
ResourceIds, `rep<T>`/`body`, capability presence, relationships as resources,
internally tagged Filter/QueryExpr, named call arguments, and Reply/Outcome.
It does not reinterpret v0.1 profiles or separate Link records as v0.2.

`--allow-refusal-probes` permits PUT/PATCH/DELETE/POST negative checks against a
fresh random identity. They must all refuse. Use this flag only on an owned test
scope: a broken provider could accept one. No such methods are sent unless the
flag is present **and** discovery first passes read-only capability admission.
Without this permission the refusal row is `not-run`, so qualification is incomplete.
Successful calls are limited to advertised safe read-only operations: `query`,
`count`, `search`, `graph`, `duplicates`, `similar` and `lint`.
There is no inference, data ingestion or mutation fixture in this profile.

A bearer credential, if required, comes only from `--token-env NAME`; anonymous
providers require none. Credentials are never command arguments. Navigation stays
on the selected origin, redirects are not followed, and embedded URL credentials
are refused. Reports retain request-path/response hashes, byte counts and statuses,
not response bodies, arbitrary discovery extensions, or reflected error values.

The CLI writes one JSON report to stdout and measurable case/page progress to
stderr. `--timeout-ms`, `--max-bytes` and `--max-pages` override checker bounds.
Exceeding a bound is a harness error, not provider nonconformance or a pass.
Integers beyond JavaScript's lossless numeric range are likewise inconclusive;
the checker never qualifies values after silently rounding them.
Defaults are30000ms,256MiB per response and10000 pages. Run with the repository's
pinned Node24.22.1. A full inventory is consumed; there is no silent sample cutoff
for inventory, Query-all, or export equality. Point reads sample each observed type.

## Coverage and verdicts

`coverage.json` records all68 normative annotations and the14 Appendix E guarantees,
with source hashes, statement hashes, explicit case mappings and applicability
rules. Source changes require reviewed coverage updates; an unknown or unmapped
clause cannot qualify. No row may be deleted, duplicated, made unrequired, excepted,
or omitted to manufacture a pass. A mutation-only obligation is not applicable
only after read-only capability admission passes. An optional stdlib obligation
is not applicable only when that capability is absent.

The runner checks discovery and closed wire envelopes, full inventory identity,
point/pinned/repeat reads, anonymous absence behavior, context correlation and its
4096-byte floor, projections, flat conditions, lexical comparison, boolean Query,
malformed Query admission, both relationship directions, count, continuation,
JSON/JSONL cursor interoperability, and export/feed-cut consistency. Body and
metadata values remain opaque; data is learned over HTTP, not from a provider's
private storage or expected-answer hook. No domain-specific type or known corpus
answer is hardcoded.

Channel Get and Pull share a URL in the draft binding. Descriptor point checks use
the already-defined Get `revision` parameter (or `selector` on unversioned scopes);
bare channel GET is exercised as Pull. A provider with neither disambiguator is
reported `not-run`, rather than inventing a route or mistaking a Page for a resource.
The JSONL List binding uses the documented bulk sequence of resources and resumes
JSON cursors. The callable Query checks use the JSON Reply containing a Page.

An empty changefeed is valid. The checker does not require fabricated events,
principals, writes or deletion history from a frozen read-only provider. It checks
that observed safe call IDs acquire no unsafe call frames. General write/crash
semantics are outside this profile. Durable resources require a restart witness;
intrinsic computed resources do not acquire a persistence claim.

The optional-operation cases check bounded ranked SearchHit arrays, case-insensitive
lexical matching, QueryExpr prefilters, selector expansion, unoffered mode faults,
BFS graph depth/directions/type prefixes/cycle edges, exact duplicate field tuples,
bounded distinct similarity pairs, and lint result shape/selection. Where a provider
publishes `metadata.lint` rules in the tested field/required/nonempty/reference
form, lint findings are independently checked against those declarations. Other
rule languages are opaque; this is not a universal lint-language interpreter.

History checks sample each observed type, consume its revision pages and compare
pinned Get representations. History export checks framing, counts, unique
identity/revision pairs and inclusion of known current revisions. A single known
baseline revision is valid; tests do not fabricate older publications.

Live SSE checks observe two bounded open-stream windows, explicit `after` and
Accept/Last-Event-ID resumption, plus invalid cursor refusal. A keepalive-only stream
is valid for an unchanged snapshot. Observation receipts explicitly identify a
live window; they are not a claim of complete finite-stream consumption. Event
publication/recovery requires a real changed-data witness outside this frozen
read-only scope. The transport avoids pooled idle sockets so CPU-heavy reference
calculations cannot accidentally reuse a server-closed socket.

Sorting checks exercise standard stdlib Query Sort keys and cursor binding.
When `packs.stdlib.query.sortOrder` advertises `scalar`, numeric keys are checked
numerically; otherwise the general checker uses string identity keys. This
provider policy does not change Core Filter comparisons, which remain lexical. The
Core draft advertises List sorting but lacks its parameter in the List signature;
the List `sort` JSON query parameter is an explicit provider binding exercised by
this tool, not an invented normative parameter in the Lumen source.

An offered feature without qualification cases stays `not-run`. This still
includes filtered/projected event streams and other optional stdlib operations.
This tool does not award coverage for those features. The target must remain quiescent during a run;
a changing baseline cannot support the inventory/export equality checks.

| Exit | State | Meaning |
| --- | --- | --- |
|0|pass|All cases and mapped applicable obligations in this named read-only profile pass; lifecycle cleanup succeeds|
|1|fail|An observed assertion fails|
|2|incomplete|Required evidence is missing or an offered feature lacks cases|
|3|harness-error|Transport, bounds, initialization or cleanup prevented observation|
|64|usage|Invalid CLI arguments; supplied arguments are not reflected|

`qualificationComplete` and `claimEligible` refer only to the named profile and
pinned sources. They are not a badge for every optional BDP pack, a performance
qualification, or deployment approval. The report fingerprints all assertion
modules as well as the source documents. Existing v0.1 results retain their
original meaning and incomplete-qualification policy.

## Adapter and checker tests

`--provider /absolute/adapter.mjs` may replace `--scope`. Its trusted `provision()`
returns only `{scope, authorization?, restart?, cleanup?}`; restart/cleanup are
administrative hooks, not expected-answer or verification hooks. A restart must
preserve the same logical scope and actually restart the candidate. Unknown
adapter fields are refused. A failed initialization still attempts owned cleanup.

Checker tests include a domain-neutral wire fixture, literal reference-semantics
assertions, report-accounting failures, and deliberately broken HTTP variants.
They ensure that ignored selection, missing JSONL, bad default windows, cursor
reuse, wrong traversal direction, malformed Query acceptance, invented commit
transactions, truncated exports, bad cut cursors and undefined envelope members
cannot qualify. These are checker regressions. Qualification of an application
still requires running the tool against that actual candidate and its real data.

The JavaScript runner accepts focused development `only` and `requiredStdlib`,
`requiredSort`, `requiredScalarSort`, `requiredHistory`, `requiredSse` options. These drive red/green
implementation before discovery advertises a feature. Focused runs retain all
omitted rows as required `not-run` and cannot qualify. Final evidence must use
the full CLI run against the staged candidate.
