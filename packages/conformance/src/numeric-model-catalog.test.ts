import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PROTOCOL_SPECIFICATION_PATHS,
  readSpecificationSource,
} from "../test-support/spec-source.js";

import {
  loadExecutableScenarioManifestJson,
  loadScenarioCatalogJson,
  selectNormativeScenariosForProfile,
  validateCatalogCitations,
} from "./index.js";

/** Companion metadata stays intact; executable bindings have explicit artifact ownership. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readText = (relativePath: string): string => readSpecificationSource(relativePath);

const CATALOG_PATH = "packages/conformance/catalog/numeric-model-v1.json";
const READ_CATALOG_PATH = "packages/conformance/catalog/read-v1.json";
const MATRICES_DIRECTORY = "packages/conformance/matrices";
const CITATION_SOURCES = new Set([
  "docs/specs/bdp.md",
  "docs/design/requirements.md",
  ...PROTOCOL_SPECIFICATION_PATHS,
]);

describe("draft numeric-model catalog", () => {
  const catalog = loadScenarioCatalogJson(readText(CATALOG_PATH), "numeric-model-v1.json");
  const ids = catalog.scenarios.map(({ id }) => id);

  it("strictly parses and binds every citation to the current specification text", () => {
    expect(catalog.catalogVersion).toBe(1);
    expect(catalog.scenarios.length).toBeGreaterThan(0);
    validateCatalogCitations(catalog, (source) => readText(source), "numeric-model-v1.json");
  });

  it("prefixes every row with the profile it requires and cites only the governing documents", () => {
    for (const scenario of catalog.scenarios) {
      expect(scenario.kind, scenario.id).toBe("normative");
      expect(scenario.id, scenario.id).toMatch(/^(?:read|read-update)\.numeric-model\./);
      expect(
        scenario.id.startsWith(`${scenario.requiredProfile}.numeric-model.`),
        scenario.id,
      ).toBe(true);
      expect(scenario.requirements.every(({ source }) => CITATION_SOURCES.has(source))).toBe(true);
    }
    // The no-op law and the admission refusal are exercised only by mutation;
    // a content-derived token is observable on every read, and that row is
    // honestly not applicable where a target declares no such scheme.
    expect(selectNormativeScenariosForProfile(catalog, "read").map(({ id }) => id)).toEqual([
      "read.numeric-model.declared-token-model",
    ]);
    expect(selectNormativeScenariosForProfile(catalog, "read-update").map(({ id }) => id)).toEqual(
      ids,
    );
  });

  it("copies only the companion Read rows into the executable Read catalog", () => {
    const readCatalog = loadScenarioCatalogJson(readText(READ_CATALOG_PATH), "read-v1.json");
    const readIds = new Set(readCatalog.scenarios.map(({ id }) => id));
    for (const row of catalog.scenarios) {
      expect(readIds.has(row.id), row.id).toBe(row.requiredProfile === "read");
      if (row.requiredProfile === "read")
        expect(readCatalog.scenarios.find((r) => r.id === row.id)).toEqual(row);
    }
  });

  const approvedBindings: Record<string, readonly string[]> = {
    "read-v1.json": ["read.numeric-model.declared-token-model"],
    "read-update-reference-continuation-v1.json": [
      "read-update.numeric-model.same-value-no-op",
      "read-update.numeric-model.round-trip-admission",
      "read-update.numeric-model.nested-refusal",
    ],
  };
  const assertBindings = (
    entry: string,
    manifest: ReturnType<typeof loadExecutableScenarioManifestJson>,
  ): void => {
    expect(manifest.catalogId, entry).not.toBe("numeric-model-v1");
    if (entry === "read-update-reference-continuation-v1.json") {
      expect(manifest.catalogId, "numeric continuation catalogId guard").toBe("read-update-v1");
      expect(manifest.manifestVersion, "numeric continuation manifestVersion guard").toBe(2);
    }
    const bound = new Set(manifest.scenarios.map(({ id }) => id));
    for (const row of catalog.scenarios)
      expect(bound.has(row.id), `${entry} binds ${row.id}`).toBe(
        approvedBindings[entry]?.includes(row.id) ?? false,
      );
  };
  it("binds numeric rows only in their explicitly approved profile artifacts", () => {
    const manifests = readdirSync(path.resolve(root, MATRICES_DIRECTORY)).filter((entry) =>
      entry.endsWith(".json"),
    );
    for (const entry of Object.keys(approvedBindings)) expect(manifests).toContain(entry);
    for (const entry of manifests)
      assertBindings(
        entry,
        loadExecutableScenarioManifestJson(readText(path.join(MATRICES_DIRECTORY, entry)), entry),
      );
  });
  it.each([
    "read-update.numeric-model.round-trip-admission",
    "read-update.numeric-model.nested-refusal",
  ])("rejects unapproved artifact ownership for %s", (id) => {
    const entry = "read-update-reference-continuation-v1.json";
    const manifest = loadExecutableScenarioManifestJson(
      readText(path.join(MATRICES_DIRECTORY, entry)),
      entry,
    );
    const selected = manifest.scenarios.filter((r) => r.id === id);
    expect(selected).toHaveLength(1);
    expect(() =>
      assertBindings("unapproved-numeric.json", { ...manifest, scenarios: selected }),
    ).toThrow(id);
    const read = loadExecutableScenarioManifestJson(
      readText(path.join(MATRICES_DIRECTORY, "read-v1.json")),
      "read-v1.json",
    );
    expect(() =>
      assertBindings("read-v1.json", { ...read, scenarios: [...read.scenarios, ...selected] }),
    ).toThrow(id);
    expect(() => assertBindings(entry, { ...manifest, catalogId: "read-v1" })).toThrow(
      "numeric continuation catalogId guard",
    );
    expect(() => assertBindings(entry, { ...manifest, manifestVersion: 1 })).toThrow(
      "numeric continuation manifestVersion guard",
    );
  });

  it("mirrors the specification's Numeric-model conformance rows exactly and in order", () => {
    const specification = readText("docs/specs/bdp.md");
    const start = specification.indexOf("\n#### Numeric-model conformance rows\n");
    expect(start).toBeGreaterThan(0);
    const section = specification.slice(start + 1);
    const bodyStart = section.indexOf("\n") + 1;
    const end = section.slice(bodyStart).search(/^#{1,4} /m);
    const rows = [
      ...(end < 0 ? section : section.slice(0, bodyStart + end)).matchAll(
        /^\| `([a-z0-9.-]+)` \| /gm,
      ),
    ].map((match) => match[1]);
    expect(rows).toEqual(ids);
  });
});
