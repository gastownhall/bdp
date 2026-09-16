import { compilePattern, matchPattern } from "./installed-schema-pattern.js";
import { EvaluationBudget } from "./installed-schema-value.js";
import { describe, expect, it } from "vitest";
import {
  compilePrivateSchemaEvaluator,
  EVALUATOR_CEILINGS,
  type EvaluatorLimits,
} from "./installed-schema-evaluator.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { SCHEMA_GRAPH_CEILINGS } from "./installed-schema-shape.js";
const bytes = (s: string) => new TextEncoder().encode(s);
const uri = "https://pattern.test/schema";
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
describe("bounded Unicode pattern assertion", () => {
  it.each([
    ["x", "before x after", true],
    ["^x$", "x\n", false],
    ["^x$", 1, true],
    ["[\\n-\\r]", "\n", true],
    ["[\\n-\\r]", "\t", false],
    ["[\\b-\\n]", "\b", true],
    ["[\\--/]", ".", true],
    ["\\uDC32", "🐲", false],
    ["[\\uD800-\\uDFFF]", "🐲", false],
    ["\\uD83D\\uDC32", "🐲", true],
    ["^..$", "🐲", false],
    ["^\\s$", "\ufeff", true],
    ["^\\s$", "\u0085", false],
    ["(a+)+$", `${"a".repeat(128)}b`, false],
    ["(a+)+$", "a".repeat(128), true],
    ["(a*)*", "", true],
    ["(a|aa)*b", "a".repeat(128), false],
    ["^a{2,3}$", "aa", true],
    ["^a{2,3}$", "a", false],
  ])("%s on %j is %s", (pattern, input, valid) => {
    const r = evaluate({ pattern }, input);
    expect(r.valid).toBe(valid);
    expect(r.annotations).toEqual([]);
  });
  it("executes reached builtin anchor pattern", () => {
    const schema = { $ref: "https://json-schema.org/draft/2020-12/meta/core#/$defs/anchorString" };
    expect(evaluate(schema, "foo_1").valid).toBe(true);
    expect(evaluate(schema, "1foo").valid).toBe(false);
  });
  it("admits unused supplied supported patterns without executing them", () => {
    expect(evaluate({ $defs: { unused: { pattern: "^x$" } } }, "y").valid).toBe(true);
  });
  it("retains unsupported declarations and the protected patternProperties boundary", () => {
    for (const schema of [{ pattern: "\\p{Letter}" }, { $defs: { unused: { pattern: "(?=x)" } } }])
      expect(compile(schema)).toMatchObject({
        kind: "refused",
        phase: "compile",
        reason: "unsupported-pattern",
      });
    expect(compile({ patternProperties: {} })).toMatchObject({
      kind: "refused",
      reason: "unsupported-patternProperties",
    });
  });
});

