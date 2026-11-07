# Current Core / ordinary Write provider kit

This is a repository-contained, public-HTTP **vertical slice**, not complete
Core/Write qualification. It is category 2 interoperability work. Its local
reference adapter is one implementation; the reference's private storage,
corruption and SIGKILL tests remain category 3. Schema/prose consistency remains
category 1. No performance baseline, CI cutover, old-cumulative conformance
replacement, production API or optional capability selection is introduced.

The governing [stabilization plan](plans/bdp-stabilization.md#testing-and-cost-discipline)
requires every required obligation in a qualification scope to have evidence.
This kit deliberately reports its missing coverage instead of declaring a pass
for the implemented subset. `qualificationComplete` is always false at this
stage. `sliceComplete` is separately true only when all 19 executable cases and
provision/cleanup complete successfully. It is not a provider badge.

## Run

Use the repository's pinned Node and pnpm, install dependencies and build first:

```sh
pnpm install --frozen-lockfile
pnpm build
node scripts/current-provider-kit.mjs --provider /absolute/path/to/adapter.mjs
node --test scripts/current-provider-kit.node-test.mjs
```

For the shipped adapter, use the absolute path to
`scripts/current-provider-reference-adapter.mjs`. It provisions a fresh owned
local reference directory and random credentials, uses the shipped public
reference factory, closes/reopens that same logical Scope on request, and removes
its directory on cleanup. It does not open a user store or change a consumer pin.
The runner's fixtures never invoke Beads commands or infer startup admission.

To run against one Scope you already have, reached directly:

```sh
node scripts/current-provider-kit.mjs --scope https://provider.example/acme/ [--token-env NAME] [--allow-mutation]
```

`--scope` has no adapter, so no restart and no fixture conditions: durability and
graph cases stay `not-run`. The token, when there is one, comes only from the named
environment variable. Without `--allow-mutation` the kit sends no mutation to that
Scope, and a Scope advertising Write reports its mutating cases `not-run`, with that
reason. Pass the flag only for a Scope you are willing to have changed: the kit creates,
edits and deletes records under `provider-kit/<run id>/`.

## A provider without Write

Write is optional. The kit reads the Scope's discovery document and goes by its
`profile`:

- `core`: every Core case runs, and every `write.*` case reports `not-applicable` with
  the reason, by discovery, with `required: false`. Such a row is never a pass, and the
  report's `discovered` member records what was read. A document that is not a valid
  closed Core document, or a profile that is neither base literal, fails
  `core.scope-discovery`: only a valid `core` makes Write not applicable.
- `write`: the Write cases run as below.

A read-only provider supplies its data by its own means, because it has no public way
to receive it: its store, its importer, or its adapter's `provision`, which is free to
write natively. The kit learns what exists from the public inventories and compares a
point read with its own inventory record, so nothing the provider says about its data
becomes an expected answer. A Scope holding no Bead leaves `core.point-read` `not-run`,
naming the seeding it needs, and never passes it.

`core.deleted-absence` needs something deleted. On a read-only provider the adapter may
delete a Resource natively and name it, identity only, in `witnesses.deletedResourceId`;
the kit then reads what the wire says of it. With no witness the case is `not-run`.

## Optional profiles: Callables and the Issue package

The same run covers the rows of [Callables §11](../specs/profiles/callables/callables.md#11-conformance-rows-for-preview-1),
[Issue §10](../specs/types/issue/issue.md#10-conformance-rows-for-preview-1) and
[Issue Callables §8](../specs/types/issue/callables.md#8-conformance-rows-for-preview-1).
They are listed, with their citations, in `packages/conformance/catalog/current/` and reported
in the report's `optional` array: `row`, `state`, and a `reason` or `note`. A failure there
fails the run. They never change `sliceComplete` or `qualificationComplete`, and
`claimEligible` is always false.

| State | Meaning |
| --- | --- |
| `pass` | Observed on the wire |
| `not-applicable` | The Scope's discovery rules it out: no Callables1, or a row needing Write on a Core Scope. Never a pass |
| `not-run` | It applies and could not be exercised: no witness, or no `--allow-mutation` |
| `excepted` | The row is in the exceptions ledger. `observed` keeps what really happened; it is never a pass |
| `fail`, `harness-error` | As for the Core and Write cases |

Pass `--exceptions /absolute/ledger.json`, an object of row to reason such as
`{"IT-11": "the row version does not advance on a label-only write"}`, to report a
provider's documented sprint exceptions. An adapter that returns
`witnesses.takesNoExceptions: true` refuses a ledger: the stabilization plan holds the
reference service to none, and its adapter says so.

Nothing outside a provider can find a Callable with no implementation or force an
operation's own failure, so an adapter may name a witness: which Callable, which arguments.
It says nothing about the answer.

```js
witnesses: {
  issuePackage: true, // discovery cannot say; see below
  callables: {
    unimplemented: "name",
    batch: { name: "reserve-room", arguments: { /* ... */ } },
    idempotentBatch: { name: "reserve-room", arguments: { /* ... */ } },
    callableError: { name: "reserve-room", arguments: { /* ... */ } },
    atomicProblem: { name: "some-atomic-batch", arguments: { /* ... */ } },
  },
}
```

With no adapter, the kit uses the tracker's own Callables as witnesses when `issue/create` is
reachable, and otherwise samples arguments from a declaration's schemas. A row with no
witness is `not-run`. Under `--scope`, all of this needs `--allow-mutation` to change anything.

A Scope has no discovery signal for the Issue package (Issue §1: a provider "MAY, but need
not, advertise Types1"). The kit takes it as served when `issue/create` is reachable, when a
record is affiliated with a package Type, or when the adapter says `issuePackage: true`.
Otherwise the package's rows are `not-applicable`.

The reference is run by `scripts/current-provider-callables-adapter.mjs`, whose operations
exist only to be witnesses. `provisionWithIssuePackage`, in the same file, adds the Issue
Types: `IC-1` and `IC-2` then fail, because the reference does not serve the 45 names.

The CLI emits one JSON report. Exit 2 means incomplete coverage (including a
successful slice); exit 1 means at least one public assertion failed; exit 3 means
an adapter, transport, initialization or cleanup failure prevented observation.
Exit 64 means invalid CLI usage; a fixed usage line goes to stderr without
reflecting supplied arguments.
There is no exit 0/full-qualification path in this initial kit. The report retains
fixed per-obligation assertion diagnostics without response values or body diffs,
so reflected credentials cannot enter assertion reports. It retains individual
failing rows even when a separate cleanup error makes the aggregate
state `harness-error`. A required `not-run`, `fail` or `harness-error` blocks
complete qualification. Prerequisite failures leave dependent cases `not-run`.

## Adapter contract

A trusted, explicitly selected local ES module exports:

```js
export async function provision({ fixture }) {
  // On a provider that advertises Write: provision one isolated canonical Scope, full
  // fixture access, and an admitted
  // Bead Type for fixture.type with properties.title string and free metadata.
  // fixture.id is an unused Scope-relative identity (no live/deleted prior identity),
  // readable with full fixture visibility; fixture.runId is unique.
  // fixture.graphSourceId, fixture.secondaryIds and fixture.linkId are also unused/admitted identities.
  // fixture.linkType admits properties.label string and free metadata.
  // fixture.aliasLeaf is an unused safe leaf under the advertised alias base.
  return {
    scope: "https://provider.example/isolated/",
    connections: [{
      origin: "https://provider.example",
      connectOrigin: "https://provider.example",
      authorization: "Bearer <owned fixture credential>"
    }],
    conditions: {
      retainedDetailWindowMs: fixture.minimumDetailWindowMs,
      graphRetainedDetailWindowMs: fixture.minimumGraphDetailWindowMs,
      unownedLinkFixture: true,
      hierarchicalAliasFixture: true
    },
    // Optional, and identities only: see "A provider without Write".
    witnesses: { deletedResourceId: "a/resource/you/deleted/natively" },
    async restart() {
      // Real service/process restart or the provider's declared admin equivalent,
      // preserving the same Scope, principal, effects and authoritative key state.
      return { connections: [/* current authorized connections */] };
    },
    async cleanup() { /* close/reap/remove only owned fixture resources */ }
  };
}
```

The runner accepts only these fields. `authorization` is optional. Origins are
explicit HTTP(S) origins without paths, fragments or embedded credentials.
`connectOrigin` routes real traffic to an explicitly authorized physical origin;
the canonical URL's path, query and Host are preserved. No redirect is followed,
no undeclared origin receives credentials, and no adapter function can return
expected values, verify a result or replace HTTP responses. The adapter can set
up the requested fixture; it is not an oracle. Extra oracle fields are refused.
The module is trusted operator code, not an untrusted plugin sandbox.

All eight distinct operation URLs are read from public discovery/directory,
without fixed path guesses. Discovery is followed through the Scope's registered
`service-desc` Link. The initial kit can select one typed matching Link or one
unambiguous candidate; ambiguous candidates are a harness limitation, not a new
protocol rule forbidding multiple Links. Add explicit connections for every
served navigation origin. This initial transport supports Authorization headers,
not every deployment-specific authentication/proxy arrangement. HTTP exchanges
have a five-second wall deadline and one-MiB response cap; fixed report diagnostics
distinguish these kit bounds from an unspecified transport failure. Hitting a kit bound is
a harness error, not proof of provider nonconformance.

`restart`, `conditions` and `witnesses` may be omitted; durability cases then remain `not-run`.
A positive integer window shorter than the requested minimum likewise leaves
durability `not-run` while allowing the non-durable cases to run. Zero, negative,
noninteger or malformed conditions are harness errors. Skip reasons distinguish
absence, a short window and elapsed time.
The lifecycle handshake is an administrative test hook, **not BDP wire**. The
adapter must really carry out its declared restart and retain the isolated
fixture's stable principal and namespace. The kit cannot independently prove an
arbitrary operator hook is honest. Its reference adapter uses actual close/reopen;
this does not substitute for an abrupt-death/failover witness.

Full original replay is checked only under the explicitly provisioned retained
**detail** window. The fixture requests at least 60 seconds. The adapter returns
that condition only if its actual setup guarantees it; do not invent a public
retention advertisement. The reference currently retains all outcomes with no
expiry administration. The kit measures from before the earliest mutation using
a monotonic clock, and refuses to qualify replay after the condition window.
Write permits unadvertised finite detail retention without a client-known window;
its omission is not a failed promise. Expired detail/tombstone tests remain open.

Hooks own their bounded completion and cleanup. The runner bounds HTTP, but does
not isolate, forcibly terminate or time out arbitrary adapter code; an adapter
that hangs inside provision/restart/cleanup requires operator cleanup. On failed
provisioning before returning a handle, the adapter must clean up its own partial
resources. The shipped adapter does so. No new general process supervisor is
claimed by this slice.

## Executable obligation map

Expected assertions are authored in `scripts/current-provider-kit.mjs`, separate
from the provider. Response admission uses the current common schema and records
its exact SHA-256 in the report. The `inputs` record also hashes the actual case
source and Core/Write prose files and records the running Node version. Provider
product identity remains unverified: the function API cannot identify an adapter
module, and helper/transitive input closure is incomplete. These hashes identify
observed local inputs; they are not a result-reuse attestation or complete
execution provenance. Adapter paths, connection URLs and credentials are not
included. Tests compare whole parsed original envelopes;
they do not impose JSON member ordering or a revision-token encoding. No HTTP
cache-directive ordering is imposed.

| Case | Public evidence | Owning rule |
| --- | --- | --- |
| `core.scope-discovery` | Successful canonical Scope GET and followed service-desc navigation | [Core discovery](../specs/profiles/core/core.md#discovery-and-capabilities) |
| `write.discovery-directory` | Closed Write discovery, matching Scope, exact eight distinct ordinary targets | [Write selection/directory](../specs/profiles/write/write.md#discover-and-select-write) |
| `write.media-before-admission` | Generic-JSON create returns schema-valid 415 unsupported-media-type; public GET confirms the explicitly unused identity remains absent before a valid same-bytes/same-key create | [Contract and media](../specs/profiles/write/write.md#contract-and-media) |
| `write.create` | Same key after the rejected media permits a complete created Bead and exact immediate replay; requested identity/affiliation, exact authored properties/metadata, opaque revision and mutation HTTP metadata | [Ordinary results](../specs/profiles/write/write.md#ordinary-results) |
| `core.point-read` | Actual GET agrees with created original envelope and Bead kind | [Resource reads](../specs/profiles/core/core.md#read-a-bead-or-link) |
| `write.no-op` | Same covered state preserves the entire envelope, changed:false | [No-ops](../specs/profiles/write/write.md#covered-state-and-no-ops) |
| `write.guard-failure` | Wrong independent revision guard gives revision-mismatch and leaves current state unchanged | [Ordinary requests](../specs/profiles/write/write.md#ordinary-requests) |
| `write.effectful-update` | Real property change changes revision and preserves untouched metadata | [Object planes](../specs/profiles/write/write.md#independent-object-planes) |
| `write.delete` | Deleted identity carries exact last live affiliation/revision | [Ordinary results](../specs/profiles/write/write.md#ordinary-results) |
| `write.restart` | Explicit adapter restart completes under the fixture window | [Durable recovery](../specs/profiles/write/write.md#atomic-durability-crash-and-capability-changes) |
| `write.durable-original-success` | Same create key returns whole original envelope after edit, deletion and restart | [Terminal outcomes](../specs/profiles/write/write.md#claims-and-terminal-outcomes) |
| `write.durable-original-failure` | Same failed guard key returns whole original Problem after later state/deletion/restart | [Terminal outcomes](../specs/profiles/write/write.md#claims-and-terminal-outcomes) |
| `write.durable-original-delete` | Same delete key returns original deleted identity after restart | [Terminal outcomes](../specs/profiles/write/write.md#claims-and-terminal-outcomes) |
| `core.deleted-absence` | Current GET remains absent after retained create replay: uniform 404 or Core-permitted authorized 410; no implicit resurrection | [Reads after deletion](../specs/profiles/core/core.md#reads-after-deletion) |
| `write.link-create` | Unowned local Link has exact authored planes and pinned endpoints; canonical GET agrees, kind is link and service-desc resolves to owning Scope | [Ordinary results](../specs/profiles/write/write.md#ordinary-results) |
| `write.link-update` | Guarded endpoint-only correction removes the replaced target pin, preserves omitted source pin/planes; equal target is a full-envelope no-op | [Endpoint correction](../specs/profiles/write/write.md#whole-link-endpoint-correction) |
| `write.alias-put` | Closed created/updated results, same-target put, repoint and original put replay; public 307 still targets the current Bead | [Aliases](../specs/profiles/write/write.md#aliases) |
| `write.alias-delete` | Closed delete result and 404 absence; alias reuse followed by old delete replay preserves the new live binding | [Terminal outcomes](../specs/profiles/write/write.md#claims-and-terminal-outcomes) |
| `write.link-delete` | Exact final-live deleted Link identity, permitted current absence and unchanged unowned endpoints | [Ordinary results](../specs/profiles/write/write.md#ordinary-results) |

These are narrow witnesses, not complete coverage of each linked section. The
report separately names required uncovered families: complete clause census;
inventory/native pagination; Link/alias reads; remaining HTTP/selection cases;
remaining Link CRUD/alias variants; remaining identity/allocation/admission/limits/numeric cases;
authorization/protected Type/owner effects; concurrency/abrupt loss/failover and
retention/erasure diagnoses. `UNCOVERED_REQUIRED` keeps them as required `not-run`
rows, preventing this vertical slice from silently becoming full qualification. The
completion calculation checks the exact independent fixed set of required IDs,
unique rows, required flags, passed states and successful lifecycle; it cannot
pass merely because a reduced subset passes. There is no waiver option, and the
coverage-audit row remains required `not-run`.
Optional Events, Types, historical-update, projection and batch have no selected
cases here (Callables has; see above); running the base slice does not qualify their advertised obligations.

The controls execute the real reference and a real HTTP intermediary that emits
a schema-valid wrong postimage. They prove the runner rejects that postimage,
missing lifecycle/retention conditions cannot pass durability, oracle fields are
refused with cleanup, primary and cleanup failures remain separate, and the
external-module CLI reports incomplete status. They are verifier controls, not
evidence that a second independent provider passed.

The media witness covers one `application/json` create refusal before key
admission. The following valid create and exact original replay use the same
key and authored JSON bytes, with public point reads confirming the one requested
identity's state. This does not qualify every 415 variant, identity admission as a
whole, or absence of all possible provider side effects. The adapter must provision
the explicitly unused identity with full read visibility; that is a fixture
condition, not an assumption about arbitrary existing provider data. A negative
control forwards the rejected request as valid media to the real reference,
actually consuming its key and creating the target, then falsely reports 415;
the runner rejects it through a public GET of that target. No internal state
oracle or production fault hook is used.

Module-loading failures use only fixed `not-found`, `syntax` or `module`
categories, never raw error messages, paths or stacks in the report. Operators
needing full loader diagnostics can import their selected module manually in an
operator-owned terminal; that output may contain sensitive paths or data and is
outside this report's redacted output. Initialization failure before an adapter
is entered leaves provisioning `not-run` and the aggregate `harness-error`.


## Unowned Link and alias fixture slice

The original fourteen Bead cases execute first, including their one controlled
restart and durable replays. A missing restart or base detail window retains its
original `not-run` outcomes without blocking the independent graph fixture. An
actual base failure prevents graph execution; a later graph failure cannot erase
base evidence. Input hashes and all eight uncovered families remain.

The five graph rows then use a **fresh third source Bead**, two target Beads and
one Link. They never refer to the original Bead, which has already been deleted.
Fresh graph work re-reads the canonical Scope, follows current service-desc and
validates the current discovery/directory and alias base. Original base-key retries
finish first using their original targets; later navigation changes never rebind
those retries. The source and targets are created through ordinary public writes after unused
identity GET 404 preconditions; no private state supplies expected records. The
shared Bead setup is only fixture provisioning. Unsupported preconditions are
`not-run`, and setup that cannot be verified is a harness limitation. An unused
Link GET 404 is independently required before its creation. All three new Bead
envelopes must remain unchanged through the unowned Link and alias observations.
After a no-op result, a fresh Link GET verifies the entire stored envelope.

`unownedLinkFixture` declares no owner for this source/Link-Type fixture. Its
absence skips only Link rows; it does not block aliases. The independent
`hierarchicalAliasFixture` declares an unused leaf beneath the advertised
in-Scope hierarchical alias base. An unsuitable base, non-unused alias GET or
first-put 404 is an unavailable fixture, not a protocol verdict or a retroactive
provisioning failure. Alias redirects and admitted absence must omit Resource
kind metadata. Link deletion can still run after an alias failure. The isolated
adapter cleanup owns remaining fixture Beads and aliases; Bead housekeeping is
not attributed to the Link-deletion obligation.

The original requested base detail window remains 60 seconds. Graph provisioning
separately requests `minimumGraphDetailWindowMs: 360000` (six minutes); an adapter
may declare `graphRetainedDetailWindowMs` only if its real setup guarantees that
window. The reference is append-only and can do so. This is an administrative
fixture budget, **not** a BDP retention advertisement or wire SLA. Missing or
short graph detail conditions leave alias rows `not-run` while Link rows can run.
Malformed graph-only conditions are harness errors after the base journey and
cannot retroactively change its outcomes or successful provisioning. The
monotonic graph clock starts before its earliest mutation, after the base
journey, so this expanded budget cannot consume the original replay window.

Each alias row checks its detail budget before any row dispatch, and every old-key
replay checks again immediately before dispatch and after observation. An already
elapsed window leaves the row and remaining alias subjourney `not-run`; expiry
while replay is in flight is a harness error. Actual long-window expiry-in-flight
was not exercised by the bounded controls; the pure readiness control checks the
boundary arithmetic without changing the runner clock or minimum. These are
same-session replays, not new crash-durability evidence. Hook containment remains
an explicit limitation.

The stable `write.remaining-five-operations` ID is intentionally retained for
report compatibility. It now names **unqualified variants**, not a claim that the
five operations are entirely unexecuted; its reason describes the narrow
witnesses. It stays required `not-run`, alongside the complete-obligation audit,
and complete Core/Write qualification remains unavailable.

Two real HTTP controls reject schema-valid wrong Link pin output and a hidden
alias replay effect. The latter changes only the upstream retry key, causing a
real fresh alias rebind, but returns captured original response bytes; a subsequent
public redirect read must expose the wrong live target. Fixture-condition and
short-window controls prevent these observations from being counted when their
prerequisites are unavailable. Additional real HTTP controls check stored no-op
state, alias kind metadata and fixture limitations while preserving all base rows.
Reports continue to use fixed redacted diagnostics.

Still unqualified: incident Link membership/directions and native pagination;
HEAD/304 and all read/negotiation failures; every malformed/admission/identity and
per-operation guard case; alias collision/authorization/nondisclosure and invalid
targets; Link retyping/attribution/owned state and atomic owner context; concurrent
claims, changed retry meaning, expiry, erasure, abrupt loss and failover. Alias
non-versioning is observed through unchanged Bead envelopes, not an unadvertised
private Events feed. These additions select no Types, History, Events or batch
cross-product and provide no provider badge or complete Core/Write qualification.
