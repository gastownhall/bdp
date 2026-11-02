import { describe, expect, it } from "vitest";
import type { AdmittedJsonValue } from "@bdp/protocol";
import { applyObjectChange, ObjectEditFailure, type ObjectChange } from "./object-edits.js";

interface PatchCase {
  readonly name: string;
  readonly before: Record<string, AdmittedJsonValue>;
  readonly change: ObjectChange;
  readonly after: Record<string, AdmittedJsonValue>;
}
const examples: readonly PatchCase[] = [
  {
    name: "add replaces an existing object member",
    before: { x: 1 },
    change: [{ op: "add", path: "/x", value: 2 }],
    after: { x: 2 },
  },
  {
    name: "add creates a new member",
    before: {},
    change: [{ op: "add", path: "/x", value: null }],
    after: { x: null },
  },
  {
    name: "remove differs from assigning null",
    before: { x: null, y: true },
    change: [{ op: "remove", path: "/x" }],
    after: { y: true },
  },
  {
    name: "array insertion shifts existing elements",
    before: { x: [1, 2] },
    change: [{ op: "add", path: "/x/1", value: 3 }],
    after: { x: [1, 3, 2] },
  },
  {
    name: "dash appends to an array",
    before: { x: [1] },
    change: [{ op: "add", path: "/x/-", value: 2 }],
    after: { x: [1, 2] },
  },
  {
    name: "numeric length appends to an array",
    before: { x: [1] },
    change: [{ op: "add", path: "/x/1", value: 2 }],
    after: { x: [1, 2] },
  },
  {
    name: "array removal closes the gap",
    before: { x: [1, 2, 3] },
    change: [{ op: "remove", path: "/x/1" }],
    after: { x: [1, 3] },
  },
  {
    name: "array replacement preserves length",
    before: { x: [1, 2] },
    change: [{ op: "replace", path: "/x/0", value: null }],
    after: { x: [null, 2] },
  },
  {
    name: "later steps see earlier additions",
    before: {},
    change: [
      { op: "add", path: "/parent", value: {} },
      { op: "add", path: "/parent/child", value: [1] },
      { op: "add", path: "/parent/child/-", value: 2 },
    ],
    after: { parent: { child: [1, 2] } },
  },
  {
    name: "root replacement clears the object",
    before: { x: 1 },
    change: [{ op: "replace", path: "", value: {} }],
    after: {},
  },
  {
    name: "root add is literal replacement",
    before: { x: 1 },
    change: [{ op: "add", path: "", value: { y: null } }],
    after: { y: null },
  },
  {
    name: "root can be removed then restored",
    before: { x: 1 },
    change: [
      { op: "remove", path: "" },
      { op: "add", path: "", value: { restored: true } },
    ],
    after: { restored: true },
  },
  {
    name: "only the final document must be an object",
    before: {},
    change: [
      { op: "replace", path: "", value: [] },
      { op: "add", path: "/-", value: 1 },
      { op: "replace", path: "", value: { done: true } },
    ],
    after: { done: true },
  },
  {
    name: "escaped slash and tilde select literal names",
    before: { "a/b": { "~": 1 } },
    change: [{ op: "replace", path: "/a~1b/~0", value: 2 }],
    after: { "a/b": { "~": 2 } },
  },
  {
    name: "empty property names are valid",
    before: { "": 1 },
    change: [{ op: "replace", path: "/", value: 2 }],
    after: { "": 2 },
  },
];
describe("ordinary object-edit behavioral boundary", () => {
  it.each(examples)("$name", ({ before, change, after }) => {
    const original = JSON.stringify(before);
    expect(applyObjectChange(before, change)).toEqual(after);
    expect(JSON.stringify(before)).toBe(original);
  });
  it.each(["/x/01", "/x/-1", "/x/3", "/x/9007199254740993", "/x/length"])(
    "refuses invalid array add position %s",
    (path) => {
      expect(() => applyObjectChange({ x: [1] }, [{ op: "add", path, value: 2 }])).toThrow(
        ObjectEditFailure,
      );
    },
  );
  it.each(["replace", "remove"] as const)("%s requires an existing own target", (op) => {
    for (const path of ["/missing", "/toString", "/x/1", "/x/-", "/parent/child", "/value/child"]) {
      const change: ObjectChange = op === "remove" ? [{ op, path }] : [{ op, path, value: null }];
      expect(() => applyObjectChange({ x: [1], value: true }, change)).toThrow(ObjectEditFailure);
    }
  });
  it.each([null, [], "scalar", 1])("refuses a final nonobject document %j", (value) => {
    expect(() => applyObjectChange({}, [{ op: "replace", path: "", value }])).toThrow(
      ObjectEditFailure,
    );
  });
  it("refuses a removed final root and never mutates the input on later failure", () => {
    const before = { nested: { value: 1 } };
    expect(() =>
      applyObjectChange(before, [
        { op: "replace", path: "/nested/value", value: 2 },
        { op: "remove", path: "/absent" },
      ]),
    ).toThrow(ObjectEditFailure);
    expect(before).toEqual({ nested: { value: 1 } });
    expect(() => applyObjectChange(before, [{ op: "remove", path: "" }])).toThrow(
      ObjectEditFailure,
    );
    expect(() =>
      applyObjectChange(before, [
        { op: "remove", path: "" },
        { op: "replace", path: "", value: {} },
      ]),
    ).toThrow(ObjectEditFailure);
  });
  it("treats prototype-looking names as data without traversing inherited members", () => {
    const before = JSON.parse('{"__proto__":{"x":1},"constructor":{"prototype":{"safe":true}}}');
    const after = applyObjectChange(before, [
      { op: "replace", path: "/__proto__/x", value: 2 },
      { op: "replace", path: "/constructor/prototype/safe", value: false },
    ]);
    expect(JSON.stringify(after)).toBe(
      '{"__proto__":{"x":2},"constructor":{"prototype":{"safe":false}}}',
    );
    expect(Object.prototype).not.toHaveProperty("x");
    expect(Object.prototype).not.toHaveProperty("safe");
    expect(() => applyObjectChange({}, [{ op: "add", path: "/__proto__/x", value: 2 }])).toThrow(
      ObjectEditFailure,
    );
  });
});
