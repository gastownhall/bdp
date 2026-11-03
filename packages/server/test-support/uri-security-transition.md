# fast-uri 3.1.9: private index3 receiving boundary

This focused successor to [PR314](https://github.com/gastownhall/bdp/pull/314)
is based on main `aad0a7baeece14ff9d10cf3ac8393a0fc5c372d0`. It changes the
private schema interpreter and its installation custody. It does not change
normative BDP Resource URI identity, select a new Type design, migrate a store,
rewrite old conformance pins, or establish external consumer adoption.

## Dependency and observed interpretation

The exact server dependency and AJV 8.17.1's transitive resolver move
from fast-uri 3.1.5 to 3.1.9. A workspace pnpm override pins every workspace fast-uri resolution to 3.1.9; it does not rely only on the current deduplicated lock outcome. The upstream [security release](https://github.com/fastify/fast-uri/releases/tag/v3.1.9)
and [encoded-scheme](https://github.com/advisories/GHSA-w74x-v6f9-j3xg),
[host-confusion](https://github.com/advisories/GHSA-wjr9-j795-jxcr),
[relative-normalization](https://github.com/advisories/GHSA-xhq7-xmqj-769h), and
[suffix-colon](https://github.com/advisories/GHSA-333x-w4r6-6crp) advisories
support upgrading. The earlier bounded packet separately verified all ten
advisories cited by Julian. Dependency advisory wording is not evidence of a
BDP SSRF/XSS exploit: this graph resolves only supplied offline artifacts and
never fetches a resolved URI.

Actual 3.1.5/3.1.9 probes on the same graph wrapper established:

| Boundary | index2 / 3.1.5 | index3 / 3.1.9 |
| --- | --- | --- |
| `https://Host.test:443/a/b` + `../C?X=%2f` | `https://host.test/C?X=%2f` | `https://host.test/C?X=%2F` |
| Two schema IDs differing only in query `%2f` / `%2F` | Distinct resources | Refused `resource-collision` |
| Uppercase-query reference to supplied lowercase-query schema | `missing-resource` | Binds the unique canonical resource |
| Encoded-scheme `$ref` in actual AJV | Could alias the clean `https` schema | Refused malformed scheme |
| Wrapper host case/unreserved escapes, malformed authority/IP/port/scheme, relative dot/colon resolution, URN/file, fragment single decoding | Focused admitted/refused results | Same focused results |

A reserved encoded slash stays encoded; query hex-case normalization does not
turn it into a path delimiter. Fragments are stripped before fast-uri, decoded
once and encoded by the wrapper. Suffix serialization is an upstream dependency
control only: the graph does not select that mode or normalize relative
references before resolving them.

AJV and the graph have different registration machinery. AJV keeps supplied
schema registration keys; a lowercase-query `$id` is not automatically
re-registered under the graph's canonical uppercase-query identity. In particular,
an identically spelled lowercase-query `$id`/`$ref` pair validated with 3.1.5 but
now fails reference lookup: AJV retains the raw registration key while 3.1.9
normalizes the lookup URI. An explicitly uppercase-query registration accepts
either reference spelling. No query-bearing `$id` was found in the shipped
protocol/spec schema, catalog and matrix JSON scan; arbitrary external artifacts
are not thereby qualified. Focused controls keep this compatibility refusal
visible and prove ordinary local `$defs` references and validation still work.
If both raw query-case keys are registered with different schemas, AJV silently
selects the uppercase registration for references written either way; the graph
instead refuses the collision. This is a silent wrong-schema risk for external
registrations, not merely a fail-closed refusal. No schema-registration rewrite is
hidden here.

The wrapper retains conservative pre-normalization admission and fail-closed
checks of the original `fast-uri/lib/schemes.js` registry. Missing or altered
private registry surfaces still refuse; no shared dependency state is frozen or
modified. The fourteen-row source-policy guard remains intact, with only graph,
URI module and lock pins refreshed after this deliberate interpretation review.

## Current in-repository consumers and persistence

`buildInstalledSchemaGraph` produces a private graph identity from policy,
artifact digest and built-in digest. No in-repository loader persists or reloads
a `SchemaGraphCandidate` or uses its identity as a database key. Its sole
non-test compile caller, `compilePrivateSchemaEvaluator`, rebuilds the graph
from exact supplied artifacts on each compilation.

There is nevertheless a persisted interpretation consumer:
`compileDevelopmentContracts` supplies both the configured Read/Update authority
and Transactional authority. Before this change, its `development-schema5-...`
identity hashed artifacts and limits but omitted interpreter policy, and its
capture omitted policy too. The configured recovery store records that identity
in installation/lineage metadata and capture; the Transactional store records
it in configuration metadata and capture. A dependency-only upgrade could
therefore recompile under changed interpretation while retaining old custody.

This change closes the specific URI graph-policy custody gap. It does not yet
bind the separate pattern-subset and annotation-output policy revisions into
installation capture; their values remain unchanged here. A change to either
needs a separate explicit custody transition before it can safely reuse
persisted installations. Source-policy pins are not a complete interpreter
identity proof.

The candidate binds `graphPolicy: "schema-resource-index-3"` into **both** the
compiled identity input and immutable capture. The existing prefix format stays
compatible with readers that extract a 64-character digest; the digest and
capture deliberately change. Existing exact installation/capture guards refuse
old pre-policy identities or mismatched captures before pending-claim recovery
or expiry writes. Tests compare the complete temporary database bytes before
and after refused opens. Same-policy reconstruction/reopen preserves retained
results and ordinary validation. The historical pre-policy literal remains an
explicit distinct witness in the installed compiler test.

The current Core/Write reference (`reference.ts` → `retained-v01/http.ts` and
`retained-v01/store.ts`) does not import this graph/compiler or use this compiled
installation identity. Its format5/6/7 selection and stored Resource revisions
are unchanged. Its protocol parsers still receive the transitive AJV resolver
upgrade; focused retained parser controls are separate from graph qualification.
Older optional-profile installed reference and Transactional entrypoints do use
the compiled identity and require the transition below. No Type/profile
conformance or historical evidence reseal follows from these local checks.

## Explicit consumer adoption; no migration promise

A consumer retaining index2 graphs, compiled programs, installation identities,
configuration captures or result caches must keep the interpreter policy with
that evidence. It must not relabel old evidence index3 or reopen it under the
new interpreter with an unchanged identity. In-repository configured stores
fail closed rather than doing so.

Fresh provisioning in a separate explicitly selected empty directory under the
new policy is supported by the candidate's focused tests. Existing configured
stores are **not migrated or declared readable by the new runtime**. Preserve
the original store, exact old configuration/artifacts and old receipts. Any
needed data transition, read access through a retained implementation,
reinstallation or cache rebuild requires an explicit operator/consumer adoption
plan; this patch contains no automatic conversion, store deletion, credential
change or fallback to a weaker identity check. It does not assert that there
are no external persisted consumers.

Static-only local Beads observations are not a fleet inventory. The checkout at
`/Users/dbox/repos/beads` commit `96b879a274906e08b8fa7a634c50262c2c5df939`
had no `internal/httpapi/bdpwire` directory. A separately available source
snapshot `/Users/dbox/repos/beads-playground/source` at
`f9088f209d2bf863cb99dccca631e1d9a4615e82` embeds BDP schema pin
`53bdbd03136875f952af184fce7b3c7af8f74e96`, compares its schema ID exactly,
and uses a Go schema validator. No private index/compiler/fast-uri use was found
in that snapshot's BDP wire package or `go.mod`. Neither observation establishes
the active Beads product's adoption state. No Beads tests/processes/stores,
consumer pins or external trackers were touched.
