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

const CATALOG_PATH = "packages/conformance/catalog/owned-wildcard-v1.json";
const READ_CATALOG_PATH = "packages/conformance/catalog/read-v1.json";
const MATRICES_DIRECTORY = "packages/conformance/matrices";
const CITATION_SOURCES = new Set(["docs/specs/bdp.md", "docs/design/requirements.md"]);

describe("draft owned-Link wildcard catalog", () => {
  const catalog = loadScenarioCatalogJson(readText(CATALOG_PATH), "owned-wildcard-v1.json");
  const ids = catalog.scenarios.map(({ id }) => id);

  it("strictly parses and binds every citation to the current specification text", () => {
    expect(catalog.catalogVersion).toBe(1);
    expect(catalog.scenarios.length).toBeGreaterThan(0);
    validateCatalogCitations(catalog, (source) => readText(source), "owned-wildcard-v1.json");
  });

  it("prefixes every row with the profile it requires and cites only the governing documents", () => {
    for (const scenario of catalog.scenarios) {
      expect(scenario.kind, scenario.id).toBe("normative");
      expect(scenario.id, scenario.id).toMatch(/^(?:read|read-update)\.owned-wildcard\./);
      expect(
        scenario.id.startsWith(`${scenario.requiredProfile}.owned-wildcard.`),
        scenario.id,
      ).toBe(true);
      expect(scenario.requirements.every(({ source }) => CITATION_SOURCES.has(source))).toBe(true);
    }
    // Descriptor and record shape and view closure are Read-observable; the
    // bounds and source versioning are exercised only by mutation.
    expect(selectNormativeScenariosForProfile(catalog, "read").map(({ id }) => id)).toEqual([
      "read.owned-wildcard.declaration",
      "read.owned-wildcard.max-required",
      "read.owned-wildcard.explicit-max-bounded",
      "read.owned-wildcard.present-entries",
      "read.owned-wildcard.closure",
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
      expect(manifest.catalogId, entry).not.toBe("owned-wildcard-v1");
      const bound = new Set(manifest.scenarios.map(({ id }) => id));
      for (const row of catalog.scenarios)
        expect(bound.has(row.id), `${entry} binds ${row.id}`).toBe(
          entry === "read-v1.json" && row.requiredProfile === "read",
        );
    }
  });

  it("mirrors the specification's Owned-Link wildcard conformance rows exactly and in order", () => {
    const specification = readText("docs/specs/bdp.md");
    const start = specification.indexOf("\n#### Owned-Link wildcard conformance rows\n");
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
