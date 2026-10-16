import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isProtocolSpecificationSource,
  readSpecificationSource,
} from "../test-support/spec-source.js";
import {
  loadExecutableScenarioManifestJson,
  loadScenarioCatalogJson,
  selectNormativeScenariosForProfile,
  validateCatalogCitations,
} from "./index.js";
import { loadProfileContractSelection } from "./profile-contract-selection.js";

/** Catalog citations and composition are checked here. The explicit private
 * cumulative manifest observes only its authored cases; missing obligations
 * remain uncovered and public qualification is not enabled by this test. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readText = (relativePath: string): string => readSpecificationSource(relativePath);

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
      expect(
        scenario.requirements.every(({ source }) => isProtocolSpecificationSource(source)),
      ).toBe(true);
    }
    expect(selectNormativeScenariosForProfile(catalog, "read").map(({ id }) => id)).toEqual([]);
  });

  it("mirrors the declared Read discovery retirement exactly", () => {
    const spec = readText("docs/specs/bdp.md");
    const section =
      spec
        .split("#### Read+Update conformance rows")[1]
        ?.split("#### Transactional conformance rows")[0] ?? "";
    const declared = [
      ...section.matchAll(/^- `(read-update\.[a-z0-9.-]+)` retires `(read\.[a-z0-9.-]+)`$/gm),
    ].map((match) => [match[1], match[2]]);
    const actual = catalog.scenarios.flatMap((row) =>
      (row.retires ?? []).map((id) => [row.id, id]),
    );
    expect(declared).toEqual([["read-update.discovery.document", "read.discovery.document"]]);
    expect(actual).toEqual(declared);
    expect(section).toContain(
      "replacing the\nRead+Update discovery row does not restore the Read-only shape",
    );
  });

  it("does not collide with the sealed Read catalog", () => {
    const readCatalog = loadScenarioCatalogJson(readText(READ_CATALOG_PATH), "read-v1.json");
    const readIds = new Set(readCatalog.scenarios.map(({ id }) => id));
    for (const id of ids) expect(readIds.has(id), id).toBe(false);
  });

  const approvedRuManifests = ["read-update-v1.json", "read-update-reference-continuation-v1.json"];
  const assertManifestBinding = (
    entry: string,
    manifest: ReturnType<typeof loadExecutableScenarioManifestJson>,
  ): void => {
    if (approvedRuManifests.includes(entry)) {
      expect(manifest.catalogId).toBe("read-update-v1");
      expect(manifest.manifestVersion).toBe(2);
      const cumulativeIds = loadProfileContractSelection("read-update").required.map(
        (row) => row.id,
      );
      expect(manifest.scenarios.length).toBeLessThan(cumulativeIds.length);
      for (const row of manifest.scenarios) expect(cumulativeIds).toContain(row.id);
      return;
    }
    expect(manifest.catalogId, entry).not.toBe("read-update-v1");
    const bound = new Set(manifest.scenarios.map(({ id }) => id));
    for (const id of ids) expect(bound.has(id), `${entry} binds ${id}`).toBe(false);
  };

  it("binds only the approved partial version 2 RU shards, preserving the sealed Read matrix", () => {
    // This explicit reviewed list is not derived from a manifest's profile or catalog tag.
    expect(
      JSON.parse(readText("packages/conformance/test-support/read-update-artifact-set-v1.json")),
    ).toEqual({
      version: 1,
      shards: [
        { id: "baseline", source: `matrices/${approvedRuManifests[0]}` },
        { id: "reference-continuation", source: `matrices/${approvedRuManifests[1]}` },
      ],
    });
    const manifests = readdirSync(path.resolve(root, MATRICES_DIRECTORY)).filter((entry) =>
      entry.endsWith(".json"),
    );
    for (const entry of approvedRuManifests) expect(manifests).toContain(entry);
    for (const entry of manifests)
      assertManifestBinding(
        entry,
        loadExecutableScenarioManifestJson(readText(path.join(MATRICES_DIRECTORY, entry)), entry),
      );
  });

  it("rejects RU bindings outside the approved shard filenames even with another catalog tag", () => {
    const manifest = loadExecutableScenarioManifestJson(
      readText(path.join(MATRICES_DIRECTORY, approvedRuManifests[1]!)),
      approvedRuManifests[1],
    );
    expect(() => assertManifestBinding("unapproved-ru.json", manifest)).toThrow(
      /unapproved-ru.json/,
    );
    const unknownSubject = manifest.scenarios.filter(
      (row) => row.id === "read-update.alias.unknown-subject",
    );
    expect(unknownSubject).toHaveLength(1);
    expect(() =>
      assertManifestBinding("read-v1.json", {
        ...manifest,
        catalogId: "read-v1",
        scenarios: unknownSubject,
      }),
    ).toThrow(/read-v1.json binds read-update.alias.unknown-subject/);
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
