/** Response-only counterfactuals travel through a real socket and exact decoder. */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
import { withSchemaCohort } from "../test-support/installed-schema-cohort.js";
import { installedObservationSchema } from "../test-support/installed-body-schema.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry =
  process.env.BDP_CUMULATIVE_INSTALLED_ENTRY ??
  path.join(root, "packages/server/dist/installed-reference-process.js");
const helpers = (await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
)) as {
  availablePort(): Promise<number>;
  referenceConfiguration(
    directory: string,
    port: number,
    token: string,
    scope: string,
  ): Record<string, unknown>;
  launchInstalledReference(entry: string, config: unknown): Promise<{ close(): Promise<unknown> }>;
};
const configModule = (await import(
  pathToFileURL(path.join(path.dirname(entry), "installed-reference-configuration.js")).href
)) as { referenceTypeArtifacts(scope: string): import("@bdp/protocol").TypeDescriptor[] };
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
  ["beads", "embedded-links"],
  ["types", "unchanged"],
  ["types", "wrong-name"],
  ["types", "wrong-describes"],
  ["resource", "unchanged"],
  ["resource", "embedded-links"],
] as const;

it.each(cases)(
  "checks actual %s collection response: %s",
  async (collection, mutation) => {
    const id =
      collection === "beads"
        ? "read.collections.beads"
        : collection === "types"
          ? "read.types.inventory"
          : "read.resource.default-bounded";
    const suffix = collection === "resource" ? "beads/read-a" : `${collection}/`;
    const port = await helpers.availablePort();
    const dir = mkdtempSync(path.join(tmpdir(), "bdp-read-oracle-"));
    let child: Awaited<ReturnType<typeof helpers.launchInstalledReference>> | undefined;
    let target: ReturnType<typeof createRawHttpScenarioTarget> | undefined;
    let changed = 0;
    // Forward authority values; selected JSON responses are reserialized with
    // recomputed framing. This proves assertion sensitivity over real sockets,
    // not octet-transparent forwarding of the original authority response.
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
            try {
              if (request.url === `/acme/${suffix}` && received.statusCode === 200) {
                const body = JSON.parse(text) as {
                  items: {
                    properties: Record<string, unknown>;
                    metadata: unknown;
                    type: string;
                    name: string;
                    describes: string;
                  }[];
                };
                if (mutation === "embedded-links" && collection === "resource")
                  Object.assign(body, { links: { items: [], next: null } });
                for (const item of body.items ?? []) {
                  if (mutation === "embedded-links")
                    Object.assign(item, { links: { items: [], next: null } });
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
              const headers = { ...received.headers };
              delete headers["transfer-encoding"];
              if (received.statusCode === 204 || received.statusCode === 304)
                delete headers["content-length"];
              else headers["content-length"] = String(Buffer.byteLength(text));
              response.writeHead(received.statusCode ?? 502, headers);
              response.end(text);
            } catch {
              if (!response.headersSent)
                response.writeHead(502, { "content-type": "application/json" });
              response.end(JSON.stringify({ error: "counterfactual proxy failed" }));
            }
          });
        },
      );
      upstream.on("error", (error) => response.destroy(error));
      upstream.setTimeout(5000, () => upstream.destroy(Error("oracle upstream deadline")));
      request.pipe(upstream);
    });
    try {
      const config = withSchemaCohort(
        helpers.referenceConfiguration(dir, port, token, scope),
        configModule.referenceTypeArtifacts(scope),
      );
      child = await helpers.launchInstalledReference(entry, config);
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
          ...["", "bdp.json", suffix].map((suffix) => ({
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
      if (collection !== "types") {
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
        schemaValidator: createJsonSchemaValidator(installedObservationSchema),
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
          : mutation === "embedded-links" && collection === "beads"
            ? ["no-embedded-links-0", "no-embedded-links-1"]
            : [
                collection === "beads"
                  ? "fixture-bead-records"
                  : collection === "types"
                    ? "fixture-type-summaries"
                    : "no-embedded-links",
              ],
      );
      expect(result.claimEligible).toBe(false);
    } finally {
      await target?.close();
      if (proxy.listening)
        await new Promise<void>((resolve) => {
          proxy.close(() => resolve());
          proxy.closeAllConnections();
        });
      await child?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  15000,
);
