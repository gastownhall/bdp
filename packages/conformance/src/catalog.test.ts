import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CatalogValidationError,
  CONFORMANCE_RESULT_STATES,
  isConformanceResultState,
  isSymbolicUrl,
  loadScenarioCatalogJson,
  parseScenarioCatalog,
  profileIncludes,
  SYMBOLIC_URLS,
  selectApplicableScenariosForProfile,
  selectDiagnosticScenariosForProfile,
  selectNormativeScenariosForProfile,
  validateCatalogCitations,
} from "./index.js";

const CITATION = {
  source: "docs/specs/bdp.md",
  anchor: "#conformance-profiles-and-reading-guide",
  selectedText: "Claiming a higher profile claims every lower profile:",
};

function scenario(
  id: string,
  requiredProfile: "read" | "read-update" | "transactional",
  kind: "normative" | "diagnostic" = "normative",
) {
  return {
    id,
    title: `Scenario ${id}`,
    kind,
    requiredProfile,
    requirements: [CITATION],
  };
}

describe("scenario metadata catalog", () => {
  it("returns a closed copy of a valid catalog", () => {
    const source = { catalogVersion: 1, scenarios: [scenario("read.discovery", "read")] };
    const catalog = parseScenarioCatalog(source);

    expect(catalog).toEqual(source);
    expect(catalog).not.toBe(source);
    expect(catalog.scenarios[0]).not.toBe(source.scenarios[0]);
    expect(catalog.scenarios[0]?.requirements[0]).not.toBe(source.scenarios[0]?.requirements[0]);
  });

  it("loads JSON and includes the source label in failures", () => {
    expect(loadScenarioCatalogJson(JSON.stringify({ catalogVersion: 1, scenarios: [] }))).toEqual({
      catalogVersion: 1,
      scenarios: [],
    });
    expect(() => loadScenarioCatalogJson("{", "catalog.json")).toThrowError(
      /^catalog\.json: validation failed/,
    );
  });

  it.each([
    [null, ["$"]],
    [[], ["$"]],
    [{ catalogVersion: 2, scenarios: [] }, ["$.catalogVersion"]],
    [{ catalogVersion: 1, scenarios: {} }, ["$.scenarios"]],
    [{ catalogVersion: 1, scenarios: [null] }, ["$.scenarios[0]"]],
  ] as const)("rejects malformed top-level or scenario shape %#", (value, paths) => {
    expectIssues(value, paths);
  });

  it("rejects duplicate identifiers with one unambiguous diagnostic", () => {
    expectIssues(
      {
        catalogVersion: 1,
        scenarios: [scenario("read.discovery", "read"), scenario("read.discovery", "read")],
      },
      ["$.scenarios[1].id"],
    );
  });

  it("rejects invalid, overlong, and non-string scenario fields", () => {
    expectIssues(
      {
        catalogVersion: 1,
        scenarios: [
          { ...scenario("Read Discovery", "read"), title: 7, kind: "case" },
          scenario(`a${"b".repeat(128)}`, "read"),
        ],
      },
      ["$.scenarios[0].id", "$.scenarios[0].title", "$.scenarios[0].kind", "$.scenarios[1].id"],
    );
  });

  it("rejects missing, nonobject, empty, and malformed citations", () => {
    expectIssues(
      {
        catalogVersion: 1,
        scenarios: [
          { ...scenario("read.empty", "read"), requirements: [] },
          { ...scenario("read.nonobject", "read"), requirements: ["citation"] },
          {
            ...scenario("read.malformed", "read"),
            requiredProfile: "read+update",
            requirements: [{ source: 3, anchor: "#", selectedText: false }],
          },
        ],
      },
      [
        "$.scenarios[0].requirements",
        "$.scenarios[1].requirements[0]",
        "$.scenarios[2].requiredProfile",
        "$.scenarios[2].requirements[0].source",
        "$.scenarios[2].requirements[0].selectedText",
        "$.scenarios[2].requirements[0].anchor",
      ],
    );
  });

  it("rejects inherited records, class instances, and inherited required fields", () => {
    class CatalogLike {
      catalogVersion = 1;
      scenarios: readonly unknown[] = [];
    }
    expectIssues(new CatalogLike(), ["$"]);

    const inherited = Object.create({ kind: "normative" }) as Record<string, unknown>;
    Object.assign(inherited, scenario("read.inherited", "read"));
    delete inherited.kind;
    expectIssues({ catalogVersion: 1, scenarios: [inherited] }, ["$.scenarios[0]"]);
  });

  it("quotes unusual unknown keys in issue paths", () => {
    expectIssues({ catalogVersion: 1, scenarios: [], "wire.schema": true }, ['$["wire.schema"]']);
  });
});

