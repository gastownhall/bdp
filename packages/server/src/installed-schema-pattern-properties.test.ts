import { describe, expect, it } from "vitest";
import {
  compilePrivateSchemaEvaluator,
  EVALUATOR_CEILINGS,
  type EvaluatorLimits,
} from "./installed-schema-evaluator.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { SCHEMA_GRAPH_CEILINGS } from "./installed-schema-shape.js";
const bytes = (s: string) => new TextEncoder().encode(s);
const uri = "https://pp.test/s";
function compile(schema: unknown, limits: EvaluatorLimits = EVALUATOR_CEILINGS) {
  return compilePrivateSchemaEvaluator({
    bundle: {
      descriptors: [],
      schemas: [{ retrievalUri: uri, utf8Bytes: bytes(JSON.stringify(schema)) }],
      limits: CONTRACT_ARTIFACT_CEILINGS,
    },
    graphLimits: SCHEMA_GRAPH_CEILINGS,
    entry: { kind: "schema", retrievalUri: uri },
    limits,
  });
}
function evaluate(schema: unknown, value: unknown) {
  const c = compile(schema);
  expect(c.kind).toBe("compiled");
  if (c.kind !== "compiled") throw new Error(c.reason);
  const r = c.evaluateUtf8(bytes(JSON.stringify(value)));
  expect(r.kind).toBe("evaluated");
  if (r.kind !== "evaluated") throw new Error(r.reason);
  return r;
}
const ppAnnotation = (value: string[]) => ({
  keyword: "patternProperties",
  value,
  schemaLocation: `${uri}#/patternProperties`,
  instanceLocation: "",
  validationPath: "/patternProperties",
});
describe("patternProperties semantic admission", () => {
  it.each([null, true, 1, "a", []].map((value) => [value]))(
    "empty map leaves nonobject %j unannotated",
    (value) => {
      const r = evaluate({ patternProperties: {} }, value);
      expect(r.valid).toBe(true);
      expect(r.annotations).toEqual([]);
    },
  );
  it("empty map emits one exact empty annotation on objects", () => {
    const r = evaluate({ patternProperties: {} }, { a: null });
    expect(r.valid).toBe(true);
    expect(r.annotations).toEqual([ppAnnotation([])]);
    expect(evaluate({}, { a: null }).annotations).toEqual([]);
  });
  it("applies every overlapping pattern and adjacent properties", () => {
    expect(evaluate({ patternProperties: { a: true, "[a]": false } }, { a: null }).valid).toBe(
      false,
    );
    expect(
      evaluate({ properties: { a: false }, patternProperties: { a: true } }, { a: null }).valid,
    ).toBe(false);
    expect(
      evaluate({ patternProperties: { a: { type: "number" }, "[a]": { maximum: 3 } } }, { a: 2 })
        .valid,
    ).toBe(true);
    expect(
      evaluate({ patternProperties: { a: { type: "number" }, "[a]": { maximum: 3 } } }, { a: 4 })
        .valid,
    ).toBe(false);
  });
  it("recognizes regex names for additionalProperties", () => {
    const schema = { patternProperties: { "^x": true }, additionalProperties: false };
    expect(evaluate(schema, { xyz: null }).valid).toBe(true);
    expect(evaluate(schema, { y: null }).valid).toBe(false);
  });
  it("commits successful regex coverage for unevaluatedProperties", () => {
    const schema = { patternProperties: { "^x": true }, unevaluatedProperties: false };
    expect(evaluate(schema, { xyz: null }).valid).toBe(true);
    expect(evaluate(schema, { y: null }).valid).toBe(false);
  });
  it("admits strict child recursion and terminates", () => {
    expect(evaluate({ patternProperties: { "^x$": { $ref: "#" } } }, { x: { x: {} } }).valid).toBe(
      true,
    );
  });
  it("qualifies unused supported declarations", () => {
    expect(
      evaluate({ $defs: { unused: { patternProperties: { x: false } } } }, { x: null }).valid,
    ).toBe(true);
    expect(
      evaluate({ contentMediaType: "text/plain", contentSchema: { patternProperties: {} } }, "x")
        .valid,
    ).toBe(true);
  });
  it("keeps malformed-key and same-instance-cycle refusals", () => {
    for (const key of ["\\p{Letter}", "(?=x)"])
      expect(compile({ patternProperties: { [key]: true } })).toMatchObject({
        kind: "refused",
        phase: "compile",
        reason: "unsupported-pattern",
      });
    expect(compile({ $ref: "#" })).toMatchObject({ kind: "refused", reason: "nonqualified-cycle" });
  });
});
it("retains the existing public healthy entry and cycle boundary", () => {
  expect(evaluate({ type: "object" }, { x: null }).valid).toBe(true);
  expect(compile({ pattern: "(?=x)" })).toMatchObject({
    kind: "refused",
    reason: "unsupported-pattern",
  });
  expect(compile({ $ref: "#" })).toMatchObject({ kind: "refused", reason: "nonqualified-cycle" });
});

