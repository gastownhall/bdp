# Executable conformance matrices

`read-v1.json` is the complete but non-attesting Read execution manifest. It
links every metadata-catalog scenario to an executable plan. Plan completeness
alone cannot enable a conformance claim: the app matrices use test-only
admission grants and controlled capabilities, and every runner report keeps
`claimEligible` hard-coded to `false`. The conformance claim lives elsewhere —
in the committed two-target cohort artifact described at the end of this
document, which records, per target, the rows proved against the launched
packaged payloads, the self-certified in-process rows, and each honestly
not-applicable capability-gated row, and whose content digest is the
recorded per-target evidence constant; the sealed artifact carries the
authoritative counts.

The checked-in runner still fails closed when a plan's required capability is
absent, an observation is incomplete, or target provenance cannot be proved.
Canonical schema and validator-implementation binding, domain-complete runtime
fixture validation, harness/executor/target provenance, execution against both
packaged targets, and one atomic reviewed evidence cohort must all be satisfied
before any Read evidence marker or listener admission can be enabled.

Every run now accepts a factory-created immutable artifact bundle rather than
independently supplied parsed values. The factory copies, parses, and validates
the exact UTF-8 catalog, manifest, and fixture bytes; verifies that every plan
names the bound fixture; and records a SHA-256 digest for each raw source in the
version 3 report. The verified fixture object is passed explicitly to harness
preparation, and the in-process `bdptest` matrix constructs its Scope port from
that same object. A caller-supplied target label is recorded separately under
report declarations and is not represented as derived target provenance.
Artifact bytes and JSON structure are bounded before the parsed values reach the
runner. Schema `uri` validation uses the RFC 3986 `ajv-formats` full-mode rule;
raw non-ASCII IRI spellings that WHATWG URL parsing would normalize are rejected,
while their valid percent-encoded URI spellings remain accepted.

Target-specific expected values live only beneath the bound fixture's
`/oracles/` namespace. An assertion chooses either a manifest literal or one
fixture pointer, never both. Bundle creation resolves every pointer and validates
the expected scalar, set, or tuple shape before a target can run; diagnostics and
reports never copy oracle values. The checked-in `read-reference-v1` fixture is
the `bdptest` realization of the reviewed logical topology. Its Resource
identities and properties, collection tuples, structural-predicate projections,
Type inventory, and incident-Link sets are selected through those oracles. A
`bdpbd` realization may use different projected and synthesized identifiers and
properties while preserving the same logical Bead roles, blocking relationships,
statuses, and readiness result. Exact harness binding validation remains in
force for whichever realization is bound.

The shared topology includes the baseline quantifier pair: `I` has one open and
one closed blocker and must remain blocked, while `J` has two closed blockers
and must be ready. `K` supplies the second closed blocker. Both the portable
reference target and the isolated real-`bd` seed carry this topology, so an
implementation that treats any closed blocker as sufficient cannot pass the
realization or packaged readiness oracles.

Timestamp portability is also explicit rather than recursive. An exact JSON
assertion that permits target-dynamic timestamps lists their relative RFC 6901
JSON Pointers in `timestampPointers`; every canonical timestamp-looking string
outside those declared locations remains part of the exact fixture comparison.

The non-attesting real-`bd` lane uses the test-only
`BDP_BD_MATRIX_EXECUTABLE` override when it is set. Hosted CI builds the tagged
1.0.5 source with its pinned Go toolchain, supplies that exact path, and sets
`BDP_REQUIRE_BD_MATRIX=1`; a missing or invalid executable therefore fails the
job instead of silently skipping real-`bd` coverage. Without an override, the
lane runs only outside CI when an executable `bd` file is already available on
a non-empty `PATH` entry. Common truthy CI spellings such as `true` and `1`
disable ambient binary discovery. A configured override fails closed if it
cannot be resolved or does not report one of the two exact checked-in 1.0.5
build identities. The matrix allowlist contains the local Homebrew tuple and
the tagged source-build `dev` tuple used by hosted CI; JSON and text output must
match the same tuple, so build channels cannot be mixed. The Homebrew tuple
requires `branch: v1.0.5`. The source build is checked from the same isolated,
non-Git workspace shape used by the matrix and requires the exact absence of a
`branch` member; running that binary from a Git checkout would otherwise report
the ambient checkout branch rather than build provenance. This behavior-matrix
allowlist does not weaken or replace the separate baseline verifier: the
observations under `docs/design/evidence/bd-baseline/` remain pinned exactly to
the Homebrew build and identity.
These test-only variables are distinct from production `BDP_BD_EXECUTABLE`
configuration.

