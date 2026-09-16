import { qualifyStaticRecursion } from "./installed-schema-recursion.js";
import { EvaluationBudget } from "./installed-schema-value.js";
import type { SchemaNode, SchemaReference } from "./installed-schema-graph.js";
import { describe, expect, it } from "vitest";
import {
  compilePrivateSchemaEvaluator,
  EVALUATOR_CEILINGS,
  type EvaluatorLimits,
} from "./installed-schema-evaluator.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { SCHEMA_GRAPH_CEILINGS } from "./installed-schema-shape.js";

const uri = "https://test.example/schema";
const bytes = (s: string) => new TextEncoder().encode(s);
const registerNoPattern = () => undefined;
function admit(schema: string, limits: EvaluatorLimits = EVALUATOR_CEILINGS) {
  return compilePrivateSchemaEvaluator({
    bundle: {
      descriptors: [],
      schemas: [{ retrievalUri: uri, utf8Bytes: bytes(schema) }],
      limits: CONTRACT_ARTIFACT_CEILINGS,
    },
    graphLimits: SCHEMA_GRAPH_CEILINGS,
    entry: { kind: "schema", retrievalUri: uri },
    limits,
  });
}
function compile(schema: string, limits: EvaluatorLimits = EVALUATOR_CEILINGS) {
  const c = admit(schema, limits);
  if (c.kind !== "compiled") throw new Error(`compile: ${c.reason}`);
  return c;
}
function evaluate(schema: string, input: string) {
  const r = compile(schema).evaluateUtf8(bytes(input));
  if (r.kind !== "evaluated") throw new Error(`instance: ${r.reason}`);
  return r;
}
const recursiveArray = '{"anyOf":[{"type":"integer"},{"type":"array","items":{"$ref":"#"}}]}';

