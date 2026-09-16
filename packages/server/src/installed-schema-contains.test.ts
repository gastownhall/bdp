import { describe, expect, it } from "vitest";
import { JsonNumberLiteral } from "@bdp/protocol";
import {
  compilePrivateSchemaEvaluator,
  EVALUATOR_CEILINGS,
  type EvaluatorLimits,
} from "./installed-schema-evaluator.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { SCHEMA_GRAPH_CEILINGS } from "./installed-schema-shape.js";

const bytes = (s: string) => new TextEncoder().encode(s);
function compile(schema: string, limits: EvaluatorLimits = EVALUATOR_CEILINGS) {
  const c = compilePrivateSchemaEvaluator({
    bundle: {
      descriptors: [],
      schemas: [{ retrievalUri: "https://test.example/schema", utf8Bytes: bytes(schema) }],
      limits: CONTRACT_ARTIFACT_CEILINGS,
    },
    graphLimits: SCHEMA_GRAPH_CEILINGS,
    entry: { kind: "schema", retrievalUri: "https://test.example/schema" },
    limits,
  });
  if (c.kind !== "compiled") throw new Error(`compile: ${c.reason}`);
  return c;
}
function evaluate(schema: string, input: string, limits: EvaluatorLimits = EVALUATOR_CEILINGS) {
  const result = compile(schema, limits).evaluateUtf8(bytes(input));
  if (result.kind !== "evaluated") throw new Error(`instance: ${result.reason}`);
  expect(result.counters.annotationBytes).toBe(
    Buffer.byteLength(JSON.stringify(result.annotations)),
  );
  return result;
}
const diagnostic = (keyword: string) => ({
  schemaLocation: `https://test.example/schema#/${keyword}`,
  instanceLocation: "",
  message: `Schema assertion failed: ${keyword}`,
});

