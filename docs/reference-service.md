# Canonical draft reference API

The specification baseline is PR337/main0bf00889. Reference implementation
qualification is recorded in [PR338](https://github.com/gastownhall/bdp/pull/338);
source/build success alone is not a completed conformance claim. This API selects
ordinary Core and the eight singleton Write operations. Events,
Types, full History, projection and Transfer are unadvertised and explicitly
unsupported. Batch and historical Update are separate opt-in compositions below;
neither is selected by default. Ordinary Type-definition Beads remain generic
Bead records.

Use repository-pinned Node24.22.1 and pnpm11.20.0, install with the frozen lockfile,
and build normally. The entry is `@bdp/server/reference`; it does not change the
legacy CLI startup commands or install a global service.

```ts
import { startReferenceService } from "@bdp/server/reference";

const token = process.env.MY_REFERENCE_TOKEN;
if (token === undefined) throw new Error("MY_REFERENCE_TOKEN is required");
const service = await startReferenceService({
  directory: "/absolute/path/to/an/owned/empty/directory",
  create: true,
  instance: "my-reference-instance",
  scope: "https://records.example/acme/",
  credentials: [{ token, principal: "operator" }],
});
// Explicitly route this canonical Scope to service.listenUrl using your proxy.
// On shutdown: await service.close().
```

The reference Scope URL has a4096-byte configuration bound. Supply a32–256-character URL-safe secret token; no credential is generated or
installed implicitly. Every configured principal has complete access to this
Scope. The listener binds an ephemeral loopback port; advertised canonical HTTPS
navigation is independent of that private transport address. This module does
not configure TLS or a reverse proxy. The deployment owns that explicit mapping.

Creation requires an empty owned directory. Reopen with `create:false`, the same
directory/instance/Scope and selected configuration. Refusal never resets or
migrates a store. Existing private-fixture stores have different captured policy
and cannot silently become this composition. The SQLite engine retains identities,
durable outcomes and exact saved responses across reopen. Ordinary read cursors
are process-local and expire rather than restart after reopen.

Default navigation is `bdp` for discovery, `bdp/beads` and `bdp/links` for inventories,
and discovered `bdp/operations` targets for Write. The `bdp` control namespace is
reserved against Resource/alias collisions; Resource IDs otherwise share one
kind-independent space. Clients follow discovery and never derive identity from
an inventory prefix.

`RetainedClient` follows the selected discovery, exposes point full/properties
reads, `list`, `incident`, `readPage`, redirect-only `resolveAlias`, `bindWrite` and
`submit`. Each page call returns one native page and its actual next; it does not
overfetch or flatten. Pass an issued next URL unchanged to `readPage`. Ordinary
Core permits replacing only its `limit` value; all other issued bytes must remain.
Every actual target still passes the caller’s explicit network and per-target
credential policy. Alias resolution never follows the redirect or forwards a
credential to its target.

The original `BdpClient`, legacy adapter/CLI startup and historical conformance
catalogs keep their own contracts and evidence. They are not interchangeable with
this API. See the [alignment plan](spec-review/reference-alignment.md) for current
verification limits and [historical accounting](spec-review/historical-alignment.md).

The service advertises its100-item default/1000-item maximum page,8192-byte
Selector bound,512KiB request-target and64KiB mutation-body bounds, and five-minute
maximum snapshot lifetime. Framing allows1MiB so committed Resource identities
remain readable; complete records/results retain their existing262144-byte bound.
An inventory observation scans at most32MiB of serialized records before JSON
materialization and retains at most32MiB/one million JSON positions across active
snapshots. Genuine hard observation limits give413; temporary retained-capacity
pressure gives503. No partial inventory is presented as exhaustion.

Snapshot admission can temporarily hold one additional bounded copy before
checking aggregate capacity: at most64MiB of snapshot-copy weight, in addition
to the bounded32MiB input scan and ordinary object overhead. The32MiB retained
budget is Scope-wide; principals share it, so another caller can temporarily
receive503 until snapshots expire. These are resource bounds, not RSS limits.
## Canonical CLI increment

The reference `bdp` executable defaults to the canonical CLI profile. Use
`--cli-profile compat` or startup configuration `{"cli":{"profile":"compat"}}`
to select the retained compatibility surface. The parser and grouped `--help`
output use the same Commander command definitions. The only imported product
global is `--actor`, admitted as provenance on the five operations that support
it; it is never authentication. Other product globals are not registered.

```sh
pnpm test:cli
bdp --scope https://work.example/team/ scope inspect --output-format json
bdp --scope https://work.example/team/ create --type https://types.example/Note --id note
bdp --scope https://work.example/team/ show note
```

The current increment connects ordinary Core reads, eight singleton Write
operations, lossless inputs, property masks, native paging, deletion previews,
member emission, request previews and frozen same-key retries. Atomic batch
submission is a separate pending client integration. Optional Events, History,
Types interpretation and native Resource projection are not qualified by these
tests. A changed credential is conservatively refused on retry because this
executable has no authenticated principal-discovery contract; this does not claim
same-principal credential-rotation support.

`pnpm test:cli` builds and runs a small Node black-box suite against the actual
emitted executable, an HTTP capture proxy, the reference service and an isolated
SQLite directory. It does not inherit Vitest's historical admission mock. Pure
parser, input and rendering tests remain ordinary Vitest tests. Original authored
CLI fixtures remain historical inputs, not executable acceptance results.

Keep the conformance runner's raw HTTP, bounds and report kernel for independent
implementations. Current-contract wire assertions and reference regressions need
separate subjects from installed legacy/private profile matrices. Existing matrix
assertions remain intact until each has an explicit replacement or retained lane;
this increment removes no test or CI gate and adds no testing framework.

## Optional historical Update and same-ID recovery

For a fresh store, `historicalUpdate: true` selects the optional version1
historical-update capability. It retains body-free deletion versions and exact
editable content sources. Reopening requires the same explicit option and captured
configuration. This fresh format7 composition does not migrate formats5/6 or
open an old private store by guessing its format number.

An explicitly batch-enabled fresh store uses `atomicBatch: true` and format6.
The initial reference refuses `atomicBatch: true` together with
`historicalUpdate: true` before provisioning. Default ordinary stores retain
format5. These are reference storage choices, not protocol identities or a
requirement on Beads storage.

`update --from-revision` selects a historical editable content base, then applies
explicit edits. The source revision, actual current predecessor and optional
current guard are independent. Current Type and protected state remain
authoritative. Deleted-to-live recovery creates a fresh live version under the
same identity; it never revives deleted Links or upserts an unknown identity.
The exact complete editable source content consumed must be authorized and
available; unused historical owned-Link structure is not required. A live no-op
preserves its entire old record and historical context.

The canonical executable accepts `--from-revision =TOKEN` and the product alias
`--from_revision`. Numeric ordinals require an authoritative product adapter;
this reference has no ordinal mapping and refuses them before dispatch. The
initial CLI refuses historical `--dry-run-mode batch` rather than emitting an
unsupported executable composition. Request preview and frozen same-key retry
remain supported. Human rendering shows the Resource; JSON output carries the
explicit historical result/context wrapper.

Create the SDK client with both ordinary and historical-update transports.
`readHistoricalUpdate(absoluteBeadUri, {terminal: true, scope})` obtains the
current authorized deletion version D; the same method without `terminal`
selects the live feature view and its retained source/predecessor context.
Ordinary GET remains404 while deleted. A terminal version is not a live content
source. Use the genuine D as an independent current guard when recovering from
an earlier live source R1; the result has a new live revision R8 and context
identifying source R1 and actual predecessor D.

The capability uses explicit feature media for requests/results/views. Ordinary
Resource representations stay closed and unchanged. A lost response remains
unknown until the saved invocation is retried with the same body, headers and
key; the executable journal preserves those values across restart.

This reference is append-only and provides no source-pruning, administrative
erasure, partial-disclosure policy, full History or Events interface. Its current
principals have whole-Scope access. Retained-index corruption is an invariant
failure, not invented evidence that historical content was lawfully pruned.
Tests of unknown sources, rollback, reopen and corruption do not qualify a
pruning/erasure lifecycle or the unselected full History/Events composition.

The [inventory disposition index](plans/inventory-dispositions-20261102.md)
retains historical requirements and remaining test work. Current qualification
receipts must identify the actual source/build/configuration; this API document
alone is not conformance evidence.
