import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { stringifyJsonValue, type TypeDescriptor } from "@bdp/protocol";
import {
  schemaCohortArtifacts,
  withSchemaCohort,
} from "../test-support/installed-schema-cohort.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry =
  process.env.BDP_CUMULATIVE_INSTALLED_ENTRY ??
  path.join(root, "packages/server/dist/installed-reference-process.js");
const module = (await import(
  pathToFileURL(path.join(path.dirname(entry), "installed-reference-configuration.js")).href
)) as typeof import("../../../packages/server/src/installed-reference-configuration.js");
const scope = "https://reference.invalid/acme/";
it("pins the complete schema cohort closure, identical schema URIs and canonical 17-Type fixture oracles", () => {
  const additions = schemaCohortArtifacts(scope);
  const shipped = module.referenceTypeArtifacts(scope);
  const configuration = withSchemaCohort(
    {
      scope,
      listener: { host: "127.0.0.1", port: 12345 },
      directory: "/tmp/schema-fixture-capture-only",
      create: true,
      credentials: [
        { token: "schema_fixture_capture_01234567890123456789", principal: "operator" },
      ],
      policies: { operator: { create: true, write: true, hidden: [], readOnly: [] } },
      maximumEndpointMultiplicity: [],
    },
    shipped,
  );
  expect(configuration.contracts.descriptors.slice(0, 13)).toEqual(
    shipped.map((d) => ({ retrievalUri: d.id, utf8: stringifyJsonValue(d) })),
  );
  expect(new Set(configuration.contracts.descriptors.map((d) => d.retrievalUri)).size).toBe(17);
  expect(configuration.contracts.descriptors).toHaveLength(17);
  expect(additions.schemas).toHaveLength(4);
  for (const d of additions.descriptors) {
    const schema = additions.schemas.find((s) => s.retrievalUri === d.propertiesSchema);
    expect(schema).toBeDefined();
    expect(JSON.parse(schema!.utf8).$id).toBe(d.propertiesSchema);
    expect(schema!.retrievalUri).toBe(d.propertiesSchema);
    expect(JSON.parse(schema!.utf8)).not.toHaveProperty("additionalProperties");
  }
  const captured = module.captureInstalledReferenceConfiguration(configuration);
  expect(captured.profile).toBe("read-update");
  const shippedCapture = module.captureInstalledReferenceConfiguration({
    ...configuration,
    contracts: { descriptors: [], schemas: [] },
  });
  const shippedIds = new Set(shippedCapture.configuration.contracts.descriptors.map((d) => d.id));
  expect(captured.configuration.contracts.descriptors.filter((d) => shippedIds.has(d.id))).toEqual(
    shippedCapture.configuration.contracts.descriptors,
  );
  for (const id of shippedIds)
    expect(captured.configuration.contracts.types[id]).toBe(
      shippedCapture.configuration.contracts.types[id],
    );
  expect(captured.configuration.contracts.descriptors).toHaveLength(17);
  expect(captured.schemas).toEqual(
    additions.schemas.map((schema) => ({ uri: schema.retrievalUri, utf8: schema.utf8 })),
  );
  const expected = [...shipped, ...additions.descriptors].sort((a, b) =>
    Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)),
  );
  const fixture = JSON.parse(
    readFileSync(
      path.join(root, "packages/conformance/fixtures/read-update-reference-v1.json"),
      "utf8",
    ),
  );
  expect(fixture.oracles.collections["type-summaries"]).toEqual(
    expected.map((d) => [d.id.slice(scope.length), d.name, d.describes]),
  );
  expect(fixture.oracles.ordering.types).toEqual(expected.map((d) => [d.id.slice(scope.length)]));
  expect(expected.slice(10, 14).map((d) => d.id)).toEqual(
    additions.descriptors.map((d: TypeDescriptor) => d.id),
  );
  expect(expected.length).toBeLessThanOrEqual(20);
});
