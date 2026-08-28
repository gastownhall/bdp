import { describe, expect, it } from "vitest";

import { serializeConformanceReport, type ConformanceRunResult } from "./index.js";

describe("deterministic report serialization", () => {
  it("sorts object keys recursively and appends one newline", () => {
    const report = {
      reportVersion: 3,
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      selectedScenarioIds: ["read.discovery"],
      artifacts: {
        catalogDigest: "catalog",
        manifestDigest: "manifest",
        fixtureDigest: "fixture",
      },
      declarations: { targetLabel: "target" },
      scenarios: [
        {
          id: "read.discovery",
          requiredProfile: "read",
          state: "pass",
          requirements: ["docs/specs/bdp.md#scope-discovery-and-human-documentation"],
          exchanges: [
            {
              request: {
                id: "scope",
                method: "GET",
                url: "https://scope.example/",
                headers: {},
              },
              response: {
                url: "https://scope.example/",
                status: 200,
                headers: { zeta: "z", alpha: "a", Alpha: "A", é: "unicode" },
                decodedBodyBytes: 0,
                bodyKind: "empty",
              },
              assertions: [{ id: "status", passed: true }],
            },
          ],
        },
      ],
      claimEligible: false,
    } satisfies ConformanceRunResult;

    const first = serializeConformanceReport(report);
    const second = serializeConformanceReport({
      ...report,
      scenarios: report.scenarios.map((scenario) => ({ ...scenario })),
    });
    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
    expect(first.indexOf('"Alpha":"A"')).toBeLessThan(first.indexOf('"alpha":"a"'));
    expect(first.indexOf('"alpha":"a"')).toBeLessThan(first.indexOf('"zeta":"z"'));
    expect(first.indexOf('"zeta":"z"')).toBeLessThan(first.indexOf('"é":"unicode"'));
  });

  it("preserves fail-closed scenario categories", () => {
    const report = {
      reportVersion: 3,
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      selectedScenarioIds: ["read.pending"],
      artifacts: {
        catalogDigest: "catalog",
        manifestDigest: "manifest",
        fixtureDigest: "fixture",
      },
      declarations: { targetLabel: "target" },
      scenarios: [
        {
          id: "read.pending",
          requiredProfile: "read",
          state: "harness-error",
          category: "not-implemented",
          requirements: [],
          reason: "catalog scenario has no executable plan",
          exchanges: [],
        },
      ],
      claimEligible: false,
    } satisfies ConformanceRunResult;
    expect(serializeConformanceReport(report)).toContain('"category":"not-implemented"');
  });

  it("deterministically serializes redacted programmable-action observations in report v3", () => {
    const report = {
      reportVersion: 3,
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      selectedScenarioIds: ["read.pending"],
      artifacts: { catalogDigest: "catalog", manifestDigest: "manifest", fixtureDigest: "fixture" },
      declarations: { targetLabel: "target" },
      scenarios: [
        {
          id: "read.pending",
          requiredProfile: "read",
          state: "pass",
          requirements: [],
          exchanges: [],
          actions: [
            {
              action: { id: "list", family: "client", operation: "list" },
              output: { kind: "json" },
              assertions: [],
            },
          ],
        },
      ],
      claimEligible: false,
    } satisfies ConformanceRunResult;
    const serialized = serializeConformanceReport(report);
    expect(serialized).toContain('"reportVersion":3');
    expect(serialized).toContain(
      '"actions":[{"action":{"family":"client","id":"list","operation":"list"},"assertions":[],"output":{"kind":"json"}}]',
    );
  });

  it("rejects an erased or JavaScript caller attempting to emit action observations as v2", () => {
    const report = {
      reportVersion: 2,
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      declarations: {
        artifacts: {
          catalog: "catalog-digest",
          manifest: "manifest-digest",
          fixture: "fixture-digest",
        },
        target: "target",
      },
      scenarios: [
        {
          id: "scenario-a",
          status: "pass",
          actions: [
            {
              action: { id: "list", family: "client", operation: "list" },
              output: { kind: "json" },
              assertions: [],
            },
          ],
          cleanup: "pass",
        },
      ],
      claimEligible: false,
    } as unknown as ConformanceRunResult;

    expect(() => serializeConformanceReport(report)).toThrow(
      "unsupported conformance report version",
    );
  });
});
