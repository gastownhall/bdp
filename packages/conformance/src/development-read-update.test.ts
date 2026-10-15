import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createConformanceArtifactBundle, validateCatalogCitations } from "./index.js";
import { createDevelopmentReadUpdateArtifactBundle } from "./artifact-bundle.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (name: string) => readFileSync(path.join(root, name));
const source = (name: string) => ({ bytes: read(`packages/conformance/development/${name}`) });
const sources = {
  catalog: source("read-update-catalog-v1.json"),
  manifest: source("read-update-manifest-v1.json"),
  fixture: source("read-update-fixture-v1.json"),
};
const bundle = createDevelopmentReadUpdateArtifactBundle(sources);
const inventory = JSON.parse(
  read("packages/conformance/development/read-update-coverage-v1.json").toString(),
);

describe("development Read+Update evidence inventory", () => {
  it("binds diagnostic-only citations and preserves the production catalog-ID guard", () => {
    validateCatalogCitations(
      bundle.catalog,
      (name) => read(name).toString(),
      "development-read-update",
    );
    expect(() => createConformanceArtifactBundle(sources)).toThrow("catalogId");
    expect(bundle.catalog.scenarios.every((row) => row.kind === "diagnostic")).toBe(true);
  });

  it.each(["kind", "id", "requiredProfile", "retires"])(
    "rejects unsafe diagnostic catalog field %s",
    (field) => {
      const catalog = JSON.parse(sources.catalog.bytes.toString());
      catalog.scenarios[0][field] = {
        kind: "normative",
        id: "read-update.singleton.create-bead",
        requiredProfile: "read",
        retires: ["read-update.singleton.create-bead"],
      }[field];
      expect(() =>
        createDevelopmentReadUpdateArtifactBundle({
          ...sources,
          catalog: { bytes: Buffer.from(JSON.stringify(catalog)) },
        }),
      ).toThrow();
    },
  );

  it("rejects a manifest trying to bind a normative ID or an inherited profile", () => {
    for (const replacement of [
      { id: "read-update.singleton.create-bead" },
      { requiredProfile: "read" },
    ]) {
      const manifest = JSON.parse(sources.manifest.bytes.toString());
      Object.assign(manifest.scenarios[0], replacement);
      expect(() =>
        createDevelopmentReadUpdateArtifactBundle({
          ...sources,
          manifest: { bytes: Buffer.from(JSON.stringify(manifest)) },
        }),
      ).toThrow("diagnostic Read+Update catalog");
    }
  });

  it("inventories all 82 normative rows once, with executable assertion bindings or explicit omissions", () => {
    const normative = JSON.parse(
      read("packages/conformance/catalog/read-update-v1.json").toString(),
    );
    expect(normative.scenarios).toHaveLength(82);
    expect(inventory).toMatchObject({ version: 1, developmentOnly: true, claimEligible: false });
    expect(inventory.rows.map((row: { id: string }) => row.id)).toEqual(
      normative.scenarios.map((row: { id: string }) => row.id),
    );
    const plans = new Map(bundle.manifest.scenarios.map((plan) => [plan.id, plan]));
    for (const row of inventory.rows) {
      if (row.status === "omitted") {
        expect(row.bindings).toEqual([]);
        expect(row.reason.length).toBeGreaterThan(0);
        expect(row.category.length).toBeGreaterThan(0);
        continue;
      }
      expect(row.status).toBe("bounded-observation");
      expect(row.bindings.length).toBeGreaterThan(0);
      for (const binding of row.bindings) {
        const plan = plans.get(binding.scenario);
        expect(plan, row.id).toBeDefined();
        if (plan === undefined) throw new Error("missing diagnostic plan");
        const assertions = new Set(
          plan.actions?.flatMap((action) =>
            action.assertions.map((assertion) => `${action.id}.${assertion.id}`),
          ),
        );
        expect(binding.assertions.length, row.id).toBeGreaterThan(0);
        expect(Array.isArray(binding.limits)).toBe(true);
        for (const assertion of binding.assertions)
          expect(assertions.has(assertion), `${row.id}: ${assertion}`).toBe(true);
      }
    }
    for (const plan of bundle.manifest.scenarios) {
      expect(plan.actions?.length).toBeGreaterThan(0);
      for (const action of plan.actions ?? []) expect(action.assertions.length).toBeGreaterThan(0);
    }
  });
});
