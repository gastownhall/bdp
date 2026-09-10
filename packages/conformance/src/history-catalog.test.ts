import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  loadScenarioCatalogJson,
  validateCatalogCitations,
  loadExecutableScenarioManifestJson,
} from "./index.js";
const root = new URL("../../../", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root), "utf8");
const catalog = loadScenarioCatalogJson(read("packages/conformance/catalog/history-v1.json"));
describe("History catalog remains unbound metadata", () => {
  it("has 21 unique normative source-bound rows and no fourth profile", () => {
    expect(catalog.scenarios).toHaveLength(21);
    expect(() => validateCatalogCitations(catalog, read)).not.toThrow();
    expect(new Set(catalog.scenarios.map((row) => row.id)).size).toBe(21);
    for (const row of catalog.scenarios) {
      expect(row.kind).toBe("normative");
      expect(["read", "read-update", "transactional"]).toContain(row.requiredProfile);
    }
    const specification = read("docs/specs/bdp.md");
    const section = specification
      .split("#### History conformance rows\n")[1]
      ?.split("#### Read+Update conformance rows")[0];
    expect(section).toBeDefined();
    if (section === undefined) throw new Error("missing normative History section");
    expect([...section.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1])).toEqual(
      catalog.scenarios.map((row) => row.id),
    );
  });
  it("is absent from every executable manifest and the existing Read catalog", () => {
    const ids = new Set(catalog.scenarios.map((row) => row.id));
    const readCatalog = loadScenarioCatalogJson(read("packages/conformance/catalog/read-v1.json"));
    for (const row of readCatalog.scenarios) expect(ids.has(row.id)).toBe(false);
    for (const file of readdirSync(new URL("packages/conformance/matrices/", root)).filter((name) =>
      name.endsWith(".json"),
    )) {
      const manifest = loadExecutableScenarioManifestJson(
        read(`packages/conformance/matrices/${file}`),
      );
      expect(manifest.catalogId).not.toBe("history-v1");
      for (const row of manifest.scenarios) expect(ids.has(row.id)).toBe(false);
    }
  });
});
