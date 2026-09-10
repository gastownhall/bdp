import { describe, expect, it } from "vitest";
import { snapshotJsonValue, stringifyJsonValue } from "./json-values.js";
import { ProtocolArtifactValidationError } from "./protocol-errors.js";

function descend(value: unknown, depth: number): unknown {
  let current = value;
  for (let i = 0; i < depth; i++) {
    if (!Array.isArray(current)) throw new Error(`missing array at ${i}`);
    expect(Object.isFrozen(current)).toBe(true);
    expect(current[0]).toBe(1);
    current = current[1];
  }
  return current;
}

describe("iterative JSON snapshots and ordinary encoding", () => {
  it("copies and encodes 20,000 mixed numeric nesting levels exactly", () => {
    const depth = 20_000;
    const text = `${"[1,".repeat(depth)}{"n":2,"text":"é😀"}${"]".repeat(depth)}`;
    const source: unknown = JSON.parse(text);
    // Independent native ceiling control proves this exercises more than a
    // shallow traversal. JSON.parse is iterative in the supported runtime.
    expect(() => JSON.stringify(source)).toThrow(RangeError);
    const snapshot = snapshotJsonValue(source);
    expect(descend(snapshot, depth)).toEqual({ n: 2, text: "é😀" });
    expect(stringifyJsonValue(snapshot)).toBe(text);
    expect(stringifyJsonValue(source)).toBe(text);
    expect(snapshot === source).toBe(false);
  });
  it("preserves ordinary own-key enumeration, primitive escapes and finite number formatting", () => {
    const source = Object.assign(Object.create(null), {
      z: 1,
      "10": "ten",
      "2": "two",
      "01": "leading",
      a: -0,
      text: '\n\t"\\é😀\u2028',
      numbers: [1e21, 1e-7, Number.MIN_VALUE, Number.MAX_VALUE],
    }) as Record<string, unknown>;
    Object.defineProperty(source, "__proto__", { value: { safe: true }, enumerable: true });
    expect(stringifyJsonValue(source)).toBe(JSON.stringify(source));
    expect(stringifyJsonValue({ z: 1, a: 2 })).toBe('{"z":1,"a":2}');
    expect(stringifyJsonValue({ a: 2, z: 1 })).not.toBe(stringifyJsonValue({ z: 1, a: 2 }));
    const snapshot = snapshotJsonValue(source) as Record<string, unknown>;
    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype);
    expect(Object.hasOwn(snapshot, "__proto__")).toBe(true);
    expect(Object.hasOwn(Object.prototype, "safe")).toBe(false);
    expect(Object.is(snapshot.a, -0)).toBe(true); // Snapshot is not numeric admission.
    expect(stringifyJsonValue(-0)).toBe("0");
  });
  it("preserves one-read accessor behavior and never invokes toJSON", () => {
    let reads = 0;
    let toJsonCalls = 0;
    const value = {
      get n() {
        reads++;
        return reads === 1 ? 3 : undefined;
      },
    };
    Object.defineProperty(value, "toJSON", {
      value: () => {
        toJsonCalls++;
        return "wrong";
      },
    });
    const snapshot = snapshotJsonValue(value);
    expect(snapshot).toEqual({ n: 3 });
    expect(reads).toBe(1);
    expect(stringifyJsonValue(snapshot)).toBe('{"n":3}');
    expect(toJsonCalls).toBe(0);
    let encodeReads = 0;
    expect(
      stringifyJsonValue({
        get v() {
          encodeReads++;
          return encodeReads;
        },
      }),
    ).toBe('{"v":1}');
    expect(encodeReads).toBe(1);
  });
  it("captures array length once and keeps the same selected values under accessor mutation", () => {
    let reads = 0;
    const source = new Proxy([1], {
      get(target, key, receiver) {
        if (key === "length") {
          reads++;
          return reads === 1 ? 1 : 20_000;
        }
        return Reflect.get(target, key, receiver);
      },
    });
    expect(snapshotJsonValue(source)).toEqual([1]);
    expect(reads).toBe(1);
    const array = [1, 2];
    Object.defineProperty(array, "0", {
      enumerable: true,
      configurable: true,
      get() {
        array.push(3);
        return 1;
      },
    });
    expect(stringifyJsonValue(array)).toBe("[1,2]");
  });
  it("checks active-path cycles while independently copying shared acyclic values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const parse of [snapshotJsonValue, stringifyJsonValue])
      expect(() => parse(cyclic)).toThrow("must not contain a cycle");
    const leaf = { n: 1 };
    const snapshot = snapshotJsonValue({ a: leaf, b: leaf }) as Record<string, unknown>;
    expect(snapshot.a).not.toBe(leaf);
    expect(snapshot.a).not.toBe(snapshot.b);
    leaf.n = 2;
    expect(snapshot.a).toEqual({ n: 1 });
    const deep: unknown[] = [];
    let cursor = deep;
    for (let i = 0; i < 10_000; i++) {
      const next: unknown[] = [];
      cursor.push(next);
      cursor = next;
    }
    cursor.push(deep);
    expect(() => snapshotJsonValue(deep)).toThrow(ProtocolArtifactValidationError);
  });
  it.each([
    undefined,
    1n,
    () => 1,
    Symbol("x"),
    Number.NaN,
    Infinity,
    -Infinity,
    new Date(),
    new Map(),
    Object.create({ inherited: true }),
    { nested: undefined },
    [undefined],
    Array(1),
    { text: "\ud800" },
    { "\udfff": 1 },
    { toJSON: () => "not JSON data" },
  ])("rejects hostile or non-JSON value %# through both boundaries", (value) => {
    expect(() => snapshotJsonValue(value)).toThrow(ProtocolArtifactValidationError);
    expect(() => stringifyJsonValue(value)).toThrow(ProtocolArtifactValidationError);
  });
  it("propagates throwing accessors without retrying them or returning a partial snapshot", () => {
    let calls = 0;
    const value = {
      get n(): never {
        calls++;
        throw new Error("accessor failed");
      },
    };
    expect(() => snapshotJsonValue(value)).toThrow("accessor failed");
    expect(calls).toBe(1);
  });
  it("accepts wide finite JSON under the caller's byte budget without hidden container/node caps", () => {
    const wide = { values: Array.from({ length: 101 }, () => Array(1_001).fill(0)) };
    const text = JSON.stringify(wide);
    expect(Buffer.byteLength(text)).toBeLessThan(1_048_576);
    expect(stringifyJsonValue(wide)).toBe(text);
    const object = Object.fromEntries(Array.from({ length: 10_001 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(snapshotJsonValue(object) as object)).toHaveLength(10_001);
  });
});