Gate 0 deadlines bound how long the runner waits and stop the remaining matrix,
but they cannot terminate an arbitrary JavaScript promise that ignores its
abort signal. If fixture preparation or an HTTP exchange does not settle after
its signal is aborted, cleanup is skipped rather than raced against that
still-running operation, and the matrix is stopped with the fixture state
treated as poisoned.
An attesting runner therefore also needs a killable executor and harness
isolation boundary, or a verified abort-and-settlement acknowledgement, before
a deadline result may be considered contained evidence.

The single-page collection, structural-predicate, and incident-Link direction
plans explicitly require the `reference-read-v1-single-page` harness capability. Their set assertions
are valid only when the harness guarantees that the complete deterministic
fixture fits in one page, and each plan also observes `next: null`; they are not
a substitute for the pagination plans. The `json-array-set` assertion
uses multiset equality, so repeated fixture projections retain exact multiplicity.

The four pagination plans require the separate `controlled-read-pagination-v1`
harness capability. That capability creates a test-only public-listener session
with explicit Selector limits, page bounds, cursor lifetime, retained-state
bounds, deterministic time and cursor generation, and controllable
Authorization View and Scope epoch identities. None of those values are
shipping defaults or discovery names. The action executor uses only bounded,
fixture-selected inputs and returns normalized observations for runner-owned
assertions; the session's identity signaling and mutation controls are not BDP
request fields.

The Selector plan proves a complete multi-page selection over canonical Bead
records through an exact sorted identity set, page-size vector, and duplicate
check, without making target iteration order normative. It separately observes
rejection at both the grammar and configured UTF-8 byte bounds and deliberately
does not assign a portable BDP Problem code to those invalid Selector requests.
Its controlled Authorization View excludes one fixture Bead that independently
matches both the nested-property and top-level-Type predicates. The exact
result set and reduced page-size vector therefore prove View projection occurs
before Selector evaluation and pagination rather than merely selecting a
fixture that lacked the candidate.
The collection snapshot plan first reads the mutation candidate's public,
target-generated revision, changes the fixture source after page one, proves a
fresh initial read observes the controlled revision, and proves the old stream
retains the public baseline revision without another adapter dispatch. No
portable oracle invents or normalizes a target revision, and an explicit
baseline-distinct observation makes the controlled revision transition
non-vacuous. Cursor-error coverage rejects an incompatible cursor query without
standardizing its Problem mapping, then
checks exact `cursor-expired` and `foreign-view` status, family, and retry
metadata for expiry, Authorization View, and Scope epoch fences. A failed
foreign-view attempt is surrounded by two successful reads of the same issued
cursor; exact action-local comparison of their ID-and-revision page tuples plus
`next` presence or nullness proves the attempt did not consume or restart the
continuation without making the opaque cursor spelling an oracle.

The incident-Link pagination plan interleaves the nine-page Link collection
with a three-page `direction=both` incident-Link view over the same Link
resources. The fixture owns only independently derived sorted identity sets,
page-size vectors, and mutation candidates; it does not prescribe adapter
iteration order. After both first pages, the action selects a candidate absent
from both first pages, reads its public baseline revision, and changes it. A
fresh selected Link read observes the controlled revision while both old cursor
streams retain the same baseline revision without continuation adapter dispatches.
The action also proves that the issued incident cursor remains replayable after
the mutation and immediately before advancing the controlled clock. Only then
does it cross the TTL and prove the next replay returns the exact private,
no-store `410 cursor-expired` gone Problem instead of restarting against current
source state. The baseline-distinct observation makes the incident revision
transition non-vacuous as well.

