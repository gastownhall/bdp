import { createHash } from "node:crypto";
import type { JsonNumberLiteral } from "@bdp/protocol";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_ARTIFACT_CEILINGS,
  type ContractArtifactInput,
} from "./installed-contract-artifact.js";
import { BUILTIN_SCHEMA_DIGEST, BUILTIN_SCHEMA_DOCUMENTS } from "./installed-schema-builtins.js";
import {
  buildInstalledSchemaGraph,
  formatSchemaPointer,
  formatSchemaKeywordUri,
  SCHEMA_GRAPH_POLICY,
} from "./installed-schema-graph.js";
import {
  GraphBudget,
  SchemaGraphError,
  SCHEMA_GRAPH_CEILINGS,
  SCHEMA_KEYWORDS,
  type SchemaGraphLimits,
} from "./installed-schema-shape.js";
const retrieval = "https://schema.test/root";
const row = (text: string, retrievalUri = retrieval): ContractArtifactInput => ({
  retrievalUri,
  utf8Bytes: Buffer.from(text),
});
const input = (text: string, rest: ContractArtifactInput[] = []) => ({
  descriptors: [],
  schemas: [row(text), ...rest],
  limits: CONTRACT_ARTIFACT_CEILINGS,
});
const graph = (text: string, limits: SchemaGraphLimits = SCHEMA_GRAPH_CEILINGS) =>
  buildInstalledSchemaGraph(input(text), limits);
const rootNode = (text: string) => {
  const node = graph(text).nodes[0];
  if (!node) throw new Error("missing root");
  return node;
};

