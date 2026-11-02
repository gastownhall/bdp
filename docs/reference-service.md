# Canonical draft reference API

The specification baseline is PR337/main0bf00889. Reference implementation
qualification is recorded in [PR338](https://github.com/gastownhall/bdp/pull/338);
source/build success alone is not a completed conformance claim. This API selects
ordinary Core and the eight singleton Write operations. Events,
Types, History, projection, Transfer and batch are unadvertised and explicitly
unsupported. Ordinary Type-definition Beads remain generic Bead records.

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
