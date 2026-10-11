import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadScenarioCatalogJson, validateCatalogCitations } from "./index.js";
import { markdownAnchors } from "./markdown.js";

const root = new URL("../../../", import.meta.url);
const read = (source: string) => readFileSync(new URL(source, root), "utf8");
const spec = read("docs/specs/bdp.md");
const rank = { read: 1, "read-update": 2, transactional: 3 };

// Shared sections are deliberately classified; unclassified material cannot
// establish an obligation for any profile. Mixed-profile row tables must cite
// the operative section rather than treating the entire table as Read authority.
const sections: Record<string, number | undefined> = {
  "Status and conformance": 1,
  "Conformance profiles and reading guide": undefined,
  "The uniformity principle": 1,
  "Part I — Read": 1,
  "Part II — Read+Update": 2,
  "Part III — Transactional": 3,
  "Conformance index and informative end matter": undefined,
};
const sharedAnchors: Record<string, number> = {
  "#normative-conformance-matrix": 1,
  "#readupdate-conformance-rows": 2,
  "#transactional-conformance-rows": 3,
};
interface ProfileOwnership {
  profile: number | undefined;
  sharedText?: string;
}
function headingOwners(markdown: string): Map<string, ProfileOwnership> {
  const owners = new Map<string, ProfileOwnership>();
  let owner: number | undefined;
  const anchors = markdownAnchors(markdown);
  for (const heading of anchors) {
    if (heading.level === 2 && heading.title !== undefined) {
      if (!Object.hasOwn(sections, heading.title))
        throw new Error(`Unclassified top-level section: ${heading.title}`);
      owner = sections[heading.title];
    }
    const nextHeading = anchors.find(
      (entry) => entry.title !== undefined && entry.index > heading.index,
    );
    owners.set(heading.anchor, {
      profile: owner ?? sharedAnchors[heading.anchor],
      ...(Object.hasOwn(sharedAnchors, heading.anchor)
        ? { sharedText: markdown.slice(heading.index, nextHeading?.index ?? markdown.length) }
        : {}),
    });
  }
  for (const anchor of anchors)
    if (anchor.aliasOf !== undefined)
      owners.set(anchor.anchor, owners.get(anchor.aliasOf) ?? { profile: undefined });
  return owners;
}
function assertProfileCitation(
  anchor: string,
  profile: keyof typeof rank,
  indexed = owners,
  selectedText?: string,
): void {
  const ownership = indexed.get(anchor);
  if (ownership?.profile === undefined)
    throw new Error(`Unclassified or missing anchor: ${anchor}`);
  if (ownership.profile > rank[profile]) throw new Error(`Later-profile anchor: ${anchor}`);
  // Heading aliases inherit both profile and excerpt bounds, not just the rank.
  if (ownership.sharedText !== undefined && selectedText !== undefined) {
    const normalized = (text: string) => text.replace(/\s+/g, " ").trim();
    if (!normalized(ownership.sharedText).includes(normalized(selectedText)))
      throw new Error(`Shared anchor does not own nested excerpt: ${anchor}`);
  }
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
  it("owns Transactional end matter and rejects its use by Read", () => {
    expect(owners.get("#transactional-conformance-rows")?.profile).toBe(3);
    expect(() => assertProfileCitation("#transactional-conformance-rows", "read")).toThrow(
      "Later-profile",
    );
    expect(() => assertProfileCitation("#readupdate-conformance-rows", "read")).toThrow(
      "Later-profile",
    );
    expect(() =>
      assertProfileCitation("#transactional-conformance-rows", "transactional"),
    ).not.toThrow();
  });
  it("uses rendered Part anchors without collapsing their spaces", () => {
    expect(owners.get("#part-i--read")?.profile).toBe(1);
    expect(owners.has("#part-i-read")).toBe(false);
  });
  it("owns explicit anchors in their containing profile", () => {
    expect(owners.get("#references")?.profile).toBe(1);
    expect(owners.get("#batch-local-resource-references")?.profile).toBe(2);
  });
  it("does not silently open an inserted top-level section or unknown end matter", () => {
    expect(() =>
      headingOwners(spec.replace("### Transactional discovery", "## Unclassified")),
    ).toThrow("Unclassified top-level section");
    expect(() => assertProfileCitation("#deferred-model-features", "transactional")).toThrow(
      "Unclassified",
    );
    expect(() => assertProfileCitation("#conformance-profiles-and-reading-guide", "read")).toThrow(
      "Unclassified",
    );
  });
  it("keeps the explicit top-level section inventory complete", () => {
    expect(
      markdownAnchors(spec)
        .filter((entry) => entry.level === 2 && entry.title !== undefined)
        .map((entry) => entry.title),
    ).toEqual(Object.keys(sections));
  });
  it("does not let an explicit alias bypass a later Part's ownership", () => {
    const indexed = headingOwners(
      '## Part I — Read\nRead.\n<a id="later"></a>\n\n## Part III — Transactional\nLater.',
    );
    expect(() => assertProfileCitation("#later", "read", indexed)).toThrow("Later-profile");
    expect(() => assertProfileCitation("#later", "transactional", indexed)).not.toThrow();
  });
  it("does not smuggle a higher-profile table through its shared parent anchor", () => {
    expect(() =>
      assertProfileCitation(
        "#normative-conformance-matrix",
        "read",
        owners,
        "These rows name the Transactional obligations.",
      ),
    ).toThrow("nested excerpt");
  });
  it("propagates shared-parent excerpt restrictions through an explicit alias", () => {
    const changed = spec.replace(
      "### Normative conformance matrix",
      '<a id="shared-alias"></a>\n\n### Normative conformance matrix',
    );
    expect(() =>
      assertProfileCitation(
        "#shared-alias",
        "read",
        headingOwners(changed),
        "These rows name the Transactional obligations.",
      ),
    ).toThrow("nested excerpt");
    expect(() =>
      assertProfileCitation(
        "#shared-alias",
        "read",
        headingOwners(changed),
        "BDP v0 publishes one machine-readable, black-box conformance matrix.",
      ),
    ).not.toThrow();
  });
  it("rejects duplicate explicit/generated anchor ownership instead of using the last owner", () => {
    const changed =
      '## Part III — Transactional\n### Collision\nTX rule.\n## Part I — Read\n<a id="collision"></a>\nRead rule.';
    expect(() => headingOwners(changed)).toThrow("Ambiguous Markdown anchor");
    expect(() =>
      headingOwners(
        spec.replace(
          "### Normative conformance matrix",
          '<a id="transactional-discovery"></a>\n\n### Normative conformance matrix',
        ),
      ),
    ).toThrow("Ambiguous Markdown anchor");
  });
  it("recognizes each normative part", () => {
    expect(owners.get("#scope-discovery-and-human-documentation")?.profile).toBe(1);
    expect(owners.get("#readupdate-discovery")?.profile).toBe(2);
    expect(owners.get("#discovery-profile-membership")?.profile).toBe(3);
  });
  it.each(catalogs)("audits every requirement in %s", (name) => {
    const catalog = loadScenarioCatalogJson(read(name));
    validateCatalogCitations(catalog, read);
    for (const scenario of catalog.scenarios) {
      for (const requirement of scenario.requirements) {
        if (requirement.source !== "docs/specs/bdp.md") continue;
        const label = `${scenario.id}: ${requirement.anchor}`;
        expect(
          () =>
            assertProfileCitation(
              requirement.anchor,
              scenario.requiredProfile,
              owners,
              requirement.selectedText,
            ),
          label,
        ).not.toThrow();
      }
    }
  });
});