describe("repository-aware requirement citations", () => {
  const catalog = parseScenarioCatalog({
    catalogVersion: 1,
    scenarios: [scenario("read.discovery", "read")],
  });
  const markdown = `# BDP\n\n## Conformance profiles and reading guide\n\nClaiming a higher\nprofile claims every lower profile:\n\n### Detail\nStill in the section.\n\n## Other\nNot in the section.\n`;

  it("accepts an existing source, anchor, and whitespace-normalized excerpt", () => {
    expect(() =>
      validateCatalogCitations(catalog, (source) =>
        source === "docs/specs/bdp.md" ? markdown : undefined,
      ),
    ).not.toThrow();
  });

  it("validates the current citation against the real repository source", () => {
    validateCatalogCitations(catalog, (source) =>
      readFileSync(path.resolve(process.cwd(), source), "utf8"),
    );
  });

  it("rejects a missing source", () => {
    expectCitationIssue(catalog, () => undefined, "$.scenarios[0].requirements[0].source");
  });

  it("rejects a missing anchor", () => {
    expectCitationIssue(catalog, () => "# Different", "$.scenarios[0].requirements[0].anchor");
  });

  it("rejects excerpt drift within an otherwise valid section", () => {
    expectCitationIssue(
      catalog,
      () => markdown.replace("every lower profile:", "some lower profiles."),
      "$.scenarios[0].requirements[0].selectedText",
    );
  });

  it("rejects text found only after the following same-level heading", () => {
    const outsideTextCatalog = catalogWithCitation({
      ...CITATION,
      selectedText: "Not in the section.",
    });
    expectCitationIssue(
      outsideTextCatalog,
      () => markdown,
      "$.scenarios[0].requirements[0].selectedText",
    );
  });

  it("ignores false anchors and section boundaries inside matching code fences", () => {
    const fencedMarkdown = `# BDP

\`\`\`markdown
## False anchor
\`\`\`

## Real section
Inside real section.

~~~markdown
## False boundary
~~~

Still inside real section.

## Following section
Outside real section.
`;
    validateCatalogCitations(
      catalogWithCitation({
        source: "docs/specs/bdp.md",
        anchor: "#real-section",
        selectedText: "Still inside real section.",
      }),
      () => fencedMarkdown,
    );
    expectCitationIssue(
      catalogWithCitation({
        source: "docs/specs/bdp.md",
        anchor: "#false-anchor",
        selectedText: "False anchor",
      }),
      () => fencedMarkdown,
      "$.scenarios[0].requirements[0].anchor",
    );
  });

  it("uses duplicate heading slugs while ignoring fenced duplicates", () => {
    const duplicateMarkdown = `## Repeated
First section.

\`\`\`markdown
## Repeated
\`\`\`

## Repeated
Second section.
`;
    validateCatalogCitations(
      catalogWithCitation({
        source: "docs/specs/bdp.md",
        anchor: "#repeated-1",
        selectedText: "Second section.",
      }),
      () => duplicateMarkdown,
    );
  });
});

