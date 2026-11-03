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
stage. `sliceComplete` is separately true only when all 14 executable cases and
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

The CLI emits one JSON report. Exit 2 means incomplete coverage (including a
successful slice); exit 1 means at least one public assertion failed; exit 3 means
an adapter, transport, initialization or cleanup failure prevented observation.
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
  // Provision one isolated canonical Scope, full fixture access, and an admitted
  // Bead Type for fixture.type with properties.title string and free metadata.
  // fixture.id is an unused Scope-relative identity (no live/deleted prior identity),
  // readable with full fixture visibility; fixture.runId is unique.
  return {
    scope: "https://provider.example/isolated/",
    connections: [{
      origin: "https://provider.example",
      connectOrigin: "https://provider.example",
      authorization: "Bearer <owned fixture credential>"
    }],
    conditions: { retainedDetailWindowMs: fixture.minimumDetailWindowMs },
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
have a five-second wall deadline and one-MiB response cap; hitting a kit bound is
a harness error, not proof of provider nonconformance.

`restart` and `conditions` may be omitted; durability cases then remain `not-run`.
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

These are narrow witnesses, not complete coverage of each linked section. The
report separately names required uncovered families: complete clause census;
inventory/native pagination; Link/alias reads; remaining HTTP/selection cases;
Link CRUD/alias mutation; remaining identity/allocation/admission/limits/numeric cases;
authorization/protected Type/owner effects; concurrency/abrupt loss/failover and
retention/erasure diagnoses. `UNCOVERED_REQUIRED` keeps them as required `not-run`
rows, preventing this vertical slice from silently becoming full qualification.
Optional Events, Types, historical-update, projection and batch have no selected
cases here; running the base slice does not qualify their advertised obligations.

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
