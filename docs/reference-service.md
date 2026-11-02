# Canonical draft reference API

The specification baseline is337/main0bf00889. The reference implementation is
being qualified in338; source/build success alone is not a completed conformance
claim. It selects ordinary Core and the eight singleton Write operations. Events,
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

Supply a32–256-character URL-safe secret token; no credential is generated or
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
