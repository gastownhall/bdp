# Reference alignment to the canonical working draft

Specification baseline: `0bf00889b247491412703e02c1f2ce2b10fa3ff9` (PR337).
Its separate actual-main specification CI is [41406174292](https://github.com/gastownhall/bdp/actions/runs/41406174292).
Donna authorized Trish to align and merge the BDP reference client, service and
tests against this commit. Full editorial review continues. Other fleet work,
Beads, queued handoffs and PR334 remain paused.

Current candidate and terminal qualification are recorded in
[PR338](https://github.com/gastownhall/bdp/pull/338). The checkpoints below preserve
original failures and the repairs they motivated; their pending states describe
those checkpoints, not a second active candidate.

## Intended submission contract

The reference path supports required Core reads and the eight ordinary Write
operations, with truthful optional Events advertisement. Inventories and incident
Link reads return complete ordinary Resource pages with the specified metadata,
filters, bounded selectors, snapshot context and resizable ordinary continuations.
Clients follow discovered URLs and preserve native response/page boundaries.

The reference service uses the standard `bdp/` control namespace by default and
continues to advertise its actual URLs. Resources retain one shared identity
space. Explicit configuration owns credentials, directory/provisioning and Scope;
tests use newly owned temporary stores. Public entry points must expose only
behavior actually qualified by the current contract.

Types, History, projection, rooted allocation, richer/native Query, Transfer and
atomic batch acquire no new advertisement through this work. Unsupported selected
requests refuse explicitly. Ordinary Type-definition Beads remain ordinary records
through generic creation, point reads and inventories. All existing pin, identity,
endpoint, metadata, retry, authority and durable outcome rules remain binding.

## Initial source gap inventory

| Surface | Evidence at baseline | Required action |
| --- | --- | --- |
| Protocol discovery | `retained-read-values.ts` and `retained-write-values.ts` declare required Events; Write parsing always validates its URL | Make the member optional consistently; preserve full obligations where advertised. |
| Schema loading | `retained-write-values.ts` uses strict Ajv with the full current bundle and no ownership-annotation registration | Retain strict validation and admit only the known non-validation source annotations. |
| Reference client | `RetainedClient` exposes inspect, point full/properties read, bind and singleton submit | Complete ordinary collection/incident/alias access and bounded native continuation handling; optional Event access checks advertisement. |
| v0.1 SQLite listener | `retained-v01/http.ts` explicitly reports a private incomplete fixture; advertised inventories are not routed | Implement the mandatory read surface and qualify an explicit reference composition; preserve existing private evidence and safety controls. |
| Filtering/pagination | Existing shared selector and snapshot-pagination modules already own bounded parsing, retention, auth binding and cleanup | Reuse those modules; add ordinary continuation resizing without changing legacy behavior or weakening capacity/expiry checks. |
| Endpoint URI overlap | `reference-input.ts` emits a private gap for scheme-shaped strings such as `a:b` | Pair the current Core URI/Write-relative-path rules with RFC3986 syntax and qualify deterministic parsing independently of store liveness. Escalate only an actual unresolved contract contradiction. |
| Optional unsupported views | Private HTTP currently reports501 for History/aggregate gaps | The public reference surface must give the selected truthful refusal; leave optional capabilities unadvertised. |
| Publication and tests | Canonical client is exported; v0.1 server source is excluded from installed package files and has no public reference entry | Publish a qualified reference entry with actual installed-client/service witnesses; retain legacy APIs and historical artifacts under their stated contracts. |
| Historical validator | `check_type_examples.py` still consumes pinned historical fixtures/retired prose | Preserve pins and original controls; explicitly re-key or keep historical scope without claiming current coverage. |

For endpoint References, a leading URI scheme distinguishes an absolute URI from
a relative-path reference. RFC3986§4.2 excludes a colon from the first relative
path segment; see [the primary syntax specification](https://www.rfc-editor.org/rfc/rfc3986.html#section-4.2).
Core admits opaque absolute external URIs and Write admits relative local paths.
The proposed repair therefore keeps scheme-shaped endpoints opaque; a local ID
containing a colon remains addressable by its full canonical in-Scope URL.
This interpretation must pass the existing schema and exact-reference/recovery
controls before the old private gap is retired.

## Implementation batches

1. Establish the exact baseline failures on pinned Node24.22.1/pnpm11.20.0;
   repair schema loading and optional discovery; publish the coherent first unit.
2. Implement ordinary Resource inventory/incident reads and client page access,
   reusing bounded selectors and snapshot pagination; cover opaque next URLs,
   empty pages, kind/owning-Scope metadata and current authorization.
3. Assemble the explicit reference service entry and standard control layout;
   qualify native URI/ID/pin behavior, ordinary CRUD/aliases, optional Events,
   refusal/no-effect, durable recovery and reopen through real HTTP/SQLite.
4. Finish current/historical source accounting, installed-artifact witnesses,
   normal full CI and independent review. Merge only the complete selected
   candidate, then qualify its actual main commit separately.

## Local validation and resource boundaries

One command at a time, with full logs retained and clear terminal outcomes.
Use the existing pinned local Node24.22.1 and corepack-selected pnpm11.20.0.
First run the existing protocol/client retained suites and private store/HTTP
witnesses; preserve original failures and private gap expectations. Build normally
before child-process/installed-artifact tests. Add independent request/response
oracles for each repaired requirement, then run the repository's normal typecheck,
boundary, formatting, generated-source, test, preflight, smoke and evidence checks.
The hosted implementation job retains its existing20-minute bound and required
real bd matrix. No skip, assertion, hook, deadline, version pin or evidence gate
is weakened to obtain a pass.

All runtime state belongs to this candidate's fresh temporary directories.
No shared Git, shared writer, old runtime grant, user store, manual binary,
consumer pin, release/tag/default promotion, global install, fleet restart or
parallel observer is part of this work. Optional feature gaps stay visible.

## Stop-loss

A genuine protocol choice, unsafe shared-resource dependency or unbounded change
family stops that family for a concrete decision. Continue independent repairs.
Do not edit the specification to accommodate an implementation gap, silently
select provisional semantics, broaden into another profile, or call a private
fixture conforming by changing a label. Revisit the plan before expanding a newly
observed failure family. A passing subset is reported with its exact limits.

## First repair results

Pinned Node24.22.1/pnpm11.20.0: the baseline retained protocol/client subset
failed69/147 tests before repair. Known passive schema-source annotations are
now registered explicitly while strict unknown-keyword refusal remains enabled;
Core and Write discovery accept omitted Events and reject malformed advertised
Events. The five-file repaired subset passes154 tests; typecheck passes.

A broader18-file artifact run passes351/363 tests, with12 failures preserved:
historical prose/schema byte pins need explicit historical source binding,
projection's inherited optional-metadata expectation conflicts with current Core,
and old Type publication/read fixtures omit required current metadata. These are
separate alignment families, not waived failures. No SQLite/service, installed
artifact, full implementation suite or conformance claim follows from this unit.

## Ordinary read/service repair

The candidate now adds complete ordinary inventory/incident pages and retained SDK
page/alias operations, using the shared bounded Selector and snapshot engine. Only
ordinary continuations opt into page resizing; legacy fixed-page behavior remains.
The original605cc30 reservation implementation was superseded by the independent
review repair below; it is preserved in Git and its original test evidence.

The explicit `@bdp/server/reference` composition uses the standard `bdp/` namespace,
complete Scope access for its configured principals, fresh explicit provisioning
and the existing durable SQLite mutation/recovery engine. It does not advertise
Events, Types, History, projection or batch. Its selected Core/control policy is
captured in the store configuration: opening an old private fixture as this
composition refuses a mismatch instead of migrating or reinterpreting it.

The first real canonical HTTP/SQLite witness passes4 tests with independent wire
assertions for inventory/incident metadata, snapshot resizing, HEAD/304, ordinary
Type Beads, endpoint pins, aliases, reserved controls and reopen/retry. Private
fixture qualification remains separate. An initial transport-origin bug and an
incorrect credential callback in the new integration test were diagnosed and
fixed; their original failed log is retained. The earlier expected422 for a
scheme-shaped endpoint was an incorrect test oracle: its other endpoint is a
live local Bead, so the native result is200 with the opaque URI preserved. A
changed same-key invocation conflicts; a fresh full-URL local invocation succeeds.

The observed historical artifact failures are the next bounded family. Harvest
only the reviewed exact source loader/snapshots and citation controls from336,
then explicitly bind historical byte-pin/prose tests to their original inputs.
Immutable Type publications and their pins are preserved, with current metadata
requirements tested separately. Do not rewrite publication1/2 records under old
revision tokens or silently replace historical hashes with the current bundle.

## Historical validation result

The preserved catalogs still contain305 rows/569 quotations and retain all six
original byte pins. Their loader refuses source drift, missing/alternate inputs
and malformed encoded Write storage. The original metadata-omitting Type
publication/lookup fixtures now have an explicit historical schema subject and
current rejection controls. No immutable publication was edited or re-pinned.

The Python historical checker passes its original shape, exact-read and altered-copy
controls in a task-owned Python3.13 environment with jsonschema4.23.0 (format extra)
and referencing0.35.1; the dependency freeze is retained outside the repository.
The first attempt lacked jsonschema; the next lacked URI format dependencies.
Those failures are retained, not suppressed. No global Python environment changed.

Applicable retained168/126 guards were recovered before the broad runtime suite.
Their Beads shared-resource/native campaigns remain paused and unrun here. This
BDP reference uses only this candidate’s fresh temporary SQLite/test workspaces.

## Broad local run and next bounded controls

The first full local run completed normally in234.371 seconds:10076PASS,19FAIL,
2existing optional skips (real bd matrix and real-bd demo; user-installed binaries
were excluded). No timeout. All remaining failures were identified in eight files:
historical Problem/prose and diagnostic-source readers, old navigation/layout
anchors, exact package export controls, and the schema-graph interpretation-policy
tripwire for the expanded protocol export barrel. The original complete log and
source manifest are retained. This is not required hosted real-bd qualification.

Historical Problem/cumulative tests now use the closed pinned reader. The current
source helper reads the actual named file and no longer synthesizes a phantom
monolith behind the old navigation path. Old anchor maps lead explicitly to the
archive; current entry links lead directly to the four selected profiles. Private
lifecycle/snapshot containment checks include the new reference entry without
exposing their private facilities. The policy hash remains deliberately unrefreshed
until an independent reviewer checks interpretation and the private version rule.

## Independent review repair

Review01 completed normally with substantive findings. Its large-set/capacity/HEAD
findings are repaired by authenticated offsets over one retained snapshot identity,
nonrepeating masked per-engine counters, per-snapshot MAC keys and source-private
unissued-page release. Existing snapshot byte/node/state/TTL limits are unchanged;
hard per-observation limits are distinguished from temporary active-snapshot
pressure. SQLite scans are bounded before materialization.111 targeted tests and
typecheck pass, including10002 records, tampering, repeated entropy after expiry,
actual HEAD/304 pressure and an oversized scan with readable committed data.

The [review disposition](reference-review.md) records every finding, explicit
policy-version reasoning and remaining closure/installed/full-CI duties. The pin
refresh was applied only after the independent decision and a hash comparison of
all14 guarded inputs. There is no readiness or merge claim at this point.

## Coupled transport repair

A further independent wire test demonstrated18000-byte identity creation200
followed by default read431 from Node’s implicit header limit. The new reference
composition now has a finite1MiB HTTP framing envelope,512KiB advertised/enforced
request target, unchanged64KiB mutation body and unchanged262144-byte store
representation/result bound. Its private-fixture transport and all test/run budgets
stay unchanged. Public Scope configuration is bounded before provisioning.
Before issuing a first cursor, the authority checks the largest form-serialized
next at the maximum permitted limit, so a valid resize cannot cross the target
bound. This prevents accepting a read and then issuing an unusable continuation.
The selected transport policy is durably captured; old private/unqualified policy
stores are refused rather than migrated or silently reinterpreted.

Transport/collection qualification passes20 tests; the original long-ID431 and
initial tuple typecheck failure remain logged. Corrected typecheck and normal
build pass. Actual pack/install/smoke passes (including the canonical native
client/service witness, exact pins, aliases, expiry after reopen and durable
original response replay). Package private-process exclusion and closed module/
export inventories passed against the installed tarballs. Final whole-suite/
required hosted qualification and focused review closure remain mandatory.

## Final historical reader closure

The second full local run on2bb35cf completed234.532 seconds with10096PASS10FAIL
and the same two existing optional skips. All ten were explicit test-source
bindings left behind when the phantom monolith reader was removed: seven test
files still read the navigation stub as cumulative prose or applied current
source classification to historical rows. Their table/retirement/CORS assertions
now explicitly use the same closed historical reader; the synthetic current
citation points directly to current Core. All212 tests across those seven files
pass. No catalog bytes/row counts/pins or assertions were removed. This source
repair changes no runtime product code. A final complete run remains required.
