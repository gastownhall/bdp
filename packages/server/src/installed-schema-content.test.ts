import { describe, expect, it } from "vitest";
import { JsonNumberLiteral } from "@bdp/protocol";
import {
  compilePrivateSchemaEvaluator,
  EVALUATOR_CEILINGS,
  type EvaluatorLimits,
} from "./installed-schema-evaluator.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { SCHEMA_GRAPH_CEILINGS } from "./installed-schema-shape.js";
import { chargeAnnotationBytes, EvaluationBudget } from "./installed-schema-value.js";

const uri = "https://test.example/schema";
const bytes = (s: string) => new TextEncoder().encode(s);
function admit(source: Uint8Array, limits: EvaluatorLimits = EVALUATOR_CEILINGS) {
  return compilePrivateSchemaEvaluator({
    bundle: {
      descriptors: [],
      schemas: [{ retrievalUri: uri, utf8Bytes: source }],
      limits: CONTRACT_ARTIFACT_CEILINGS,
    },
    graphLimits: SCHEMA_GRAPH_CEILINGS,
    entry: { kind: "schema", retrievalUri: uri },
    limits,
  });
}
function compile(schema: string, limits: EvaluatorLimits = EVALUATOR_CEILINGS) {
  const c = admit(bytes(schema), limits);
  if (c.kind !== "compiled") throw new Error(`compile: ${c.reason}`);
  return c;
}
function evaluate(schema: string, input = '"outer"', limits: EvaluatorLimits = EVALUATOR_CEILINGS) {
  const r = compile(schema, limits).evaluateUtf8(bytes(input));
  if (r.kind !== "evaluated") throw new Error(`instance: ${r.reason}`);
  expect(r.counters.annotationBytes).toBe(Buffer.byteLength(JSON.stringify(r.annotations)));
  return r;
}
const contentObject = {
  type: "object",
  required: ["foo"],
  properties: { foo: { type: "string" } },
};
const triple = JSON.stringify({
  contentMediaType: "application/json",
  contentEncoding: "base64",
  contentSchema: contentObject,
});

