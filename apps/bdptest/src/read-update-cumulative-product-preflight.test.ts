/** New source/configuration preflight only: no installed server or qualification run. */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createReadUpdateArtifactSet,
  loadProfileContractSelection,
} from "@bdp/conformance/testing";
import type { TypeDescriptor } from "@bdp/protocol";
import { expect, it } from "vitest";
import { createCumulativeRUClient } from "../test-support/read-update-cumulative-product-client.js";
import {
  cumulativeRUConfiguration,
  type RUCampaignCredentials,
} from "../test-support/read-update-cumulative-product-configuration.js";
import { cumulativeRUObservationSchema } from "../test-support/read-update-cumulative-product-schema.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const source = (relative: string) => ({ bytes: readFileSync(path.join(root, relative)) });
const runtime = (await import(
  pathToFileURL(path.join(root, "packages/server/dist/installed-reference-configuration.js")).href
)) as {
  referenceTypeArtifacts(scope: string): TypeDescriptor[];
  captureInstalledReferenceConfiguration(value: unknown): {
    identity: string;
    artifactIdentity: string;
    policyIdentity: string;
    authenticationIdentity: string;
    profile: "read-update";
    history: false;
  };
};
function measure(bytes: Uint8Array) {
  const stack = [{ value: JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown, depth: 0 }];
  let nodes = 0,
    maximumDepth = 0,
    maximumContainer = 0;
  while (stack.length) {
    const item = stack.pop()!;
    nodes++;
    maximumDepth = Math.max(maximumDepth, item.depth);
    if (item.value !== null && typeof item.value === "object") {
      const children = Object.values(item.value);
      maximumContainer = Math.max(maximumContainer, children.length);
      stack.push(...children.map((value) => ({ value, depth: item.depth + 1 })));
    }
  }
  return {
    bytes: bytes.byteLength,
    nodes,
    maximumDepth,
    maximumContainer,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
it.skipIf(
  !process.env.BDP_RU_CUMULATIVE_PREFLIGHT_OUTPUT || !process.env.BDP_RU_CUMULATIVE_CREDENTIALS,
)(
  "preflights every required predicate, two unchanged donor shards and the fixed actual RU configuration",
  () => {
    const output = process.env.BDP_RU_CUMULATIVE_PREFLIGHT_OUTPUT;
    const credentialFile = process.env.BDP_RU_CUMULATIVE_CREDENTIALS;
    if (!output || !credentialFile)
      throw Error("explicit fresh output and campaign credentials required");
    const credentials = JSON.parse(readFileSync(credentialFile, "utf8")) as RUCampaignCredentials;
    const selection = loadProfileContractSelection("read-update");
    const requirements = JSON.parse(
      source(
        "apps/bdptest/test-support/read-update-cumulative-product-requirements.json",
      ).bytes.toString(),
    );
    expect(selection.required).toHaveLength(130);
    expect(requirements.rows.map((r: { id: string }) => r.id)).toEqual(
      selection.required.map((r) => r.id),
    );
    for (const row of selection.required)
      expect(requirements.rows.find((r: { id: string }) => r.id === row.id).requirements).toEqual(
        row.requirements,
      );
    expect(selection.retiredIds).toEqual(["read.discovery.document"]);
    const oldBase = "packages/conformance/";
    const manifests = {
      "matrices/read-update-v1.json": source(`${oldBase}matrices/read-update-v1.json`),
      "matrices/read-update-reference-continuation-v1.json": source(
        `${oldBase}matrices/read-update-reference-continuation-v1.json`,
      ),
    };
    const fixture = source(`${oldBase}fixtures/read-update-reference-v1.json`);
    expect(
      fixture.bytes.equals(source(`${oldBase}fixtures/read-update-reference-v1.json`).bytes),
    ).toBe(true);
    const set = createReadUpdateArtifactSet(selection, {
      index: source(`${oldBase}test-support/read-update-artifact-set-v1.json`),
      fixture,
      coverage: source(`${oldBase}test-support/read-update-coverage-v1.json`),
      manifests,
    });
    expect(set.shards.map((s) => s.scenarioIds.length)).toEqual([51, 5]);
    expect(set.coverage.rows.filter((r) => r.wholeContract)).toHaveLength(34);
    const scope = "https://reference.invalid/acme/";
    const base = {
      scope,
      directory: "/tmp/ru-source-preflight-no-store-created",
      create: true,
      listener: { host: "127.0.0.1", port: 49151 },
    };
    const config = cumulativeRUConfiguration(
      base,
      runtime.referenceTypeArtifacts(scope),
      credentials,
    );
    const captured = runtime.captureInstalledReferenceConfiguration(config);
    const relocated = runtime.captureInstalledReferenceConfiguration({
      ...config,
      directory: "/tmp/ru-source-preflight-other-no-store",
      listener: { host: "127.0.0.1", port: 49152 },
    });
    expect(relocated.identity).toBe(captured.identity);
    expect(captured.profile).toBe("read-update");
    expect(captured.history).toBe(false);
    expect(config.contracts.descriptors).toHaveLength(17);
    expect(config.contracts.schemas).toHaveLength(4);
    const sources = Object.fromEntries(
      Object.entries(manifests).map(([name, value]) => [name, measure(value.bytes)]),
    );
    for (const m of Object.values(sources)) {
      expect(m.bytes).toBeLessThanOrEqual(4194304);
      expect(m.nodes).toBeLessThanOrEqual(100000);
      expect(m.maximumDepth).toBeLessThanOrEqual(128);
    }
    writeFileSync(
      output,
      JSON.stringify(
        {
          status: "SOURCE_PREFLIGHT_ONLY_NO_INSTALLED_EXECUTION_OR_CREDIT",
          runtimeSource: requirements.runtimeSource,
          requiredCount: 130,
          selectedClauses: requirements.rows.reduce(
            (n: number, r: { requirements: unknown[] }) => n + r.requirements.length,
            0,
          ),
          retiredIds: selection.retiredIds,
          requiredOrder: selection.required.map((r) => r.id),
          catalogDigests: selection.catalogDigests,
          sources,
          fixture: measure(fixture.bytes),
          inheritedCoverage: { whole: 34, partial: 96, represented: 56, omitted: 74 },
          configurationCapture: {
            identity: captured.identity,
            artifactIdentity: captured.artifactIdentity,
            policyIdentity: captured.policyIdentity,
            authenticationIdentity: captured.authenticationIdentity,
            profile: captured.profile,
            history: captured.history,
          },
          actualConfiguration: {
            ...config,
            credentials: Object.keys(credentials).map((principal) => ({
              principal,
              credentialRef: principal,
            })),
          },
          credentialsOwnedOnce: true,
          servingChildStarted: false,
          bootstrapMetadata: null,
          aggregateBudgetMilliseconds: 90000,
          campaignFinalManifestsAuthored: false,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  },
);

it("checks the newly authored two-shard carrier and full required-ID closure within the original limits", () => {
  const selection = loadProfileContractSelection("read-update");
  const base = "apps/bdptest/test-support/read-update-cumulative-product-";
  const manifests = {
    "matrices/read-update-cumulative-product-baseline.json": source(`${base}baseline.json`),
    "matrices/read-update-cumulative-product-continuation.json": source(`${base}continuation.json`),
  };
  const set = createReadUpdateArtifactSet(selection, {
    index: source(`${base}index.json`),
    fixture: source(`${base}fixture.json`),
    coverage: source(`${base}coverage.json`),
    manifests,
  });
  expect(set.shards).toHaveLength(2);
  const plannedTypes = new Set(
    cumulativeRUConfiguration(
      { scope: "https://reference.invalid/acme/" },
      runtime.referenceTypeArtifacts("https://reference.invalid/acme/"),
      {
        operator: "source-only-operator-not-serving",
        other: "source-only-other-not-serving",
        restricted: "source-only-restricted-not-serving",
      },
    ).contracts.descriptors.map((descriptor) => descriptor.retrievalUri),
  );
  for (const shard of set.shards)
    for (const scenario of shard.bundle.manifest.scenarios)
      for (const action of scenario.actions ?? scenario.requests) {
        for (const assertion of action.assertions)
          if (assertion.kind === "json-schema") {
            expect(assertion.schema.startsWith("#/$defs/")).toBe(true);
            expect(
              Object.hasOwn(
                cumulativeRUObservationSchema.$defs,
                assertion.schema.slice("#/$defs/".length),
              ),
              assertion.schema,
            ).toBe(true);
          }
        const successful = action.assertions.some(
          (a) =>
            (a.kind === "status" && a.equals === 200) ||
            (a.kind === "json-pointer" && a.pointer === "/status" && a.equals === 200),
        );
        const input =
          "input" in action &&
          action.input !== null &&
          typeof action.input === "object" &&
          !Array.isArray(action.input)
            ? (action.input as Record<string, unknown>)
            : undefined;
        const body = input?.body;
        if (
          successful &&
          typeof body === "object" &&
          body !== null &&
          !Array.isArray(body) &&
          "type" in body &&
          typeof body.type === "string"
        )
          expect(plannedTypes.has(body.type), `${scenario.id}/${action.id}: ${body.type}`).toBe(
            true,
          );
      }

  expect(set.coverage.rows.map((row) => row.id)).toEqual(selection.required.map((row) => row.id));
  for (const item of Object.values(manifests)) {
    const measured = measure(item.bytes);
    expect(measured.bytes).toBeLessThanOrEqual(4194304);
    expect(measured.nodes).toBeLessThanOrEqual(100000);
    expect(measured.maximumDepth).toBeLessThanOrEqual(128);
  }
  const output = process.env.BDP_RU_CUMULATIVE_PREFLIGHT_OUTPUT;
  if (output)
    writeFileSync(
      `${output}.carrier.json`,
      JSON.stringify(
        {
          status: "SOURCE_CARRIER_ONLY_NOT_INSTALLED_QUALIFICATION",
          sourceCommit: "5f3a67e89d62a0dcb4e9a7b9a6cb78b2c0a3e50c",
          required: selection.required.length,
          shards: set.shards.map((shard) => ({ id: shard.id, scenarioIds: shard.scenarioIds })),
          manifests: Object.fromEntries(
            Object.entries(manifests).map(([name, item]) => [name, measure(item.bytes)]),
          ),
          fixture: measure(source(`${base}fixture.json`).bytes),
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
});

it("refuses unbound captured-next inputs before credential resolution or network work", async () => {
  let credentials = 0,
    observed = 0;
  const scope = "https://reference.invalid/acme/";
  const execute = createCumulativeRUClient(
    {
      scope,
      profile: "read-update",
      routes: [{ method: "GET", url: `${scope}beads/` }],
      maximumRequestBodyBytes: 131072,
      maximumRequestHeaderBytes: 16384,
      defaultCredentialRef: "operator",
      credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
      resolveCredentials: () => {
        credentials++;
        throw Error("unexpected credential resolution");
      },
    },
    { transport: "plain", host: "127.0.0.1", port: 1 },
    () => {
      observed++;
    },
  );
  for (const value of [
    null,
    "beads/?cursor=opaque",
    "https://other.invalid/acme/beads/?cursor=opaque",
    `${scope}beads/`,
    `${scope}links/?cursor=opaque`,
    `${scope}beads/?cursor=opaque#fragment`,
  ]) {
    await expect(
      execute({
        family: "client",
        operation: "cumulative.follow-next",
        scope,
        input: { nextBinding: "next", collection: "beads", credentialRef: "operator" },
        bindings: { next: value },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
  }
  expect(credentials).toBe(0);
  expect(observed).toBe(0);
});
