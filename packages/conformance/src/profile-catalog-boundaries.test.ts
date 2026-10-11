import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadScenarioCatalogJson, validateCatalogCitations } from "./index.js";

const root = new URL("../../../", import.meta.url);
const read = (source: string) => readFileSync(new URL(source, root), "utf8");
const spec = read("docs/specs/bdp.md");
const rank = { read: 1, "read-update": 2, transactional: 3 };

// Profile ownership follows the actual containing part, including unchanged
// catalogs. A valid quote/anchor alone cannot establish profile applicability.
function headingOwners(markdown: string): Map<string, number> {
  const owners = new Map<string, number>();
  const duplicates = new Map<string, number>();
  let owner = 0;
  let fence: string | undefined;
  for (const line of markdown.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const heading = /^(#{1,6}) +(.+?)\s*$/.exec(line);
    if (!heading) continue;
    const title = heading[2] ?? "";
    if (heading[1] === "##") {
      if (title === "Part I — Read") owner = 1;
      else if (title === "Part II — Read+Update") owner = 2;
      else if (title === "Part III — Transactional") owner = 3;
      else owner = 0; // Preface or shared conformance/informative end matter.
    }
    const slug = title
      .toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .replace(/[ \t]+/g, "-");
    const index = duplicates.get(slug) ?? 0;
    duplicates.set(slug, index + 1);
    owners.set(`#${slug}${index ? `-${index}` : ""}`, owner);
  }
  return owners;
}

const owners = headingOwners(spec);
const catalogs = [
  ...readdirSync(new URL("packages/conformance/catalog/", root))
    .filter((name) => name.endsWith(".json"))
    .map((name) => `packages/conformance/catalog/${name}`),
  // Citation ownership also applies to diagnostic observations; loading their
  // metadata here does not admit them through the production artifact factory.
  "packages/conformance/development/read-update-catalog-v1.json",
];

describe("catalog citations respect cumulative profile boundaries", () => {
  it("recognizes each normative part", () => {
    expect(owners.get("#scope-discovery-and-human-documentation")).toBe(1);
    expect(owners.get("#readupdate-discovery")).toBe(2);
    expect(owners.get("#discovery-profile-membership")).toBe(3);
  });
  it.each(catalogs)("audits every requirement in %s", (name) => {
    const catalog = loadScenarioCatalogJson(read(name));
    validateCatalogCitations(catalog, read);
    for (const scenario of catalog.scenarios) {
      for (const requirement of scenario.requirements) {
        if (requirement.source !== "docs/specs/bdp.md") continue;
        const label = `${scenario.id}: ${requirement.anchor}`;
        const owner = owners.get(requirement.anchor);
        expect(owner, label).toBeDefined();
        expect(owner, label).toBeLessThanOrEqual(rank[scenario.requiredProfile]);
        // The profile overview is explicitly a navigation guide, not authority.
        expect(requirement.anchor, label).not.toBe("#conformance-profiles-and-reading-guide");
      }
    }
  });
});
