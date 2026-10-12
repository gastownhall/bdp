import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadScenarioCatalogJson, validateCatalogCitations } from "./index.js";
import { markdownAnchors, markdownSection } from "./markdown.js";

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
  "Part I — Data Model": 1,
  "Part II — Read": 1,
  "Part III — Read+Update": 2,
  "Part IV — Transactional": 3,
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

function assertProfileLinks(markdown: string): void {
  const indexed = headingOwners(markdown);
  const headings = markdownAnchors(markdown).filter((entry) => entry.title !== undefined);
  for (const link of markdown.matchAll(/\[[^\]]*\]\((#[^)]+)\)/g)) {
    const target = link[1] ?? "";
    if (!indexed.has(target)) throw new Error(`Missing internal anchor: ${target}`);
    const source = headings.findLast((heading) => heading.index < link.index);
    const profile = source === undefined ? undefined : indexed.get(source.anchor)?.profile;
    if (profile === 1) assertProfileCitation(target, "read", indexed);
    if (profile === 2) assertProfileCitation(target, "read-update", indexed);
  }
}

function assertPartLinks(markdown: string): void {
  const headings = markdownAnchors(markdown);
  const parts = new Map<string, number | undefined>();
  let part: number | undefined;
  for (const heading of headings) {
    if (heading.level === 2 && heading.title !== undefined) {
      part = [
        "Part I — Data Model",
        "Part II — Read",
        "Part III — Read+Update",
        "Part IV — Transactional",
      ].indexOf(heading.title);
      if (part < 0) part = undefined;
    }
    parts.set(heading.anchor, part);
  }
  for (const heading of headings)
    if (heading.aliasOf !== undefined) parts.set(heading.anchor, parts.get(heading.aliasOf));
  for (const link of markdown.matchAll(/\[[^\]]*\]\((#[^)]+)\)/g)) {
    const source = headings.findLast(
      (heading) => heading.title !== undefined && heading.index < link.index,
    );
    const sourcePart = source === undefined ? undefined : parts.get(source.anchor);
    const targetPart = parts.get(link[1] ?? "");
    if (sourcePart !== undefined && targetPart !== undefined && targetPart > sourcePart)
      throw new Error(`Later-part anchor: ${link[1]}`);
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
    expect(owners.get("#part-i--data-model")?.profile).toBe(1);
    expect(owners.get("#part-ii--read")?.profile).toBe(1);
    expect(owners.has("#part-ii-read")).toBe(false);
  });
  it("bounds the model introduction anchor before its child sections", () => {
    const model = markdownSection(spec, "#bead-data-model");
    expect(model).toContain("The shared data model defines");
    expect(model).not.toContain("A **BDP Scope** contains");
  });
  it("preserves the profile ownership of existing Part and model anchors", () => {
    expect(owners.get("#bead-data-model")?.profile).toBe(1);
    expect(owners.get("#part-i--read")?.profile).toBe(1);
    expect(owners.get("#part-ii--readupdate")?.profile).toBe(2);
    expect(owners.get("#part-iii--transactional")?.profile).toBe(3);
    expect(() => assertProfileCitation("#part-ii--readupdate", "read")).toThrow("Later-profile");
    expect(() => assertProfileCitation("#part-iii--transactional", "read-update")).toThrow(
      "Later-profile",
    );
  });
  it("resolves internal links without lower-profile forward dependencies", () => {
    expect(() => assertProfileLinks(spec)).not.toThrow();
    expect(() =>
      assertProfileLinks(
        spec.replace(
          "### Authorization views",
          "### Authorization views\n\nSee [batch](#batch-operation-target).",
        ),
      ),
    ).toThrow("Later-profile anchor: #batch-operation-target");
    expect(() =>
      assertProfileLinks(
        spec.replace("### Types", "### Types\n\nSee [writes](#part-ii--readupdate)."),
      ),
    ).toThrow("Later-profile anchor: #part-ii--readupdate");
  });
  it("rejects model-to-Read dependencies despite their shared profile rank", () => {
    expect(() => assertPartLinks(spec)).not.toThrow();
    expect(() =>
      assertPartLinks(
        spec.replace(
          "### Actor attribution",
          "### Actor attribution\n\nSee [History](#immutable-change-context).",
        ),
      ),
    ).toThrow("Later-part anchor: #immutable-change-context");
    expect(() =>
      assertPartLinks(
        spec.replace(
          "### Actor attribution",
          "### Actor attribution\n\nSee [Read](#part-i--read).",
        ),
      ),
    ).toThrow("Later-part anchor: #part-i--read");
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
      '## Part II — Read\nRead.\n<a id="later"></a>\n\n## Part IV — Transactional\nLater.',
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
      '## Part IV — Transactional\n### Collision\nTX rule.\n## Part II — Read\n<a id="collision"></a>\nRead rule.';
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
      // A valid excerpt repeated in place of another obligation is still lost
      // traceability, even though every individual citation resolves.
      const citations = scenario.requirements.map(({ source, anchor, selectedText }) =>
        JSON.stringify([source, anchor, selectedText.replace(/\s+/g, " ").trim()]),
      );
      expect(new Set(citations).size, `${scenario.id}: distinct requirement citations`).toBe(
        citations.length,
      );
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