describe("patternProperties names, occurrences and coverage", () => {
  it.each([
    ["f.*o", "before foo after", true],
    ["X_", "x_a", false],
    ["^á", "área", true],
    ["^🐲*$", "🐲🐲", true],
    ["^..$", "🐲", false],
    ["", "", true],
    ["\\w+", "abc_1", true],
    ["^\\d+$", "١", false],
  ] as const)("uses the existing matcher for %s / %s", (pattern, key, matches) => {
    const r = evaluate({ patternProperties: { [pattern]: true } }, { [key]: null });
    expect(r.valid).toBe(true);
    expect(r.annotations).toEqual([ppAnnotation(matches ? [key] : [])]);
  });
  it("treats raw and escaped astral name input identically", () => {
    const c = compile({ patternProperties: { "^🐲$": true } });
    if (c.kind !== "compiled") throw new Error(c.reason);
    const raw = c.evaluateUtf8(bytes('{"🐲":null}'));
    const escaped = c.evaluateUtf8(bytes('{"\\ud83d\\udc32":null}'));
    expect(raw.kind).toBe("evaluated");
    expect(escaped.kind).toBe("evaluated");
    if (raw.kind !== "evaluated" || escaped.kind !== "evaluated") throw new Error("name admission");
    // UTF8 input bytes differ by construction: 4 raw bytes versus 12 ASCII escape bytes.
    expect(raw.counters.inputBytes).toBe(13);
    expect(escaped.counters.inputBytes).toBe(21);
    expect({ ...raw, counters: { ...raw.counters, inputBytes: 21 } }).toEqual(escaped);
  });
  it("preserves exact annotation ordering and unique recognition", () => {
    const r = evaluate(
      {
        properties: { a: true },
        patternProperties: { a: true, b: true, "[ab]": true },
        additionalProperties: true,
      },
      { a: null, b: null, c: null },
    );
    expect(r.annotations).toEqual([
      {
        ...ppAnnotation(["a"]),
        keyword: "properties",
        schemaLocation: `${uri}#/properties`,
        validationPath: "/properties",
      },
      ppAnnotation(["a", "b"]),
      {
        ...ppAnnotation(["c"]),
        keyword: "additionalProperties",
        schemaLocation: `${uri}#/additionalProperties`,
        validationPath: "/additionalProperties",
      },
    ]);
    expect(
      evaluate({ patternProperties: { a: true, b: true } }, { a: null, b: null }).annotations,
    ).toEqual([ppAnnotation(["b", "a"])]);
  });
  it("uses Object.keys order for numeric-looking schema and instance keys", () => {
    const schema = JSON.parse('{"patternProperties":{"10":true,"2":true}}');
    const value = JSON.parse('{"2":null,"10":null}');
    expect(evaluate(schema, value).annotations).toEqual([ppAnnotation(["10", "2"])]);
    expect(
      evaluate({ patternProperties: { "": true } }, JSON.parse('{"10":null,"2":null,"z":null}'))
        .annotations,
    ).toEqual([ppAnnotation(["2", "10", "z"])]);
  });
  it("handles prototype-looking names as JSON data", () => {
    const value = JSON.parse('{"__proto__":null,"constructor":null}');
    expect(
      evaluate({ patternProperties: { "": true }, additionalProperties: false }, value)
        .annotations[0],
    ).toEqual(ppAnnotation(["__proto__", "constructor"]));
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
  it.each([
    ["a/b", "a~1b", "a~1b"],
    ["a~b", "a~0b", "a~0b"],
    ["", "", ""],
    ["á", "á", "%C3%A1"],
  ])("retains actual matched locations for %s", (key, escaped, encoded) => {
    const r = evaluate({ patternProperties: { [key]: { title: "leaf" } } }, { [key]: null });
    expect(r.annotations).toEqual([
      ppAnnotation([key]),
      {
        keyword: "title",
        value: "leaf",
        schemaLocation: `${uri}#/patternProperties/${encoded}/title`,
        instanceLocation: `/${escaped}`,
        validationPath: `/patternProperties/${escaped}/title`,
      },
    ]);
  });
  it("keeps failed recognized names out of AP diagnostics", () => {
    const r = evaluate(
      { patternProperties: { "^a$": false }, additionalProperties: false },
      { a: null, b: null },
    );
    expect(r.valid).toBe(false);
    expect(r.annotations).toEqual([]);
    expect(r.diagnostics).toEqual([
      {
        schemaLocation: `${uri}#/patternProperties/%5Ea%24`,
        instanceLocation: "/a",
        message: "Schema rejects every instance",
      },
      {
        schemaLocation: `${uri}#/additionalProperties`,
        instanceLocation: "/b",
        message: "Schema rejects every instance",
      },
    ]);
  });
  it("does not commit any coverage from a partially failed PP keyword", () => {
    const r = evaluate(
      { patternProperties: { "^a$": true, "^b$": false }, unevaluatedProperties: false },
      { a: null, b: null },
    );
    expect(r.valid).toBe(false);
    expect(r.annotations).toEqual([]);
    expect(
      r.diagnostics
        .filter((d) => d.schemaLocation === `${uri}#/unevaluatedProperties`)
        .map((d) => d.instanceLocation),
    ).toEqual(["/a", "/b"]);
  });
  it("keeps successful local coverage despite an unrelated assertion failure", () => {
    const r = evaluate(
      { maxProperties: 0, patternProperties: { a: true }, unevaluatedProperties: false },
      { a: null },
    );
    expect(r.valid).toBe(false);
    expect(r.annotations).toEqual([]);
    expect(r.diagnostics).toEqual([
      {
        schemaLocation: `${uri}#/maxProperties`,
        instanceLocation: "",
        message: "Schema assertion failed: maxProperties",
      },
    ]);
  });
  it("does not leak descendant object IDs into parent coverage", () => {
    const r = evaluate(
      {
        patternProperties: {
          "^a$": { patternProperties: { "": true }, unevaluatedProperties: false },
        },
        unevaluatedProperties: false,
      },
      { a: { b: null }, b: null },
    );
    expect(r.valid).toBe(false);
    expect(r.diagnostics).toEqual([
      {
        schemaLocation: `${uri}#/unevaluatedProperties`,
        instanceLocation: "/b",
        message: "Schema rejects every instance",
      },
    ]);
  });
  it.each(["anyOf", "allOf"])("merges successful %s PP coverage", (applicator) => {
    const schema = {
      [applicator]: [{ patternProperties: { a: true } }, { patternProperties: { b: true } }],
      unevaluatedProperties: false,
    };
    expect(evaluate(schema, { a: null, b: null }).valid).toBe(true);
    expect(evaluate(schema, { c: null }).valid).toBe(false);
  });
  it("oneOf uses only its successful branch", () => {
    const schema = {
      oneOf: [
        { required: ["a"], patternProperties: { a: true } },
        { required: ["b"], patternProperties: { b: true } },
      ],
      unevaluatedProperties: false,
    };
    expect(evaluate(schema, { a: null }).valid).toBe(true);
    expect(evaluate(schema, { a: null, b: null }).valid).toBe(false);
  });
  it("if contributes successful coverage without then/else, not never contributes", () => {
    expect(
      evaluate(
        { if: { patternProperties: { a: true } }, unevaluatedProperties: false },
        { a: null },
      ).valid,
    ).toBe(true);
    const r = evaluate(
      {
        not: { patternProperties: { a: true }, required: ["missing"] },
        unevaluatedProperties: false,
      },
      { a: null },
    );
    expect(r.valid).toBe(false);
    expect(r.diagnostics.map((d) => d.instanceLocation)).toEqual(["/a"]);
  });
  it("AP schemas still validate only the unmatched names", () => {
    const schema = { patternProperties: { "^a$": true }, additionalProperties: { type: "number" } };
    expect(evaluate(schema, { a: false, b: 2 }).valid).toBe(true);
    const r = evaluate(schema, { a: false, b: false });
    expect(r.valid).toBe(false);
    expect(r.diagnostics.map((d) => d.instanceLocation)).toEqual(["/b"]);
  });
  it("projects repeated memoized PP facts at every actual occurrence", () => {
    const schema = {
      $defs: { shared: { patternProperties: { a: { title: "leaf" } } } },
      allOf: [{ $ref: "#/$defs/shared" }, { $ref: "#/$defs/shared" }],
    };
    const r = evaluate(schema, { a: null });
    expect(r.valid).toBe(true);
    expect(
      r.annotations.filter((a) => a.keyword === "patternProperties").map((a) => a.validationPath),
    ).toEqual(["/allOf/1/$ref/patternProperties", "/allOf/0/$ref/patternProperties"]);
    expect(r.annotations.filter((a) => a.keyword === "title").map((a) => a.validationPath)).toEqual(
      ["/allOf/1/$ref/patternProperties/a/title", "/allOf/0/$ref/patternProperties/a/title"],
    );
    expect(r.counters.annotations).toBe(4);
    // Root, two allOf nodes, one shared ref target and one leaf: five memo states.
    // Root + two branch + two shared + two leaf projections: seven occurrences.
    expect(r.counters.states).toBe(5);
    expect(r.counters.occurrences).toBe(7);
    for (const [key, limit] of [
      ["annotations", 3],
      ["occurrences", 6],
    ] as const) {
      const c = compile(schema, { ...EVALUATOR_CEILINGS, [key]: limit });
      if (c.kind !== "compiled") throw new Error(c.reason);
      expect(c.evaluateUtf8(bytes('{"a":null}'))).toMatchObject({
        kind: "refused",
        phase: "instance",
        reason: `limit-${key}`,
      });
    }
  });
  it("retains distinct owner programs and fresh invocation state", () => {
    const schema = {
      pattern: "^x$",
      patternProperties: { a: { title: "a" } },
      $defs: { other: { patternProperties: { a: false } } },
    };
    const c = compile(schema);
    if (c.kind !== "compiled") throw new Error(c.reason);
    const first = c.evaluateUtf8(bytes('{"a":null}'));
    expect(first).toEqual(c.evaluateUtf8(bytes('{"a":null}')));
    expect(c.evaluateUtf8(bytes("{}"))).toMatchObject({
      kind: "evaluated",
      valid: true,
      annotations: [ppAnnotation([])],
    });
    expect(c.evaluateUtf8(bytes('"y"'))).toMatchObject({
      kind: "evaluated",
      valid: false,
      annotations: [],
    });
    expect(c.evaluateUtf8(bytes('{"a":null}'))).toEqual(first);
  });
  it("preflights unused bad keys and conservatively reaches dynamic children", () => {
    for (const schema of [
      { $defs: { unused: { patternProperties: { "(?=x)": true } } } },
      { contentSchema: { patternProperties: { "\\p{Letter}": true } } },
    ])
      expect(compile(schema)).toMatchObject({
        kind: "refused",
        phase: "compile",
        reason: "unsupported-pattern",
      });
    expect(
      compile({ patternProperties: { never: { $dynamicAnchor: "d", $dynamicRef: "#d" } } }),
    ).toMatchObject({ kind: "refused", reason: "nonqualified-cycle" });
  });
});

// Approved external literal-extension-ledger r3, with additive prose correction:
// root key+set11 + driver1. These are pre-implementation predictions, not samples.
describe("literal full M by P integration budgets", () => {
  const schema = { patternProperties: { "a{4095}": true, "b{4095}": true } };
  const input = (count: number) =>
    bytes(
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: count }, (_, i) => [String.fromCharCode(97 + i), null]),
        ),
      ),
    );
  const expected = (count: 15 | 16) => ({
    work: count === 16 ? 789173 : 739869,
    logicalBytes: count === 16 ? 8398948 : 7874066,
    frames: count,
    inputBytes: count === 16 ? 145 : 136,
    valueNodes: count + 1,
    states: 1,
    occurrences: 1,
    annotations: 1,
    annotationBytes: 160,
    diagnostics: 0,
    diagnosticBytes: 0,
    coefficientDigits: 0,
    normalizedCoefficientDigits: 0,
  });
  it.each([15, 16] as const)(
    "exact prewritten full counters for %s names and two 4096-state programs",
    (count) => {
      const exact = expected(count);
      const c = compile(schema, {
        ...EVALUATOR_CEILINGS,
        work: exact.work,
        logicalBytes: exact.logicalBytes,
      });
      expect(c.kind).toBe("compiled");
      if (c.kind !== "compiled") throw new Error(c.reason);
      const result = c.evaluateUtf8(input(count));
      expect(result).toMatchObject({
        kind: "evaluated",
        valid: true,
        counters: exact,
        annotations: [ppAnnotation([])],
      });
      if (result.kind !== "evaluated") throw new Error(result.reason);
      expect(result.counters).toEqual(exact);
    },
  );
  it.each(["work", "logicalBytes"] as const)(
    "one below the 16-name %s boundary refuses in the instance phase",
    (key) => {
      const exact = expected(16);
      const c = compile(schema, { ...EVALUATOR_CEILINGS, [key]: exact[key] - 1 });
      expect(c.kind).toBe("compiled");
      if (c.kind !== "compiled") throw new Error(c.reason);
      expect(c.evaluateUtf8(input(16))).toMatchObject({
        kind: "refused",
        phase: "instance",
        reason: `limit-${key}`,
      });
      expect(c.evaluateUtf8(input(15))).toMatchObject({
        kind: "evaluated",
        valid: true,
        counters: expected(15),
      });
    },
  );
  it.each(["frames", "occurrences", "annotations", "annotationBytes"] as const)(
    "exact and one-below %s output/stack limits",
    (key) => {
      const exact = expected(16);
      for (const delta of [0, -1]) {
        const c = compile(schema, { ...EVALUATOR_CEILINGS, [key]: exact[key] + delta });
        expect(c.kind).toBe("compiled");
        if (c.kind !== "compiled") throw new Error(c.reason);
        const result = c.evaluateUtf8(input(16));
        if (delta === 0)
          expect(result).toMatchObject({ kind: "evaluated", valid: true, counters: exact });
        else
          expect(result).toMatchObject({
            kind: "refused",
            phase: "instance",
            reason: `limit-${key}`,
          });
      }
    },
  );
  it("retains the 4096/4097 UTF16 pattern key ceiling", () => {
    expect(compile({ patternProperties: { ["(?:)".repeat(1024)]: true } }).kind).toBe("compiled");
    expect(compile({ patternProperties: { ["a".repeat(4096)]: true } })).toMatchObject({
      kind: "refused",
      reason: "limit-patternStates",
    });
    expect(compile({ patternProperties: { ["a".repeat(4097)]: true } })).toMatchObject({
      kind: "refused",
      reason: "limit-patternUnits",
    });
  });
});

// Ledger rows2/3 and pseudocode T0–T7: one additional all-miss record costs
// 99-8=91 work plus nine existing target-filter inspections; scratch adds384.
// The same increment holds for P1→P2 on one unmatched one-unit name.
it.each([0, 1])("charges the independent all-miss extension delta from %s records", (count) => {
  const before = evaluate({ patternProperties: count === 0 ? {} : { a: true } }, { z: null });
  const after = evaluate(
    { patternProperties: count === 0 ? { a: true } : { a: true, b: true } },
    { z: null },
  );
  expect(after.annotations).toEqual(before.annotations);
  expect(after.counters).toEqual({
    ...before.counters,
    work: before.counters.work + 100,
    logicalBytes: before.counters.logicalBytes + 384,
  });
});
