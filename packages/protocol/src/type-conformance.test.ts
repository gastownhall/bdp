import { describe, expect, it } from "vitest";

import {
  createTypeConformanceIndex,
  ProtocolArtifactValidationError,
  type TypeDescriptor,
} from "./index.js";

const root = descriptor("https://types.example/work-item", "bead", []);
const task = descriptor("https://types.example/task", "bead", [root.id]);
const urgentTask = descriptor("https://types.example/urgent-task", "bead", [task.id]);
const blocks = descriptor("https://types.example/blocks", "link", []);

describe("Type conformance index", () => {
  it("includes the declared Type and its complete transitive closure", () => {
    const index = createTypeConformanceIndex([root, task, urgentTask, blocks]);
    expect(index.includes(urgentTask.id, urgentTask.id)).toBe(true);
    expect(index.includes(urgentTask.id, task.id)).toBe(true);
    expect(index.includes(urgentTask.id, root.id)).toBe(true);
    expect(index.includes(task.id, urgentTask.id)).toBe(false);
    expect(index.includes(blocks.id, root.id)).toBe(false);
    expect(index.includes("https://types.example/unknown", "https://types.example/unknown")).toBe(
      true,
    );
  });

  it("rejects duplicate, incomplete, cross-category, and cyclic installed closures", () => {
    expect(() => createTypeConformanceIndex([root, root])).toThrow(ProtocolArtifactValidationError);
    expect(() => createTypeConformanceIndex([root, root])).toThrow(/duplicate Type Descriptor/);
    expect(() =>
      createTypeConformanceIndex([
        descriptor("https://types.example/orphan", "bead", ["https://types.example/missing"]),
      ]),
    ).toThrow(/missing parent/);
    expect(() =>
      createTypeConformanceIndex([
        root,
        descriptor("https://types.example/crossing", "link", [root.id]),
      ]),
    ).toThrow(/crosses the link\/bead boundary/);
    expect(() =>
      createTypeConformanceIndex([
        descriptor("https://types.example/a", "bead", ["https://types.example/b"]),
        descriptor("https://types.example/b", "bead", ["https://types.example/a"]),
      ]),
    ).toThrow(/contains a cycle/);
  });
});

function descriptor(
  id: string,
  describes: "bead" | "link",
  conformsTo: readonly string[],
): TypeDescriptor {
  return describes === "bead"
    ? { id, name: id, describes, conformsTo }
    : {
        id,
        name: id,
        describes,
        conformsTo,
        source: { conformsTo: [] },
        target: { conformsTo: [] },
      };
}