The advertised-limits plan separately binds the shipping defaults to discovery
and behavior: 50 default and 200 maximum page items, Selector bounds of 16,384
decoded UTF-8 bytes, depth 32, and 256 nodes, and a 300-second maximum snapshot
lifetime. It observes the discovery values, accepts the exact page boundaries,
rejects 201 items and each Selector overflow with `413 limit-exceeded`/`never`,
observes 50 items when `limit` is omitted, and proves a cursor replay preserves
the exact ID-and-revision page tuples and continuation shape immediately before
`PT300S`, then returns `410 cursor-expired` at expiry. The
controlled session uses those same values; it does not merely emit discovery
metadata disconnected from enforcement. The lifecycle observation counts each
of its nine public requests as it completes and separately records the omitted
default page, the 200-item maximum page plus continuation, and the exact
`413 limit-exceeded` Problem for 201 items; it does not echo its input limits as
evidence.

The properties-view plan checks both Resource kinds against their complete
fixture-owned open properties objects. The incident-Link direction plan covers
positive and negative inbound/outbound selection plus explicit and default
`both` behavior, with one fixture Bead having distinct inbound and outbound
Links so the union is observable. Artifact tests derive those expected Link IDs
from the same bound fixture relationships and verify that the manifest selects
the bound realization rather than carrying a second literal.

The invalid-collection-query plan sends an unsupported parameter, repeated
`limit`, and repeated `selector` through each public listener. Every probe must
return the exact `invalid-parameter` request-family Problem with status `400`,
retry `never`, the Problem media type, schema validity, and private/no-store
protection. This is the portable collection-query decision; it does not silently
generalize collection vocabulary to unrelated Resource-view combinations.

The structural-predicate plan uses heterogeneous declared Bead and Link Types
with two-hop conformance chains in both categories. It proves exact `type`,
transitive `conformsTo`, `source`, `target`, and source-or-target `endpoint`
behavior, plus logical AND across distinct predicates. Fixture query bindings
let one portable plan exercise both canonical local and absolute in-Scope
endpoint spellings without baking the runtime Scope URL into the manifest. A
cross-category empty case also prevents Link `conformsTo` from being silently
ignored or crossing the Bead/Link Type boundary. Every expected result set is
selected from the bound realization and independently derived from its topology
in artifact tests.

The Link collection uses one relational tuple assertion over every complete
fixture Link rather than independent ID, source, and target projections. Each
tuple preserves record membership and multiplicity. In-Scope endpoint IDs are
normalized relative to the run Scope, while opaque out-of-Scope endpoint URIs
remain exact absolute values. The external-endpoint plan uses reviewed
target-specific realizations instead of pretending their storage topologies are
identical. `bdptest` exposes two selected `blocks` Links around the Decision
Bead, one with external source and one with external target. The real-`bd` lane
creates its native local-source/external-target `related` dependency with
`bd dep add`, using a Link type whose non-blocking behavior is pinned by the
baseline,
observes that exact `external:beads:mol-run-assignee` identity, and confines the
mutation to a dedicated workspace discarded with the matrix temporary root;
the shared corpus is never mutated. Fixture-owned tuple oracles require the
exact opaque external identity (with its pin where one is stored), the
expected local orientation count, and at least one in-Scope Bead on every
selected Link.

The `GET`/`HEAD` catalog row now runs through a fresh bounded `node:net` or
`node:tls` connection for every exchange. The canonical Scope URL remains the
semantic request and report identity while a separate explicit dial route
selects the test listener; the wire request retains the canonical request
target and `Host`. This avoids replacing the identity under test with an
ephemeral loopback URL. HEAD assertions use the actual octets observed after
the response headers, below Node's method-aware HTTP parser, and compare status,
`Content-Length`, and `Content-Type` with the immediately preceding GET for the
same target. A malicious server that sends bytes after a HEAD response is
therefore observable and fails the body-absence assertion.

