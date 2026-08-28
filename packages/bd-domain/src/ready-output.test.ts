import { describe, expect, it } from "vitest";
import { ReadyOutputCompatibilityError, renderReadyJson, renderReadyText } from "./ready-output.js";

describe("ready output", () => {
  const result = [
    {
      bead: {
        id: "https://example/beads/a",
        type: "https://example/types/task",
        revision: "1",
        properties: {
          id: "demo-a",
          title: "A",
          status: "open",
          priority: 2,
          issue_type: "task",
          owner: "bdp-conformance@invalid",
          created_at: "2026-08-08T23:33:31Z",
          created_by: "bdp-conformance",
          updated_at: "2026-08-08T23:33:35Z",
          dependencies: [
            {
              issue_id: "demo-a",
              depends_on_id: "demo-c",
              type: "blocks",
              created_at: "2026-08-08T23:33:32Z",
              created_by: "bdp-conformance",
              metadata: "{}",
            },
          ],
          dependency_count: 1,
          dependent_count: 0,
          comment_count: 0,
          extension: "must-not-leak",
        },
      },
      blockers: [],
    },
  ] as const;
  it("renders the pinned flat bd ready JSON shape without protocol wrappers", () =>
    expect(JSON.parse(renderReadyJson(result))).toEqual([
      {
        id: "demo-a",
        title: "A",
        status: "open",
        priority: 2,
        issue_type: "task",
        owner: "bdp-conformance@invalid",
        created_at: "2026-08-08T23:33:31Z",
        created_by: "bdp-conformance",
        updated_at: "2026-08-08T23:33:35Z",
        dependencies: [
          {
            issue_id: "demo-a",
            depends_on_id: "demo-c",
            type: "blocks",
            created_at: "2026-08-08T23:33:32Z",
            created_by: "bdp-conformance",
            metadata: "{}",
          },
        ],
        dependency_count: 1,
        dependent_count: 0,
        comment_count: 0,
      },
    ]));
  it("renders deterministic titles for humans", () => expect(renderReadyText(result)).toBe("A\n"));
  it.each([
    ["missing required field", { ...result[0].bead.properties, created_at: undefined }],
    ["invalid required field", { ...result[0].bead.properties, priority: Number.NaN }],
    ["fractional priority", { ...result[0].bead.properties, priority: 1.5 }],
    ["negative count", { ...result[0].bead.properties, dependency_count: -1 }],
    ["impossible timestamp", { ...result[0].bead.properties, created_at: "2026-02-30T00:00:00Z" }],
    ["empty local ID", { ...result[0].bead.properties, id: "" }],
    ["invalid optional field", { ...result[0].bead.properties, owner: 42 }],
    ["invalid dependency", { ...result[0].bead.properties, dependencies: [{}] }],
  ])("fails closed for %s", (_label, properties) => {
    const incompatible = [{ ...result[0], bead: { ...result[0].bead, properties } }];
    expect(() => renderReadyJson(incompatible)).toThrow(ReadyOutputCompatibilityError);
  });
  it("falls back to the Bead ID for terminal control characters", () => {
    const unsafe = [
      { ...result[0], bead: { ...result[0].bead, properties: { title: "A\u001b[2J" } } },
    ];
    expect(renderReadyText(unsafe)).toBe("https://example/beads/a\n");
  });
  it("renders an empty result without a phantom line", () => {
    expect(renderReadyJson([])).toBe("[]\n");
    expect(renderReadyText([])).toBe("");
  });
});