describe("bounded static contains", () => {
  it("orders contradictory count diagnostics minContains before maxContains", () => {
    const r = evaluate('{"contains":{"const":1},"minContains":3,"maxContains":1}', "[1,1]");
    expect(r).toMatchObject({
      valid: false,
      diagnostics: [diagnostic("minContains"), diagnostic("maxContains")],
      diagnosticsComplete: true,
    });
  });
  it("enforces raw coefficient width for count bounds without a floating-point shortcut", () => {
    for (const keyword of ["minContains", "maxContains"]) {
      const healthy = compile(`{"contains":true,"${keyword}":${"9".repeat(4096)}}`).evaluateUtf8(
        bytes("[0]"),
      );
      expect(healthy).toMatchObject({
        kind: "evaluated",
        valid: keyword === "maxContains",
        counters: { coefficientDigits: 4096 },
      });
      expect(
        compile(`{"contains":true,"${keyword}":${"9".repeat(4097)}}`).evaluateUtf8(bytes("[0]")),
      ).toMatchObject({
        kind: "refused",
        phase: "instance",
        reason: "limit-coefficientDigits",
      });
    }
  });
  it("contains includes matching elements already covered by prefixItems", () => {
    const r = evaluate('{"prefixItems":[{"const":9}],"contains":{"type":"integer"}}', "[9,1]");
    expect(r.valid).toBe(true);
    expect(r.annotations.map((a) => [a.keyword, a.value])).toEqual([
      ["prefixItems", new JsonNumberLiteral("0")],
      ["contains", [new JsonNumberLiteral("0"), new JsonNumberLiteral("1")]],
    ]);
  });
  it("visits a late child after maxContains has already failed", () => {
    const c = compile('{"contains":{"minimum":0},"maxContains":0}', {
      ...EVALUATOR_CEILINGS,
      coefficientDigits: 2,
    });
    expect(c.evaluateUtf8(bytes("[1,123]"))).toMatchObject({
      kind: "refused",
      phase: "instance",
      reason: "limit-coefficientDigits",
    });
    expect(c.evaluateUtf8(bytes("[1,12]"))).toMatchObject({
      kind: "evaluated",
      valid: false,
      annotations: [],
      diagnostics: [diagnostic("maxContains")],
    });
  });
  it("discards contains annotations from a failed anyOf branch when another wins", () => {
    const r = evaluate(
      '{"anyOf":[{"contains":{"title":"hidden"},"maxItems":0},{"title":"winner"}]}',
      "[0]",
    );
    expect(r).toMatchObject({ valid: true, diagnostics: [] });
    expect(r.annotations.map((a) => [a.keyword, a.value])).toEqual([["title", "winner"]]);
  });
  it("independently accounts generated indexes and links before invalid-result projection", () => {
    const schema = '{"type":"null","contains":{"const":0},"minContains":0}';
    for (const count of [0, 1, 12]) {
      const matching = evaluate(schema, JSON.stringify(Array.from({ length: count }, () => 0)));
      const failing = evaluate(schema, JSON.stringify(Array.from({ length: count }, () => 1)));
      for (const r of [matching, failing])
        expect(r).toMatchObject({
          valid: false,
          annotations: [],
          diagnostics: [diagnostic("type")],
        });
      // Equal-sized input tokens and identical root diagnostic projection cancel.
      // Every match adds value64 + slot16 + literal2n + link48; every failed
      // trial instead adds its local failure slot16. Multi-digit indexes matter.
      const retainedDelta = Array.from(
        { length: count },
        (_, i) => 112 + 2 * String(i).length,
      ).reduce((sum, cost) => sum + cost, 0);
      expect(matching.counters.logicalBytes - failing.counters.logicalBytes).toBe(retainedDelta);
      expect(matching.counters.valueNodes - failing.counters.valueNodes).toBe(count);
      expect(matching.counters.occurrences).toBe(1);
      expect(failing.counters.occurrences).toBe(1);
    }
  });
  it("keeps unsupported contains children refused beside a supported neighbor", () => {
    expect(evaluate('{"contains":{"pattern":"x"}}', '["x"]')).toMatchObject({ valid: true });
    expect(evaluate('{"contains":{"pattern":"x"}}', '["y"]')).toMatchObject({ valid: false });
    expect(evaluate('{"contains":{"unevaluatedItems":{"pattern":"x"}}}', '[["x"]]')).toMatchObject({
      valid: true,
    });
    expect(evaluate('{"contains":{"unevaluatedItems":{"pattern":"x"}}}', '[["y"]]')).toMatchObject({
      valid: false,
    });
    expect(() => compile('{"contains":{"pattern":"(?=x)"}}')).toThrow("unsupported-pattern");
    expect(() => compile('{"contains":{"unevaluatedItems":{"pattern":"(?=x)"}}}')).toThrow(
      "unsupported-pattern",
    );
    expect(evaluate('{"contains":{"const":"x"}}', '["x"]')).toMatchObject({ valid: true });
  });
  it.each(["0", "0.0", "0e0", "0e-5", "-0", "-0.0"])(
    "recognizes mathematical min zero %s with no matching element",
    (zero) => {
      for (const input of ["[]", "[2]"]) {
        const r = evaluate(`{"contains":{"const":1},"minContains":${zero}}`, input);
        expect(r.valid).toBe(true);
        expect(r.annotations.map((a) => [a.keyword, a.value])).toEqual([["contains", []]]);
      }
    },
  );
  it.each([
    ['{"contains":true}', "[]", false],
    ['{"contains":true}', "[null,false]", true],
    ['{"contains":false}', "[0]", false],
    ['{"contains":false,"minContains":0}', "[0]", true],
    ['{"contains":true,"minContains":2.0,"maxContains":2e0}', "[0,1]", true],
    ['{"contains":true,"minContains":2,"maxContains":2}', "[0]", false],
    ['{"contains":true,"minContains":2,"maxContains":2}', "[0,1,2]", false],
    ['{"contains":true,"minContains":3,"maxContains":1}', "[0,1]", false],
    ['{"contains":true,"minContains":1e1000}', "[0]", false],
    ['{"contains":true,"maxContains":1e1000}', "[0]", true],
    ['{"contains":true,"minContains":0,"maxContains":0}', "[0]", false],
  ])("evaluates %s on %s", (schema, input, valid) => {
    expect(evaluate(schema, input).valid).toBe(valid);
  });
  it("ignores adjacent counts without contains and all three keywords on nonarrays", () => {
    for (const input of ["[]", "[0]", "null", "{}", '"x"', "5"]) {
      const r = evaluate('{"minContains":2,"maxContains":0}', input);
      expect(r).toMatchObject({ valid: true, annotations: [] });
    }
    for (const input of ["null", "{}", '"x"', "5"]) {
      expect(evaluate('{"contains":false,"minContains":2,"maxContains":0}', input)).toMatchObject({
        valid: true,
        annotations: [],
      });
    }
  });
  it("does not share counts between allOf schema objects", () => {
    expect(
      evaluate('{"allOf":[{"contains":true},{"minContains":2,"maxContains":0}]}', "[1]").valid,
    ).toBe(true);
    expect(evaluate('{"allOf":[{"contains":false},{"minContains":0}]}', "[]").valid).toBe(false);
  });
  it("visits every item and retains only matching child annotations in schema order", () => {
    const r = evaluate('{"contains":{"type":"integer","title":"match"}}', '[1,"x",2]');
    expect(r.valid).toBe(true);
    expect(r.diagnostics).toEqual([]);
    expect(r.annotations).toEqual([
      {
        keyword: "contains",
        value: [new JsonNumberLiteral("0"), new JsonNumberLiteral("2")],
        schemaLocation: "https://test.example/schema#/contains",
        instanceLocation: "",
        validationPath: "/contains",
      },
      {
        keyword: "title",
        value: "match",
        schemaLocation: "https://test.example/schema#/contains/title",
        instanceLocation: "/0",
        validationPath: "/contains/title",
      },
      {
        keyword: "title",
        value: "match",
        schemaLocation: "https://test.example/schema#/contains/title",
        instanceLocation: "/2",
        validationPath: "/contains/title",
      },
    ]);
    expect(Object.isFrozen(r.annotations[0]?.value)).toBe(true);
    const value = new JsonNumberLiteral("0");
    expect(Object.keys(value)).toEqual(["literal"]);
    expect(Object.isFrozen(value)).toBe(true);
    expect(JSON.stringify(value)).toBe('{"literal":"0"}');
  });
  it("places contains after items before metadata without hiding later matches", () => {
    const r = evaluate('{"title":"parent","items":true,"contains":{"title":"child"}}', "[0,1]");
    expect(r.annotations.map((a) => a.keyword)).toEqual([
      "items",
      "contains",
      "title",
      "title",
      "title",
    ]);
    expect(r.annotations[1]?.value).toEqual([
      new JsonNumberLiteral("0"),
      new JsonNumberLiteral("1"),
    ]);
  });
  it("preserves repeated reference occurrences and invocation locality", () => {
    const schema =
      '{"$defs":{"s":{"contains":{"title":"match"}}},"allOf":[{"$ref":"#/$defs/s"},{"$ref":"#/$defs/s"}]}';
    const c = compile(schema);
    const first = c.evaluateUtf8(bytes("[1]"));
    expect(first.kind).toBe("evaluated");
    if (first.kind !== "evaluated") throw new Error(first.reason);
    expect(first.annotations.map((a) => a.validationPath)).toEqual([
      "/allOf/1/$ref/contains",
      "/allOf/1/$ref/contains/title",
      "/allOf/0/$ref/contains",
      "/allOf/0/$ref/contains/title",
    ]);
    expect(c.evaluateUtf8(bytes("[]"))).toMatchObject({ valid: false, annotations: [] });
    expect(c.evaluateUtf8(bytes("[1]"))).toEqual(first);
  });
  it("suppresses failed-trial diagnostics and failed enclosing annotations", () => {
    for (const input of ["[2,3,4]", "[]"]) {
      const r = evaluate('{"contains":{"minimum":5}}', input);
      expect(r).toMatchObject({
        valid: false,
        annotations: [],
        diagnostics: [diagnostic("contains")],
        diagnosticsComplete: true,
        counters: { annotationBytes: 2 },
      });
      expect(r.counters.diagnosticBytes).toBe(
        Buffer.byteLength(JSON.stringify([diagnostic("contains")])),
      );
    }
    expect(evaluate('{"contains":{"title":"match"},"maxItems":0}', "[1]")).toMatchObject({
      valid: false,
      annotations: [],
      diagnostics: [diagnostic("maxItems")],
    });
  });
  it("attributes truthful local failures and preserves diagnostic envelopes", () => {
    const schema = '{"contains":{"const":1},"minContains":2}';
    expect(evaluate(schema, "[1]").diagnostics).toEqual([diagnostic("minContains")]);
    const r = evaluate(schema, "[]");
    expect(r.diagnostics).toEqual([diagnostic("contains"), diagnostic("minContains")]);
    expect(r.diagnosticsComplete).toBe(true);
    for (const key of ["diagnostics", "diagnosticBytes"] as const) {
      expect(
        evaluate(schema, "[]", { ...EVALUATOR_CEILINGS, [key]: r.counters[key] }),
      ).toMatchObject({ diagnostics: r.diagnostics, diagnosticsComplete: true });
    }
    const oneBytes = Buffer.byteLength(JSON.stringify([diagnostic("contains")]));
    for (const limits of [{ diagnostics: 1 }, { diagnosticBytes: oneBytes }]) {
      expect(evaluate(schema, "[]", { ...EVALUATOR_CEILINGS, ...limits })).toMatchObject({
        diagnostics: [diagnostic("contains")],
        diagnosticsComplete: false,
      });
    }
    for (const limits of [{ diagnostics: 0 }, { diagnosticBytes: oneBytes - 1 }]) {
      expect(
        compile(schema, { ...EVALUATOR_CEILINGS, ...limits }).evaluateUtf8(bytes("[]")),
      ).toMatchObject({ kind: "refused", phase: "instance", reason: "first-diagnostic-fit" });
    }
  });
  it.each([
    "valueNodes",
    "logicalBytes",
    "work",
    "annotations",
    "annotationBytes",
    "occurrences",
  ] as const)("enforces exact %s boundary with a healthy neighbor", (key) => {
    const schema = '{"contains":true}',
      input = JSON.stringify(Array.from({ length: 1024 }, () => 0));
    const r = evaluate(schema, input);
    expect(r.counters.valueNodes).toBe(2049); // input array + 1024 values + 1024 generated indexes
    expect(r.counters.occurrences).toBe(1025); // parent + every successful boolean fact
    for (const delta of [0, -1]) {
      const result = compile(schema, {
        ...EVALUATOR_CEILINGS,
        [key]: r.counters[key] + delta,
      }).evaluateUtf8(bytes(input));
      expect(result).toMatchObject(
        delta
          ? { kind: "refused", phase: "instance", reason: `limit-${key}` }
          : { kind: "evaluated", valid: true },
      );
    }
  });
  it("charges generated indexes even when invalid enclosing output suppresses annotations", () => {
    const schema = '{"contains":true,"maxItems":0}',
      input = "[0,1,2,3,4,5,6,7]";
    const r = evaluate(schema, input);
    expect(r).toMatchObject({
      valid: false,
      annotations: [],
      counters: { valueNodes: 17, annotationBytes: 2 },
    });
    expect(
      compile(schema, { ...EVALUATOR_CEILINGS, valueNodes: 16 }).evaluateUtf8(bytes(input)),
    ).toMatchObject({ kind: "refused", phase: "instance", reason: "limit-valueNodes" });
  });
});