describe("private Content annotations without media processing", () => {
  it.each([
    "application/json",
    "text/plain",
    "application/octet-stream",
    "image/png",
    "Text/Plain; charset=UTF-8",
  ])("retains the declaration bytes for %s without an allowlist", (media) => {
    const r = evaluate(JSON.stringify({ contentMediaType: media }));
    expect(r.valid).toBe(true);
    expect(r.annotations).toEqual([
      {
        keyword: "contentMediaType",
        value: media,
        schemaLocation: `${uri}#/contentMediaType`,
        instanceLocation: "",
        validationPath: "/contentMediaType",
      },
    ]);
  });
  it.each(["null", "true", "false", "0", "[]", "{}"])(
    "ignores all three content annotations on nonstring %s",
    (input) => {
      const r = evaluate(triple, input);
      expect(r).toMatchObject({
        valid: true,
        annotations: [],
        diagnostics: [],
        counters: { states: 1 },
      });
    },
  );
  it("mirrors the official group3 annotation values and order independently of its true flags", () => {
    const r = evaluate(triple, '"not base64 or JSON"');
    expect(r).toMatchObject({
      valid: true,
      diagnostics: [],
      counters: { states: 1, valueNodes: 1 },
    });
    expect(r.annotations.map((a) => [a.keyword, a.value])).toEqual([
      ["contentMediaType", "application/json"],
      ["contentEncoding", "base64"],
      ["contentSchema", contentObject],
    ]);
  });
  it.each(["true", "false", String.raw`{"const":1e999,"default":["a\n\"☃",null]}`])(
    "retains exact schema value %s rather than validating the outer string",
    (schema) => {
      const r = evaluate(`{"contentSchema":${schema},"contentMediaType":"application/json"}`);
      expect(r.valid).toBe(true);
      const value =
        schema === "true"
          ? true
          : schema === "false"
            ? false
            : {
                const: new JsonNumberLiteral("1e999"),
                default: ['a\n"☃', null],
              };
      expect(r.annotations.map((a) => [a.keyword, a.value])).toEqual([
        ["contentSchema", value],
        ["contentMediaType", "application/json"],
      ]);
    },
  );
  it("interprets absent encoding as identity without inventing an absent keyword annotation", () => {
    // Validation553–556 specifies identity encoding; Core544–545 supplies keyword values.
    const r = evaluate('{"contentMediaType":"application/json","contentSchema":false}');
    expect(r.annotations.map((a) => a.keyword)).toEqual(["contentMediaType", "contentSchema"]);
  });
  it.each(["true", "false", '{"type":"integer"}'])("ignores bare contentSchema %s", (schema) => {
    expect(evaluate(`{"contentSchema":${schema}}`)).toMatchObject({ valid: true, annotations: [] });
  });
  it("does not borrow adjacency from an allOf sibling or ordinary reference", () => {
    for (const schema of [
      '{"allOf":[{"contentMediaType":"text/plain"},{"contentSchema":false}]}',
      '{"$defs":{"media":{"contentMediaType":"text/plain"}},"$ref":"#/$defs/media","contentSchema":false}',
    ]) {
      const r = evaluate(schema);
      expect(r.valid).toBe(true);
      expect(r.annotations.map((a) => [a.keyword, a.value])).toEqual([
        ["contentMediaType", "text/plain"],
      ]);
    }
  });
  it.each(['"{"', '"%%%"', '"eyJmb28iOjF9"'])(
    "does not decode or validate embedded %s",
    (input) => {
      const r = evaluate(
        '{"contentEncoding":"base64","contentMediaType":"application/json","contentSchema":false}',
        input,
      );
      expect(r).toMatchObject({
        valid: true,
        diagnostics: [],
        counters: { states: 1, valueNodes: 1 },
      });
      expect(r.annotations.map((a) => a.keyword)).toEqual([
        "contentEncoding",
        "contentMediaType",
        "contentSchema",
      ]);
    },
  );
  it("executes an ordinary reference into contentSchema as an ordinary schema", () => {
    const c = compile(
      '{"contentMediaType":"application/json","contentSchema":{"type":"integer","title":"executed"},"$ref":"#/contentSchema"}',
    );
    const r = c.evaluateUtf8(bytes("3"));
    expect(r).toMatchObject({
      kind: "evaluated",
      valid: true,
      annotations: [{ keyword: "title", value: "executed" }],
      counters: { states: 2, valueNodes: 1 },
    });
    expect(c.evaluateUtf8(bytes('"3"'))).toMatchObject({
      kind: "evaluated",
      valid: false,
      annotations: [],
      diagnostics: [
        {
          schemaLocation: `${uri}#/contentSchema/type`,
          instanceLocation: "",
          message: "Schema assertion failed: type",
        },
      ],
    });
  });
  it.each([
    ['{"contentMediaType":"text/plain","contentSchema":123}', "graph:schema-shape"],
    [
      '{"contentMediaType":"text/plain","contentSchema":{"$ref":"https://missing.test/"}}',
      "graph:missing-resource",
    ],
    ['{"contentMediaType":"text/plain","contentSchema":{"pattern":"x"}}', "unsupported-pattern"],
    [
      '{"contentMediaType":"text/plain","$defs":{"unused":{"patternProperties":{"x":true}}}}',
      "unsupported-patternProperties",
    ],
    [
      '{"contentMediaType":"text/plain","contentSchema":{"$ref":"#/contentSchema"},"$ref":"#/contentSchema"}',
      "nonqualified-cycle",
    ],
    [
      '{"contentMediaType":"text/plain","contentSchema":{"$dynamicAnchor":"slot","$dynamicRef":"#slot"},"$ref":"#/contentSchema"}',
      "unsupported-dynamic",
    ],
  ])("preserves the exact compile refusal %s", (schema, reason) => {
    expect(admit(bytes(schema))).toMatchObject({ kind: "refused", phase: "compile", reason });
  });
  it("keeps unreferenced cycle/dynamic content schemas reserved and preserves raw refs", () => {
    for (const schema of [
      '{"$ref":"#/contentSchema"}',
      '{"$dynamicAnchor":"slot","$dynamicRef":"#slot"}',
    ]) {
      const r = evaluate(`{"contentMediaType":"text/plain","contentSchema":${schema}}`);
      expect(r).toMatchObject({ valid: true, counters: { states: 1 } });
      expect(r.annotations[1]?.value).toEqual(JSON.parse(schema));
    }
    expect(evaluate('{"$defs":{"unused":{"contentMediaType":"text/plain"}}}')).toMatchObject({
      valid: true,
      annotations: [],
    });
  });
  it("does not discover content-schema declarations inside unknown opaque annotation data", () => {
    const opaque = { contentMediaType: "text/plain", contentSchema: { pattern: "x" } };
    const r = evaluate(JSON.stringify({ opaque }));
    expect(r.annotations.map((a) => [a.keyword, a.value])).toEqual([["opaque", opaque]]);
  });
  it("reports nested instance, schema and validation locations", () => {
    const r = evaluate(
      '{"properties":{"a/~":{"contentMediaType":"text/plain","contentSchema":true}}}',
      '{"a/~":"x"}',
    );
    expect(r.annotations.filter((a) => a.keyword.startsWith("content"))).toEqual(
      [
        ["contentMediaType", "text/plain"],
        ["contentSchema", true],
      ].map(([keyword, value]) => ({
        keyword,
        value,
        schemaLocation: `${uri}#/properties/a~1~0/${keyword}`,
        instanceLocation: "/a~1~0",
        validationPath: `/properties/a~1~0/${keyword}`,
      })),
    );
  });
  it("projects shared schema values at both successful reference occurrences", () => {
    const schema =
      '{"$defs":{"x":{"contentMediaType":"application/json","contentSchema":{"const":2.0}}},"allOf":[{"$ref":"#/$defs/x"},{"$ref":"#/$defs/x"}]}';
    const r = evaluate(schema);
    expect(r.counters.annotations).toBe(4);
    expect(r.counters.occurrences).toBe(5);
    // The existing graph builder records these child edges in stack visitation order.
    expect(r.annotations.map((a) => a.validationPath)).toEqual([
      "/allOf/1/$ref/contentMediaType",
      "/allOf/1/$ref/contentSchema",
      "/allOf/0/$ref/contentMediaType",
      "/allOf/0/$ref/contentSchema",
    ]);
    expect(r.annotations[1]?.value).toBe(r.annotations[3]?.value);
    expect(r.annotations[1]).toMatchObject({
      value: { const: new JsonNumberLiteral("2.0") },
      schemaLocation: `${uri}#/%24defs/x/contentSchema`,
    });
  });
  it("discards failed-schema content annotations while retaining the successful anyOf branch", () => {
    // Core654–656 forbids annotations from false schema results, including children.
    const r = evaluate(
      '{"anyOf":[{"type":"null","contentMediaType":"text/plain","contentSchema":false},{"contentMediaType":"application/json","contentSchema":true}]}',
    );
    expect(r.valid).toBe(true);
    expect(r.annotations.map((a) => [a.keyword, a.value])).toEqual([
      ["contentMediaType", "application/json"],
      ["contentSchema", true],
    ]);
    expect(r.annotations.every((a) => a.validationPath.startsWith("/anyOf/1/"))).toBe(true);
  });
  it("charges the independently derived32-byte retained record even when root output is suppressed", () => {
    const without = evaluate('{"type":"null","contentMediaType":"text/plain"}');
    const withSchema = evaluate(
      '{"type":"null","contentMediaType":"text/plain","contentSchema":false}',
    );
    for (const r of [without, withSchema])
      expect(r).toMatchObject({
        valid: false,
        annotations: [],
        counters: { annotationBytes: 2, annotations: 0, states: 1 },
      });
    expect(withSchema.diagnostics).toEqual(without.diagnostics);
    expect(withSchema.counters.logicalBytes - without.counters.logicalBytes).toBe(32);
    expect(withSchema.counters.valueNodes).toBe(without.counters.valueNodes);
  });
  it("keeps caller bytes and returned nested values immutable across valid/invalid/valid calls", () => {
    const source = bytes(
      '{"minLength":1,"contentMediaType":"application/json","contentSchema":{"properties":{"foo":{"const":1e999}}}}',
    );
    const c = admit(source);
    if (c.kind !== "compiled") throw new Error(c.reason);
    source.fill(32);
    const first = c.evaluateUtf8(bytes('"x"'));
    if (first.kind !== "evaluated") throw new Error(first.reason);
    const value = first.annotations[1]?.value as {
      properties: { foo: { const: JsonNumberLiteral } };
    };
    for (const v of [value, value.properties, value.properties.foo, value.properties.foo.const])
      expect(Object.isFrozen(v)).toBe(true);
    expect(Reflect.set(value.properties.foo, "const", false)).toBe(false);
    expect(c.evaluateUtf8(bytes('""'))).toMatchObject({
      kind: "evaluated",
      valid: false,
      annotations: [],
    });
    expect(c.evaluateUtf8(bytes('"x"'))).toEqual(first);
  });
  it("pins nested value traversal charges independently of evaluator-produced counters", () => {
    // {default:[true,false]}: four pushed values16 each + one object key16.
    // Its JSON has24 bytes, four value pops and one object-key work unit; peak2 frames.
    const exact = {
      ...EVALUATOR_CEILINGS,
      logicalBytes: 80,
      annotationBytes: 24,
      work: 29,
      frames: 2,
    };
    const value = Object.freeze({ default: Object.freeze([true, false]) });
    const b = new EvaluationBudget(exact);
    chargeAnnotationBytes(value, b);
    expect(b.counts).toMatchObject({ logicalBytes: 80, annotationBytes: 24, work: 29, frames: 2 });
    for (const key of ["logicalBytes", "annotationBytes", "work", "frames"] as const) {
      expect(() =>
        chargeAnnotationBytes(value, new EvaluationBudget({ ...exact, [key]: exact[key] - 1 })),
      ).toThrow(`limit-${key}`);
    }
  });
  it("preserves existing encoding-only values and keeps the processing holds explicit", () => {
    const r = evaluate('{"contentEncoding":"base64"}', '"%%%"');
    expect(r).toMatchObject({ valid: true, diagnostics: [], diagnosticsComplete: true });
    expect(r.annotations).toEqual([
      {
        keyword: "contentEncoding",
        value: "base64",
        schemaLocation: `${uri}#/contentEncoding`,
        instanceLocation: "",
        validationPath: "/contentEncoding",
      },
    ]);
    expect(r.annotationPolicy).toEqual({
      revision: "bounded-annotation-output-2",
      format: "annotation-only",
      contentEncoding: "annotation-only-no-decoding",
      contentRevision: "annotation-only-content-1",
      contentMediaType: "annotation-only-no-media-type-parsing",
      contentSchema: "annotation-only-with-adjacent-media-type-no-validation",
      output: "complete-or-refused",
      encodedBytes: "JSON.stringify-UTF8-lossless-number-objects",
      order: "graph-edge-occurrence-order",
    });
    expect(r.deferred).toEqual([
      "full-vocabulary",
      "dynamic",
      "regex",
      "mime",
      "production-work-and-heap",
      "root-openness",
      "receiver",
      "registry",
      "ownership",
    ]);
  });
  it("bounds repeated complete output by count, bytes, occurrences, work, logical bytes and frames", () => {
    const schema = JSON.stringify({
      $defs: {
        x: {
          contentMediaType: "application/json",
          contentSchema: { default: Array.from({ length: 64 }, () => '☃\n"') },
        },
      },
      allOf: Array.from({ length: 16 }, () => ({ $ref: "#/$defs/x" })),
    });
    const r = evaluate(schema);
    // One root +16 wrapper occurrences +16 target occurrences; two annotations each.
    expect(r.counters.annotations).toBe(32);
    expect(r.counters.occurrences).toBe(33);
    const encoded = Buffer.byteLength(JSON.stringify(r.annotations));
    expect(r.counters.annotationBytes).toBe(encoded);
    for (const [key, count] of [
      ["annotations", 32],
      ["occurrences", 33],
      ["annotationBytes", encoded],
      ["logicalBytes", r.counters.logicalBytes],
      ["work", r.counters.work],
      ["frames", r.counters.frames],
    ] as const) {
      expect(evaluate(schema, '"outer"', { ...EVALUATOR_CEILINGS, [key]: count })).toEqual(r);
      expect(
        compile(schema, { ...EVALUATOR_CEILINGS, [key]: count - 1 }).evaluateUtf8(bytes('"outer"')),
      ).toMatchObject({ kind: "refused", phase: "instance", reason: `limit-${key}` });
    }
    // A materially amplified but finite output must refuse rather than return a prefix.
    const small = compile(schema, { ...EVALUATOR_CEILINGS, annotationBytes: 1024 });
    expect(small.evaluateUtf8(bytes('"outer"'))).toMatchObject({
      kind: "refused",
      phase: "instance",
      reason: "limit-annotationBytes",
    });
    expect(small.evaluateUtf8(bytes("null"))).toMatchObject({
      kind: "evaluated",
      valid: true,
      annotations: [],
    });
  });
});
