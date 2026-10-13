/** Response-only counterfactuals travel through a real socket and exact decoder. */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import {
  createRawHttpScenarioTarget,
  createRawHttpExchangeExecutor,
  runConformanceMatrix,
  createJsonSchemaValidator,
  type ExactHttpModeOptions,
} from "@bdp/conformance";
import {
  createCumulativeReadUpdateArtifactBundle,
  loadProfileContractSelection,
} from "@bdp/conformance/testing";
import { seedInstalledReadFixture } from "../test-support/installed-read-fixture.js";
import schema from "../../../schemas/bdp-v0.schema.json" with { type: "json" };
const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry =
  process.env.BDP_CUMULATIVE_INSTALLED_ENTRY ??
  path.join(root, "packages/server/dist/installed-reference-process.js");
const helpers = (await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
)) as {
  availablePort(): Promise<number>;
  referenceConfiguration(directory: string, port: number, token: string, scope: string): unknown;
  launchInstalledReference(entry: string, config: unknown): Promise<{ close(): Promise<unknown> }>;
};
const source = (relative: string) => ({ bytes: readFileSync(path.join(root, relative)) });
const bundle = createCumulativeReadUpdateArtifactBundle(
  loadProfileContractSelection("read-update"),
  {
    manifest: source("packages/conformance/matrices/read-update-v1.json"),
    fixture: source("packages/conformance/fixtures/read-update-reference-v1.json"),
  },
);
const scope = "https://reference.invalid/acme/";
const token = "read_oracle_counterfactual_01234567890123456789";
const cases = [
  ["beads", "unchanged"],
  ["beads", "swapped-title"],
  ["beads", "missing-open-property"],
  ["beads", "wrong-metadata"],
  ["beads", "wrong-type"],
  ["types", "unchanged"],
  ["types", "wrong-name"],
  ["types", "wrong-describes"],
] as const;

it.each(cases)(
  "checks actual %s collection response: %s",
  async (collection, mutation) => {
    const id = collection === "beads" ? "read.collections.beads" : "read.types.inventory";
    const dir = mkdtempSync(path.join(tmpdir(), "bdp-read-oracle-"));
    const port = await helpers.availablePort();
    const config = helpers.referenceConfiguration(dir, port, token, scope);
    const child = await helpers.launchInstalledReference(entry, config);
    let target: ReturnType<typeof createRawHttpScenarioTarget> | undefined;
    let changed = 0;
    // Forward actual authority bytes; alter only the selected collection response.
    // Exact response decoding must therefore see these bytes on the actual socket.
    const proxy = createServer((request, response) => {
      const upstream = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: request.url,
          method: request.method,
          headers: request.headers,
        },
        (received) => {
          let text = "";
          received.setEncoding("utf8");
          received.on("error", (error) => response.destroy(error));
          received.on("data", (chunk) => {
            text += chunk;
          });
          received.on("end", () => {
            if (request.url === `/acme/${collection}/` && received.statusCode === 200) {
              const body = JSON.parse(text) as {
                items: {
                  properties: Record<string, unknown>;
                  metadata: unknown;
                  type: string;
                  name: string;
                  describes: string;
                }[];
              };
              for (const item of body.items) {
                if (mutation === "swapped-title")
                  item.properties.title = item.properties.title === "a" ? "z" : "a";
                if (mutation === "missing-open-property") delete item.properties.open;
                if (mutation === "wrong-metadata") item.metadata = { unstored: true };
                if (mutation === "wrong-type") item.type = `${scope}types/bug`;
                if (mutation === "wrong-name") item.name = "wrong inventory name";
                if (mutation === "wrong-describes")
                  item.describes = item.describes === "bead" ? "link" : "bead";
              }
              text = JSON.stringify(body);
              changed += 1;
            }
            const headers = { ...received.headers, "content-length": Buffer.byteLength(text) };
            delete headers["transfer-encoding"];
            response.writeHead(received.statusCode ?? 502, headers);
            response.end(text);
          });
        },
      );
      upstream.on("error", (error) => response.destroy(error));
      upstream.setTimeout(5000, () => upstream.destroy(Error("oracle upstream deadline")));
      request.pipe(upstream);
    });
    try {
      proxy.listen(0, "127.0.0.1");
      await once(proxy, "listening");
      const address = proxy.address();
      if (!address || typeof address === "string") throw Error("proxy address missing");
      const exactMode: ExactHttpModeOptions = {
        scope,
        profile: "read-update",
        maximumRequestBodyBytes: 65536,
        maximumRequestHeaderBytes: 16384,
        routes: [
          ...["", "bdp.json", `${collection}/`].map((suffix) => ({
            method: "GET" as const,
            url: scope + suffix,
          })),
          ...["bead", "link"].map((kind) => ({
            method: "POST" as const,
            url: `${scope}operations/create-${kind}`,
          })),
        ],
        defaultCredentialRef: "operator",
        credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
        resolveCredentials: () => ({ authorization: `Bearer ${token}` }),
      };
      if (collection === "beads") {
        const seed: unknown[] = [];
        await seedInstalledReadFixture(
          bundle.fixture,
          scope,
          createRawHttpExchangeExecutor(
            { transport: "plain", host: "127.0.0.1", port },
            { exactMode },
          ),
          AbortSignal.timeout(10000),
          (observation) => seed.push(observation),
        );
        expect(seed).toHaveLength(4);
      }
      target = createRawHttpScenarioTarget(
        async () => ({
          capabilities: bundle.fixture.capabilities,
          bindings: bundle.fixture.bindings,
          dialRoute: { transport: "plain", host: "127.0.0.1", port: address.port },
          close: async () => {},
        }),
        { exactMode, requestTimeoutMs: 5000 },
      );
      if (!target.exactConfiguration) throw Error("exact target configuration missing");
      const execute = target.execute;
      const result = await runConformanceMatrix({
        declaredTargetLabel: "installed-read-response-counterfactual",
        scope,
        profile: "read-update",
        seed: 0,
        artifactBundle: bundle,
        scenarioSelection: ["read.discovery.scope-service-desc", id],
        execute,
        exactExecution: { execute, configuration: target.exactConfiguration },
        harness: target.harness,
        schemaValidator: createJsonSchemaValidator(schema),
      });
      expect(changed).toBe(1);
      expect(result.scenarios[0]?.state).toBe("pass");
      const row = result.scenarios.find((row) => row.id === id);
      expect(row?.state).toBe(mutation === "unchanged" ? "pass" : "fail");
      const failures = row?.exchanges.flatMap((exchange) =>
        exchange.assertions
          .filter((assertion) => !assertion.passed)
          .map((assertion) => assertion.id),
      );
      expect(failures).toEqual(
        mutation === "unchanged"
          ? []
          : [collection === "beads" ? "fixture-bead-records" : "fixture-type-summaries"],
      );
      expect(result.claimEligible).toBe(false);
    } finally {
      await target?.close();
      if (proxy.listening)
        await new Promise<void>((resolve) => {
          proxy.close(() => resolve());
          proxy.closeAllConnections();
        });
      await child.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  15000,
);