describe("private immutable schema graph draft", () => {
  it.each(["true", "false", "{}"])("accepts schema form %s without evaluator claims", (text) => {
    const g = graph(text);
    expect(g.nodes[0]?.value).toEqual(text === "{}" ? {} : text === "true");
    expect(g.receipt.deferred).toEqual([
      "string-semantics",
      "instance-evaluation",
      "dynamic-execution",
      "regex",
      "termination-and-work",
      "root-openness",
      "population",
      "ownership",
    ]);
    expect(g).not.toHaveProperty("ready");
    expect(g).not.toHaveProperty("installed");
  });
  it.each(["null", "1", '"x"', "[]"])("rejects non-schema root %s", (s) =>
    expect(() => graph(s)).toThrow("schema-shape"),
  );
  it("preserves lossless tokens and opaque values without indexing nested identifiers", () => {
    const text =
      '{"enum":[9007199254740993,9007199254740992],"const":{"$id":"urn:not-a-resource","n":1e9999999},"unknown":{"$ref":"https://missing.test/"},"default":{"a":[-0.0]},"examples":[{}]}';
    const g = graph(text);
    const n = g.nodes[0];
    expect(n?.keywords.map((k) => k.name)).toEqual([
      "enum",
      "const",
      "unknown",
      "default",
      "examples",
    ]);
    const v = n?.value as {
      enum: JsonNumberLiteral[];
      const: { n: JsonNumberLiteral };
      default: { a: JsonNumberLiteral[] };
    };
    expect(v.enum.map((v) => v.literal)).toEqual(["9007199254740993", "9007199254740992"]);
    expect(v.const.n.literal).toBe("1e9999999");
    expect(v.default.a[0]?.literal).toBe("-0.0");
    expect(g.resources.some((r) => r.canonicalUri === "urn:not-a-resource")).toBe(false);
    const pending: unknown[] = [g];
    while (pending.length) {
      const v = pending.pop();
      if (v && typeof v === "object") {
        expect(Object.isFrozen(v)).toBe(true);
        pending.push(...Object.values(v));
      }
    }
  });
  it.each([
    "1",
    "1.0",
    "1e0",
    "-0",
    "-0.000e-999999999",
    "1e999999999999999999999999999",
    "1000e-3",
    "0.0100e2",
    "9007199254740993",
  ])("retains exact nonnegative integer %s", (s) =>
    expect(
      (rootNode(`{"minLength":${s}}`).value as { minLength: JsonNumberLiteral }).minLength.literal,
    ).toBe(s),
  );
  it.each(["-1", "0.1", "100e-3", "1e-999999999999999999999"])(
    "refuses count %s without rounding",
    (s) => expect(() => graph(`{"maxItems":${s}}`)).toThrow("keyword-shape"),
  );
  it.each(["1e-9999999999999999999999", "0.000000000000000000000001", "1e99999999999999"])(
    "retains positive multipleOf %s",
    (s) =>
      expect(
        (rootNode(`{"multipleOf":${s}}`).value as { multipleOf: JsonNumberLiteral }).multipleOf
          .literal,
      ).toBe(s),
  );
  it.each(["0", "-0e100", "-1"])("refuses nonpositive multipleOf %s", (s) =>
    expect(() => graph(`{"multipleOf":${s}}`)).toThrow("keyword-shape"),
  );
  it.each([
    '{"enum":[]}',
    '{"enum":[1,1]}',
    '{"required":[]}',
    '{"type":["null","integer"]}',
    '{"minimum":-1e9999999}',
  ])("allows exact structural neighbor %s", (s) => expect(() => graph(s)).not.toThrow());
  it.each([
    '{"type":[]}',
    '{"type":["null","null"]}',
    '{"required":["a","a"]}',
    '{"prefixItems":[]}',
    '{"dependentRequired":{"a":[1]}}',
    '{"uniqueItems":1}',
  ])("refuses malformed operand %s", (s) => expect(() => graph(s)).toThrow("keyword-shape"));
  it("refuses an array where a child schema is required", () =>
    expect(() => graph('{"items":[]}')).toThrow("schema-shape"));
  it("registers identifiers before refs, nearest bases, aliases and static/dynamic distinctions", () => {
    const g = graph(
      '{"$ref":"child#A","$id":"https://Other.test/Top/root","$defs":{"child":{"$id":"child","$dynamicAnchor":"A","$defs":{"x":{"$anchor":"B"}},"allOf":[{"$dynamicRef":"#A"},{"$dynamicRef":"#B"},{"$dynamicRef":"#/$defs/x"},{"$ref":"#A"}]}}}',
    );
    const child = g.resources.find((r) => r.canonicalUri === "https://other.test/Top/child");
    expect(child?.containingResource).toBe(0);
    expect(g.resources[0]?.retrievalAlias).toBe(retrieval);
    expect(g.references[0]?.target).toBe(child?.node);
    const edges = g.references.filter(
      (r) => r.node !== 0 && g.nodes[r.node]?.resource === child?.id,
    );
    expect(edges.filter((r) => r.kind === "dynamic-anchor")).toHaveLength(1);
    expect(edges.find((r) => r.kind === "dynamic-anchor")).toMatchObject({
      raw: "#A",
      keyword: "$dynamicRef",
      anchor: "A",
      target: child?.node,
    });
    expect(edges.filter((r) => r.kind === "static")).toHaveLength(3);
    expect(child?.anchors).not.toBe(g.resources[0]?.anchors);
    expect(child?.dynamicAnchors).not.toBe(child?.anchors);
  });
  it("resolves escaped empty Unicode and percent pointer keys exactly once", () => {
    const g = graph(
      '{"$defs":{"a/b~c":true,"":false,"☃":{},"%2F":{}},"allOf":[{"$ref":"#/$defs/a~1b~0c"},{"$ref":"#/$defs/"},{"$ref":"#/$defs/%E2%98%83"},{"$ref":"#/$defs/%252F"}]}',
    );
    const paths = g.references
      .filter((r) => g.nodes[r.node]?.resource === 0)
      .map((r) =>
        formatSchemaPointer(
          g.pointers,
          g.nodes[r.target]?.documentPointer ?? -1,
          g.nodes[0]?.documentPointer ?? -1,
          2048,
        ),
      );
    expect(paths.sort()).toEqual(["/$defs/", "/$defs/%2F", "/$defs/a~1b~0c", "/$defs/☃"].sort());
  });
  it.each([
    "allOf",
    "anyOf",
    "oneOf",
    "not",
    "if",
    "then",
    "else",
    "definitions",
    "$defs",
    "contentSchema",
  ])("checks unused %s branches", (key) => {
    const bad = { $ref: "https://missing.test/" };
    const value = ["allOf", "anyOf", "oneOf"].includes(key)
      ? [bad]
      : ["definitions", "$defs"].includes(key)
        ? { unused: bad }
        : bad;
    expect(() => graph(JSON.stringify({ [key]: value }))).toThrow("missing-resource");
  });
  it("indexes transitional definitions and all relation classes without reviving unknown keywords", () => {
    const g = graph(
      '{"definitions":{"a":{}},"propertyNames":true,"properties":{"a":false},"items":true,"contentSchema":{},"not":true,"additionalItems":{"$ref":"https://missing.test/"}}',
    );
    expect(new Set(g.children.filter((e) => e.node === 0).map((e) => e.relation))).toEqual(
      new Set([
        "reserved",
        "property-name",
        "object-value",
        "array-item",
        "content-schema",
        "in-place",
      ]),
    );
  });
  it.each([
    ['{"$defs":{"a":{"$id":"urn:example:A"}},"$ref":"urn:example:A"}', "urn:example:A"],
    ['{"$id":"file:///schemas/a","$defs":{"x":{"$id":"b"}},"$ref":"b"}', "file:///schemas/b"],
  ])("indexes identifier-only URI %s", (s, uri) =>
    expect(graph(s).resources.some((r) => r.canonicalUri === uri)).toBe(true),
  );
  it.each([
    ['{"$defs":{"a":{"$id":"child"}},"$ref":"#/$defs/a"}', "unsupported-cross-resource-pointer"],
    ['{"const":{"a":{}},"$ref":"#/const/a"}', "unsupported-reference-position"],
    ['{"$ref":"#/~2"}', "pointer"],
    ['{"allOf":[{}],"$ref":"#/allOf/00"}', "pointer"],
    ['{"$defs":{"a":{"$id":"same"},"b":{"$id":"same"}}}', "resource-collision"],
    ['{"$anchor":"A","$dynamicAnchor":"A"}', "anchor-collision"],
    ['{"$anchor":"A","$ref":"#a"}', "missing-anchor"],
    ['{"$id":"https://x.test/a#anchor"}', "id-fragment"],
    ['{"$schema":"https://custom.test/"}', "unsupported-dialect"],
    [
      '{"$defs":{"a":{"$schema":"https://json-schema.org/draft/2020-12/schema"}}}',
      "schema-placement",
    ],
    [
      '{"$defs":{"a":{"$id":"child","$schema":"https://json-schema.org/draft/2019-09/schema"}}}',
      "unsupported-dialect",
    ],
    ['{"$defs":{"a":{"$vocabulary":{}}}}', "vocabulary-placement"],
    ['{"$vocabulary":{"relative":true}}', "vocabulary-uri"],
    ['{"dependencies":{}}', "unsupported-transitional-dependencies"],
    ['{"$recursiveRef":"#"}', "unsupported-recursive-keyword"],
    ['{"$recursiveAnchor":true}', "unsupported-recursive-keyword"],
    ['{"$id":"https://json-schema.org/draft/2020-12/schema"}', "resource-collision"],
  ])("explicitly refuses %s as %s", (s, code) => {
    try {
      graph(s);
      throw new Error("expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaGraphError);
      expect((error as SchemaGraphError).code).toBe(code);
    }
  });
  it("records explicit/default/inherited dialect and ignores ordinary required vocabularies", () => {
    const g = graph(
      '{"$schema":"https://json-schema.org:443/draft/2020-12/schema#","$vocabulary":{"https://unknown.test/vocab":true},"$defs":{"a":{"$id":"child"}}}',
    );
    expect(g.resources.slice(0, 2).map((r) => r.dialectSource)).toEqual(["explicit", "inherited"]);
    expect(graph("{}").resources[0]?.dialectSource).toBe("bdp-default");
  });
  it("formats bounded resource-relative keyword URIs with pointer and percent escaping", () => {
    const g = graph(
      '{"$defs":{"x":{"$id":"urn:example:X","properties":{"a/b~☃":{"type":"string"}}}}}',
    );
    const n = g.nodes.find((n) =>
      n.keywords.some((k) => k.name === "type" && k.value === "string"),
    );
    if (!n) throw new Error("missing node");
    const uri = "urn:example:X#/properties/a~1b~0%E2%98%83/type";
    expect(formatSchemaKeywordUri(g, n.id, "type", uri.length)).toBe(uri);
    expect(() => formatSchemaKeywordUri(g, n.id, "type", uri.length - 1)).toThrow("limit-location");
    expect(() => formatSchemaKeywordUri(g, n.id, "absent")).toThrow("pointer-location");
  });
  it("charges broad maps, repeated references, opaque data and late duplicates", () => {
    const s = JSON.stringify({
      $defs: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`key${i}`, { $ref: "#" }])),
    });
    expect(() => graph(s, { ...SCHEMA_GRAPH_CEILINGS, childEdges: 100 })).toThrow(
      "limit-childEdges",
    );
    expect(() => graph(s, { ...SCHEMA_GRAPH_CEILINGS, references: 100 })).toThrow(
      "limit-references",
    );
    expect(() =>
      graph(JSON.stringify({ opaque: Array(5000).fill(null) }), {
        ...SCHEMA_GRAPH_CEILINGS,
        syntaxNodes: 1000,
      }),
    ).toThrow("limit-syntaxNodes");
    expect(() =>
      graph(
        JSON.stringify({
          $defs: Object.fromEntries(
            Array.from({ length: 200 }, (_, i) => [
              `key${i}`,
              { $anchor: i < 199 ? `a${i}` : "a0" },
            ]),
          ),
        }),
      ),
    ).toThrow("anchor-collision");
  });
  it("binds descriptor original default-port URL without changing its artifact identity", () => {
    const descriptor = row(
      '{"id":"https://types.test/bead","name":"Bead","describes":"bead","conformsTo":[],"propertiesSchema":"https://schema.test:443/root"}',
      "https://types.test/bead",
    );
    const g = buildInstalledSchemaGraph(
      { ...input("{}"), descriptors: [descriptor] },
      SCHEMA_GRAPH_CEILINGS,
    );
    expect(g.descriptorRoots).toEqual([
      {
        descriptor: "https://types.test/bead",
        originalUri: "https://schema.test:443/root",
        resolvedUri: retrieval,
        node: 0,
        resource: 0,
      },
    ]);
    expect(() =>
      buildInstalledSchemaGraph(
        { ...input("{}"), schemas: [], descriptors: [descriptor] },
        SCHEMA_GRAPH_CEILINGS,
      ),
    ).toThrow("schema resource index refused: missing-resource");
  });
  it("binds immutable builtins, exact artifact bytes and policy into identity", () => {
    expect(BUILTIN_SCHEMA_DOCUMENTS).toHaveLength(8);
    const digest = createHash("sha256");
    const keywordNames = new Set<string>();
    for (const doc of BUILTIN_SCHEMA_DOCUMENTS) {
      const bytes = Buffer.from(doc.bytesBase64, "base64");
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(doc.sha256);
      digest.update(`${doc.uri}\0${doc.sha256}\n`);
      const meta = JSON.parse(bytes.toString()) as { properties?: Record<string, unknown> };
      for (const k of Object.keys(meta.properties ?? {})) keywordNames.add(k);
    }
    expect(digest.digest("hex")).toBe(BUILTIN_SCHEMA_DIGEST);
    // Exact fixed meta-schema census; compatibility refusal is asserted separately.
    expect(new Set(Object.keys(SCHEMA_KEYWORDS))).toEqual(keywordNames);
    expect(SCHEMA_KEYWORDS.dependencies).toBe("unsupported");
    const g = graph("{}");
    expect(g.identity).toBe(
      createHash("sha256")
        .update(`${SCHEMA_GRAPH_POLICY}\0${g.artifactDigest}\0${g.builtinDigest}`)
        .digest("hex"),
    );
    expect(graph("{ }").identity).not.toBe(g.identity);
    expect(graph("{}").identity).toBe(g.identity);
  });
  it("is unaffected by mutation of input bytes and refuses trap-bearing limits without executing traps", () => {
    const i = input("{}");
    const g = buildInstalledSchemaGraph(i, SCHEMA_GRAPH_CEILINGS);
    i.schemas[0]?.utf8Bytes.fill(0);
    expect(g.nodes[0]?.value).toEqual({});
    let calls = 0;
    const bad = new Proxy(
      { ...SCHEMA_GRAPH_CEILINGS },
      {
        ownKeys() {
          calls++;
          throw new Error("secret");
        },
      },
    );
    expect(() => buildInstalledSchemaGraph(input("{}"), bad)).toThrow("limits");
    expect(calls).toBe(0);
    const accessor = Object.defineProperty({ ...SCHEMA_GRAPH_CEILINGS }, "nodes", {
      get() {
        calls++;
        throw new Error("secret");
      },
    });
    expect(() => graph("{}", accessor)).toThrow("limits");
    expect(calls).toBe(0);
  });
  it("admits every exact counter boundary and refuses one unit less", () => {
    const descriptor = row(
      '{"id":"https://types.test/b","name":"B","describes":"bead","conformsTo":[],"propertiesSchema":"https://schema.test/root"}',
      "https://types.test/b",
    );
    const i = {
      ...input('{"$anchor":"A","$defs":{"x":{}},"$ref":"#/$defs/x"}'),
      descriptors: [descriptor],
    };
    const g = buildInstalledSchemaGraph(i, SCHEMA_GRAPH_CEILINGS);
    for (const key of Object.keys(SCHEMA_GRAPH_CEILINGS) as (keyof SchemaGraphLimits)[]) {
      const value = g.receipt.counters[key];
      expect(value).toBeGreaterThan(0);
      expect(
        buildInstalledSchemaGraph(i, { ...SCHEMA_GRAPH_CEILINGS, [key]: value }).identity,
      ).toBe(g.identity);
      expect(() =>
        buildInstalledSchemaGraph(i, { ...SCHEMA_GRAPH_CEILINGS, [key]: value - 1 }),
      ).toThrow(`limit-${key}`);
    }
  });
  it("indexes finite self/mutual cycles without expanding evaluation and handles deep syntax iteratively", () => {
    const g = graph('{"$defs":{"a":{"$ref":"#/$defs/b"},"b":{"$ref":"#/$defs/a"}},"$ref":"#"}');
    expect(g.references.filter((r) => g.nodes[r.node]?.resource === 0)).toHaveLength(3);
    const s = `${'{"not":'.repeat(4096)}true${"}".repeat(4096)}`;
    const deep = graph(s);
    expect(deep.nodes.filter((n) => n.resource === 0)).toHaveLength(4097);
    const leaf = deep.nodes[4096];
    expect(leaf).toBeDefined();
    expect(() => formatSchemaPointer(deep.pointers, leaf?.documentPointer ?? -1, 0, 8)).toThrow(
      "limit-location",
    );
    expect(() => graph(s, { ...SCHEMA_GRAPH_CEILINGS, depth: 4095 })).toThrow("limit-depth");
  });
  it("binds descriptor membership, descriptor schema targets, and retrieval URI to identity", () => {
    const descriptor = (target: string) =>
      row(
        JSON.stringify({
          id: "https://types.test/bead",
          name: "Bead",
          describes: "bead",
          conformsTo: [],
          propertiesSchema: target,
        }),
        "https://types.test/bead",
      );
    const base = input('{"$defs":{"a":{},"b":{}}}');
    const plain = buildInstalledSchemaGraph(base, SCHEMA_GRAPH_CEILINGS);
    const a = buildInstalledSchemaGraph(
      { ...base, descriptors: [descriptor(`${retrieval}#/$defs/a`)] },
      SCHEMA_GRAPH_CEILINGS,
    );
    const other = buildInstalledSchemaGraph(
      { ...base, descriptors: [descriptor(`${retrieval}#/$defs/b`)] },
      SCHEMA_GRAPH_CEILINGS,
    );
    expect(a.identity).not.toBe(plain.identity);
    expect(other.identity).not.toBe(a.identity);
    expect(other.descriptorRoots[0]?.node).not.toBe(a.descriptorRoots[0]?.node);
    const moved = buildInstalledSchemaGraph(
      { ...input("{}"), schemas: [row("{}", "https://schema.test/other")] },
      SCHEMA_GRAPH_CEILINGS,
    );
    expect(moved.identity).not.toBe(graph("{}").identity);
  });
  it.each([NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "refuses invalid bound amount %s without poisoning counters",
    (amount) => {
      const budget = new GraphBudget(SCHEMA_GRAPH_CEILINGS);
      expect(() => budget.bound("depth", amount)).toThrow(
        "schema resource index refused: limit-depth",
      );
      expect(budget.counts.depth).toBe(0);
      budget.bound("depth", 1);
      expect(budget.counts.depth).toBe(1);
    },
  );
  it("preserves node and descriptor locations on reference refusals without copying input into messages", () => {
    for (const [raw, code] of [
      ["https://missing.test/", "missing-resource"],
      ["#missing", "missing-anchor"],
      ["#/~2", "pointer"],
      ["#/const/x", "unsupported-reference-position"],
      ["#/$defs/child", "unsupported-cross-resource-pointer"],
      ["#%FF", "uri-fragment"],
      ["x".repeat(2049), "limit-uriBytes"],
    ]) {
      try {
        graph(JSON.stringify({ const: { x: {} }, $defs: { child: { $id: "child" } }, $ref: raw }));
        throw new Error("expected refusal");
      } catch (error) {
        expect(error).toBeInstanceOf(SchemaGraphError);
        expect(error).toMatchObject({ code, node: 0 });
        expect((error as SchemaGraphError).descriptor).toBeUndefined();
        expect((error as Error).message).toBe(`schema resource index refused: ${code}`);
      }
    }
    const descriptor = row(
      '{"id":"https://types.test/bead","name":"Bead","describes":"bead","conformsTo":[],"propertiesSchema":"https://missing.test/"}',
      "https://types.test/bead",
    );
    try {
      buildInstalledSchemaGraph(
        { ...input("{}"), descriptors: [descriptor] },
        SCHEMA_GRAPH_CEILINGS,
      );
      throw new Error("expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaGraphError);
      expect(error).toMatchObject({
        code: "missing-resource",
        descriptor: "https://types.test/bead",
      });
      expect((error as SchemaGraphError).node).toBeUndefined();
      expect((error as Error).message).toBe("schema resource index refused: missing-resource");
    }
  });
  it("retains ingestion's named malformed-byte, JSON and depth refusals ahead of graph indexing", () => {
    const run = (bytes: Uint8Array) => () =>
      buildInstalledSchemaGraph(
        { ...input("{}"), schemas: [{ retrievalUri: retrieval, utf8Bytes: bytes }] },
        SCHEMA_GRAPH_CEILINGS,
      );
    expect(run(Uint8Array.of(0xff))).toThrow("contract artifact ingestion refused: utf8");
    expect(run(Buffer.from("{"))).toThrow("contract artifact ingestion refused: json-syntax");
    expect(run(Buffer.from("\ufeff{}"))).toThrow(
      "contract artifact ingestion refused: json-syntax",
    );
    // The protocol decoder is iterative; the administrative ingestion layer
    // owns the per-artifact byte/depth caps before the graph's second decode.
    const deep = `${'{"not":'.repeat(100_000)}true${"}".repeat(100_000)}`;
    expect(Buffer.byteLength(deep)).toBeLessThan(CONTRACT_ARTIFACT_CEILINGS.artifactBytes);
    expect(run(Buffer.from(deep))).toThrow("contract artifact ingestion refused: limit");
  });
  it.each([
    "https://Schema.Test:443/root",
    "https://schema.test:443/root",
    "https://schema.test/%72oot",
  ])("refuses noncanonical retrieval URI before alias indexing: %s", (retrievalUri) => {
    expect(() =>
      buildInstalledSchemaGraph(
        { ...input("{}"), schemas: [row("{}", retrievalUri)] },
        SCHEMA_GRAPH_CEILINGS,
      ),
    ).toThrow("contract artifact ingestion refused: retrieval-uri");
  });
});