The target-neutral raw-HTTP scenario target establishes fixture capabilities
only after its start callback returns a validated dial route. The `bdptest`
matrix callback returns `public-http` only after its Node listener has bound and
closes both listener and Read server on every normal or exceptional path. That
matrix still uses the explicitly test-only admission grant: it exercises a real
socket but is in-process reference coverage, not packaged-target identity or
admission evidence. Type Descriptor publishers outside the Scope are
independent authorities. The controlled publisher admits exactly the
credential-free `https://work.example` authority, rejects Authorization and
Cookie fields, preserves the semantic response URL through loopback routing,
and closes with the scenario target.

The loopback publisher is a test accommodation, not relaxed response-identity
validation. Native Fetch observes the ephemeral loopback dial URL, so the
publisher clones the response and restores the canonical semantic request URL
in `Response.url`, exactly as a direct request to `https://work.example` would
report it. Client regression coverage supplies a different external response
URL and proves that the exact-identity check rejects it.

The external-Type-descriptor plan uses the public Fetch client with exactly the
selected Task and Blocks canonical IDs allowlisted. Admitting either ID does not
admit another path on the same authority. It asserts the closed Task descriptor
(`describes: bead`, conforming to Work Item) and the closed Blocks descriptor
(`describes: link`, conforming to Dependency, with empty source and target
`conformsTo` arrays).
Redirect handling, credential omission, response bounds, schema validation,
and exact requested identity remain client-owned. This capability is limited to
explicit Type Descriptor IDs; off-Scope `service-desc` discovery is
still outside the direct executor's Scope-confined policy.

This is the selected public Descriptor surface accepted in the seven-row
Descriptor decision: the BD end-to-end must surface Task and Blocks. It is distinct from the
process adapter's repo-owned in-Scope Type inventory, which also projects the
static reference descriptors needed to type the seeded `bd` values. Seeded
`bug`, `decision`, and `related` values therefore do not expand the controlled
external publisher's exact-ID allowlist or the selected Task/Blocks contract.

Fixture `blocks` links use the domain direction **source depends on target**. A
source bead is ready only when it is open and every `blocks` target is closed.
The checked-in artifact test derives the fixture's expected ready titles and
collection counts from that content instead of restating them as literals.

Repeated Scope and discovery requests are explicit prerequisites owned by the
discovery catalog rows. A prerequisite failure is reported with those discovery
requirements and leaves the dependent collection, type, or method scenario
`not-run`; it is not misattributed to the dependent behavior.

The `read.http.method-405` scaffold requires the fixture's `cors-disabled`
capability and sends an explicitly marked negative `POST` probe to Scope. It
requires exactly `Allow: GET, HEAD`. It does not require an empty response body:
the protocol prohibits a BDP Problem representation, and that negative assertion
is deferred until the manifest can express it. A separate CORS-enabled case must
require `OPTIONS` when that deployment capability is added.

The internal-fault plan requires the fixture's explicit
`unexpected-internal-fault` capability. Each app matrix injects a private
adapter exception for the fixture-bound `bead.demo-a` identity, then observes
the public Node HTTP listener over a raw socket. The row requires a body-less
`500`, so the injected detail cannot cross the wire and no unspecified BDP
Problem mapping is fabricated. It deliberately does not constrain metadata on
that empty response beyond the normative rule.

The Problem-table plan injects each of the 11 closed Read Problem codes through
an ordinary public Resource route and proves its exact family URL, status,
retry disposition, schema-valid body, Problem media type, and private/no-store
protection. The seam proves shared server serialization; natural applicability
remains owned by scenarios that exercise the corresponding failure condition.

