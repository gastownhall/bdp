# Canonical commands first

Nineteen specified public command signatures own the wire variants below. These are design signatures, not a claim of shipped commands or nineteen generated SDK methods. The 35 wire signature families contain 26 GETs, their 26 HEAD counterparts and nine POSTs; options and transport forms do not add public commands.

| Canonical command | Wire signature variants |
| --- | --- |
| `bd create` | `createBead` |
| `bd show` | `currentBead`, `historicalBead`, `beadProperties`, `projectedBead`, `projectedHistoricalBead`, `beadAggregate` |
| `bd update` | `updateBead` |
| `bd delete` | `deleteBead` |
| `bd list` | `beadInventory`, `projectedBeadInventory` |
| `bd versions` | `beadVersions` |
| `bd link create` | `createLink` |
| `bd link show` | `currentLink`, `historicalLink`, `linkProperties`, `projectedLink`, `projectedHistoricalLink` |
| `bd link update` | `updateLink` |
| `bd link delete` | `deleteLink` |
| `bd link list` | `linkInventory`, `projectedLinkInventory`, `incidentLinks` |
| `bd link versions` | `linkVersions` |
| `bd events` | `scopeEvents`, `beadEvents` |
| `bd link events` | `linkEvents` |
| `bd scope inspect` | `discovery` |
| `bd alias resolve` | `aliasResolve` |
| `bd alias put` | `putAlias` |
| `bd alias delete` | `deleteAlias` |
| `bd batch` | `atomicBatch` |

Scope landing and the Write directory are shared transport setup. Discovery also serves scope inspect. Exact-definition lookup is a selected interpreter operation whose public Type CLI remains deferred. HEAD and paging remain mechanics of the selected read.

[Command/wire exceptions and completion gaps](../../docs/cli-design/wire-correspondence.md) distinguish portable direct operations from host adapters, request composition and unfinished feature correspondence. [Wire coverage](coverage.md) retains all validation cases. Rooted allocation selects id-root1 on existing create/batch routes; it adds no public command or endpoint. Service-side Type default pinning requires no client definition prefetch.