// Isolated helper fixtures, not measured whole-compiler budgets. Actual graph
// construction also retains the builtin closure and has a separately charged prefix.
function node(id: number, names: string[] = []): SchemaNode {
  return {
    id,
    resource: id,
    documentPointer: id,
    resourceRootPointer: id,
    value: true,
    keywords: names.map((name) => ({ name, value: true, pointer: id })),
  };
}
function ref(
  from: number,
  target: number,
  keyword: "$ref" | "$dynamicRef" = "$ref",
): SchemaReference {
  return {
    node: from,
    target,
    keyword,
    raw: "https://target.test/#x",
    resolvedUri: "https://target.test/#x",
    kind: "static",
    fragmentKind: "plain-name",
    anchor: "x",
  };
}
describe("independent recursion qualification accounting", () => {
  it("charges reserved, descending and retained child edges independently", () => {
    // Isolated graph-cost fixture: no keyword inspection costs. End-to-end
    // schema admission for each child family is covered separately below.
    const nodes = [node(0), node(1), node(2), node(3)];
    const children = new Map([
      [
        0,
        [
          { node: 0, keyword: "$defs", member: "unused", target: 1, relation: "reserved" },
          { node: 0, keyword: "properties", member: "x", target: 2, relation: "object-value" },
          { node: 0, keyword: "allOf", member: "0", target: 3, relation: "in-place" },
        ],
      ],
    ]);
    // Work: containers3 + root schedule3 + R24 + D22 + seed10 + K21 + final1.
    // Logical: containers192 + three records192 + six retained ID slots96.
    const exact = { work: 84, logicalBytes: 480, states: 3, frames: 2 };
    const b = new EvaluationBudget({ ...EVALUATOR_CEILINGS, ...exact });
    expect(qualifyStaticRecursion(nodes, 0, children, new Map(), b, registerNoPattern)).toBe(false);
    expect(b.counts).toMatchObject(exact);
    for (const key of ["work", "logicalBytes", "states", "frames"] as const)
      expect(() =>
        qualifyStaticRecursion(
          nodes,
          0,
          children,
          new Map(),
          new EvaluationBudget({ ...EVALUATOR_CEILINGS, ...exact, [key]: exact[key] - 1 }),
          registerNoPattern,
        ),
      ).toThrow(`limit-${key}`);
  });
  it("names a missing scheduled node on malformed internal input", () => {
    expect(() =>
      qualifyStaticRecursion(
        [],
        0,
        new Map(),
        new Map(),
        new EvaluationBudget(EVALUATOR_CEILINGS),
        registerNoPattern,
      ),
    ).toThrow("recursion invariant: missing node");
  });
  it("names an unreachable index mismatch on malformed internal input", () => {
    expect(() =>
      qualifyStaticRecursion(
        [node(0), node(7)],
        0,
        new Map(),
        new Map(),
        new EvaluationBudget(EVALUATOR_CEILINGS),
        registerNoPattern,
      ),
    ).toThrow("recursion invariant: missing indexed node");
  });
  it.each([0, 2])("charges each of %s unreachable node scans", (unreachable) => {
    const nodes = Array.from({ length: 1 + unreachable }, (_, i) => node(i));
    const exact = { logicalBytes: 288, states: 1, frames: 1, work: 22 + 4 * unreachable };
    const b = new EvaluationBudget({ ...EVALUATOR_CEILINGS, ...exact });
    expect(qualifyStaticRecursion(nodes, 0, new Map(), new Map(), b, registerNoPattern)).toBe(
      false,
    );
    expect(b.counts).toMatchObject(exact);
    for (const key of ["logicalBytes", "states", "frames", "work"] as const)
      expect(() =>
        qualifyStaticRecursion(
          nodes,
          0,
          new Map(),
          new Map(),
          new EvaluationBudget({ ...EVALUATOR_CEILINGS, ...exact, [key]: exact[key] - 1 }),
          registerNoPattern,
        ),
      ).toThrow(`limit-${key}`);
  });
  it.each([false, true])("balances real reference duplicate/diamond with diamond=%s", (diamond) => {
    // This isolated ID graph uses the real possible duplicate: $ref plus static
    // $dynamicRef. Production schema admission of that pair is tested below.
    const nodes = diamond
      ? [node(0, ["$ref", "$dynamicRef"]), node(1, ["$ref"]), node(2, ["$ref"]), node(3)]
      : [node(0, ["$ref", "$dynamicRef"]), node(1, ["$anchor"])];
    const edges = diamond
      ? new Map([
          [0, [ref(0, 1), ref(0, 2, "$dynamicRef")]],
          [1, [ref(1, 3)]],
          [2, [ref(2, 3)]],
        ])
      : new Map([[0, [ref(0, 1), ref(0, 1, "$dynamicRef")]]]);
    // For retained reference-only DAGs: 5+17V+11E+keywords work;
    // 192+64V+32V logical bytes. No counter-derived expectations.
    const exact = diamond
      ? { work: 121, logicalBytes: 576, states: 4, frames: 2 }
      : { work: 64, logicalBytes: 384, states: 2, frames: 1 };
    const b = new EvaluationBudget({ ...EVALUATOR_CEILINGS, ...exact });
    expect(qualifyStaticRecursion(nodes, 0, new Map(), edges, b, registerNoPattern)).toBe(false);
    expect(b.counts).toMatchObject(exact);
    for (const key of ["work", "logicalBytes", "states", "frames"] as const)
      expect(() =>
        qualifyStaticRecursion(
          nodes,
          0,
          new Map(),
          edges,
          new EvaluationBudget({ ...EVALUATOR_CEILINGS, ...exact, [key]: exact[key] - 1 }),
          registerNoPattern,
        ),
      ).toThrow(`limit-${key}`);
  });
});