// Independently derived primitive traces, frozen in the external operation ledger
// before these assertions and before executing the new helper. Never sampled.
describe("independent regex operation ledgers", () => {
  it.each([
    ["", 99, 720, 1],
    ["a", 143, 832, 1],
    ["[a]", 155, 832, 1],
    ["a|b", 343, 1424, 2],
    ["a{2}", 285, 1152, 2],
    ["a{0}", 191, 912, 1],
    ["a*", 221, 1072, 2],
    ["(a*)*", 345, 1392, 3],
  ] as const)("compile ledger %s", (pattern, work, logicalBytes, frames) => {
    const exact = { work, logicalBytes, frames };
    const b = new EvaluationBudget({ ...EVALUATOR_CEILINGS, ...exact });
    compilePattern(pattern, b);
    expect(b.counts).toMatchObject({ ...exact, states: 0 });
    for (const key of ["work", "logicalBytes", "frames"] as const)
      expect(() =>
        compilePattern(
          pattern,
          new EvaluationBudget({ ...EVALUATOR_CEILINGS, ...exact, [key]: exact[key] - 1 }),
        ),
      ).toThrow(`limit-${key}`);
  });
  it.each([
    ["", "", true, 48, 384, 1],
    ["a", "", false, 39, 384, 1],
    ["a", "a", true, 91, 384, 2],
    ["a", "b", false, 84, 384, 1],
    ["a", "ba", true, 136, 384, 2],
    ["[a]", "a", true, 91, 384, 2],
    ["a|b", "a", true, 151, 512, 2],
    ["a|b", "c", false, 172, 512, 2],
    ["a{2}", "aa", true, 198, 448, 3],
    ["a{2}", "a", false, 108, 448, 2],
    ["a*", "", true, 62, 448, 2],
    ["(a*)*", "", true, 68, 512, 2],
    ["(a+)+$", `${"a".repeat(128)}b`, false, 29742, 832, 5],
    ["(a+)+$", "a".repeat(128), true, 29601, 832, 5],
  ] as const)("match ledger %s / %j", (pattern, input, valid, work, logicalBytes, frames) => {
    const program = compilePattern(pattern, new EvaluationBudget(EVALUATOR_CEILINGS));
    const exact = { work, logicalBytes, frames };
    const b = new EvaluationBudget({ ...EVALUATOR_CEILINGS, ...exact });
    expect(matchPattern(program, input, b)).toBe(valid);
    expect(b.counts).toMatchObject({ ...exact, states: 0 });
    for (const key of ["work", "logicalBytes", "frames"] as const)
      expect(() =>
        matchPattern(
          program,
          input,
          new EvaluationBudget({ ...EVALUATOR_CEILINGS, ...exact, [key]: exact[key] - 1 }),
        ),
      ).toThrow(`limit-${key}`);
  });
  it("charges transient range endpoints and additional retained class terms", () => {
    const cost = (pattern: string) => {
      const b = new EvaluationBudget(EVALUATOR_CEILINGS);
      compilePattern(pattern, b);
      return b.counts.logicalBytes;
    };
    expect(cost("[a-b]") - cost("[a]")).toBe(64);
    expect(cost("[abc]") - cost("[a]")).toBe(96);
  });
  it("charges all200 invocation-owned scratch allocations", () => {
    const program = compilePattern("a", new EvaluationBudget(EVALUATOR_CEILINGS));
    const exact = { work: 16800, logicalBytes: 76800, frames: 1 };
    const run = (b: EvaluationBudget) => {
      for (let i = 0; i < 200; i++) expect(matchPattern(program, "b", b)).toBe(false);
    };
    const b = new EvaluationBudget({ ...EVALUATOR_CEILINGS, ...exact });
    run(b);
    expect(b.counts).toMatchObject({ ...exact, states: 0 });
    for (const key of ["work", "logicalBytes"] as const)
      expect(() =>
        run(new EvaluationBudget({ ...EVALUATOR_CEILINGS, ...exact, [key]: exact[key] - 1 })),
      ).toThrow(`limit-${key}`);
  });
});
describe("complete bounded profile controls", () => {
  it.each([
    ["", "", true],
    ["a|", "", true],
    ["(?:)", "", true],
    ["()", "", true],
    ["[]", "a", false],
    ["[^]", "🐲", true],
    ["[^]", "", false],
    ["[-a]", "-", true],
    ["[a-]", "-", true],
    ["[a-b-c]", "-", true],
    ["[-]", "-", true],
    ["[--a]", "/", true],
    ["[a-z]", "A", false],
    ["[^a]", "a", false],
    ["[a\\D]", "5", false],
    ["[^\\D]", "5", true],
    ["\\d", "١", false],
    ["\\w", "é", false],
    ["\\W", "é", true],
    ["^.$", "🐲", true],
    [".", "\n", false],
    ["^.$", "\n", false],
    ["^.$", "\t", true],
    [".", "\r", false],
    [".", "\u2028", false],
    [".", "\u2029", false],
    ["^\\s$", "\u180e", false],
    ["^\\S$", "\u200b", true],
    ["^\\s$", "\u3000", true],
    ["\\0", "\0", true],
    ["\\x41", "A", true],
    ["\\cA", "\x01", true],
    ["\\cz", "\x1a", true],
    ["\\u{1F432}", "🐲", true],
    ["\\u{D800}", "🐲", false],
    ["\\u{D83D}\\u{DC32}", "🐲", false],
    ["[\\uD83D\\uDC32-\\u{1F433}]", "🐲", true],
    ["\\uD83D\\uD83D\\uDC32", "🐲", false],
    ["\\uD83D\\uDC32\\uDC32", "🐲", false],
    ["^a{0001,0002}$", "aa", true],
    ["^a{0}$", "", true],
    ["^a{0}$", "a", false],
    ["^a??$", "a", true],
    ["^a+?$", "aaa", true],
    ["^a{1,}?$", "aaa", true],
    ["^(?:a|)$", "", true],
    ["^(?:a|)$", "b", false],
    ["^(?:a?){2}$", "a", true],
    ["(?:^)*a", "a", true],
    ["(?:$)+", "abc", true],
    ["^$", "\n", false],
    ["\\^\\$\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\/\\\\", "^$.*+?()[]{}|/\\", true],
  ] as const)("profile %s / %j", (pattern, input, valid) => {
    expect(evaluate({ pattern }, input).valid).toBe(valid);
  });
  it.each([
    "[\\d-a]",
    "[a-\\d]",
    "[\\r-\\n]",
    "[a--]",
    "[\\B]",
    "\\-",
    "\\a",
    "\\1",
    "\\b",
    "\\B",
    "\\p{Letter}",
    "\\P{Letter}",
    "(?=a)",
    "(?!a)",
    "(?<=a)",
    "(?<!a)",
    "(?<x>a)",
    "(?i:a)",
    "\\k<x>",
    "\\01",
    "\\c1",
    "\\x0z",
    "\\u12",
    "\\u{}",
    "\\u{110000}",
    "\\",
    "[",
    "(",
    ")",
    "]",
    "}",
    "a{",
    "a{}",
    "a{,1}",
    "a{5,3}",
    "a{10000000000,9999999999}",
    "a**",
    "^*",
    "$?",
  ])("refuses malformed or unimplemented syntax %s", (pattern) => {
    expect(compile({ pattern })).toMatchObject({
      kind: "refused",
      phase: "compile",
      reason: "unsupported-pattern",
    });
  });
  it("pins source and expanded-state ceilings without measuring a threshold", () => {
    expect(compile({ pattern: "a".repeat(4097) })).toMatchObject({ reason: "limit-patternUnits" });
    expect(compile({ pattern: "(?:)".repeat(1024) }).kind).toBe("compiled"); // Exactly4096 units.
    for (const pattern of ["a{4096}", "a{4294967296}", "(a{4096}){4096}", "a".repeat(4096)])
      expect(compile({ pattern })).toMatchObject({ reason: "limit-patternStates" });
    const p = compilePattern("a{4095}", new EvaluationBudget(EVALUATOR_CEILINGS));
    expect(p.instructions).toHaveLength(4096); //4095 consuming instructions plus accept.
  });
  it("bounds explicit grouping depth before push and uses no native call recursion", () => {
    const pattern = `${"(".repeat(100)}a${")".repeat(100)}`;
    expect(evaluate({ pattern }, "a").valid).toBe(true);
    expect(() =>
      compilePattern(pattern, new EvaluationBudget({ ...EVALUATOR_CEILINGS, frames: 100 })),
    ).toThrow("limit-frames");
    expect(
      compilePattern(pattern, new EvaluationBudget({ ...EVALUATOR_CEILINGS, frames: 101 }))
        .instructions,
    ).toHaveLength(2);
  });
  it("makes the fixed-work envelope and repeated-match cost observable", () => {
    const p = compilePattern("a", new EvaluationBudget(EVALUATOR_CEILINGS));
    const b = new EvaluationBudget({ ...EVALUATOR_CEILINGS, work: 90039 });
    expect(matchPattern(p, "b".repeat(2000), b)).toBe(false);
    expect(b.counts.work).toBe(90039); //39 +45*2000, independently derived.
    expect(() =>
      matchPattern(
        p,
        "b".repeat(2000),
        new EvaluationBudget({ ...EVALUATOR_CEILINGS, work: 90038 }),
      ),
    ).toThrow("limit-work");
    expect(evaluate({ pattern: "a" }, "b".repeat(2000)).valid).toBe(false);
    expect(
      evaluate(
        { items: { pattern: "^a$" } },
        Array.from({ length: 300 }, () => "a"),
      ).valid,
    ).toBe(true);
    // No promise that hundreds of large programs fit: scratch alone exceeds16MiB.
    const large = compilePattern("a{4095}", new EvaluationBudget(EVALUATOR_CEILINGS));
    const exhausted = new EvaluationBudget(EVALUATOR_CEILINGS);
    expect(() => {
      for (let i = 0; i < 65; i++) matchPattern(large, "", exhausted);
    }).toThrow("limit-logicalBytes");
  });
  it("freezes all retained program data and does not leak scratch across calls", () => {
    const p = compilePattern("[a-c]", new EvaluationBudget(EVALUATOR_CEILINGS));
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.instructions)).toBe(true);
    for (const instruction of p.instructions) {
      expect(Object.isFrozen(instruction)).toBe(true);
      if (instruction.terms) {
        expect(Object.isFrozen(instruction.terms)).toBe(true);
        for (const t of instruction.terms) expect(Object.isFrozen(t)).toBe(true);
      }
    }
    expect(() => {
      (p.instructions[0] as { x: number }).x = 100;
    }).toThrow();
    for (const [input, expected] of [
      ["x", false],
      ["b", true],
      ["x", false],
      ["a", true],
    ] as const)
      expect(matchPattern(p, input, new EvaluationBudget(EVALUATOR_CEILINGS))).toBe(expected);
  });
  it("keeps declaration preflight distinct from reached builtin and dynamic behavior", () => {
    for (const schema of [
      {
        $defs: { unused: { pattern: "\\p{Letter}" } },
        $dynamicAnchor: "slot",
        $dynamicRef: "#slot",
      },
      { contentSchema: { pattern: "\\p{Letter}" } },
    ])
      expect(compile(schema)).toMatchObject({ reason: "unsupported-pattern" });
    expect(compile({ $defs: { unused: { pattern: "a{4096}" } } })).toMatchObject({
      reason: "limit-patternStates",
    });
    expect(compile({ $ref: "https://json-schema.org/draft/2020-12/meta/core" })).toMatchObject({
      reason: "unsupported-dynamic",
    });
    // Every supplied program is retained/charged, even where root evaluation cannot reach it.
    const schema = {
      $defs: Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [String(i), { pattern: "a{4095}" }]),
      ),
    };
    expect(compile(schema, { ...EVALUATOR_CEILINGS, logicalBytes: 1048576 })).toMatchObject({
      reason: "limit-logicalBytes",
    });
    expect(
      compile(
        { $defs: { unused: { pattern: "a" } } },
        { ...EVALUATOR_CEILINGS, logicalBytes: 1048576 },
      ).kind,
    ).toBe("compiled");
  });
  it("preserves diagnostic occurrences and failed-branch annotation suppression", () => {
    const direct = evaluate({ properties: { "a/~": { pattern: "^x$" } } }, { "a/~": "y" });
    expect(direct.diagnostics).toEqual([
      {
        schemaLocation: `${uri}#/properties/a~1~0/pattern`,
        instanceLocation: "/a~1~0",
        message: "Schema assertion failed: pattern",
      },
    ]);
    const shared = evaluate(
      { $defs: { p: { pattern: "^x$" } }, allOf: [{ $ref: "#/$defs/p" }, { $ref: "#/$defs/p" }] },
      "y",
    );
    expect(shared.diagnostics).toHaveLength(2);
    expect(
      shared.diagnostics.every(
        (d) => d.schemaLocation === `${uri}#/%24defs/p/pattern` && d.instanceLocation === "",
      ),
    ).toBe(true);
    const branch = evaluate(
      {
        anyOf: [
          { pattern: "^x$", title: "failed" },
          { pattern: "^y$", title: "winner" },
        ],
      },
      "y",
    );
    expect(branch.diagnostics).toEqual([]);
    expect(branch.annotations.map((a) => a.value)).toEqual(["winner"]);
  });
  it("retains JSON-domain distinctions for keys, escaped pairs and FEFF", () => {
    const c = compile({ propertyNames: { pattern: "." } });
    if (c.kind !== "compiled") throw new Error(c.reason);
    expect(c.evaluateUtf8(bytes('{"\\ud800":1}'))).toMatchObject({
      kind: "refused",
      reason: "input-domain",
    });
    expect(c.evaluateUtf8(bytes('{"🐲":1}'))).toMatchObject({ kind: "evaluated", valid: true });
    const astral = compile({ pattern: "^.$" });
    if (astral.kind !== "compiled") throw new Error(astral.reason);
    for (const input of ['"\\ud83d\\udc32"', '"🐲"'])
      expect(astral.evaluateUtf8(bytes(input))).toMatchObject({ kind: "evaluated", valid: true });
    expect(astral.evaluateUtf8(bytes('\ufeff"a"'))).toMatchObject({ reason: "input-domain" });
  });
  it("keeps pattern as a known assertion with explicit private policy metadata", () => {
    for (const input of ["x", 1, {}, []]) {
      const r = evaluate({ pattern: "x" }, input);
      expect(r.annotations).toEqual([]);
      expect(r.counters.annotationBytes).toBe(2);
      expect(r.stage).toBe("private-static-schema-evaluation-3");
      expect(r.patternPolicy).toBe("bounded-ecma2020-regular-subset-1");
      expect(Object.hasOwn(EVALUATOR_CEILINGS, "patternUnits")).toBe(false);
      expect(Object.hasOwn(EVALUATOR_CEILINGS, "patternStates")).toBe(false);
      expect(r.annotationPolicy.revision).toBe("bounded-annotation-output-2");
      expect(r.deferred).toContain("regex");
    }
  });
  it("retains graph shape and exact builtin resource-collision refusal", () => {
    expect(compile({ pattern: 1 })).toMatchObject({
      phase: "compile",
      reason: "graph:keyword-shape",
    });
    const builtin = "https://json-schema.org/draft/2020-12/meta/core";
    for (const schema of [{ pattern: "x" }, { $id: builtin, pattern: "x" }])
      expect(
        compilePrivateSchemaEvaluator({
          bundle: {
            descriptors: [],
            schemas: [{ retrievalUri: builtin, utf8Bytes: bytes(JSON.stringify(schema)) }],
            limits: CONTRACT_ARTIFACT_CEILINGS,
          },
          graphLimits: SCHEMA_GRAPH_CEILINGS,
          entry: { kind: "schema", retrievalUri: builtin },
          limits: EVALUATOR_CEILINGS,
        }),
      ).toMatchObject({ phase: "compile", reason: "graph:resource-collision" });
  });
});

