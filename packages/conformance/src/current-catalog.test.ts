import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadScenarioCatalogJson, validateCatalogCitations } from "./index.js";

/** Current-contract rows: their citations are read against today's specification text. */
const repository = new URL("../../../", import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, repository), "utf8");
const conformanceRows = (source: string, prefix: string) =>
  [...read(source).matchAll(new RegExp(`^\\| (${prefix}-\\d+) \\| (.*) \\|$`, "gm"))].map(
    ([, row, text]) => ({ row, text }),
  );

describe.each([
  ["callables-v1.json", [["specs/profiles/callables/callables.md", "CB", "callables."]]],
  [
    "issue-package-v1.json",
    [
      ["specs/types/issue/issue.md", "IT", "issue."],
      ["specs/types/issue/callables.md", "IC", "issue."],
    ],
  ],
] as const)("current catalog %s", (file, sources) => {
  const catalog = loadScenarioCatalogJson(
    read(`packages/conformance/catalog/current/${file}`),
    file,
  );
  it("carries every citation verbatim", () => {
    validateCatalogCitations(catalog, (source) => read(source), file);
  });
  it("names each conformance row of the specification exactly once, with its text", () => {
    for (const [source, prefix, idPrefix] of sources) {
      const rows = conformanceRows(source, prefix);
      expect(rows.length).toBeGreaterThan(0);
      for (const { row, text } of rows) {
        const entry = catalog.scenarios.find(({ id }) => id === `${idPrefix}${row?.toLowerCase()}`);
        expect(entry, row).toBeDefined();
        expect(entry?.requirements[0]?.selectedText, row).toBe(text);
      }
    }
  });
});

it("keeps the current catalogs apart from the classified historical directory", () => {
  const listed = readdirSync(new URL("packages/conformance/catalog/", repository));
  expect(listed.filter((name) => name.startsWith("callables") || name.startsWith("issue"))).toEqual(
    [],
  );
});