describe("guarded static recursion", () => {
  it("pins the independently derived whole-compile work boundary", () => {
    // Nine resources +147 adjacency edges +1136 preflight +435 helper work.
    expect(admit('{"uniqueItems":true}', { ...EVALUATOR_CEILINGS, work: 1727 })).toMatchObject({
      kind: "compiled",
    });
    expect(admit('{"uniqueItems":true}', { ...EVALUATOR_CEILINGS, work: 1726 })).toMatchObject({
      kind: "refused",
      phase: "compile",
      reason: "limit-work",
    });
  });
  it.each([
    [
      '{"type":"object","properties":{"x":{"$ref":"#"}},"additionalProperties":false}',
      '{"x":{"x":1}}',
      '{"x":{"x":"bad"}}',
    ],
    ['{"type":"object","additionalProperties":{"$ref":"#"}}', '{"a":{"b":1}}', '{"a":{"b":"bad"}}'],
    ['{"type":"array","prefixItems":[{"$ref":"#"}],"items":false}', "[[1]]", '[["bad"]]'],
    ['{"type":"array","items":{"$ref":"#"}}', "[[1]]", '[["bad"]]'],
    ['{"type":"array","contains":{"$ref":"#"}}', '[[1],"unmatched"]', '[["bad"]]'],
    [
      '{"type":"object","unevaluatedProperties":{"$ref":"#"}}',
      '{"a":{"b":1}}',
      '{"a":{"b":"bad"}}',
    ],
    ['{"type":"array","unevaluatedItems":{"$ref":"#"}}', "[[1]]", '[["bad"]]'],
  ])("admits only strict descent through %s", (branch, good, bad) => {
    const c = compile(`{"anyOf":[{"type":"integer"},${branch}]}`);
    const first = c.evaluateUtf8(bytes(good));
    expect(first).toMatchObject({ kind: "evaluated", valid: true });
    expect(c.evaluateUtf8(bytes(bad))).toMatchObject({
      kind: "evaluated",
      valid: false,
      annotations: [],
    });
    expect(c.evaluateUtf8(bytes(good))).toEqual(first);
  });
  it.each([
    '{"$ref":"#"}',
    '{"allOf":[{"$ref":"#"}]}',
    '{"not":{"$ref":"#"}}',
    '{"dependentSchemas":{"x":{"$ref":"#"}}}',
    '{"propertyNames":{"$ref":"#"}}',
    '{"properties":{"x":{"$ref":"#/properties/x"}}}',
    '{"if":true,"then":{"$ref":"#"}}',
    '{"if":false,"else":{"$ref":"#"}}',
    '{"then":{"$ref":"#"}}',
    '{"contentSchema":{"$ref":"#/contentSchema"},"$ref":"#/contentSchema"}',
  ])("retains non-descending cycle refusal %s", (schema) => {
    expect(admit(schema)).toMatchObject({
      kind: "refused",
      phase: "compile",
      reason: "nonqualified-cycle",
    });
  });
  it.each([false, true])("checks reachable dynamic before cycles with reverse=%s", (reverse) => {
    const children = [{ $ref: "#" }, { $dynamicRef: "#d" }];
    if (reverse) children.reverse();
    expect(
      admit(JSON.stringify({ $defs: { dynamic: { $dynamicAnchor: "d" } }, allOf: children })),
    ).toMatchObject({ kind: "refused", phase: "compile", reason: "unsupported-dynamic" });
  });
  it("executes builtin patterns and retains a co-reachable true-dynamic refusal", () => {
    const target = "https://json-schema.org/draft/2020-12/meta/core#/$defs/anchorString";
    expect(
      admit(
        JSON.stringify({
          $ref: target,
          allOf: [{ $ref: target }, { $dynamicAnchor: "x", $dynamicRef: "#x" }],
        }),
      ),
    ).toMatchObject({ kind: "refused", phase: "compile", reason: "unsupported-dynamic" });
    expect(admit(JSON.stringify({ $ref: target }))).toMatchObject({ kind: "compiled" });
    for (const [value, valid] of [
      ["a", true],
      ["foo_1", true],
      ["1foo", false],
      ["-a", false],
    ] as const)
      expect(evaluate(JSON.stringify({ $ref: target }), JSON.stringify(value)).valid).toBe(valid);
  });
  it("admits the former recursive pattern fixture with invalid leaves", () => {
    const schema = '{"properties":{"x":{"$ref":"#"}},"pattern":"x"}';
    expect(evaluate(schema, '{"x":"x"}').valid).toBe(true);
    expect(evaluate(schema, '{"x":"y"}').valid).toBe(false);
  });
  it("keeps property-name IDs separate while locations name containing objects", () => {
    const r = evaluate(
      '{"type":"object","properties":{"x":{"$ref":"#"}},"additionalProperties":false,"propertyNames":{"title":"name","minLength":1}}',
      '{"x":{"x":{}}}',
    );
    expect(r.valid).toBe(true);
    expect(
      r.annotations
        .filter((a) => a.keyword === "title")
        .map((a) => a.instanceLocation)
        .sort(),
    ).toEqual(["", "/x"]);
    const names = evaluate(
      '{"$defs":{"name":{"title":"name"}},"propertyNames":{"$ref":"#/$defs/name"}}',
      '{"a":1,"b":2}',
    );
    expect(
      names.annotations
        .filter((a) => a.keyword === "title")
        .map((a) => a.validationPath)
        .sort(),
    ).toEqual(["/propertyNames/$ref/title", "/propertyNames/$ref/title"]);
  });
  it("ignores reserved cycles but follows explicit static refs", () => {
    expect(
      evaluate(
        '{"$defs":{"x":{"$ref":"#/$defs/x"}},"contentSchema":{"$ref":"#/contentSchema"}}',
        "null",
      ).valid,
    ).toBe(true);
    expect(
      evaluate(
        '{"$defs":{"x":{"$anchor":"x","type":"integer"}},"$ref":"#x","$dynamicRef":"#x"}',
        "1",
      ).valid,
    ).toBe(true);
    expect(
      evaluate(
        '{"$defs":{"x":{"$anchor":"x","type":"integer"}},"$ref":"#x","$dynamicRef":"#x"}',
        '"bad"',
      ).valid,
    ).toBe(false);
  });
  it.each([
    ['{"properties":{"x":{"$ref":"#"}},"pattern":"(?=x)"}', "unsupported-pattern"],
    [
      '{"properties":{"x":{"$ref":"#"}},"$defs":{"unused":{"patternProperties":{"x":true}}}}',
      "unsupported-patternProperties",
    ],
    ['{"properties":{"x":{"$ref":"https://missing.test/"}}}', "graph:missing-resource"],
    ['{"items":12}', "graph:schema-shape"],
    [
      '{"properties":{"x":{"$ref":"#"}},"$dynamicAnchor":"d","$dynamicRef":"#d"}',
      "unsupported-dynamic",
    ],
  ])("keeps unsupported neighbor %s", (schema, reason) =>
    expect(admit(schema)).toMatchObject({ kind: "refused", phase: "compile", reason }),
  );
  it("preserves coverage and count independence inside recursion", () => {
    const object =
      '{"type":"object","properties":{"x":{"$ref":"#"}},"unevaluatedProperties":false}';
    expect(evaluate(object, '{"x":{}}').valid).toBe(true);
    expect(evaluate(object, '{"x":{},"extra":1}').valid).toBe(false);
    expect(evaluate(object, '{"x":{"extra":1}}').valid).toBe(false);
    const array = '{"type":"array","items":{"$ref":"#"},"unevaluatedItems":false}';
    expect(evaluate(array, "[[[]]]").valid).toBe(true);
    expect(evaluate(array, "[[1]]").valid).toBe(false);
    const contains =
      '{"anyOf":[{"type":"integer"},{"type":"array","contains":{"$ref":"#"},"minContains":1,"maxContains":1,"unevaluatedItems":false}]}';
    expect(evaluate(contains, "[[1]]").valid).toBe(true);
    expect(evaluate(contains, "[[1,2]]").valid).toBe(false);
  });
  it("projects separate shared recursive paths and hides failed branch annotations", () => {
    const r = evaluate(
      '{"$defs":{"r":{"type":"object","title":"node","properties":{"x":{"$ref":"#/$defs/r"}}}},"anyOf":[{"allOf":[{"$ref":"#/$defs/r"},{"$ref":"#/$defs/r"}]},{"type":"null","$ref":"#/$defs/r"}]}',
      '{"x":{}}',
    );
    expect(r.valid).toBe(true);
    const titles = r.annotations.filter((a) => a.keyword === "title");
    expect(titles).toHaveLength(4);
    expect(new Set(titles.map((a) => a.validationPath)).size).toBe(4);
    expect(titles.every((a) => a.validationPath.startsWith("/anyOf/0/"))).toBe(true);
    expect(Object.isFrozen(r.annotations)).toBe(true);
  });
  it("bounds deep finite recursion without host recursion", () => {
    const c = compile(recursiveArray, { ...EVALUATOR_CEILINGS, frames: 40 });
    expect(c.evaluateUtf8(bytes(`${"[".repeat(30)}1${"]".repeat(30)}`))).toMatchObject({
      kind: "refused",
      phase: "instance",
      reason: "limit-frames",
    });
    expect(c.evaluateUtf8(bytes("[[1]]"))).toMatchObject({ kind: "evaluated", valid: true });
    expect(c.evaluateUtf8(bytes('[["bad"]]'))).toMatchObject({ kind: "evaluated", valid: false });
  });
  it("bounds shared recursive projection by the independent occurrence count", () => {
    // Each level has one root, two ref wrappers, and two recursive child occurrences:
    // T(empty object)=1+2+2=5; T({x:child})=5+2*(1+T(child))=7+2*T(child).
    const schema =
      '{"$defs":{"r":{"allOf":[{"$ref":"#/$defs/s"},{"$ref":"#/$defs/s"}]},"s":{"properties":{"x":{"$ref":"#/$defs/r"}}}},"$ref":"#/$defs/r"}';
    // Root wrapper adds one: 1 + T({x:{x:{}}}) = 1+41=42.
    const c = compile(schema, { ...EVALUATOR_CEILINGS, occurrences: 42 });
    expect(c.evaluateUtf8(bytes('{"x":{"x":{}}}'))).toMatchObject({
      kind: "evaluated",
      valid: true,
      counters: { occurrences: 42 },
    });
    const limited = compile(schema, { ...EVALUATOR_CEILINGS, occurrences: 41 });
    expect(limited.evaluateUtf8(bytes('{"x":{"x":{}}}'))).toMatchObject({
      kind: "refused",
      phase: "instance",
      reason: "limit-occurrences",
    });
    expect(limited.evaluateUtf8(bytes('{"x":{}}'))).toMatchObject({
      kind: "evaluated",
      valid: true,
    });
  });
  it("identifies actual compiled/evaluated/refused stage3 outcomes", () => {
    const c = compile("true");
    expect(c.stage).toBe("private-static-schema-evaluation-3");
    expect(c.evaluateUtf8(bytes("null")).stage).toBe(c.stage);
    expect(admit('{"$ref":"#"}').stage).toBe(c.stage);
    expect(c.evaluateUtf8(bytes("{"))).toMatchObject({
      stage: c.stage,
      kind: "refused",
      phase: "instance",
    });
  });
  it.each(["states", "work", "logicalBytes", "annotations", "annotationBytes"] as const)(
    "preserves runtime %s refusal boundaries on recursion",
    (key) => {
      const input = `${"[".repeat(32)}1${"]".repeat(32)}`;
      const result = evaluate(recursiveArray, input);
      expect(result.valid).toBe(true);
      // These are unchanged runtime counters: check their exact/one-below
      // admission behavior, independently from the literal compiler ledger above.
      const exact = compile(recursiveArray, {
        ...EVALUATOR_CEILINGS,
        [key]: result.counters[key],
      });
      expect(exact.evaluateUtf8(bytes(input))).toEqual(result);
      const limited = compile(recursiveArray, {
        ...EVALUATOR_CEILINGS,
        [key]: result.counters[key] - 1,
      });
      expect(limited.evaluateUtf8(bytes(input))).toMatchObject({
        kind: "refused",
        phase: "instance",
        reason: `limit-${key}`,
      });
      expect(limited.evaluateUtf8(bytes("1"))).toMatchObject({ kind: "evaluated", valid: true });
    },
  );
});