describe("cumulative profile selection", () => {
  const catalog = parseScenarioCatalog({
    catalogVersion: 1,
    scenarios: [
      scenario("read.normative", "read"),
      scenario("read.diagnostic", "read", "diagnostic"),
      scenario("read-update.normative", "read-update"),
      scenario("transactional.diagnostic", "transactional", "diagnostic"),
    ],
  });

  it("derives the cumulative relation and fails fast for invalid JavaScript input", () => {
    expect(profileIncludes("read", "read")).toBe(true);
    expect(profileIncludes("read", "read-update")).toBe(false);
    expect(profileIncludes("transactional", "read-update")).toBe(true);
    expect(() => profileIncludes("invalid" as "read", "read")).toThrow(RangeError);
  });

  it("keeps diagnostics out of normative claim selection", () => {
    expect(selectNormativeScenariosForProfile(catalog, "read-update").map(({ id }) => id)).toEqual([
      "read.normative",
      "read-update.normative",
    ]);
  });

  it("provides explicit applicable and diagnostic selections", () => {
    expect(selectApplicableScenariosForProfile(catalog, "read").map(({ id }) => id)).toEqual([
      "read.normative",
      "read.diagnostic",
    ]);
    expect(
      selectDiagnosticScenariosForProfile(catalog, "transactional").map(({ id }) => id),
    ).toEqual(["read.diagnostic", "transactional.diagnostic"]);
  });

  it("returns an empty selection when no entry applies", () => {
    const transactionalOnly = parseScenarioCatalog({
      catalogVersion: 1,
      scenarios: [scenario("transactional.only", "transactional")],
    });
    expect(selectNormativeScenariosForProfile(transactionalOnly, "read")).toEqual([]);
    expect(selectDiagnosticScenariosForProfile(transactionalOnly, "read")).toEqual([]);
  });

  it("rejects an invalid claimed profile even when the catalog is empty", () => {
    const empty = parseScenarioCatalog({ catalogVersion: 1, scenarios: [] });
    // Validate before iteration so an empty catalog cannot make invalid caller
    // input look like a legitimate empty selection.
    expect(() => selectApplicableScenariosForProfile(empty, "invalid" as "read")).toThrow(
      RangeError,
    );
  });
});

describe("runner vocabulary", () => {
  it("defines exactly the five result states from the component contract", () => {
    expect(CONFORMANCE_RESULT_STATES).toEqual([
      "pass",
      "fail",
      "not-applicable",
      "unsupported-profile",
      "harness-error",
    ]);
    for (const state of CONFORMANCE_RESULT_STATES)
      expect(isConformanceResultState(state)).toBe(true);
    expect(isConformanceResultState("skipped")).toBe(false);
    expect(isConformanceResultState(null)).toBe(false);
  });

  it("distinguishes the Link inventory from an incident-Link view", () => {
    expect(SYMBOLIC_URLS).toEqual([
      "$scope",
      "$service-desc",
      "$beads",
      "$links",
      "$types",
      "$bead-links",
      "$next",
    ]);
    for (const symbol of SYMBOLIC_URLS) expect(isSymbolicUrl(symbol)).toBe(true);
    expect(isSymbolicUrl("beads/")).toBe(false);
    expect(isSymbolicUrl("$operations")).toBe(false);
    expect(isSymbolicUrl(7)).toBe(false);
  });
});

function expectIssues(value: unknown, expectedPaths: readonly string[]): void {
  try {
    parseScenarioCatalog(value);
    throw new Error("expected catalog validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CatalogValidationError);
    if (!(error instanceof CatalogValidationError)) return;
    expect(error.issues.map(({ path }) => path)).toEqual(expectedPaths);
  }
}

function expectCitationIssue(
  catalog: ReturnType<typeof parseScenarioCatalog>,
  loader: () => string | undefined,
  expectedPath: string,
): void {
  try {
    validateCatalogCitations(catalog, loader);
    throw new Error("expected citation validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CatalogValidationError);
    if (!(error instanceof CatalogValidationError)) return;
    expect(error.issues.map(({ path }) => path)).toEqual([expectedPath]);
  }
}

function catalogWithCitation(citation: typeof CITATION): ReturnType<typeof parseScenarioCatalog> {
  return parseScenarioCatalog({
    catalogVersion: 1,
    scenarios: [{ ...scenario("read.citation", "read"), requirements: [citation] }],
  });
}