The nondisclosure plan first proves its hidden and deletion candidates are live,
then excludes one from the controlled Authorization View and deletes the other.
Hidden, deleted, and never-existing Beads must return the same schema-valid,
private/no-store `404 resource-not-found` Problem from ordinary, properties, and
incident-Link reads, and targeted collection Selectors must enumerate neither
the hidden nor deleted identity.

The `read.http.cache-cors` plan requires the exact `private, no-store` directive
set, compared case-insensitively as HTTP requires, on representative
Scope-bounded data: Bead and Link records, properties and incident-Link views,
the three Read collections, and the nondisclosing `404` Problem. Exactness is
deliberate while the token assertion cannot both allow compatible extra
directives and forbid a contradictory `public` directive. Neither the portable
oracle nor the reference server assigns that cache policy to the bodyless Scope
`204`, bodyless `405` responses, the discovery document, or externally hosted
Type Descriptors. The reference server also protects the authorization-fenced,
heuristically cacheable `410 cursor-expired` Problem. The portable cursor
oracle now checks the exact error class through controlled sessions. Discovery
cache/revalidation policy and `ETag`
coverage under the same specification anchor remain separately owned gaps.
Every Scope-data HEAD plan compares `Cache-Control` with its preceding GET so a
target cannot drop the protection on the bodyless response.

The disabled-CORS branch sends both an `Origin`-bearing ordinary `GET` and an
`Origin`-bearing `OPTIONS` preflight. Access-Control response-field absence is
claimable only when the executor attests that its effective request headers were
serialized onto the wire and those headers contain the exact requested
`Origin`; preflight evidence must also contain the exact requested
`Access-Control-Request-Method`. A planned Fetch header set is not wire evidence
and fails closed with `wire-observation-unavailable`. Reports retain only the
redacted header names plus the wire-observation marker. The CORS-enabled
positive branch remains a deferred optional-capability variant.

The unsupported-client-input diagnostic is exercised through the public
`BdpClient` seam against a controlled in-memory transport: unsupported discovery
versions and profiles return a
structured failure before the requested Read operation is dispatched. Its two
programmable-client actions expose only the bounded result code and symbolic
dispatch counts; the runner owns the assertions and report output never copies
the synthetic discovery document.
The no-eager-Type-resolution diagnostic similarly gives the public client a generic
Resource carrying an external Type ID and proves exactly one Resource dispatch
with zero descriptor dispatches. This is a client behavior oracle rather than
an assertion about either server realization.
The malformed-client-response diagnostic is exercised through the public
client plus Fetch transport. Transport observations use an explicit
success-versus-Problem discriminator, so successful open properties cannot be
misclassified from member names. Successful Read bodies and direct Problems
are parsed through the canonical schemas into owned, deeply immutable values,
with request-context coherence checks layered on top. Malformed JSON,
schema-invalid bodies, and contextually incoherent successful responses
normalize to a bounded `temporarily-unavailable` Read Problem in the Fetch
lane. After a non-success status is observed, however, an unreadable,
timed-out, oversized, wrong-media, or malformed body remains a local transport
failure unless it is a valid BDP Problem or the explicitly permitted body-less
`500`. These cases and the malformed-response action are diagnostic
coverage/tooling rows rather than target conformance oracles. The malformed
successful-response action now observes the public Fetch client through a
bounded synthetic response and records only its normalized result code and
symbolic request counts. The three client rows are executable in both app
matrices without claiming that either shipping server emitted the synthetic
input.

The disconnect-recovery diagnostic performs two collection reads through one
public client. Its target-facing Fetch first completes a real public HTTP
exchange and then injects a response-body stream failure; the client must
normalize that interruption and successfully perform the second public read.
This deliberately tests client/tooling recovery and does not claim that either
server realization caused the diagnostic disconnect.

The cross-target diagnostic reads the public Bead and Link collections from the
currently prepared realization. It projects only fixture-owned logical roles:
title/status/priority tuples and relationship edges joined by title and tagged
with an ID-free logical Link role. A fixture-oracle input maps each
realization's public Link Type identity to that role; the runner materializes
the input without exposing the fixture to the action executor. It then compares
the bounded projection with the bound fixture oracle, while artifact tests
independently derive and compare the two realizations' oracles. Target Resource,
Link, and Type identifiers never become the equivalence output oracle.

