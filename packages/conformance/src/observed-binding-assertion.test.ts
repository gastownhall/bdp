import { describe, expect, it } from "vitest";
import { createConformanceArtifactBundle } from "./artifact-bundle.js";
import { parseExecutableScenarioManifest } from "./executable-manifest.js";
import { runConformanceMatrix } from "./runner.js";
const scope = "https://example.invalid/";
const encode = (value: unknown) => ({ bytes: Buffer.from(JSON.stringify(value)) });
const fixture = {
  fixtureVersion: 1,
  id: "binding-test",
  seed: 0,
  capabilities: ["synthetic-observations"],
  bindings: {},
};
const catalog = {
  catalogVersion: 1,
  scenarios: [
    {
      id: "read.binding",
      title: "Observed equality",
      kind: "normative",
      requiredProfile: "read",
      requirements: [
        {
          source: "docs/specs/bdp.md",
          anchor: "#scope-discovery-and-human-documentation",
          selectedText: "service-desc",
        },
      ],
    },
  ],
};
function manifest(family: "http" | "client", assertion: Record<string, unknown> = {}) {
  const base =
    family === "http"
      ? { method: "GET", target: { binding: "scope" } }
      : { operation: "observe", input: {} };
  return {
    manifestVersion: 1,
    catalogId: "read-v1",
    scenarios: [
      {
        id: "read.binding",
        requiredProfile: "read",
        setup: { fixture: fixture.id, requires: [] },
        applicability: { requires: [] },
        cleanup: { resetFixture: true },
        actions: [
          {
            ...base,
            family,
            id: "prior",
            captures: [{ binding: "observed", from: { kind: "json-pointer", pointer: "/value" } }],
            assertions: [{ id: "exists", kind: "json-pointer", pointer: "/value", exists: true }],
          },
          {
            ...base,
            family,
            id: "later",
            captures: [],
            assertions: [
              {
                id: "equals-observed",
                kind: "json-pointer",
                pointer: "/value",
                exists: true,
                equalsBinding: "observed",
                ...assertion,
              },
            ],
          },
        ],
      },
    ],
  };
}
describe("shared earlier-observation JSON assertion", () => {
  it.each(["http", "client"] as const)(
    "compares actual %s values without coercion and rejects mismatches",
    async (family) => {
      const prior = family === "http" ? `${scope}beads/a` : { revision: "r1", metadata: { n: 1 } };
      for (const [later, expected] of [
        [prior, "pass"],
        [{ revision: "r2", metadata: { n: 1 } }, "fail"],
        [42, "fail"],
        [undefined, "fail"],
      ] as const) {
        let index = 0;
        const observe = () => ({ value: index++ === 0 ? prior : later });
        const result = await runConformanceMatrix({
          scope,
          profile: "read",
          seed: 0,
          declaredTargetLabel: "observed-binding-test",
          artifactBundle: createConformanceArtifactBundle({
            catalog: encode(catalog),
            manifest: encode(manifest(family)),
            fixture: encode(fixture),
          }),
          execute: async () => ({
            url: scope,
            status: 200,
            headers: {},
            bodyText: JSON.stringify(observe()),
          }),
          actionExecutor: async () => {
            const value = observe();
            return value.value === undefined ? {} : value;
          },
          harness: {
            prepare: async () => ({ capabilities: ["synthetic-observations"] }),
            cleanup: async () => {},
          },
        });
        expect(result.scenarios[0]?.state).toBe(expected);
      }
    },
  );
  it("rejects missing, later, self, scope and mixed-oracle captures before execution", () => {
    for (const value of ["missing", "scope", "later-capture"])
      expect(() =>
        parseExecutableScenarioManifest(manifest("client", { equalsBinding: value })),
      ).toThrow();
    for (const extra of [
      { equals: 1 },
      { fixturePointer: "/oracles/value" },
      { equalsRunProfile: true },
      { exists: false },
      { normalize: "scope-relative-url" },
      { equalsBinding: 42 },
    ])
      expect(() => parseExecutableScenarioManifest(manifest("client", extra))).toThrow();
    const source = manifest("client");
    const first = source.scenarios[0]?.actions[0];
    if (!first) throw Error("missing action");
    first.assertions = [
      {
        id: "self",
        kind: "json-pointer",
        pointer: "/value",
        exists: true,
        equalsBinding: "observed",
      },
    ];
    expect(() => parseExecutableScenarioManifest(source)).toThrow();
  });
});
