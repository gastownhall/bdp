# BDP profile implementation progress

## First mutable reference slice

`bdptest-development` is a separate, explicitly non-attesting executable over the
existing Node/TypeScript runtime. It exercises six singleton Resource operations
and shared live reads using durable SQLite storage, the existing Resource/member
evaluators and the Read/sequence lifecycle. Normal `bdptest` and `bdpbd` admission
remain unchanged. The new `@bdp/server/development` subpath exposes only a bounded
development composition, not the private evaluators or storage handles.

The development server binds only `127.0.0.1`, requires an explicit bearer token,
checks Host, refuses browser Origin requests, bounds body/header receiving, and
uses a single fixed local-operator principal for idempotency. Resource
`attribution.basis` remains carried data and is independent of that credential.
There is no public authority/authentication policy claim.

### Run it

With the repository-pinned Node 24.16.0 and pnpm 11.20.0:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm smoke:development
```

The smoke creates a temporary configuration/store, launches the emitted executable,
uses the actual SDK Fetch transport, stops and starts a new process at the same
Scope, checks retained replay, then removes its own store. It reports each stage
and ends with `PASS` and `claimEligible: false`. This is executable observation,
not a fixture-only or conformance claim.

For manual experimentation, save a private JSON file with exactly these fields:

```json
{
  "directory": "/absolute/path/to/a-new-development-store",
  "port": 8765,
  "create": true,
  "token": "replace_with_32_or_more_random_base64url_characters"
}
```

Run `node apps/bdptest/dist/development-main.js /path/to/config.json`. Readiness
reports the actual Scope URL. `port: 0` selects a port for first provisioning;
reopen with its exact reported port and `create: false`. A missing store never
triggers an inferred reseed; attempting `create: true` against an existing store
fails. Copy/restore and arbitrary prepopulated databases are not supported.

The fixed generic Types are `https://bdp.example/development/bead` and
`https://bdp.example/development/link`. They have unconstrained object properties,
no ownership declarations and no property schema. Exact installed descriptor
bytes and current Resource Type membership are checked on startup, as are the
existing runtime compatibility bounds. This installs a closed reference contract
set; it does not finish the general user-Type/schema installer.

Singleton requests go to `/development/create-bead`, `update-bead`, `delete-bead`,
`create-link`, `update-link`, and `delete-link`, with `Content-Type:
application/json`, `Authorization: Bearer ...` and `Idempotency-Key`. Request and
mutation-result bodies use the current Read+Update model, including metadata and
`attribution.basis`. Point/collection reads use `/beads/`, `/links/` and `/types/`
and their Resource paths. The root is an informational development document with
`claimEligible: false`, not BDP discovery; it emits no `service-desc` link or
Read+Update profile token. The high-level SDK correctly refuses to discover a
qualified profile here. The SDK's real Fetch transport can use the explicit URLs.

### What the executable observations establish

- Bead create → live read → guarded update → live read → delete → missing read.
- Metadata and properties change atomically; metadata-only Link edits preserve
  properties; carried writer attribution preserves `basis`.
- A successful exact-key retry returns its retained result, conflicting key reuse
  fails, and a stale guard fails without changing the live Resource.
- Semantic no-ops preserve revision. Bead deletion with a live Link fails atomically.
- A new process reads persisted state and replays a pre-restart result. Deleted
  identities remain unavailable for reuse; deletion replay works.
- Missing/wrong credentials, browser Origin, duplicate keys, malformed JSON and
  oversized input are refused before mutation/key capture.
- Explicit provisioning, refusal to reseed, close/reopen and bounded subprocess
  cleanup. Existing component tests separately exercise crash/recovery internals;
  this new process smoke tests graceful restart, not power-loss durability.

### Deliberate gaps before Read+Update admission

No aliases or sequence receiver, full HTTP conditional/HEAD/CORS negotiation,
production identity/policy engine, complete installed schema engine, generalized
startup/restore qualification or write conformance evidence is claimed. Receiving
failures currently use generic RFC9457 Problems, while evaluated mutation failures
use BDP Problems. The receiver must obtain the full BDP status/Problem/negotiation
contract before profile admission. No discovery claim is manufactured to make the
high-level client accept this incomplete receiver.

The exact fixed-Type development composition and its private runtime bounds do
not establish arbitrary callbacks, schemas, retained populations, workload bounds,
concurrent external database writers, or authenticated multi-user behavior.
Neither Events nor epoch/snapshot replication are added to the Read profile.
Existing internal pagination invalidation remains in the shared Read component.

## Next slices

1. Complete the receiving/authority path for all eight singleton operations and
   sequences; align startup installation and advertised/enforced bounds; bind the
   Read+Update catalog to executable observations. Keep the two target capability
   claims separate: `bdpbd` still needs native guard/atomicity evidence from its
   CLI crosswalk.
2. For Transactional, add a separate atomic batch owner/store boundary. Reuse the
   Resource evaluator's transaction interface; do **not** implement batch by
   repeatedly calling `executeMember`, because that commits each member and
   retains separate Read+Update outcomes. The first transaction slice should
   create a Bead and Link with a local reference, commit both plus one receipt and
   ordered change group together, and prove rollback when the final operation
   fails. Then add pending admission/recovery and replay before widening to set
   operations, projections, erasure, snapshots and full catalog coverage.
3. The current Read+Update and Transactional idempotency laws differ; a shared
   Resource evaluation seam does not make their key-state machines interchangeable.
   Editorial staging should make those overrides explicit. Vickie's event
   enrichment proposals remain unresolved design inputs, not implementation law.

No normative spec edits, CLI implementation, shared database access, merges or
profile capability/evidence marker changes are part of this slice.