The restore-identity plan preserves the distinction between restoring one
logical Scope and exposing restored data as a different Scope. The `bdptest`
branch restores at the same canonical Scope, rotates its controlled internal
Scope epoch, and proves a pre-restore cursor is fenced with `410 cursor-expired`.
The stable Resource URL remains identical and the deleted Resource remains
`404 resource-not-found`. The real
`bd` branch starts a restored listener at a new canonical Scope: discovery and
live Resource URLs use that new base, the old stable and deleted URLs both
return `404`, and fixture evidence permits the independently seeded Resource at
the new Scope to be live. Both branches prove the chosen identity semantics
without treating one target's restore mechanism as the other's.

The raw-request-target plan uses the socket executor against each live target
listener. It proves canonical configured-Scope identity for origin-form,
scheme-relative, and absolute-form successes; exact non-success statuses for
printable noncanonical forms; and Node-native bodyless `400` responses for a
control octet and invalid UTF-8 that are rejected before the handler. It does
not treat those parser-level responses as BDP Problem envelopes.
Every authored raw-target template is materialized only after its semantic
target binding has resolved. Origin paths therefore inherit the runtime Scope
mount and fixture resource identity instead of embedding either one in the
matrix. Templates may replace the request-target authority, insert exact bytes
before the final path segment, or append strict ASCII/base64 suffix bytes; the
fully materialized request target remains bounded to 8 KiB and is never copied
into the conformance report.

The full executable-plan score (every applicable plan passing per target)
remains non-attesting and fail-closed. There are no missing Read plans, but
executable coverage is not target-bound admission evidence.

The reference fixture's Type IDs are deliberately hosted outside its Scope at
`https://work.example/types/`. A Scope-local `types/{id}` request therefore
does not alias a descriptor merely because its final path segment matches. The
normative descriptor row now uses the controlled external publisher and public
client exact-Type-ID allowlist described above. An unlisted external descriptor
ID still fails locally with `BdpClientCapabilityError`
(`safe-fetch-policy-required`) before dispatch rather than becoming a fabricated
wire Problem.

The direct executor's safe fetch boundary is the canonical Scope. A valid
off-Scope `service-desc` target is reported as `harness-error` with category
`out-of-scope-target`, not as target non-conformance; a future isolated fetch
policy is required to execute that topology. Because the harness cannot safely
continue after a Scope escape, that category stops the matrix and records later
scenarios as `not-run`. Separately, the public client currently raises local
`BdpClientCapabilityError` (`safe-fetch-policy-required`) before following the
same off-Scope discovery target; that client capability result is not direct
executor evidence.

Each observed response body records one bounded shape: `empty`, `json`,
`invalid-json`, or `unrepresentable-json`. Malformed JSON remains a faithful raw
observation and does not by itself fail a status- or header-only request. A
syntactically valid JSON number that the runtime cannot represent finitely is a
target-attributed failure only when an assertion or capture needs the materialized
JSON value; status-, header-, and raw-body-only checks remain independently
observable. JSON depth, node, or container width beyond the runner's configured
materialization bounds is a scenario-local `observation-limit` harness error, as
is a response beyond the executor's configured byte bound. A successfully
cleaned-up observation limit does not suppress later independent evidence. The
same limit during a prerequisite recheck stops the matrix because the shared
prerequisite cannot be re-established safely for dependent scenarios.

The report's `claimEligible` member is therefore hard-coded to `false`.
The non-attesting report records body size and shape but intentionally omits raw
body content and body digests. It records only allowlisted header names and
redacts every header value until the evidence artifact's secret-bearing
provenance policy is selected. Offline schema failures retain the bounded Ajv
message but omit the target-derived instance path, so response member names and
values cannot enter the report through that diagnostic surface. Ajv's
`uniqueItems` message may identify duplicate array indices; those indices carry
neither a member name nor a value.

