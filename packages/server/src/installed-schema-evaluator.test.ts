import { describe, it, expect } from "vitest";
import { JsonNumberLiteral } from "@bdp/protocol";
import {
  compilePrivateSchemaEvaluator,
  EVALUATOR_CEILINGS,
  type EvaluatorLimits,
} from "./installed-schema-evaluator.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { SCHEMA_GRAPH_CEILINGS } from "./installed-schema-shape.js";
import { EvaluationBudget, EvaluationMemo, instanceIndex } from "./installed-schema-value.js";
import { instanceSpans } from "../test-support/schema-graph-spans.js";
const bytes = (s: string) => new TextEncoder().encode(s);
function compile(schema: string, limits: EvaluatorLimits = EVALUATOR_CEILINGS) {
  return compilePrivateSchemaEvaluator({
    bundle: {
      descriptors: [],
      schemas: [{ retrievalUri: "https://test.example/schema", utf8Bytes: bytes(schema) }],
      limits: CONTRACT_ARTIFACT_CEILINGS,
    },
    graphLimits: SCHEMA_GRAPH_CEILINGS,
    entry: { kind: "schema", retrievalUri: "https://test.example/schema" },
    limits,
  });
}
function evaluate(schema: string, input: string) {
  const c = compile(schema);
  expect(c.kind).toBe("compiled");
  if (c.kind !== "compiled") throw new Error(c.reason);
  return c.evaluateUtf8(bytes(input));
}
describe("private supported static evaluator", () => {
  it("reserves a memo key and entry before retaining either at the private boundary", () => {
    const tooSmall = new EvaluationMemo(
      new EvaluationBudget({ ...EVALUATOR_CEILINGS, logicalBytes: 5 }),
    );
    expect(() => tooSmall.key(1, 2)).toThrow("limit-logicalBytes");
    for (const limit of [37, 38]) {
      const budget = new EvaluationBudget({ ...EVALUATOR_CEILINGS, logicalBytes: limit });
      const memo = new EvaluationMemo<string>(budget);
      const key = memo.key(1, 2); // Three ASCII units = six logical bytes; entry adds 32.
      expect(key).toBe("1:2");
      expect(budget.counts.logicalBytes).toBe(6);
      if (limit === 37) {
        expect(() => memo.set(key, "retained")).toThrow("limit-logicalBytes");
        expect(memo.get(key)).toBeUndefined();
      } else {
        memo.set(key, "retained");
        expect(memo.get(key)).toBe("retained");
        expect(budget.counts.logicalBytes).toBe(38);
      }
    }
  });
  it("charges memo key construction, hits and insertions against work before the operation", () => {
    const budget = new EvaluationBudget(EVALUATOR_CEILINGS);
    const memo = new EvaluationMemo<string>(budget);
    const key = memo.key(12, 345);
    expect(budget.counts.work).toBeGreaterThan(0);
    const constructed = budget.counts.work;
    memo.set(key, "same fact");
    expect(budget.counts.work).toBeGreaterThan(constructed);
    const inserted = budget.counts.work;
    expect(memo.get(key)).toBe("same fact");
    expect(budget.counts.work).toBeGreaterThan(inserted);
    const complete = budget.counts.work;
    for (const delta of [0, -1]) {
      const bounded = new EvaluationMemo<string>(
        new EvaluationBudget({ ...EVALUATOR_CEILINGS, work: complete + delta }),
      );
      const owned = bounded.key(12, 345);
      bounded.set(owned, "same fact");
      if (delta) expect(() => bounded.get(owned)).toThrow("limit-work");
      else expect(bounded.get(owned)).toBe("same fact");
    }
  });
  it("accounts for shared-reference memo hits without carrying facts into another invocation", () => {
    const schema =
      '{"$defs":{"shared":{"type":"integer"}},"items":{"allOf":[{"$ref":"#/$defs/shared"},{"$ref":"#/$defs/shared"}]}}';
    const input = JSON.stringify(Array.from({ length: 1000 }, (_, i) => i));
    const c = compile(schema);
    if (c.kind !== "compiled") throw new Error(c.reason);
    const first = c.evaluateUtf8(bytes(input));
    if (first.kind !== "evaluated") throw new Error(first.reason);
    expect(first.valid).toBe(true);
    // Root plus items/allOf, two reference sites and their one shared target per item.
    expect(first.counters.states).toBe(4001);
    expect(c.evaluateUtf8(bytes('["changed"]'))).toMatchObject({ kind: "evaluated", valid: false });
    expect(c.evaluateUtf8(bytes(input))).toEqual(first);
    for (const key of ["logicalBytes", "work"] as const)
      for (const delta of [0, -1]) {
        const bounded = compile(schema, {
          ...EVALUATOR_CEILINGS,
          [key]: first.counters[key] + delta,
        });
        if (bounded.kind !== "compiled") throw new Error(bounded.reason);
        const result = bounded.evaluateUtf8(bytes(input));
        if (delta)
          expect(result).toMatchObject({
            kind: "refused",
            phase: "instance",
            reason: `limit-${key}`,
          });
        else expect(result).toMatchObject({ kind: "evaluated", valid: true });
      }
  });
  it("reports dependentRequired once when exactly one diagnostic slot and byte envelope fit", () => {
    const schema = '{"dependentRequired":{"a":["x","also"],"b":["y"]}}';
    const initial = evaluate(schema, '{"a":1,"b":2}');
    if (initial.kind !== "evaluated") throw new Error(initial.reason);
    expect(initial.diagnostics).toHaveLength(1);
    const size = Buffer.byteLength(JSON.stringify(initial.diagnostics));
    const c = compile(schema, { ...EVALUATOR_CEILINGS, diagnostics: 1, diagnosticBytes: size });
    if (c.kind !== "compiled") throw new Error(c.reason);
    expect(c.evaluateUtf8(bytes('{"a":1,"b":2}'))).toMatchObject({
      kind: "evaluated",
      valid: false,
      diagnosticsComplete: true,
      diagnostics: initial.diagnostics,
    });
    expect(c.evaluateUtf8(bytes('{"a":1,"b":2,"x":3,"also":4,"y":5}'))).toMatchObject({
      kind: "evaluated",
      valid: true,
      diagnosticsComplete: true,
      diagnostics: [],
    });
  });

  it.each([
    ["true", "null", true],
    ["false", "{}", false],
    ['{"type":"object"}', "{}", true],
    ['{"type":"integer"}', "1.0", true],
    ['{"type":"integer"}', "1e-1", false],
    ['{"multipleOf":0.1}', "0.3", true],
    ['{"multipleOf":0.1}', "0.31", false],
    ['{"multipleOf":7}', "21", true],
    ['{"multipleOf":7}', "22", false],
    ['{"multipleOf":3e-10000000}', "6e10000000", true],
    ['{"minimum":9007199254740993}', "9007199254740992", false],
    ['{"maximum":-1e99}', "-1e100", true],
    ['{"exclusiveMaximum":1}', "1", false],
    ['{"exclusiveMinimum":-1}', "-1", false],
    ['{"const":-0}', "0e99999999", true],
    ['{"const":1e10000000}', "10e9999999", true],
    ['{"enum":[1,true,{"a":2,"b":1}]}', '{"b":1.0,"a":2e0}', true],
    ['{"enum":[]}', "null", false],
    ['{"minLength":2,"maxLength":2}', '"😀a"', true],
    ['{"minLength":2}', '"😀"', false],
    ['{"maxLength":1e10000000}', '"a"', true],
    ['{"minLength":1e10000000}', '"a"', false],
    ['{"required":["x"]}', "{}", false],
    ['{"dependentRequired":{"x":["y"]}}', '{"x":1}', false],
    ['{"minProperties":2,"maxProperties":2}', '{"x":1,"y":1}', true],
    ['{"minItems":1,"maxItems":2}', "[]", false],
    ['{"uniqueItems":true}', "[1,1.0]", false],
    ['{"uniqueItems":true}', "[false,0]", true],
    ['{"properties":{"x":{"type":"integer"}},"additionalProperties":false}', '{"x":1}', true],
    [
      '{"properties":{"x":{"type":"integer"}},"additionalProperties":false}',
      '{"x":1,"y":2}',
      false,
    ],
    ['{"prefixItems":[{"type":"integer"}],"items":{"type":"string"}}', '[1,"a"]', true],
    ['{"prefixItems":[true],"items":false}', "[1,2]", false],
    ['{"allOf":[{"minimum":1},{"maximum":2}]}', "2", true],
    ['{"anyOf":[false,{"type":"string"}]}', '"a"', true],
    ['{"oneOf":[true,true]}', "1", false],
    ['{"not":{"type":"number"}}', "1", false],
    ['{"if":{"type":"number"},"then":{"minimum":2},"else":{"type":"string"}}', '"a"', true],
    ['{"if":true,"then":false}', "1", false],
    ['{"then":false,"else":false}', "1", true],
    ['{"dependentSchemas":{"x":{"required":["y"]}}}', '{"x":1}', false],
    ['{"propertyNames":{"minLength":2}}', '{"a":1}', false],
    ['{"$defs":{"n":{"type":"number"}},"$ref":"#/$defs/n","minimum":2}', "1", false],
    ['{"format":"email"}', '"not email"', true],
    ['{"contentEncoding":"base64"}', '"not base64"', true],
    ['{"type":"string","minimum":5}', '"ok"', true],
  ] as const)("evaluates %s against %s", (schema, input, valid) => {
    const r = evaluate(schema, input);
    expect(r).toMatchObject({ kind: "evaluated", valid });
    if (r.kind === "evaluated") expect(r.diagnostics.length === 0).toBe(valid);
  });
  it("owns invocation-local facts and immutable annotations", () => {
    const c = compile('{"properties":{"x":{"const":1,"title":"x"}}}');
    if (c.kind !== "compiled") throw new Error(c.reason);
    for (let i = 0; i < 10; i++) {
      expect(c.evaluateUtf8(bytes('{"x":1}'))).toMatchObject({ kind: "evaluated", valid: true });
      expect(c.evaluateUtf8(bytes('{"x":2}'))).toMatchObject({ kind: "evaluated", valid: false });
    }
  });
  it("discards speculative annotations and preserves reference occurrence paths", () => {
    const r = evaluate(
      '{"$defs":{"s":{"title":"shared"}},"allOf":[{"$ref":"#/$defs/s"},{"$ref":"#/$defs/s"}],"anyOf":[{"title":"bad","type":"number"},{"title":"good"}]}',
      '"a"',
    );
    if (r.kind !== "evaluated") throw new Error(r.reason);
    expect(r.valid).toBe(true);
    expect(r.annotations.filter((a) => a.keyword === "title").map((a) => a.value)).toEqual([
      "shared",
      "shared",
      "good",
    ]);
    expect(
      new Set(r.annotations.filter((a) => a.value === "shared").map((a) => a.validationPath)).size,
    ).toBe(2);
  });
  it("collects successful if children but no invented if boolean", () => {
    const r = evaluate('{"if":{"title":"condition"}}', "1");
    if (r.kind !== "evaluated") throw new Error(r.reason);
    expect(r.annotations.map((a) => a.keyword)).toEqual(["title"]);
  });
  it("reports actual missing/property-name locations and escapes real children", () => {
    for (const schema of ['{"required":["missing"]}', '{"propertyNames":false}']) {
      const r = evaluate(schema, '{"x":1}');
      if (r.kind !== "evaluated") throw new Error(r.reason);
      expect(r.diagnostics[0]?.instanceLocation).toBe("");
    }
    const r = evaluate('{"properties":{"a/~":{"const":2}}}', '{"a/~":1}');
    if (r.kind !== "evaluated") throw new Error(r.reason);
    expect(r.diagnostics[0]?.instanceLocation).toBe("/a~1~0");
  });
  it.each([
    '{"pattern":"(a+)+$"}',
    '{"contentMediaType":"text/plain"}',
    '{"contains":true}',
    '{"minContains":0}',
    '{"unevaluatedProperties":true}',
    '{"$dynamicAnchor":"x","$dynamicRef":"#x"}',
    '{"$ref":"#"}',
    '{"$defs":{"x":{"items":{"$ref":"#/$defs/x"}}},"$ref":"#/$defs/x"}',
  ])("refuses before evaluation %s", (schema) => expect(compile(schema).kind).toBe("refused"));
  it("admits static dynamicRef and rejects unused pattern declarations", () => {
    expect(
      evaluate('{"$defs":{"x":{"$anchor":"x","type":"integer"}},"$dynamicRef":"#x"}', "1"),
    ).toMatchObject({ kind: "evaluated", valid: true });
    expect(compile('{"$defs":{"x":{"pattern":"x"}}}')).toMatchObject({
      kind: "refused",
      phase: "compile",
      reason: "unsupported-pattern",
    });
  });
  it.each(['{"x":1,"x":2}', '"\\ud800"', "1e", "\ufeff{}"])("refuses input domain %s", (input) =>
    expect(evaluate("true", input)).toMatchObject({
      kind: "refused",
      phase: "instance",
      reason: "input-domain",
    }),
  );
  it("handles deep equality without recursion", () => {
    const v = `${"[".repeat(2000)}9007199254740993${"]".repeat(2000)}`;
    expect(evaluate(`{"const":${v}}`, v)).toMatchObject({ kind: "evaluated", valid: true });
  });
  it("extracts exact scalar spans", () => {
    const text =
      '[{"schema":true,"tests":[{"data":1e99999999},{"data":"}\\"["},{"data":null},{"data":[9007199254740993]}]}]';
    const spans = instanceSpans(text);
    expect(spans.map((s) => s.text)).toEqual([
      "1e99999999",
      '"}\\"["',
      "null",
      "[9007199254740993]",
    ]);
    for (const span of spans) expect(text.slice(span.start, span.end)).toBe(span.text);
  });
  it("does not invoke supplied entry getters", () => {
    let hits = 0;
    const input = {
      bundle: {},
      graphLimits: {},
      limits: EVALUATOR_CEILINGS,
      entry: {
        get kind() {
          hits++;
          return "schema";
        },
        retrievalUri: "x",
      },
    };
    expect(compilePrivateSchemaEvaluator(input as never).kind).toBe("refused");
    expect(hits).toBe(0);
  });
  it("truncates only on a confirmed additional diagnostic", () => {
    const schema = '{"required":["a"],"minProperties":2}';
    const c = compile(schema, { ...EVALUATOR_CEILINGS, diagnostics: 1 });
    if (c.kind !== "compiled") throw new Error(c.reason);
    expect(c.evaluateUtf8(bytes("{}"))).toMatchObject({
      kind: "evaluated",
      valid: false,
      diagnosticsComplete: false,
    });
    const one = compile('{"required":["a"]}', { ...EVALUATOR_CEILINGS, diagnostics: 1 });
    if (one.kind !== "compiled") throw new Error(one.reason);
    expect(one.evaluateUtf8(bytes("{}"))).toMatchObject({
      kind: "evaluated",
      diagnosticsComplete: true,
    });
  });
  it("checks first complete diagnostic fit at byte equality and one below", () => {
    const original = evaluate("false", "null");
    if (original.kind !== "evaluated") throw new Error(original.reason);
    const n = original.counters.diagnosticBytes;
    for (const delta of [0, -1]) {
      const c = compile("false", { ...EVALUATOR_CEILINGS, diagnosticBytes: n + delta });
      if (c.kind !== "compiled") throw new Error(c.reason);
      expect(c.evaluateUtf8(bytes("null")).kind).toBe(delta ? "refused" : "evaluated");
    }
  });
  it("preserves number tokens at the input boundary", () => {
    const b = new EvaluationBudget(EVALUATOR_CEILINGS);
    expect(instanceIndex(bytes("1e9999999"), b)[0]?.value).toEqual(
      new JsonNumberLiteral("1e9999999"),
    );
  });
  it.each(Object.keys(EVALUATOR_CEILINGS) as (keyof EvaluatorLimits)[])(
    "checks independent %s exact and one over",
    (key) => {
      const b = new EvaluationBudget({ ...EVALUATOR_CEILINGS, [key]: 2 });
      b.charge(key, 2);
      expect(b.counts[key]).toBe(2);
      expect(() => b.charge(key)).toThrow(`limit-${key}`);
    },
  );
  it("distinguishes runtime work refusal from validity", () => {
    const c = compile('{"uniqueItems":true}', { ...EVALUATOR_CEILINGS, work: 2000 });
    if (c.kind !== "compiled") throw new Error(c.reason);
    expect(
      c.evaluateUtf8(bytes(JSON.stringify(Array.from({ length: 150 }, (_, i) => i)))),
    ).toMatchObject({ kind: "refused", phase: "instance", reason: "limit-work" });
  });
  it("binds a real descriptor to its below-root schema and copies caller bytes", () => {
    const schema = bytes('{"$defs":{"x":{"const":1}}}');
    const descriptor = bytes(
      '{"id":"https://test.example/type","name":"T","describes":"bead","conformsTo":[],"propertiesSchema":"https://test.example/schema#/$defs/x"}',
    );
    const c = compilePrivateSchemaEvaluator({
      bundle: {
        descriptors: [{ retrievalUri: "https://test.example/type", utf8Bytes: descriptor }],
        schemas: [{ retrievalUri: "https://test.example/schema", utf8Bytes: schema }],
        limits: CONTRACT_ARTIFACT_CEILINGS,
      },
      graphLimits: SCHEMA_GRAPH_CEILINGS,
      entry: { kind: "descriptor", typeId: "https://test.example/type" },
      limits: EVALUATOR_CEILINGS,
    });
    if (c.kind !== "compiled") throw new Error(c.reason);
    schema.fill(0);
    descriptor.fill(0);
    expect(c.evaluateUtf8(bytes("1"))).toMatchObject({ kind: "evaluated", valid: true });
    const r = c.evaluateUtf8(bytes("2"));
    if (r.kind !== "evaluated") throw new Error(r.reason);
    expect(r.diagnostics[0]?.schemaLocation).toBe("https://test.example/schema#/%24defs/x/const");
  });
  it.each([
    ["inputBytes", "true", "null", 4],
    ["valueNodes", "true", "[1]", 2],
    ["frames", "true", "[1,2,3,4]", 4],
    ["states", '{"items":true}', "[1,2,3]", 4],
    ["coefficientDigits", '{"type":"integer"}', "12", 2],
  ] as const)("enforces %s at an actual operation boundary", (key, schema, input, limit) => {
    for (const delta of [0, -1]) {
      const c = compile(schema, { ...EVALUATOR_CEILINGS, [key]: limit + delta });
      if (c.kind !== "compiled") throw new Error(c.reason);
      const r = c.evaluateUtf8(bytes(input));
      expect(r.kind).toBe(delta ? "refused" : "evaluated");
      if (r.kind === "refused") expect(r.reason).toBe(`limit-${key}`);
    }
  });
  it.each(["logicalBytes", "work"] as const)(
    "checks observed %s equality without claiming heap measurement",
    (key) => {
      const schema = '{"uniqueItems":true}',
        input = JSON.stringify(Array.from({ length: 90 }, (_, i) => "x".repeat(20) + i));
      const r = evaluate(schema, input);
      if (r.kind !== "evaluated") throw new Error(r.reason);
      for (const delta of [0, -1]) {
        const c = compile(schema, { ...EVALUATOR_CEILINGS, [key]: r.counters[key] + delta });
        if (c.kind !== "compiled") throw new Error(c.reason);
        expect(c.evaluateUtf8(bytes(input)).kind).toBe(delta ? "refused" : "evaluated");
      }
    },
  );
});
