import { describe, expect, it } from "vitest";
import { JsonNumberLiteral } from "@bdp/protocol";
import {
  compilePrivateSchemaEvaluator,
  EVALUATOR_CEILINGS,
  type EvaluatorLimits,
} from "./installed-schema-evaluator.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { SCHEMA_GRAPH_CEILINGS } from "./installed-schema-shape.js";

import { EvaluationBudget, EvaluationLocations } from "./installed-schema-value.js";

const bytes = (s: string) => new TextEncoder().encode(s);
function compile(schema: string, limits: EvaluatorLimits = EVALUATOR_CEILINGS) {
  const result = compilePrivateSchemaEvaluator({
    bundle: {
      descriptors: [],
      schemas: [{ retrievalUri: "https://test.example/schema", utf8Bytes: bytes(schema) }],
      limits: CONTRACT_ARTIFACT_CEILINGS,
    },
    graphLimits: SCHEMA_GRAPH_CEILINGS,
    entry: { kind: "schema", retrievalUri: "https://test.example/schema" },
    limits,
  });
  if (result.kind !== "compiled") throw new Error(`compile: ${result.reason}`);
  return result;
}
function evaluate(schema: string, input: string, limits: EvaluatorLimits = EVALUATOR_CEILINGS) {
  const result = compile(schema, limits).evaluateUtf8(bytes(input));
  if (result.kind !== "evaluated") throw new Error(`instance: ${result.reason}`);
  expect(result.counters.annotationBytes).toBe(
    Buffer.byteLength(JSON.stringify(result.annotations)),
  );
  return result;
}

