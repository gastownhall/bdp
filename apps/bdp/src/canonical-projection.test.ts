import { describe, expect, it } from "vitest";
import { stringifyJsonValue, type RetainedJsonObject } from "@bdp/protocol";
import {
  CanonicalProjectionError,
  projectCanonicalProperties,
  validateCanonicalPropertiesMasks,
} from "./canonical-projection.js";

const project = projectCanonicalProperties;
describe("canonical properties-view local masks", () => {
  it("copies the whole value without masks, keeping absence, null and ordinary identity-looking fields", () => {
    const value = {
      id: "data",
      type: { revision: "data" },
      revision: 2,
      nil: null,
      values: [false, 0, ""],
    };
    const projected = project(value, {});
    expect(projected).toEqual(value);
    expect(projected).not.toBe(value);
    expect(projected.type).not.toBe(value.type);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.values)).toBe(true);
    expect(project(value, { include: ["/id"] })).toEqual({ id: "data" });
    expect(project(value, { omit: ["/id", "/type/revision", "/revision"] })).toEqual({
      type: {},
      nil: null,
      values: [false, 0, ""],
    });
  });
  it("unions includes in original object order, retains ancestors, and tolerates duplicates/overlap", () => {
    const value = { z: { a: 1, b: 2 }, first: 3, other: true };
    const projected = project(value, { include: ["/first", "/z/a", "/z", "/z/a"] });
    expect(stringifyJsonValue(projected)).toBe('{"z":{"a":1,"b":2},"first":3}');
    expect(project(value, { include: ["/z/a", "/z/b"] })).toEqual({ z: { a: 1, b: 2 } });
    expect(project(value, { include: [] })).toEqual({});
  });
  it("root include selects the whole object before omissions, and empty objects remain values", () => {
    const value = { nested: {}, keep: { x: 1 }, other: false };
    expect(project(value, { include: ["", "/missing"], omit: ["/other"] })).toEqual({
      nested: {},
      keep: { x: 1 },
    });
    expect(project(value, { include: ["/nested"] })).toEqual({ nested: {} });
    expect(project({}, { include: [""] })).toEqual({});
  });
  it("missing or wrong-shaped includes are no-ops and do not fabricate containers", () => {
    const value = { scalar: 1, nil: null, object: {}, array: [1] };
    expect(
      project(value, {
        include: ["/absent", "/scalar/x", "/nil/x", "/object/missing", "/array/8", "/array/0/x"],
      }),
    ).toEqual({});
    expect(
      project(value, { omit: ["/absent/x", "/scalar/x", "/nil/x", "/array/8", "/array/0/x"] }),
    ).toEqual(value);
  });
  it("keeps included ancestors after descendant subtraction without reviving omitted ancestors", () => {
    const value = { a: { b: { x: 1, y: 2 } }, array: [{ x: 1, y: 2 }] };
    expect(project(value, { include: ["/a/b/x"], omit: ["/a/b/x"] })).toEqual({ a: { b: {} } });
    expect(project(value, { include: ["/a/b/x"], omit: ["/a/b"] })).toEqual({ a: {} });
    expect(project(value, { include: ["/array/0/x"], omit: ["/array/0/x"] })).toEqual({
      array: [{}],
    });
    expect(project(value, { include: ["/array/0/x"], omit: ["/array/0"] })).toEqual({ array: [] });
  });
  it("evaluates include and omit array indexes against the original and compacts only once", () => {
    const value = {
      rows: [
        { a: "zero", b: 0 },
        { a: "one", b: 1 },
        { a: "two", b: 2 },
        { a: "three", b: 3 },
      ],
    };
    const masks = {
      include: ["/rows/3/a", "/rows/1", "/rows/0/a", "/rows/3/b"],
      omit: ["/rows/0", "/rows/1/b", "/rows/3/b", "/rows/0"],
    };
    expect(project(value, masks)).toEqual({ rows: [{ a: "one" }, { a: "three" }] });
    expect(value.rows).toHaveLength(4);
    expect(value.rows[1]).toEqual({ a: "one", b: 1 });
    expect(masks).toEqual({
      include: ["/rows/3/a", "/rows/1", "/rows/0/a", "/rows/3/b"],
      omit: ["/rows/0", "/rows/1/b", "/rows/3/b", "/rows/0"],
    });
  });
  it("preserves original ordering across nested arrays and does not pad nulls", () => {
    const value = { grid: [["a", "b", "c"], ["d"], ["e", "f", "g"]] };
    expect(
      project(value, { include: ["/grid/2/2", "/grid/0/2", "/grid/0/0"], omit: ["/grid/0/0"] }),
    ).toEqual({ grid: [["c"], ["g"]] });
    expect(project(value, { omit: ["/grid/0", "/grid/2/1"] })).toEqual({
      grid: [["d"], ["e", "g"]],
    });
  });
  it("treats canonical decimal segments as array indexes only in arrays", () => {
    const value = { array: ["zero", "one"], object: { "01": true, "-": false, length: "data" } };
    expect(
      project(value, {
        include: [
          "/array/01",
          "/array/-",
          "/array/length",
          "/array/9007199254740993",
          "/object/01",
          "/object/-",
          "/object/length",
        ],
      }),
    ).toEqual({ object: { "01": true, "-": false, length: "data" } });
  });
  it("decodes RFC6901 exactly once, including literal empty keys and prototype-like keys", () => {
    const value: RetainedJsonObject = {
      "": { "": 1 },
      "a/b": { "~": 2 },
      "~1": 3,
      ["__proto__"]: { constructor: 4 },
    };
    expect(
      project(value, { include: ["//", "/a~1b/~0", "/~01", "/__proto__/constructor"] }),
    ).toEqual(value);
    expect(project(value, { omit: ["/", "/a~1b/~0", "/~01"] })).toEqual({
      "a/b": {},
      ["__proto__"]: { constructor: 4 },
    });
    expect(Object.getPrototypeOf(project(value, {}))).toBe(null);
  });
  it.each(["id", "#", "#/id", "$.id", "/bad~", "/bad~2", "/bad~10~", "\ud800"])(
    "refuses malformed pointers: %s",
    (mask) => {
      expect(() => project({}, { include: [mask] })).toThrow(CanonicalProjectionError);
      expect(() => validateCanonicalPropertiesMasks({ omit: [mask] })).toThrow(
        CanonicalProjectionError,
      );
    },
  );
  it("refuses root omission even on an empty selection and validates all overlapping pointers", () => {
    expect(() => project({}, { include: [], omit: [""] })).toThrow("root omission");
    expect(() => project({}, { include: ["", "/bad~2"] })).toThrow(CanonicalProjectionError);
    expect(() => project({}, { omit: ["/a", "/a/bad~2"] })).toThrow(CanonicalProjectionError);
  });
  it("does not interpret framing or Resource context within this properties-view function", () => {
    const value = {
      envelope: { id: "ordinary" },
      source: { uri: "ordinary", revision: "ordinary" },
    };
    expect(project(value, { omit: ["/envelope", "/source/revision"] })).toEqual({
      source: { uri: "ordinary" },
    });
    expect(() => project(value, { omit: ["envelope"] })).toThrow(CanonicalProjectionError);
  });
});