Shipping admission is open, backed by exactly the atomic checked-in Read
cohort this section requires: `docs/design/evidence/read-cohort/read-v1.json`,
generated by `pnpm evidence:generate` against the launched packaged payloads
and verified by `pnpm evidence:verify`. The per-target evidence markers carry
the cohort artifact's content digest and must never be populated
independently: any edit to either marker without a matching artifact fails
the evidence gate closed. The cohort's required scenario IDs are derived from
the bound catalog and its runs together cover both `bdptest` and `bdpbd`. A
cohort is assembled from more than one run — a packaged run and a
self-certified in-process run — so each run declares the rows it carries, and,
for each target, their union must be exactly the required set minus that
target's derived not-applicable rows (the honest-absence rule below), with
every carried row attributed to exactly one run. The cohort must bind the catalog, manifest, fixture,
canonical schema, validator, runner, harness, executor, installed payload,
launched target process, fixture/workspace, and—for `bdpbd`—the actual `bd`
executable. A missing, failing, or mismatched target closes the cohort for
both targets. The fixture binding is per-realization — `read-reference-v1`
for `bdptest`, `read-bdpbd-v1` for `bdpbd` — while catalog and manifest must
agree across every run, and each target's runs must agree on their fixture.

A test-admitted target closes the cohort too, but that prohibition governs
**closure**, not **generation**. The distinction is forced by a circularity the
original five decisions did not address: a production `--serve` refuses to bind a
Read listener until evidence exists, and the cohort is what produces that
evidence, so the first run cannot be packaged-admitted. Ruled 2026-08-17:

- The bootstrap cohort may be generated against a test-granted target. It is a
  scaffold, and it is committed only to unlock admission for the packaged run.
- Every artifact records the admission of **every carried row** (an
  honestly inapplicable row is recorded under `notApplicable` instead and
  carries no admission), and a carried row that is not self-certifiable
  must be `packaged`. That single rule refuses the bootstrap
  artifact automatically — its packaged-required rows are in-process — so no
  separate prohibition is needed, and cherry-picking the bootstrap commit still
  fails closed.
- The shipped tree carries packaged-derived evidence only. The bootstrap artifact
  and constant are replaced by the packaged results within the same change, so
  the run head the verifier checks is the packaged run's.

The seal is packaged-only rather than byte-identical to the bootstrap. Requiring
byte-identity would oblige the in-process harness to be a perfect simulator of
the packaged one, which carries no protocol value: a mismatch would report
harness parity rather than conformance.

The five decisions that previously blocked a non-null cohort were resolved
2026-08-17 and now bind the implementation:

- **Required set and admissible state.** The required set is the
  catalog-derived scenario ID list, and `pass` is the
  only admissible state for an applicable row. `fail`, `harness-error`,
  `unsupported-profile`, and absent each close the cohort for both targets.
  A `not-applicable` outcome is admissible in exactly one form: a
  capability-gated row recorded per target under the honest-absence rule
  below, derived and recomputed from committed bytes — anywhere else it
  closes the cohort. Per-target scores render split (`N pass / 0 other`),
  never as a bare ratio, so a non-pass state cannot hide inside one.
- **Optional-capability variants.** The cohort accounts for every reviewed
  required row and authors no absent-variant scenarios. The artifact carries an explicit
  `uncovered` list naming the absent-optional variant, so that gap is declared
  rather than left implicit.
- **Evidence constant and closed-gate bootstrapping.** The constant is the cohort
  artifact's content digest rather than a commit SHA, and the artifact never
  contains the constant; that is what breaks the circularity. The artifact
  records the reviewed run head and every binding digest. Verification fails
  closed unless the recorded run head is an ancestor of `HEAD`, the delta from
  that run head to the evidence commit is confined to the constant and the
  artifact, both targets name the same run head, and both per-target entries
  carry the same artifact digest. One cohort covers both targets, so any
  disagreement between them closes it.
