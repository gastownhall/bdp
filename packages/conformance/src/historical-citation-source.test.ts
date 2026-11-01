import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertHistoricalCitation692dBytes,
  HISTORICAL_CITATION_692D_CATALOG_PATHS,
  isHistoricalCitation692dProtocolSource,
  readHistoricalCitation692dCatalog,
  readHistoricalCitation692dSource,
} from "../test-support/historical-citation-source.js";
import {
  isProtocolSpecificationSource,
  readSpecificationSource,
} from "../test-support/spec-source.js";
import { loadScenarioCatalogJson, validateCatalogCitations } from "./index.js";

const root = new URL("../../../", import.meta.url);
const snapshotRoot = new URL("../test-support/historical-citation-692d/", import.meta.url);

describe("historical citation cutline 692d is a separate test source", () => {
  it("preserves the old obligation without making it current Core authority", () => {
    const historical = readHistoricalCitation692dSource("docs/specs/bdp.md");
    const old = "The Read discovery document requires `bdpVersion`, `profile`, `scope`, `beads`, `links`, and `types`.";
    expect(historical.replace(/\s+/g, " ")).toContain(old);
    expect(readSpecificationSource("docs/specs/bdp.md").replace(/\s+/g, " ")).not.toContain(old);
    expect(readSpecificationSource("specs/profiles/core/retained-core.md")).toContain(
      "No `types` inventory is\nrequired or guessed.",
    );
    expect(isProtocolSpecificationSource("specs/history/core-v0-types.md")).toBe(false);
    expect(isProtocolSpecificationSource("specs/profiles/types/types.md")).toBe(false);
  });

  it("has no current-file, history, alternate-spelling or network source fallback", () => {
    for (const source of [
      "specs/history/core-v0-types.md",
      "specs/profiles/types/types.md",
      "specs/profiles/core/retained-core.md",
      "./specs/profiles/core/core.md",
      "specs/profiles/core/../write/write.md",
      "../outside.md",
      "file:///etc/hosts",
      "https://example.invalid/core.md",
      "package.json",
    ]) {
      expect(isHistoricalCitation692dProtocolSource(source), source).toBe(false);
      expect(() => readHistoricalCitation692dSource(source), source).toThrow("Not a historical");
      expect(() => readHistoricalCitation692dCatalog(source), source).toThrow("Not a historical");
    }
    expect(isHistoricalCitation692dProtocolSource("docs/design/requirements.md")).toBe(false);
    expect(readHistoricalCitation692dSource("docs/design/requirements.md")).toContain("#");
  });

  it("refuses missing, changed and appended bytes even with unchanged source names", () => {
    const snapshotPaths = [
      "docs/design/requirements.md",
      "specs/profiles/core/core.md",
      "specs/profiles/write/write.md",
      "specs/conformance.md",
    ];
    for (const source of [...snapshotPaths, ...HISTORICAL_CITATION_692D_CATALOG_PATHS]) {
      const bytes = readFileSync(new URL(source, snapshotPaths.includes(source) ? snapshotRoot : root));
      expect(() => assertHistoricalCitation692dBytes(source, bytes), source).not.toThrow();
      expect(() => assertHistoricalCitation692dBytes(source, bytes.subarray(1)), source).toThrow("byte drift");
      const changed = Buffer.from(bytes);
      changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
      expect(() => assertHistoricalCitation692dBytes(source, changed), source).toThrow("byte drift");
      expect(() => assertHistoricalCitation692dBytes(source, Buffer.concat([bytes, Buffer.from(" ")])), source).toThrow("byte drift");
    }
    expect(() => assertHistoricalCitation692dBytes("package.json", Buffer.alloc(0))).toThrow("Not a pinned");
  });

  it("checks every original quotation from the exact six catalogs without changing their census", () => {
    const expected = [
      ["read-v1.json", 49, 91],
      ["read-update-v1.json", 82, 204],
      ["owned-wildcard-v1.json", 7, 24],
      ["transactional-v1.json", 133, 201],
      ["history-v1.json", 30, 32],
      ["numeric-model-v1.json", 4, 17],
    ] as const;
    expect([...HISTORICAL_CITATION_692D_CATALOG_PATHS].sort()).toEqual(
      expected.map(([name]) => `packages/conformance/catalog/${name}`).sort(),
    );
    let requirements = 0;
    for (const [name, scenarioCount, requirementCount] of expected) {
      const catalog = loadScenarioCatalogJson(
        readHistoricalCitation692dCatalog(`packages/conformance/catalog/${name}`),
      );
      expect(catalog.scenarios, name).toHaveLength(scenarioCount);
      const count = catalog.scenarios.reduce((sum, row) => sum + row.requirements.length, 0);
      expect(count, name).toBe(requirementCount);
      requirements += count;
      validateCatalogCitations(catalog, readHistoricalCitation692dSource, name);
    }
    expect(requirements).toBe(569);
  });
});