describe("independent character tables and scratch envelope", () => {
  // ECMA-2020 WhiteSpace/LineTerminator plus the pinned Unicode13 Zs rows;
  // this list is independent of the implementation's private SPACE constant.
  it.each([
    0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003,
    0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
    0xfeff,
  ])("matches whitespace code point %i and rejects its complement", (cp) => {
    const input = String.fromCodePoint(cp);
    expect(evaluate({ pattern: "^\\s$" }, input).valid).toBe(true);
    expect(evaluate({ pattern: "^\\S$" }, input).valid).toBe(false);
  });
  it.each([0x0085, 0x180e, 0x1fff, 0x200b, 0x2027, 0x202e, 0x2030, 0x205e, 0x2060, 0x3001])(
    "rejects whitespace near-miss %i and accepts its complement",
    (cp) => {
      const input = String.fromCodePoint(cp);
      expect(evaluate({ pattern: "^\\s$" }, input).valid).toBe(false);
      expect(evaluate({ pattern: "^\\S$" }, input).valid).toBe(true);
    },
  );
  it("pins ASCII word characters and adjacent nonword boundaries", () => {
    for (const input of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_") {
      expect(evaluate({ pattern: "^\\w$" }, input).valid).toBe(true);
      expect(evaluate({ pattern: "^\\W$" }, input).valid).toBe(false);
    }
    for (const input of ["/", ":", "@", "[", "`", "{", "é", "١", "🐲"]) {
      expect(evaluate({ pattern: "^\\w$" }, input).valid).toBe(false);
      expect(evaluate({ pattern: "^\\W$" }, input).valid).toBe(true);
    }
  });
  it("admits32 address matches with independently bounded work and exact scratch", () => {
    const pattern = String.raw`^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,63}$`;
    const program = compilePattern(pattern, new EvaluationBudget(EVALUATOR_CEILINGS));
    // Projection:2 anchors +127+509+124 quantified states +2 literals +1 accept.
    expect(program.instructions).toHaveLength(765);
    // Scratch32*(256+64*765). Work upper bound32*(4597+7*40955),
    // derived from384 consumers,378 splits,2 anchors,1 accept and6 BMP input points.
    const limits = { ...EVALUATOR_CEILINGS, logicalBytes: 1574912, work: 9321024 };
    const run = (budget: EvaluationBudget) => {
      for (let i = 0; i < 32; i++) expect(matchPattern(program, "a@b.co", budget)).toBe(true);
    };
    const budget = new EvaluationBudget(limits);
    run(budget);
    expect(budget.counts.logicalBytes).toBe(1574912);
    expect(() => run(new EvaluationBudget({ ...limits, logicalBytes: 1574911 }))).toThrow(
      "limit-logicalBytes",
    );
  });
});
