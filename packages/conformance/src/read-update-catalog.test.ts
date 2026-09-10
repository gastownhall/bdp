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

/**
 * The drafted Read+Update rows are metadata only. They bind normative text
 * so that the profile's obligations are reviewable now, but no executable
 * manifest names this catalog, no fixture realizes it, and no runner can
 * report a row from it — so nothing can claim it. That absence is asserted
 * here so it cannot erode silently. What is checked is structure and
 * citation consistency — the rows parse, every excerpt still appears in
 * its anchored section, and the rows mirror the specification's table in
 * order — never the behavior a row describes.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readText = (relativePath: string): string =>
  readFileSync(path.resolve(root, relativePath), "utf8");

const CATALOG_PATH = "packages/conformance/catalog/read-update-v1.json";
const READ_CATALOG_PATH = "packages/conformance/catalog/read-v1.json";
const MATRICES_DIRECTORY = "packages/conformance/matrices";

describe("draft Read+Update catalog", () => {
  const catalog = loadScenarioCatalogJson(readText(CATALOG_PATH), "read-update-v1.json");
  const ids = catalog.scenarios.map(({ id }) => id);

  it("strictly parses and binds every citation to the current specification text", () => {
    expect(catalog.catalogVersion).toBe(1);
    expect(catalog.scenarios.length).toBeGreaterThan(0);
    validateCatalogCitations(catalog, (source) => readText(source), "read-update-v1.json");
  });

  it("scopes every row to the Read+Update profile with the profile's id prefix", () => {
    for (const scenario of catalog.scenarios) {
      expect(scenario.requiredProfile, scenario.id).toBe("read-update");
      expect(scenario.id, scenario.id).toMatch(/^read-update\./);
      expect(scenario.requirements.every(({ source }) => source === "docs/specs/bdp.md")).toBe(
        true,
      );
    }
    expect(selectNormativeScenariosForProfile(catalog, "read").map(({ id }) => id)).toEqual([]);
  });

  it("does not collide with the sealed Read catalog", () => {
    const readCatalog = loadScenarioCatalogJson(readText(READ_CATALOG_PATH), "read-v1.json");
    const readIds = new Set(readCatalog.scenarios.map(({ id }) => id));
    for (const id of ids) expect(readIds.has(id), id).toBe(false);
  });

  it("is bound by no executable manifest, so no runner report can carry its rows", () => {
    const manifests = readdirSync(path.resolve(root, MATRICES_DIRECTORY)).filter((entry) =>
      entry.endsWith(".json"),
    );
    expect(manifests.length).toBeGreaterThan(0);
    for (const entry of manifests) {
      const manifest = loadExecutableScenarioManifestJson(
        readText(path.join(MATRICES_DIRECTORY, entry)),
        entry,
      );
      expect(manifest.catalogId, entry).not.toBe("read-update-v1");
      const bound = new Set(manifest.scenarios.map(({ id }) => id));
      for (const id of ids) expect(bound.has(id), `${entry} binds ${id}`).toBe(false);
    }
  });

  it("mirrors the specification's Read+Update conformance rows exactly and in order", () => {
    const specification = readText("docs/specs/bdp.md");
    const start = specification.indexOf("\n#### Read+Update conformance rows\n");
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
