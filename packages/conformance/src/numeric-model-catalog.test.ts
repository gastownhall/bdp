import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  loadExecutableScenarioManifestJson,
  loadScenarioCatalogJson,
  selectNormativeScenariosForProfile,
  validateCatalogCitations,
} from "./index.js";

/** Companion source metadata stays intact; only its Read rows enter the successor Read manifest. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readText = (relativePath: string): string =>
  readFileSync(path.resolve(root, relativePath), "utf8");

const CATALOG_PATH = "packages/conformance/catalog/numeric-model-v1.json";
const READ_CATALOG_PATH = "packages/conformance/catalog/read-v1.json";
const MATRICES_DIRECTORY = "packages/conformance/matrices";
const CITATION_SOURCES = new Set(["docs/specs/bdp.md", "docs/design/requirements.md"]);

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

  it("binds only the Read companion rows in the separate Read manifest", () => {
    const manifests = readdirSync(path.resolve(root, MATRICES_DIRECTORY)).filter((entry) =>
      entry.endsWith(".json"),
    );
    expect(manifests.length).toBeGreaterThan(0);
    for (const entry of manifests) {
      const manifest = loadExecutableScenarioManifestJson(
        readText(path.join(MATRICES_DIRECTORY, entry)),
        entry,
      );
      expect(manifest.catalogId, entry).not.toBe("numeric-model-v1");
      const bound = new Set(manifest.scenarios.map(({ id }) => id));
      for (const row of catalog.scenarios)
        expect(bound.has(row.id), `${entry} binds ${row.id}`).toBe(
          entry === "read-v1.json" && row.requiredProfile === "read",
        );
    }
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
