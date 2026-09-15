import { describe, expect, it } from "vitest";

import {
  createTypeConformanceIndex,
  ProtocolArtifactValidationError,
  type TypeDescriptor,
  type TypeConformanceIndex,
} from "./index.js";

const root = descriptor("https://types.example/work-item", "bead", []);
const task = descriptor("https://types.example/task", "bead", [root.id]);
const urgentTask = descriptor("https://types.example/urgent-task", "bead", [task.id]);
const blocks = descriptor("https://types.example/blocks", "link", []);

describe("Type conformance index", () => {
  it("accepts the original minimal structural interface", () => {
    const index: TypeConformanceIndex = { includes: (declared, required) => declared === required };
    expect(index.includes(root.id, root.id)).toBe(true);
    expect(index.includes(root.id, task.id)).toBe(false);
  });
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

describe("iterative administrative Type conformance", () => {
  const generous = { nodes: 100, edges: 100, depth: 100, memberships: 1000, unionAttempts: 1000 };
  const diamond = [
    descriptor("https://t/d", "bead", ["https://t/b", "https://t/c"]),
    descriptor("https://t/b", "bead", ["https://t/a"]),
    descriptor("https://t/c", "bead", ["https://t/a"]),
    descriptor("https://t/a", "bead", []),
  ];
  it("counts real union attempts separately from deduplicated membership across input orders", () => {
    for (const values of [
      diamond,
      [...diamond].reverse(),
      [diamond[2], diamond[0], diamond[3], diamond[1]],
    ]) {
      const index = createTypeConformanceIndex(values as TypeDescriptor[], generous);
      expect(index.statistics).toEqual({
        nodes: 4,
        edges: 4,
        depth: 3,
        memberships: 9,
        unionAttempts: 6,
      });
      expect(Object.isFrozen(index.statistics)).toBe(true);
      expect(index.includes("https://t/d", "https://t/a")).toBe(true);
      expect(index.includes("https://t/b", "https://t/c")).toBe(false);
    }
  });
  it.each([
    ["nodes", 4],
    ["edges", 4],
    ["depth", 3],
    ["memberships", 9],
    ["unionAttempts", 6],
  ] as const)("enforces exact %s bounds before the next operation", (key, bound) => {
    expect(createTypeConformanceIndex(diamond, { ...generous, [key]: bound }).statistics[key]).toBe(
      bound,
    );
    for (const order of [diamond, [...diamond].reverse()])
      expect(() => createTypeConformanceIndex(order, { ...generous, [key]: bound - 1 })).toThrow(
        `Type conformance ${key} limit exceeded`,
      );
  });
  it("walks beyond the native stack before its first membership allocation", () => {
    const chain = Array.from({ length: 16000 }, (_, i) =>
      descriptor(`https://t/${i}`, "bead", i === 15999 ? [] : [`https://t/${i + 1}`]),
    );
    expect(() =>
      createTypeConformanceIndex(chain, {
        nodes: 16000,
        edges: 15999,
        depth: 16000,
        memberships: 0,
        unionAttempts: 0,
      }),
    ).toThrow("Type conformance memberships limit exceeded");
    chain[15999] = descriptor("https://t/15999", "bead", ["https://t/0"]);
    expect(() => createTypeConformanceIndex(chain)).toThrow(/contains a cycle/);
  });
  it("computes longest path even when parent results were already memoized", () => {
    const chain = Array.from({ length: 70 }, (_, i) =>
      descriptor(`https://t/${i}`, "bead", i === 0 ? [] : [`https://t/${i - 1}`]),
    );
    for (const order of [chain, [...chain].reverse()]) {
      const index = createTypeConformanceIndex(order);
      expect(index.statistics).toEqual({
        nodes: 70,
        edges: 69,
        depth: 70,
        memberships: 2485,
        unionAttempts: 2415,
      });
      expect(() =>
        createTypeConformanceIndex(order, {
          ...generous,
          depth: 69,
          memberships: 10000,
          unionAttempts: 10000,
        }),
      ).toThrow("depth limit exceeded");
    }
  });
  it("keeps empty-closure and unknown self-inclusion behavior without administrative defaults", () => {
    const index = createTypeConformanceIndex([], {
      nodes: 0,
      edges: 0,
      depth: 0,
      memberships: 0,
      unionAttempts: 0,
    });
    expect(index.statistics).toEqual({
      nodes: 0,
      edges: 0,
      depth: 0,
      memberships: 0,
      unionAttempts: 0,
    });
    expect(index.includes("https://unknown/x", "https://unknown/x")).toBe(true);
    expect(() => createTypeConformanceIndex([], { ...generous, depth: NaN })).toThrow(TypeError);
  });
});
