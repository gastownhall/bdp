import { decodeJsonDocument, JsonNumberLiteral } from "@bdp/protocol";
import { describe, expect, it } from "vitest";
import {
  encodeSemanticValue,
  UNBOUND_SEMANTIC_REFERENCE,
  type SemanticValue,
} from "./semantic-identity.js";

const encode = (text: string): string => encodeSemanticValue(decodeJsonDocument(text));

describe("internal exact semantic value codec", () => {
  it("pins the version and separates every scalar kind", () => {
    expect(encode("1.20")).toBe('["ru-semantic-value-1",["number","12","-1"]]');
    const values = ["null", "true", "false", '"true"', '"null"', '"1"', "1", "{}", "[]"];
    expect(new Set(values.map(encode)).size).toBe(values.length);
    for (const value of values) expect(() => JSON.parse(encode(value))).not.toThrow();
  });
  it.each([
    ["1", "1.0", "1e0", "10e-1", "0.1e1"],
    ["-1", "-1.00", "-10e-1"],
    ["123.45", "1234500e-4", "1.2345e2"],
    [
      "0",
      "-0",
      "0.0",
      "-0.0",
      "0e999999999999999999999999999999",
      "-0e-999999999999999999999999999999",
    ],
    ["1e300", "10e299", `1${"0".repeat(300)}`],
  ])("equates exact decimal spellings %j", (...values) => {
    expect(new Set(values.map(encode)).size).toBe(1);
  });
  it.each([
    ["9007199254740992", "9007199254740993"],
    ["0.1", "0.10000000000000000555"],
    ["1e999", "2e999"],
    ["1e-999", "2e-999"],
    ["-1e999", "1e999"],
    ["1e9007199254740992", "1e9007199254740993"],
  ])("preserves distinct values %s and %s without binary64 conversion", (a, b) => {
    expect(encode(a)).not.toBe(encode(b));
  });
  it("normalizes unsafe and huge positive/negative exponents without expanding magnitudes", () => {
    expect(encode("1e9007199254740993")).toBe(encode("10e9007199254740992"));
    const nines = "9".repeat(4096);
    const previous = `${"9".repeat(4095)}8`;
    const next = `1${"0".repeat(4096)}`;
    const positive = encode(`1e${nines}`);
    expect(positive).toBe(encode(`10e${previous}`));
    expect(encode(`1e-${nines}`)).toBe(encode(`10e-${next}`));
    expect(positive.length).toBeLessThan(4200);
    expect(encode(`1e-${nines}`).length).toBeLessThan(4200);
  });
  it("keeps long coefficient work proportional to its digits", () => {
    const digits = `1${"0".repeat(50_000)}1`;
    expect(encode(digits)).toBe(encode(`${digits}0e-1`));
    const [, node] = JSON.parse(encode(digits));
    expect(node).toEqual(["number", digits, "0"]);
  });
  it("ignores object order at every depth and preserves every array order", () => {
    const a = '{"b":[{"z":2,"a":1},null],"a":{"y":true,"x":"x"}}';
    const b = '{"a":{"x":"x","y":true},"b":[{"a":1.0,"z":2},null]}';
    expect(encode(a)).toBe(encode(b));
    expect(encode(a)).not.toBe(encode('{"a":{"x":"x","y":true},"b":[null,{"a":1,"z":2}]}'));
    expect(encode('{"change":[{"op":"remove","path":"/a"},{"op":"remove","path":"/b"}]}')).not.toBe(
      encode('{"change":[{"op":"remove","path":"/b"},{"op":"remove","path":"/a"}]}'),
    );
  });
  it("uses deterministic code-unit object ordering without Unicode normalization", () => {
    const encoded = JSON.parse(encode('{"\\ue000":null,"😀":true,"10":null,"2":null}'));
    expect(encoded[1][1].map(([key]: [string, unknown]) => key)).toEqual([
      "10",
      "2",
      "😀",
      "\ue000",
    ]);
    expect(encode('"é"')).not.toBe(encode('"é"'));
    expect(encode('"\\ud83d\\ude00"')).toBe(encode('"😀"'));
  });
  it("never interprets property strings or expands defaults itself", () => {
    expect(encode('{"target":"alias/x"}')).not.toBe(
      encode('{"target":"https://example.test/beads/a"}'),
    );
    expect(encode('{"properties":{"source":"@a","uri":"alias/x"}}')).not.toBe(
      encode('{"properties":{"source":"@b","uri":"alias/x"}}'),
    );
    expect(encode("{}")).not.toBe(encode('{"properties":{}}'));
    expect(encode('{"target":{"uri":"urn:opaque:X","revision":"r1"}}')).not.toBe(
      encode('{"target":{"uri":"urn:opaque:x","revision":"r1"}}'),
    );
  });
  it("keeps user marker-shaped values disjoint from private unbound and numeric nodes", () => {
    const unbound = encodeSemanticValue(UNBOUND_SEMANTIC_REFERENCE);
    const number = encode("1");
    for (const value of [
      '"unbound"',
      '["unbound"]',
      '{"kind":"unbound"}',
      '{"literal":"1"}',
      '["number","1","0"]',
    ]) {
      expect(encode(value)).not.toBe(unbound);
      expect(encode(value)).not.toBe(number);
    }
    expect(encodeSemanticValue({ target: UNBOUND_SEMANTIC_REFERENCE })).not.toBe(
      encode('{"target":{"kind":"unbound"}}'),
    );
  });
  it("encodes twenty thousand nested arrays and objects iteratively", () => {
    const depth = 20_000;
    const raw = `${'[{"value":'.repeat(depth)}1.0${"}]".repeat(depth)}`;
    const result = encode(raw);
    let parsed = JSON.parse(result)[1];
    for (let index = 0; index < depth; index++) {
      if (parsed[0] !== "array" || parsed[1][0][0] !== "object")
        throw new Error("wrong nested tags");
      parsed = parsed[1][0][1][0][1];
    }
    expect(parsed).toEqual(["number", "1", "0"]);
    expect(result).toBe(encode(`${'[{"value":'.repeat(depth)}1e0${"}]".repeat(depth)}`));
  });
  it("accepts shared acyclic data and null-prototype maps, but rejects cycles", () => {
    const shared = { value: new JsonNumberLiteral("1") };
    expect(encodeSemanticValue([shared, shared])).toBe(encode('[{"value":1},{"value":1}]'));
    const map = Object.assign(Object.create(null), { __proto__: "ordinary", z: null });
    Object.defineProperty(map, "__proto__", { value: "ordinary", enumerable: true });
    expect(encodeSemanticValue(map)).toBe(encode('{"z":null,"__proto__":"ordinary"}'));
    const cycle: Record<string, SemanticValue> = {};
    cycle.self = cycle;
    expect(() => encodeSemanticValue(cycle)).toThrow("acyclic");
  });
  it.each([
    1,
    Number.POSITIVE_INFINITY,
    undefined,
    Symbol("unbound semantic reference"),
    new Date(),
    [undefined],
    new Array(3),
  ])("rejects runtime values outside its explicit lossless API", (value) => {
    expect(() => encodeSemanticValue(value as SemanticValue)).toThrow(TypeError);
  });
  it("rejects accessors, hidden/symbol fields and extra array fields without reading getters", () => {
    let reads = 0;
    const getter = {
      get x() {
        reads++;
        return null;
      },
    };
    const hidden = Object.defineProperty({}, "x", { value: null });
    const symbol = { [Symbol("hidden")]: null };
    const array = Object.assign([null], { extra: null });
    for (const value of [getter, hidden, symbol, array])
      expect(() => encodeSemanticValue(value as SemanticValue)).toThrow(TypeError);
    expect(reads).toBe(0);
  });
  it("rejects non-scalar input and forged literal nodes", () => {
    expect(() => encodeSemanticValue("\ud800")).toThrow("scalar Unicode");
    expect(() => encodeSemanticValue({ "\udc00": null })).toThrow("scalar Unicode");
    const forged = Object.create(JsonNumberLiteral.prototype);
    Object.defineProperty(forged, "literal", { value: "1\n", enumerable: true });
    expect(() => encodeSemanticValue(forged)).toThrow("JSON number literal");
  });
});
