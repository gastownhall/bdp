# Ordinary reference server startup

`bdptest --serve --config /absolute/startup.json` can start the reference
Read+Update or Transactional implementation through the same installed executable
used for Read. Select a profile and a trusted deployment file explicitly. These
reference servers are qualification targets: startup reports `claimEligible:
false` and does not certify the cumulative conformance surface.

`bdpbd` continues to use the bd adapter and its admitted Read composition. This
path does not give that adapter reference SQLite behavior or Write guarantees.

Use Node 24.16.0 and pnpm 11.20.0 from the workspace toolchain. Build with
`pnpm install --frozen-lockfile --ignore-scripts` followed by `pnpm build`.
The executable artifacts are `apps/bdptest/dist/main.js` and, when packed and
installed, the `bdptest` bin supplied by `@bdp/bdptest`.

## Transactional example

Provision a private local store directory before starting. Replace the paths,
port, token, and contract identifiers below for the selected deployment. The
Scope must be the canonical URL of this listener, ending in `/`.

`startup.json`:

```json
{
  "scope": { "url": "http://127.0.0.1:8123/acme/" },
  "server": {
    "host": "127.0.0.1",
    "port": 8123,
    "advertisedProfile": "transactional",
    "limits": {
      "page": { "defaultItems": 2, "maximumItems": 32 },
      "selector": { "bytes": 4096, "depth": 32, "nodes": 256 },
      "cursorTtlMilliseconds": 1000
    }
  },
  "bdptest": { "deploymentFile": "/absolute/deployment.json" }
}
```

`deployment.json` is trusted configuration containing credentials. Keep it
private (for example, mode `0600`); do not put real tokens in source control.
Artifact `utf8` values are complete JSON documents, not filenames or URLs to
fetch. Their identifiers and retrieval locations must satisfy the reference
artifact admission rules.

```json
{
  "format": "bdptest-reference-deployment-1",
  "profile": "transactional",
  "configuration": {
    "directory": "/absolute/private-store",
    "create": true,
    "credentials": [
      { "token": "replace-with-private-token", "principal": "writer", "canMutate": true }
    ],
    "artifacts": {
      "descriptors": [
        {
          "retrievalUri": "http://127.0.0.1:8123/acme/types/bead",
          "utf8": "{\"id\":\"http://127.0.0.1:8123/acme/types/bead\",\"name\":\"Bead\",\"describes\":\"bead\",\"conformsTo\":[],\"propertiesSchema\":\"http://127.0.0.1:8123/acme/schemas/n\"}"
        }
      ],
      "schemas": [
        {
          "retrievalUri": "http://127.0.0.1:8123/acme/schemas/n",
          "utf8": "{\"$id\":\"http://127.0.0.1:8123/acme/schemas/n\",\"type\":\"object\",\"properties\":{\"n\":{\"type\":\"integer\"}},\"additionalProperties\":false}"
        }
      ]
    }
  }
}
```

Start with `node apps/bdptest/dist/main.js --serve --config /absolute/startup.json`
from a built workspace, or `bdptest --serve --config /absolute/startup.json`
from a local package installation. The environment alternative for the
deployment path is `BDP_BDPTEST_DEPLOYMENT_FILE`; normal shared-config precedence
applies. SIGINT or SIGTERM closes the listener and owned store. A preparation or
startup failure exits 2 with a sanitized diagnostic; neither credentials nor
deployment-content digests appear in CLI diagnostics.

## Read+Update differences

Set both profile fields to `read-update`. Its captured limits are page
`20/100`, Selector `4096/32/256`, and cursor lifetime `60000` milliseconds.
Use this configuration shape, with the same complete artifact documents as above:

```json
{
  "directory": "/absolute/private-store",
  "create": true,
  "credentials": [{ "token": "replace-with-private-token", "principal": "writer" }],
  "policies": {
    "writer": { "create": true, "write": true, "hidden": [], "readOnly": [] }
  },
  "contracts": { "descriptors": [], "schemas": [] },
  "maximumEndpointMultiplicity": []
}
```

Empty RU contract arrays select the shipped reference contract closure; provide
the explicit descriptor/schema arrays when selecting a custom closure. These
prepared implementations require their captured limits exactly; changing only
the advertised limits is refused. TX is currently IPv4 loopback; RU also accepts
IPv6 loopback. Port zero and internal fault controls are refused.

Without `--serve`, configuration loading runs lifecycle mode and does not open
the deployment file. Supplying a higher profile without a deployment file does
not bypass the ordinary Read admission boundary.

## Cold discovery and qualification

Authenticate the Scope request and follow its `service-desc` Link to the Scope
descriptor. Resolve the operations and Types locations against that descriptor;
resolve each operation URL against the operations directory URL. Use the
discovered Type identifier and collection URL to construct resource requests.
Mutation JSON is the command body itself; its idempotency key is the
`idempotency-key` HTTP header.

The new `reference-startup-cli.test.ts` observes this installed HTTP path through
Scope, descriptor, operations directory, Types, create, and resource GET for
both profiles. It also checks missing-file refusal, credential redaction,
no-serve behavior, and clean shutdown. It is focused startup evidence, not a
complete conformance run. The reusable `@bdp/conformance` artifact/matrix runner
still needs the complete selected cumulative coverage and actual installed
target binding before a profile conformance claim can be made.
