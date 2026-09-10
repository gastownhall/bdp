import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  admitJsonNumbers,
  decodeJsonDocument,
  isAdmissibleJsonNumber,
  JsonNumberLiteral,
  JsonSyntaxError,
} from "./json-admission.js";

describe("lossless JSON admission", () => {
  it.each([
    "",
    " ",
    "[1,]",
    '{"a":1,}',
    "[1 2]",
    '{"a" 1}',
    "true false",
    "+1",
    "01",
    "1.",
    "1e",
    ".5",
    "NaN",
    "Infinity",
    "undefined",
    "\ufeff{}",
    '"\\x41"',
    '"line\nfeed"',
    "[",
    "{",
    '"unfinished',
  ])("rejects malformed syntax %j", (text) =>
    expect(() => decodeJsonDocument(text)).toThrow(JsonSyntaxError),
  );

  it.each([
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"😀":1,"\\ud83d\\ude00":2}',
    '{"x":{"/":1,"\\u002f":2}}',
  ])("rejects duplicate decoded names before overwrite %j", (text) =>
    expect(() => decodeJsonDocument(text)).toThrow(/duplicate decoded/),
  );
  it.each([
    '"\\ud800"',
    '"\\udfff"',
    '"\\ud800x"',
    '"\ud800"',
    '{"\\ud800":0}',
    '[{"v":"\\udc00"}]',
  ])("rejects lone surrogate at any value/key %j", (text) =>
    expect(() => decodeJsonDocument(text)).toThrow(/unpaired surrogate/),
  );

  it("accepts independently scoped repeated names, escaped strings, scalar pairs and JSON whitespace", () => {
    const raw =
      ' \r\n\t {"a":{"x":"quote\\" slash\\\\ 😀"},"b":{"x":"\\ud83d\\ude00"},"t":true,"n":null,"f":false} ';
    const result = admitJsonNumbers(decodeJsonDocument(raw));
    expect(result).toEqual({ ok: true, value: JSON.parse(raw) });
    if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
  });

  it("preserves root numbers, exact decimal spellings and escaped JSON Pointers", () => {
    expect(decodeJsonDocument("9007199254740993")).toEqual(
      new JsonNumberLiteral("9007199254740993"),
    );
    const result = admitJsonNumbers(
      decodeJsonDocument('{"a/b~c":[9007199254740993,1e9999,1e-9999],"":1.2345678901234567891}'),
    );
    expect(result).toEqual({
      ok: false,
      offending: [
        { pointer: "/a~1b~0c/0", literal: "9007199254740993" },
        { pointer: "/a~1b~0c/1", literal: "1e9999" },
        { pointer: "/a~1b~0c/2", literal: "1e-9999" },
        { pointer: "/", literal: "1.2345678901234567891" },
      ],
    });
    expect(result).not.toHaveProperty("value");
    expect(admitJsonNumbers(decodeJsonDocument("1e9999"))).toEqual({
      ok: false,
      offending: [{ pointer: "", literal: "1e9999" }],
    });
  });

  it("treats __proto__ as data without prototype mutation", () => {
    const result = admitJsonNumbers(
      decodeJsonDocument('{"__proto__":{"polluted":true},"constructor":1}'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.getPrototypeOf(result.value)).toBeNull();
    expect(Object.hasOwn(result.value as object, "__proto__")).toBe(true);
    expect({}).not.toHaveProperty("polluted");
  });

  it("handles 20,000 nesting levels iteratively, with no new wire depth limit", () => {
    const depth = 20_000;
    const result = admitJsonNumbers(
      decodeJsonDocument(`${"[".repeat(depth)}1${"]".repeat(depth)}`),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    let node = result.value;
    for (let i = 0; i < depth; i++) {
      expect(Object.isFrozen(node)).toBe(true);
      node = (node as readonly (typeof node)[])[0] ?? null;
    }
    expect(node).toBe(1);
  });

  it("uses exact decimal comparison for exponent extremes without expanding powers", () => {
    expect(isAdmissibleJsonNumber(`0e${"9".repeat(10000)}`)).toBe(true);
    expect(isAdmissibleJsonNumber(`1e${"9".repeat(10000)}`)).toBe(false);
    expect(isAdmissibleJsonNumber(`1e-${"9".repeat(10000)}`)).toBe(false);
    expect(isAdmissibleJsonNumber("0.10000000000000000555")).toBe(false);
    expect(isAdmissibleJsonNumber("5e-324")).toBe(true);
    expect(isAdmissibleJsonNumber("4e-324")).toBe(false);
    expect(isAdmissibleJsonNumber("1.7976931348623157e308")).toBe(true);
    expect(isAdmissibleJsonNumber("1.7976931348623159e308")).toBe(false);
    expect(() => isAdmissibleJsonNumber("0x1")).toThrow(TypeError);
  });

  it("agrees with every independently pinned numeric-model vector", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../../fixtures/numeric-model/numeric-model.json", import.meta.url),
        "utf8",
      ),
    ) as {
      sameValue: { spellings: string[]; serialized: string }[];
      admitted: { literal: string; serialized: string }[];
      refused: { literal: string }[];
      documents: {
        properties: string;
        disposition: string;
        offending?: { pointer: string; literal: string }[];
      }[];
    };
    for (const group of fixture.sameValue)
      for (const literal of group.spellings) {
        expect(isAdmissibleJsonNumber(literal), literal).toBe(true);
        expect(admitJsonNumbers(decodeJsonDocument(literal))).toEqual({
          ok: true,
          value: JSON.parse(group.serialized),
        });
      }
    for (const { literal, serialized } of fixture.admitted) {
      expect(isAdmissibleJsonNumber(literal), literal).toBe(true);
      expect(admitJsonNumbers(decodeJsonDocument(literal))).toEqual({
        ok: true,
        value: JSON.parse(serialized),
      });
    }
    for (const { literal } of fixture.refused)
      expect(isAdmissibleJsonNumber(literal), literal).toBe(false);
    for (const row of fixture.documents) {
      const result = admitJsonNumbers(decodeJsonDocument(row.properties));
      expect(result.ok).toBe(row.disposition === "admitted");
      if (!result.ok) expect(result.offending).toEqual(row.offending);
    }
  });
});