- **`bd` compatibility scope.** The cohort pins an exact `bd` identity: version
  1.0.5, `schema_version` 1, and the recorded baseline observation digest over
  the committed observations. Any drift closes `bdpbd` and therefore both
  targets. `pnpm baseline:verify` is a pre-cohort gate and is deliberately not in
  CI: it is pinned to the Homebrew build and identity, while hosted CI builds the
  tagged source and reports the `dev` tuple, so the two cannot be satisfied by
  the same binary.
- **Secret-bearing evidence retention.** Redaction is permanent rather than
  deferred. The artifact retains scenario ID, result state, allowlisted header
  names, body size and shape, and binding digests. It carries no header values,
  no body content, no body digests, and no target-derived instance paths.
- **Admission bootstrapping.** Generation may be test-granted; closure may not.
  See the decision above; the artifact records admission per carried row
  (inapplicable rows live under `notApplicable` and carry none) and
  verification requires `packaged` for every carried row that is not
  self-certifiable.
- **Row provenance and the self-certified set.** Decided 2026-08-17. The rows
  carrying `lifecycle`-family actions cannot be driven against a packaged
  target: they mutate target state mid-run, and the control headers
  `x-bdp-conformance-view`/`x-bdp-conformance-epoch` are defined in
  `packages/conformance/test-support` and honored by nothing in the server
  package or either composition root. Rather than ship a conformance control
  surface, provenance is recorded **per row** — packaged, self-certified in-process,
  or honestly not-applicable — declared explicitly in the artifact, which
  carries the authoritative per-target counts.

  The self-certifiable set is **derived from the bound manifest** — precisely the
  rows carrying a `lifecycle`-family action — never a hand-maintained list. A
  list could be extended to hide a packaged failure; a derived set can only
  change when the manifest changes, and the manifest digest is already bound.

  **Callout, binding.** The artifact and this specification must state that the
  self-certified rows are not independently verified. They exercise the same
  server package through a different composition, so they are evidence about the
  implementation but not about the packaged boundary. If BDP is ever used to
  certify third-party servers, these lifecycle rows are self-attested and must be
  presented as such rather than as black-box conformance.

The verification rules above are enforced by `pnpm evidence:verify`
(`scripts/read-cohort-evidence.mjs`), which runs in CI. The cohort artifact's
one committed location is `docs/design/evidence/read-cohort/read-v1.json`, and
the run-head-to-evidence-commit delta may touch only that file and
`packages/server/src/read-conformance-capability.ts`. While nothing claims
evidence — no recorded constant and no committed artifact — the gate exits 2
and admission stays fail-closed, which is a passing state. The moment anything
claims evidence, including a bare well-formed constant with no artifact behind
it, the gate demands the full proof: canonical artifact bytes digesting to the
recorded constant for both targets, per-row provenance with the self-certifiable
set re-derived from the bound manifest, run-head ancestry, and delta
confinement. This ordering is deliberate: the gate landed before any bootstrap
constant so that no window ever exists in which a fabricated value admits the
server unchallenged.

Exact-head CI, whole-branch adversarial review, and tree-equality proof
remain final gates; none has been satisfied merely by reaching the executable
plan count.


### Honest absence: capability-gated rows

A catalog scenario whose manifest plan carries `applicability.requires` runs
only against a target whose bound fixture declares every named capability. A
target whose fixture does not is recorded in the cohort artifact's per-target
`notApplicable` list — scenario id plus the missing capabilities — and
contributes no row for that scenario. The list is derived, never supplied:
the generator computes it from the bound manifest and each target's bound
fixture, and the evidence gate recomputes it from the committed bytes and
refuses an artifact whose recorded list differs, whose inapplicable row is
also claimed, or whose scores count an inapplicable row as pass. Honest
absence is not coverage: a capability-gated row proves nothing about the
target that lacks the capability, and the artifact says so instead of
hiding it.
