import { describe, expect, it } from "vitest";
import type { JsonValue, ScenarioAssertion } from "./executable-manifest.js";
import {
  deepEqual,
  isLiteralJsonPointerAssertion,
  jsonPointer,
  literalJsonPointerMatches,
} from "./json-pointer-verifier.js";

const literal = (
  pointer: string,
  equals?: JsonValue,
): Extract<ScenarioAssertion, { kind: "json-pointer" }> => ({
  id: "independent-vector",
  kind: "json-pointer",
  pointer,
  exists: true,
  ...(equals === undefined ? {} : { equals }),
});

describe("private literal JSON pointer verifier", () => {
  it("uses standard one-pass escapes, empty pointer and exact array indices", () => {
    const body = { "a/b": { "~1": ["zero", "one"] } };
    expect(jsonPointer(body, "")).toBe(body);
    expect(jsonPointer(body, "/a~1b/~01/1")).toBe("one");
    for (const token of ["01", "-1", "+1", "-", "1.0"])
      expect(jsonPointer(["zero", "one"], `/${token}`)).toBeUndefined();
    for (const pointer of ["foo", "/bad~2", "/bad~"])
      expect(jsonPointer({ oo: "not-a-pointer", "bad~2": true }, pointer)).toBeUndefined();
  });
  it("requires own members and preserves missing, undefined and null distinctions", () => {
    const body = Object.assign(Object.create({ inherited: 1 }), {
      own: null,
      undefined: undefined,
    });
    expect(jsonPointer(body, "/inherited")).toBeUndefined();
    expect(jsonPointer(body, "/own")).toBeNull();
    expect(literalJsonPointerMatches(body, literal("/own", null))).toBe(true);
    expect(literalJsonPointerMatches(body, { ...literal("/absent"), exists: false })).toBe(true);
    expect(literalJsonPointerMatches(body, literal("/undefined"))).toBe(false);
    expect(literalJsonPointerMatches(body, { ...literal("/undefined"), exists: false })).toBe(true);
    expect(
      literalJsonPointerMatches(
        JSON.parse('{"__proto__":{"value":2}}'),
        literal("/__proto__/value", 2),
      ),
    ).toBe(true);
  });
  it("compares independent literal JSON values without key-order or array-order confusion", () => {
    expect(deepEqual({ a: [1, 2], b: false }, { b: false, a: [1, 2] })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: null }, {})).toBe(false);
    expect(deepEqual(0, -0)).toBe(false);
    expect(literalJsonPointerMatches({ a: [1, 2] }, literal("/a", [1, 2]))).toBe(true);
    expect(literalJsonPointerMatches({ a: [1, 2] }, literal("/a", [2, 1]))).toBe(false);
  });
  it("shares one fail-closed modifier predicate with runner and helper entry", () => {
    const base = literal("/value", 1);
    expect(isLiteralJsonPointerAssertion(base)).toBe(true);
    for (const modifier of [
      "normalize",
      "fixturePointer",
      "equalsBinding",
      "equalsRunProfile",
      "timestampPointers",
      "futureModifier",
    ]) {
      const changed = { ...base, [modifier]: undefined };
      expect(isLiteralJsonPointerAssertion(changed)).toBe(false);
      expect(() => literalJsonPointerMatches({ value: 1 }, changed)).toThrow(
        "Literal JSON pointer assertion required",
      );
    }
    for (const pointer of ["foo", "/bad~2"])
      expect(isLiteralJsonPointerAssertion(literal(pointer))).toBe(false);
  });
});
