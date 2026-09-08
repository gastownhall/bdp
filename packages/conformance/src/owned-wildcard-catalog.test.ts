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
 * The owned-Link wildcard rows are metadata only. They bind the normative
 * text the 2026-09-08 ruling produced so that its obligations are
 * reviewable now, but no executable manifest names this catalog, no fixture
 * realizes it, and no runner can report a row from it — so nothing can
 * claim it. That absence is asserted here so it cannot erode silently. What
 * is checked is structure and citation consistency — the rows parse, every
 * excerpt still appears in its anchored section, and the rows mirror the
 * specification's table in order — never the behavior a row describes.
 */
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
      "read.owned-wildcard.present-entries",
      "read.owned-wildcard.closure",
    ]);
    expect(selectNormativeScenariosForProfile(catalog, "read-update").map(({ id }) => id)).toEqual(
      ids,
    );
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
      expect(manifest.catalogId, entry).not.toBe("owned-wildcard-v1");
      const bound = new Set(manifest.scenarios.map(({ id }) => id));
      for (const id of ids) expect(bound.has(id), `${entry} binds ${id}`).toBe(false);
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