describe("bounded static unevaluated locations", () => {
  it.each([
    ['{"unevaluatedItems":false}', "[]", true],
    ['{"unevaluatedItems":false}', "[0]", false],
    ['{"unevaluatedProperties":false}', "{}", true],
    ['{"unevaluatedProperties":false}', '{"x":0}', false],
    ['{"unevaluatedItems":{"type":"null"}}', "[null]", true],
    ['{"unevaluatedProperties":{"type":"null"}}', '{"x":null}', true],
    ['{"unevaluatedItems":false}', "{}", true],
    ['{"unevaluatedProperties":false}', "[]", true],
    [
      '{"allOf":[{"prefixItems":[{"type":"string"}],"items":true}],"unevaluatedItems":false}',
      '["foo",42,true]',
      true,
    ],
    [
      '{"prefixItems":[true],"allOf":[{"unevaluatedItems":true}],"unevaluatedItems":false}',
      '["foo",42,true]',
      true,
    ],
    [
      '{"anyOf":[{"items":{"type":"string"}},true],"unevaluatedItems":{"type":"boolean"}}',
      '["yes","no"]',
      true,
    ],
    [
      '{"properties":{"x":true},"$defs":{"s":{"unevaluatedProperties":false}},"$ref":"#/$defs/s"}',
      '{"x":1}',
      false,
    ],
    ['{"allOf":[{"properties":{"x":true}},{"unevaluatedProperties":false}]}', '{"x":1}', false],
    [
      '{"not":{"anyOf":[true,{"properties":{"foo":true}}],"unevaluatedProperties":false}}',
      '{"bar":1}',
      true,
    ],
    [
      '{"not":{"anyOf":[true,{"properties":{"foo":true}}],"unevaluatedProperties":false}}',
      '{"foo":1}',
      false,
    ],
  ] as const)("evaluates %s on %s", (schema, input, valid) => {
    expect(evaluate(schema, input).valid).toBe(valid);
  });
  it.each(["minContains", "maxContains"])(
    "keeps successful contains coverage despite %s failure",
    (keyword) => {
      const result = evaluate(
        `{"contains":{"const":1},"${keyword}":${keyword === "minContains" ? 2 : 0},"unevaluatedItems":false}`,
        "[1]",
      );
      expect(result).toMatchObject({ valid: false, annotations: [], diagnosticsComplete: true });
      expect(result.diagnostics).toEqual([
        {
          schemaLocation: `https://test.example/schema#/${keyword}`,
          instanceLocation: "",
          message: `Schema assertion failed: ${keyword}`,
        },
      ]);
    },
  );
  it("emits empty property names but no empty-array unevaluated annotation", () => {
    expect(
      evaluate('{"unevaluatedProperties":true}', "{}").annotations.map((a) => [a.keyword, a.value]),
    ).toEqual([["unevaluatedProperties", []]]);
    expect(evaluate('{"unevaluatedItems":true}', "[]").annotations).toEqual([]);
    expect(
      evaluate('{"contains":true,"minContains":0,"unevaluatedItems":true}', "[]").annotations.map(
        (a) => [a.keyword, a.value],
      ),
    ).toEqual([["contains", []]]);
    expect(
      evaluate('{"contains":true,"unevaluatedItems":false}', "[0]").annotations.map((a) => [
        a.keyword,
        a.value,
      ]),
    ).toEqual([["contains", [new JsonNumberLiteral("0")]]]);
  });
  it.each([
    ['{"if":{"properties":{"x":true}},"unevaluatedProperties":false}', '{"x":1}', true],
    ['{"if":{"properties":{"x":true}},"unevaluatedProperties":false}', '{"y":1}', false],
    [
      '{"if":{"properties":{"x":true},"required":["missing"]},"else":{"properties":{"y":true}},"unevaluatedProperties":false}',
      '{"x":1,"y":1}',
      false,
    ],
    [
      '{"dependentSchemas":{"x":{"properties":{"y":true}}},"properties":{"x":true},"unevaluatedProperties":false}',
      '{"x":1,"y":1}',
      true,
    ],
    ['{"dependentSchemas":{"x":{}},"unevaluatedProperties":false}', '{"x":1}', false],
    [
      '{"oneOf":[{"properties":{"x":true},"required":["x"]},{"properties":{"y":true},"required":["y"]}],"unevaluatedProperties":false}',
      '{"x":1}',
      true,
    ],
    [
      '{"oneOf":[{"properties":{"x":true}},{"properties":{"y":true}}],"unevaluatedProperties":false}',
      '{"x":1}',
      false,
    ],
    [
      '{"anyOf":[{"contains":{"const":1},"maxContains":0},true],"unevaluatedItems":false}',
      "[1]",
      false,
    ],
    ['{"allOf":[true],"unevaluatedProperties":false}', '{"x":1}', false],
    ['{"propertyNames":{"type":"string"},"unevaluatedProperties":false}', '{"x":1}', false],
    [
      '{"properties":{"foo":{"properties":{"bar":true}}},"unevaluatedProperties":false}',
      '{"foo":{"bar":1},"bar":1}',
      false,
    ],
    ['{"prefixItems":[{"prefixItems":[true]}],"unevaluatedItems":false}', "[[1],1]", false],
    [
      '{"$defs":{"s":{"$anchor":"s","properties":{"x":true}}},"$dynamicRef":"#s","unevaluatedProperties":false}',
      '{"x":1}',
      true,
    ],
  ] as const)("isolates branch and instance coverage for %s", (schema, input, valid) => {
    expect(evaluate(schema, input).valid).toBe(valid);
  });
  it("commits only complete keyword success inside already-invalid parents", () => {
    const property = evaluate(
      '{"properties":{"foo":{"type":"string"},"bar":{"type":"string"}},"unevaluatedProperties":false}',
      '{"foo":"ok","bar":1}',
    );
    expect(property.valid).toBe(false);
    expect(property.annotations).toEqual([]);
    expect(property.diagnostics.map((d) => [d.instanceLocation, d.schemaLocation])).toEqual([
      ["/bar", "https://test.example/schema#/properties/bar/type"],
      ["/foo", "https://test.example/schema#/unevaluatedProperties"],
      ["/bar", "https://test.example/schema#/unevaluatedProperties"],
    ]);
    for (const keyword of [
      '"prefixItems":[{"type":"string"},{"type":"string"}]',
      '"items":{"type":"string"}',
    ]) {
      const result = evaluate(`{${keyword},"unevaluatedItems":false}`, '["ok",1]');
      expect(result.diagnostics.map((d) => d.instanceLocation)).toEqual(["/1", "/0", "/1"]);
    }
    const all = evaluate(
      '{"allOf":[{"properties":{"x":true}},false],"unevaluatedProperties":false}',
      '{"x":1}',
    );
    expect(all.diagnostics.map((d) => d.instanceLocation)).toEqual(["", "/x"]);
    const dependencies = evaluate(
      '{"properties":{"a":true,"b":true},"dependentSchemas":{"a":{"properties":{"x":true}},"b":false},"unevaluatedProperties":false}',
      '{"a":1,"b":1,"x":1}',
    );
    expect(dependencies.diagnostics.map((d) => d.instanceLocation)).toEqual(["", "/x"]);
  });
  it("keeps additionalProperties local and true items independent of failed prefix", () => {
    const extra = evaluate(
      '{"allOf":[{"properties":{"x":true}}],"additionalProperties":false,"unevaluatedProperties":false}',
      '{"x":1}',
    );
    expect(extra.diagnostics).toEqual([
      {
        schemaLocation: "https://test.example/schema#/additionalProperties",
        instanceLocation: "/x",
        message: "Schema rejects every instance",
      },
    ]);
    const prefix = evaluate(
      '{"prefixItems":[false],"items":true,"unevaluatedItems":false}',
      "[0,1]",
    );
    expect(prefix.diagnostics).toEqual([
      {
        schemaLocation: "https://test.example/schema#/prefixItems/0",
        instanceLocation: "/0",
        message: "Schema rejects every instance",
      },
    ]);
  });
  it("preserves empty and nonempty contains index sets rather than a true shortcut", () => {
    expect(
      evaluate('{"contains":{"const":1},"minContains":0,"unevaluatedItems":false}', "[]").valid,
    ).toBe(true);
    expect(
      evaluate('{"contains":{"const":1},"minContains":0,"unevaluatedItems":false}', "[2]").valid,
    ).toBe(false);
    expect(
      evaluate(
        '{"prefixItems":[true],"contains":{"type":"string"},"unevaluatedItems":false}',
        '[1,"ok",2]',
      ).valid,
    ).toBe(false);
    const full = evaluate('{"prefixItems":[true,true],"unevaluatedItems":true}', "[0,1]");
    expect(full.annotations.map((a) => a.keyword)).toEqual(["prefixItems"]);
  });
  it("keeps private summary deduplication separate from repeated output occurrences", () => {
    const schema =
      '{"$defs":{"s":{"unevaluatedProperties":{"const":1}}},"allOf":[{"$ref":"#/$defs/s"},{"$ref":"#/$defs/s"}],"unevaluatedProperties":false}';
    const c = compile(schema),
      first = c.evaluateUtf8(bytes('{"x":1}'));
    if (first.kind !== "evaluated") throw new Error(first.reason);
    expect(first.annotations.map((a) => [a.validationPath, a.value])).toEqual([
      ["/unevaluatedProperties", []],
      ["/allOf/1/$ref/unevaluatedProperties", ["x"]],
      ["/allOf/0/$ref/unevaluatedProperties", ["x"]],
    ]);
    expect(first).not.toHaveProperty("locations");
    expect(c.evaluateUtf8(bytes('{"x":2}'))).toMatchObject({ valid: false, annotations: [] });
    expect(c.evaluateUtf8(bytes('{"x":1}'))).toEqual(first);
    expect(Object.isFrozen(first.annotations[1]?.value)).toBe(true);
  });
  it("reports real escaped child locations and deterministic annotations", () => {
    const r = evaluate('{"unevaluatedProperties":{"title":"child"}}', '{"a/~":1}');
    expect(r.annotations).toEqual([
      {
        keyword: "unevaluatedProperties",
        value: ["a/~"],
        schemaLocation: "https://test.example/schema#/unevaluatedProperties",
        instanceLocation: "",
        validationPath: "/unevaluatedProperties",
      },
      {
        keyword: "title",
        value: "child",
        schemaLocation: "https://test.example/schema#/unevaluatedProperties/title",
        instanceLocation: "/a~1~0",
        validationPath: "/unevaluatedProperties/title",
      },
    ]);
  });
  it("keeps unreachable definitions inactive and bare then conservatively tracked but unapplied", () => {
    // Keep the same root keyword/edge shape: even dormant $defs adds existing
    // keyword-scan work, independently of the new coverage feature flag.
    const base = evaluate(
      '{"$defs":{"unused":{"title":"unused"}},"properties":{"x":true}}',
      '{"x":1}',
    );
    const reserved = evaluate(
      '{"$defs":{"unused":{"unevaluatedProperties":false}},"properties":{"x":true}}',
      '{"x":1}',
    );
    expect(reserved).toEqual(base);
    const bare = evaluate('{"then":{"unevaluatedProperties":false}}', '{"x":1}');
    expect(bare).toMatchObject({ valid: true, annotations: [] });
    expect(bare.counters.logicalBytes).toBeGreaterThan(
      evaluate('{"then":false}', '{"x":1}').counters.logicalBytes,
    );
    expect(base.deferred).not.toContain("unevaluated");
    expect(base.annotationPolicy.revision).toBe("bounded-annotation-output-2");
  });
  it.each([
    ['{"unevaluatedProperties":{"pattern":"(?=x)"}}', "unsupported-pattern"],
    ['{"unevaluatedItems":{"$dynamicAnchor":"x","$dynamicRef":"#x"}}', "unsupported-dynamic"],
  ])("retains the qualified refusal for %s", (schema, reason) => {
    expect(() => compile(schema)).toThrow(`compile: ${reason}`);
  });
  it("executes the former literal-pattern refusal fixture", () => {
    expect(evaluate('{"unevaluatedProperties":{"pattern":"x"}}', '{"k":"x"}')).toMatchObject({
      valid: true,
    });
    expect(evaluate('{"unevaluatedProperties":{"pattern":"x"}}', '{"k":"y"}')).toMatchObject({
      valid: false,
    });
  });
  it("admits recursive unevaluated items with an invalid leaf neighbor", () => {
    const c = compile('{"type":"array","unevaluatedItems":{"$ref":"#"}}');
    expect(c.evaluateUtf8(bytes("[[[]]]"))).toMatchObject({ kind: "evaluated", valid: true });
    expect(c.evaluateUtf8(bytes("[[1]]"))).toMatchObject({ kind: "evaluated", valid: false });
  });
  it.each([
    ['{"unevaluatedItems":{"minimum":0}}', "[-1,123]", "[-1,12]"],
    ['{"unevaluatedProperties":{"minimum":0}}', '{"a":-1,"b":123}', '{"a":-1,"b":12}'],
  ])("visits the late child after an earlier failure for %s", (schema, refused, neighbor) => {
    const c = compile(schema, { ...EVALUATOR_CEILINGS, coefficientDigits: 2 });
    expect(c.evaluateUtf8(bytes(refused))).toMatchObject({
      kind: "refused",
      phase: "instance",
      reason: "limit-coefficientDigits",
    });
    expect(c.evaluateUtf8(bytes(neighbor))).toMatchObject({
      kind: "evaluated",
      valid: false,
      annotations: [],
    });
  });
  it("keeps the private diagnostic convention within exact envelopes", () => {
    const schema = '{"unevaluatedProperties":false}',
      input = '{"a":0,"b":1}';
    const expected = ["a", "b"].map((key) => ({
      schemaLocation: "https://test.example/schema#/unevaluatedProperties",
      instanceLocation: `/${key}`,
      message: "Schema rejects every instance",
    }));
    expect(evaluate(schema, input).diagnostics).toEqual(expected);
    const firstBytes = Buffer.byteLength(JSON.stringify([expected[0]]));
    for (const limits of [{ diagnostics: 1 }, { diagnosticBytes: firstBytes }])
      expect(evaluate(schema, input, { ...EVALUATOR_CEILINGS, ...limits })).toMatchObject({
        diagnostics: [expected[0]],
        diagnosticsComplete: false,
        annotations: [],
      });
    expect(
      evaluate(schema, input, {
        ...EVALUATOR_CEILINGS,
        diagnosticBytes: Buffer.byteLength(JSON.stringify(expected)),
      }),
    ).toMatchObject({ diagnostics: expected, diagnosticsComplete: true });
    for (const limits of [{ diagnostics: 0 }, { diagnosticBytes: firstBytes - 1 }])
      expect(
        compile(schema, { ...EVALUATOR_CEILINGS, ...limits }).evaluateUtf8(bytes(input)),
      ).toMatchObject({ kind: "refused", phase: "instance", reason: "first-diagnostic-fit" });
  });
  it("reserves coverage storage before growth and charges repeated attempts", () => {
    expect(() =>
      EvaluationLocations.create(
        0,
        false,
        new EvaluationBudget({ ...EVALUATOR_CEILINGS, logicalBytes: 63 }),
      ),
    ).toThrow("limit-logicalBytes");
    const b = new EvaluationBudget({ ...EVALUATOR_CEILINGS, logicalBytes: 95 });
    const tooSmall = EvaluationLocations.create(0, false, b);
    expect(() => tooSmall.mark(1)).toThrow("limit-logicalBytes");
    expect(tooSmall.covers(1)).toBe(false);
    const budget = new EvaluationBudget(EVALUATOR_CEILINGS);
    const child = EvaluationLocations.create(0, true, budget);
    child.mark(1);
    child.mark(1);
    child.markAllItems();
    child.seal();
    expect(budget.counts).toMatchObject({ logicalBytes: 96, work: 6 });
    const parent = EvaluationLocations.create(0, true, budget);
    parent.merge(child);
    expect(budget.counts).toMatchObject({ logicalBytes: 192, work: 13 });
    parent.merge(child);
    expect(budget.counts).toMatchObject({ logicalBytes: 192, work: 20 });
    expect(parent.allItems).toBe(true);
    expect(parent.covers(99)).toBe(true);
    expect(() => child.mark(2)).toThrow("coverage-sealed");
    expect(() => child.markAllItems()).toThrow("coverage-sealed");
    expect(() => parent.merge(EvaluationLocations.create(0, true, budget))).toThrow(
      "coverage-unsealed",
    );
    const other = EvaluationLocations.create(1, true, budget);
    other.seal();
    expect(() => parent.merge(other)).toThrow("coverage-instance");
    const otherInvocation = EvaluationLocations.create(
      0,
      true,
      new EvaluationBudget(EVALUATOR_CEILINGS),
    );
    otherInvocation.seal();
    expect(() => parent.merge(otherInvocation)).toThrow("coverage-instance");
  });
  it("keeps a sealed child's coverage unchanged when the receiver covers all items", () => {
    const budget = new EvaluationBudget(EVALUATOR_CEILINGS);
    const child = EvaluationLocations.create(0, true, budget);
    child.mark(1);
    child.seal();
    expect(child.allItems).toBe(false);
    expect(child.covers(1)).toBe(true);
    expect(child.covers(2)).toBe(false);
    const receiver = EvaluationLocations.create(0, true, budget);
    receiver.markAllItems();
    receiver.merge(child);
    expect(receiver.covers(2)).toBe(true);
    expect(child.allItems).toBe(false);
    expect(child.covers(1)).toBe(true);
    expect(child.covers(2)).toBe(false);
  });
  it.each([
    "logicalBytes",
    "work",
    "annotations",
    "annotationBytes",
    "occurrences",
    "states",
    "frames",
    "valueNodes",
  ] as const)("enforces independent %s boundaries on 128 real properties", (key) => {
    const input = JSON.stringify(
      Object.fromEntries(Array.from({ length: 128 }, (_, i) => [`p${i}`, 0])),
    );
    const schema = '{"unevaluatedProperties":true}',
      r = evaluate(schema, input);
    expect(r.counters.valueNodes).toBe(129);
    expect(r.counters.states).toBe(129);
    expect(r.counters.occurrences).toBe(129);
    expect(r.counters.annotations).toBe(1);
    for (const delta of [0, -1])
      expect(
        compile(schema, { ...EVALUATOR_CEILINGS, [key]: r.counters[key] + delta }).evaluateUtf8(
          bytes(input),
        ),
      ).toMatchObject(
        delta
          ? { kind: "refused", phase: "instance", reason: `limit-${key}` }
          : { kind: "evaluated", valid: true },
      );
  });
  it("bounds four shared-reference unions without suppressing annotation occurrences", () => {
    const properties = Object.fromEntries(Array.from({ length: 128 }, (_, i) => [`p${i}`, true]));
    const input = JSON.stringify(
      Object.fromEntries(Object.keys(properties).map((key) => [key, 0])),
    );
    const schema = JSON.stringify({
      $defs: { s: { properties } },
      allOf: Array.from({ length: 4 }, () => ({ $ref: "#/$defs/s" })),
      unevaluatedProperties: false,
    });
    const r = evaluate(schema, input);
    expect(r.annotations.map((a) => a.keyword)).toEqual([
      "unevaluatedProperties",
      "properties",
      "properties",
      "properties",
      "properties",
    ]);
    expect(new Set(r.annotations.slice(1).map((a) => a.validationPath)).size).toBe(4);
    for (const key of ["work", "logicalBytes"] as const)
      for (const delta of [0, -1])
        expect(
          compile(schema, { ...EVALUATOR_CEILINGS, [key]: r.counters[key] + delta }).evaluateUtf8(
            bytes(input),
          ),
        ).toMatchObject(
          delta
            ? { kind: "refused", phase: "instance", reason: `limit-${key}` }
            : { kind: "evaluated", valid: true },
        );
  });
  it.each([
    '{"$defs":{"s":{"items":true}},"$ref":"#/$defs/s","unevaluatedItems":false}',
    '{"oneOf":[{"items":true},false],"unevaluatedItems":false}',
    '{"if":{"items":true},"unevaluatedItems":false}',
    '{"if":true,"then":{"items":true},"unevaluatedItems":false}',
    '{"if":false,"else":{"items":true},"unevaluatedItems":false}',
  ])("propagates the allItems flag through %s", (schema) => {
    const r = evaluate(schema, "[1,2]");
    expect(r.valid).toBe(true);
    expect(r.annotations.filter((a) => a.keyword === "unevaluatedItems")).toEqual([]);
  });
  it("charges discarded candidates, copied names and unique coverage before invalid projection", () => {
    for (const n of [0, 1, 12, 128]) {
      const values = Array.from({ length: n }, () => 0);
      const items = evaluate('{"type":"null","unevaluatedItems":true}', JSON.stringify(values));
      const properties = evaluate(
        '{"type":"null","unevaluatedProperties":true}',
        JSON.stringify(Object.fromEntries(values.map((v, i) => [String(i), v]))),
      );
      for (const r of [items, properties])
        expect(r).toMatchObject({ valid: false, annotations: [], counters: { occurrences: 1 } });
      // Numeric object keys and array indexes retain identical instance strings.
      // Objects add one candidate container (64), then names+IDs containers (128).
      // Per child: two candidate slots (32), unique coverage (32), longer link (10).
      // Empty objects alone retain the empty-name annotation record (32).
      expect(properties.counters.logicalBytes - items.counters.logicalBytes).toBe(
        n ? 192 + 74 * n : 224,
      );
    }
  });
  it("schedules a fixed 512-node acyclic chain without recursive evaluation", () => {
    const defs: Record<string, unknown> = { s0: { properties: { x: true } } };
    for (let i = 1; i < 512; i++) defs[`s${i}`] = { $ref: `#/$defs/s${i - 1}` };
    const schema = JSON.stringify({
      $defs: defs,
      $ref: "#/$defs/s511",
      unevaluatedProperties: false,
    });
    expect(evaluate(schema, '{"x":1}')).toMatchObject({ valid: true, diagnostics: [] });
  });
});
