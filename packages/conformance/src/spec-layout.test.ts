import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readSpecificationSource } from "../test-support/spec-source.js";
import { markdownAnchors } from "./markdown.js";

const root = new URL("../../../", import.meta.url);
const read = (source: string) => readFileSync(new URL(source, root), "utf8");
const map = JSON.parse(read("docs/design/spec-path-map.json")) as {
  anchors: Record<string, string>;
};
const documents = [
  "specs/README.md",
  "specs/profiles/core/core.md",
  "specs/profiles/write/write.md",
  "specs/conformance.md",
  "specs/profiles/types/types.md",
  "specs/profiles/types/README.md",
  "specs/types/issue/issue.md",
  "docs/specs/bdp.md",
];

describe("single specification authority and physical layout", () => {
  it("preserves every legacy protocol anchor at its owning authoritative document", () => {
    for (const [anchor, source] of Object.entries(map.anchors)) {
      expect(source.startsWith("specs/")).toBe(true);
      expect(
        markdownAnchors(read(source)).map((entry) => entry.anchor),
        source,
      ).toContain(`#${anchor}`);
    }
  });

  it.each(documents)("resolves actual relative file and section links in %s", (source) => {
    const text = read(source);
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const href = match[1] ?? "";
      if (/^[a-z][a-z\d+.-]*:/i.test(href)) continue;
      const target = new URL(href, new URL(source, root));
      const anchor = target.hash;
      target.hash = "";
      expect(existsSync(target), `${source}: ${href}`).toBe(true);
      if (anchor !== "" && target.pathname.endsWith(".md"))
        expect(
          markdownAnchors(readFileSync(target, "utf8")).map((entry) => entry.anchor),
          `${source}: ${href}`,
        ).toContain(anchor);
    }
  });

  it("keeps the historical Read+Update alias with its heading in Write", () => {
    const source = "specs/profiles/write/write.md";
    const alias = markdownAnchors(read(source)).find(
      (entry) => entry.anchor === "#part-ii--readupdate",
    );
    expect(alias?.aliasOf).toBe("#part-iii--readupdate");
    expect(map.anchors["part-ii--readupdate"]).toBe(source);
    for (const [anchor, owner] of Object.entries(map.anchors))
      expect(read("docs/specs/bdp.md")).toContain(`](../../${owner}#${anchor})`);
  });

  it("retains repository boundaries for test citation source reads", () => {
    expect(() => readSpecificationSource("../outside.md")).toThrow("escapes the repository root");
    expect(() => readSpecificationSource("file:///etc/hosts")).toThrow(
      "escapes the repository root",
    );
    expect(readSpecificationSource("specs/profiles/core/core.md")).toContain("Part II — Read");
  });

  it("leaves navigation rather than competing requirements at the former monolith", () => {
    const legacy = read("docs/specs/bdp.md");
    expect(legacy).toContain("non-normative navigation only");
    expect(legacy).not.toMatch(/\b(?:MUST|SHALL|SHOULD|REQUIRED)\b/);
    expect(existsSync(new URL("schemas/bdp-v0.schema.json", root))).toBe(false);
  });
});
