import { describe, expect, it } from "vitest";
import { qualifyDynamicRecursion, qualifyStaticRecursion } from "./installed-schema-recursion.js";
import { EvaluationBudget } from "./installed-schema-value.js";
import {
  compilePrivateSchemaEvaluator,
  EVALUATOR_CEILINGS,
  type EvaluatorLimits,
} from "./installed-schema-evaluator.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { SCHEMA_GRAPH_CEILINGS } from "./installed-schema-shape.js";
import type {
  SchemaNode,
  SchemaReference,
  SchemaResource,
  SchemaGraphCandidate,
} from "./installed-schema-graph.js";
import type { LosslessJsonValue } from "@bdp/protocol";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const uri = "https://dynamic.test/root";
function compile(
  schema: unknown,
  documents: unknown[] = [],
  limits: EvaluatorLimits = EVALUATOR_CEILINGS,
) {
  return compilePrivateSchemaEvaluator({
    bundle: {
      descriptors: [],
      schemas: [schema, ...documents].map((value, i) => ({
        retrievalUri: i === 0 ? uri : `https://dynamic.test/document${i}`,
        utf8Bytes: bytes(value),
      })),
      limits: CONTRACT_ARTIFACT_CEILINGS,
    },
    graphLimits: SCHEMA_GRAPH_CEILINGS,
    entry: { kind: "schema", retrievalUri: uri },
    limits,
  });
}
function evaluate(schema: unknown, value: unknown) {
  const c = compile(schema);
  if (c.kind !== "compiled") throw new Error(`compile: ${c.reason}`);
  const r = c.evaluateUtf8(bytes(value));
  if (r.kind !== "evaluated") throw new Error(`instance: ${r.reason}`);
  expect(r.counters.annotationBytes).toBe(Buffer.byteLength(JSON.stringify(r.annotations)));
  return r;
}
type Child = SchemaGraphCandidate["children"][number];
interface Fixture {
  nodes: SchemaNode[];
  resources: SchemaResource[];
  children: Map<number, Child[]>;
  refs: Map<number, SchemaReference[]>;
}
function node(id: number, resource: number, values: Record<string, unknown>): SchemaNode {
  return {
    id,
    resource,
    documentPointer: id,
    resourceRootPointer: resource,
    value: values as LosslessJsonValue,
    keywords: Object.entries(values).map(([name, value]) => ({
      name,
      value: value as LosslessJsonValue,
      pointer: id,
    })),
  };
}
function resource(id: number, root: number, anchors: Record<string, number>): SchemaResource {
  return {
    id,
    node: root,
    artifact: `https://helper.test/${id}`,
    canonicalUri: `https://helper.test/${id}`,
    dialect: "https://json-schema.org/draft/2020-12/schema",
    dialectSource: "explicit",
    anchors,
    dynamicAnchors: anchors,
  };
}
function child(f: Fixture, from: number, to: number, keyword: string): void {
  const rows = f.children.get(from) ?? [];
  rows.push({
    node: from,
    target: to,
    keyword,
    relation:
      keyword === "$defs" ? "reserved" : keyword === "properties" ? "object-value" : "in-place",
  });
  f.children.set(from, rows);
}
function reference(f: Fixture, from: number, to: number, dynamic = false): void {
  const rows = f.refs.get(from) ?? [];
  rows.push({
    node: from,
    target: to,
    keyword: dynamic ? "$dynamicRef" : "$ref",
    raw: "#n",
    resolvedUri: "https://helper.test/0#n",
    kind: dynamic ? "dynamic-anchor" : "static",
    fragmentKind: "plain-name",
    anchor: "n",
  });
  f.refs.set(from, rows);
}
function fixture(which: number): Fixture {
  const f: Fixture = { nodes: [], resources: [], children: new Map(), refs: new Map() };
  if ([1, 2, 7].includes(which)) {
    f.nodes = [
      node(0, 0, { $defs: {}, $dynamicRef: "#n", ...(which === 2 ? { properties: {} } : {}) }),
      node(1, 0, { $dynamicAnchor: "n" }),
    ];
    f.resources = [resource(0, 0, { n: 1 })];
    reference(f, 0, 1, true);
    child(f, 0, 1, "$defs");
    if (which === 2) {
      f.nodes.push(node(2, 0, {}));
      child(f, 0, 2, "properties");
    }
    if (which === 7)
      for (let i = 0; i < 8; i++) {
        f.nodes.push(node(i + 2, i + 1, { $dynamicAnchor: "meta" }));
        f.resources.push(resource(i + 1, i + 2, { meta: i + 2 }));
      }
  } else if (which === 3) {
    f.nodes = [node(0, 0, { $dynamicAnchor: "n", $dynamicRef: "#n" })];
    f.resources = [resource(0, 0, { n: 0 })];
    reference(f, 0, 0, true);
  } else if (which === 4) {
    f.nodes = [
      node(0, 0, { $dynamicAnchor: "n", properties: {} }),
      node(1, 0, { $dynamicRef: "#n" }),
    ];
    f.resources = [resource(0, 0, { n: 0 })];
    child(f, 0, 1, "properties");
    reference(f, 1, 0, true);
  } else {
    const branches = which === 6 ? 3 : 2,
      shared = branches === 3 ? 10 : 7,
      fallback = shared + 1;
    f.nodes.push(node(0, 0, { anyOf: [], $schema: "x" }));
    for (let i = 1; i <= branches; i++) {
      f.nodes.push(node(i, 0, { $ref: "x" }));
      child(f, 0, i, "anyOf");
    }
    f.resources.push(resource(0, 0, {}));
    for (let i = 0; i < branches; i++) {
      const root = branches + 1 + 2 * i,
        leaf = root + 1;
      f.nodes.push(
        node(root, i + 1, { $id: "x", $defs: {}, $ref: "x" }),
        node(leaf, i + 1, { $dynamicAnchor: "n", type: "string", title: "branch" }),
      );
      f.resources.push(resource(i + 1, root, { n: leaf }));
      child(f, root, leaf, "$defs");
      reference(f, i + 1, root);
      reference(f, root, shared);
    }
    f.nodes.push(
      node(shared, branches + 1, {
        $id: "x",
        $defs: {},
        $dynamicRef: "#n",
        ...(which === 8 ? { pattern: "^", patternProperties: {} } : {}),
      }),
      node(fallback, branches + 1, { $dynamicAnchor: "n", type: "null" }),
    );
    f.resources.push(resource(branches + 1, shared, { n: fallback }));
    child(f, shared, fallback, "$defs");
    reference(f, shared, fallback, true);
  }
  return f;
}
const expected = [
  [1, 13, 272, 1, 204, 1840, 3, 1],
  [2, 14, 272, 1, 276, 2192, 4, 2],
  [3, 13, 272, 1, 139, 1520, 2, 1],
  [4, 23, 352, 2, 238, 2032, 4, 1],
  [5, 54, 592, 5, 948, 4992, 14, 2],
  [6, 59, 672, 6, 1402, 6656, 19, 3],
  [7, 13, 272, 1, 510, 2848, 3, 1],
  [8, 64, 592, 5, 986, 4992, 14, 2],
] as const;
function owners(f: Fixture, b: EvaluationBudget, which: number) {
  const calls: { name: string; node: number; value: unknown }[] = [];
  const callback =
    (name: string) =>
    (id: number, value: unknown): void => {
      if (which !== 8) throw new Error("unexpected declaration");
      expect(id).toBe(7);
      expect(value).toBe(f.nodes[7]?.keywords.find((k) => k.name === name)?.value);
      b.work(3); // Direct preprimed supplied-table hit, not actual matcher compilation.
      calls.push({ name, node: id, value });
    };
  return { pattern: callback("pattern"), properties: callback("patternProperties"), calls };
}
function old(f: Fixture, b: EvaluationBudget, o: ReturnType<typeof owners>): void {
  expect(() =>
    qualifyStaticRecursion(f.nodes, 0, f.children, f.refs, b, o.pattern, o.properties),
  ).toThrow("unsupported-dynamic");
}
describe("frozen dynamic owner ledgers, no observed-number calibration", () => {
  for (const [which, ow, ob, os, work, logicalBytes, states, frames] of expected) {
    it(`D${which} exact retained-prefix and complete owner ledger`, () => {
      const f = fixture(which),
        b = new EvaluationBudget({ ...EVALUATOR_CEILINGS, work, logicalBytes, states, frames }),
        o = owners(f, b, which);
      old(f, b, o);
      expect(b.counts).toMatchObject({ work: ow, logicalBytes: ob, states: os });
      const invoke = () =>
        qualifyDynamicRecursion(
          f.nodes,
          f.resources,
          0,
          f.children,
          f.refs,
          b,
          o.pattern,
          o.properties,
        );
      if (which === 3) expect(invoke).toThrow("nonqualified-cycle");
      else {
        const result = invoke();
        expect(result.entry).toBe(0);
        if (which === 6) expect(result.states.length).toBeGreaterThan(f.nodes.length);
        if (which === 7) expect(result.states).toHaveLength(2);
        if (which === 8) {
          expect(result.states.filter((s) => s.node === 7)).toHaveLength(2);
          expect(o.calls.filter((c) => c.name === "pattern")).toHaveLength(3);
          expect(o.calls.filter((c) => c.name === "patternProperties")).toHaveLength(3);
        }
      }
      expect(b.counts).toMatchObject({ work, logicalBytes, states, frames });
    });
    for (const key of ["work", "logicalBytes", "states", "frames"] as const) {
      if (which === 3 && key !== "work") continue;
      it(`D${which} one-below ${key} refuses without changing other limits`, () => {
        const exact = { work, logicalBytes, states, frames };
        const b = new EvaluationBudget({ ...EVALUATOR_CEILINGS, [key]: exact[key] - 1 }),
          f = fixture(which),
          o = owners(f, b, which);
        expect(() => {
          try {
            qualifyStaticRecursion(f.nodes, 0, f.children, f.refs, b, o.pattern, o.properties);
          } catch (error) {
            if (!(error instanceof Error) || !error.message.includes("unsupported-dynamic"))
              throw error;
          }
          qualifyDynamicRecursion(
            f.nodes,
            f.resources,
            0,
            f.children,
            f.refs,
            b,
            o.pattern,
            o.properties,
          );
        }).toThrow(`limit-${key}`);
      });
    }
  }
  it("keeps decorative-name contexts distinct while selecting the same referenced leaf", () => {
    const f = fixture(5);
    f.nodes[0] = node(0, 0, { $defs: {}, anyOf: [] });
    f.nodes[4] = node(4, 1, { $dynamicAnchor: "u" });
    f.nodes[6] = node(6, 2, { $dynamicAnchor: "u" });
    f.nodes[8] = node(8, 0, { $dynamicAnchor: "n", type: "string" });
    f.resources = [
      resource(0, 0, { n: 8 }),
      resource(1, 3, { u: 4 }),
      resource(2, 5, { u: 6 }),
      resource(3, 7, {}),
    ];
    const b = new EvaluationBudget(EVALUATOR_CEILINGS),
      no = () => undefined;
    const r = qualifyDynamicRecursion(f.nodes, f.resources, 0, f.children, f.refs, b, no, no);
    expect(r.states).toHaveLength(9);
    const shared = r.states.filter((s) => s.node === 7);
    expect(shared).toHaveLength(2);
    expect(shared[0]?.context).not.toBe(shared[1]?.context);
    for (const s of shared)
      for (const target of s.refs.values()) expect(r.states[target]?.node).toBe(8);
    expect(r.states.filter((s) => s.node === 8)).toHaveLength(2);
  });
});

const A = "https://dynamic.test/a",
  S = "https://dynamic.test/shared";
const callA = { $ref: A };
const routes: {
  name: string;
  schema: unknown;
  input: unknown;
  override?: unknown;
  valid?: boolean;
  path?: string;
  instance?: string;
}[] = [
  { name: "Y01 refs", schema: callA, input: 1, path: "" },
  { name: "Y02 allOf", schema: { allOf: [callA] }, input: 1, path: "/allOf/0" },
  { name: "Y02 anyOf", schema: { anyOf: [false, callA] }, input: 1, path: "/anyOf/1" },
  { name: "Y02 oneOf", schema: { oneOf: [false, callA] }, input: 1, path: "/oneOf/1" },
  { name: "Y03 not", schema: { not: callA }, input: 1, valid: false },
  {
    name: "Y04 if",
    schema: {
      if: callA,
      // biome-ignore lint/suspicious/noThenProperty: Fixed JSON Schema data, not a callable thenable.
      then: false,
      else: true,
    },
    input: 1,
    valid: false,
  },
  {
    name: "Y05 then",
    schema: {
      if: true,
      // biome-ignore lint/suspicious/noThenProperty: Fixed JSON Schema data, not a callable thenable.
      then: callA,
    },
    input: 1,
    path: "/then",
  },
  { name: "Y05 else", schema: { if: false, else: callA }, input: 1, path: "/else" },
  {
    name: "Y06 dependentSchemas",
    schema: { dependentSchemas: { x: callA } },
    input: { x: 1 },
    override: { required: ["x"] },
    path: "/dependentSchemas/x",
  },
  {
    name: "Y07 properties",
    schema: { properties: { x: callA } },
    input: { x: 1 },
    path: "/properties/x",
    instance: "/x",
  },
  {
    name: "Y08 patternProperties",
    schema: { patternProperties: { "^x$": callA } },
    input: { x: 1 },
    path: "/patternProperties/^x$",
    instance: "/x",
  },
  {
    name: "Y09 additionalProperties",
    schema: { additionalProperties: callA },
    input: { x: 1 },
    path: "/additionalProperties",
    instance: "/x",
  },
  {
    name: "Y10 propertyNames distinct synthetic IDs",
    schema: { propertyNames: callA },
    input: { x: 1, y: 2 },
    override: { const: "x" },
    valid: false,
  },
  {
    name: "Y10 propertyNames positive",
    schema: { propertyNames: callA },
    input: { x: 1 },
    override: { const: "x" },
    path: "/propertyNames",
  },
  {
    name: "Y11 prefixItems",
    schema: { prefixItems: [callA] },
    input: [1],
    path: "/prefixItems/0",
    instance: "/0",
  },
  { name: "Y12 items", schema: { items: callA }, input: [1], path: "/items", instance: "/0" },
  {
    name: "Y13 contains",
    schema: { contains: callA },
    input: [1, "bad"],
    path: "/contains",
    instance: "/0",
  },
  {
    name: "Y14 unevaluatedProperties",
    schema: { unevaluatedProperties: callA },
    input: { x: 1 },
    path: "/unevaluatedProperties",
    instance: "/x",
  },
  {
    name: "Y15 unevaluatedItems",
    schema: { unevaluatedItems: callA },
    input: [1],
    path: "/unevaluatedItems",
    instance: "/0",
  },
];
describe("every dynamic transition reaches the override, not its initial fallback", () => {
  for (const row of routes)
    it(row.name, () => {
      const docs = [
        {
          $id: A,
          $defs: {
            override: {
              $dynamicAnchor: "n",
              ...((row.override ?? { const: 1 }) as object),
              title: "selected",
            },
          },
          $ref: S,
        },
        {
          $id: S,
          $defs: { fallback: { $dynamicAnchor: "n", const: "never", title: "fallback" } },
          $dynamicRef: "#n",
        },
      ];
      const c = compile(row.schema, docs);
      if (c.kind !== "compiled") throw new Error(c.reason);
      const r = c.evaluateUtf8(bytes(row.input));
      if (r.kind !== "evaluated") throw new Error(r.reason);
      expect(r.valid).toBe(row.valid ?? true);
      expect(r.counters.annotationBytes).toBe(Buffer.byteLength(JSON.stringify(r.annotations)));
      if (row.valid === false) expect(r.annotations).toEqual([]);
      else
        expect(r.annotations.filter((a) => a.keyword === "title")).toEqual([
          {
            keyword: "title",
            value: "selected",
            schemaLocation: `${A}#/%24defs/override/title`,
            instanceLocation: row.instance ?? "",
            validationPath: `${row.path}/$ref/$ref/$dynamicRef/title`,
          },
        ]);
    });
});

it("keeps reference-object kinds separate even with the same initial target", () => {
  const shared = "https://dynamic.test/pair",
    initial = "https://dynamic.test/initial";
  const c = compile(
    { $id: uri, $defs: { n: { $dynamicAnchor: "n", title: "outer" } }, $ref: shared },
    [
      { $id: shared, $ref: `${initial}#n`, $dynamicRef: `${initial}#n` },
      { $id: initial, $dynamicAnchor: "n", title: "initial" },
    ],
  );
  if (c.kind !== "compiled") throw new Error(c.reason);
  const r = c.evaluateUtf8(bytes(null));
  if (r.kind !== "evaluated") throw new Error(r.reason);
  expect(r.valid).toBe(true);
  expect(r.annotations).toEqual([
    {
      keyword: "title",
      value: "initial",
      schemaLocation: `${initial}#/title`,
      instanceLocation: "",
      validationPath: "/$ref/$ref/title",
    },
    {
      keyword: "title",
      value: "outer",
      schemaLocation: `${uri}#/%24defs/n/title`,
      instanceLocation: "",
      validationPath: "/$ref/$dynamicRef/title",
    },
  ]);
});
it("binding original node zero creates a cycle instead of falling back to a different leaf", () => {
  expect(
    compile({ $id: uri, $dynamicAnchor: "n", $ref: S }, [
      { $id: S, $defs: { n: { $dynamicAnchor: "n" } }, $dynamicRef: "#n" },
    ]),
  ).toMatchObject({ kind: "refused", phase: "compile", reason: "nonqualified-cycle" });
});
it("qualifies a cross-resource productive loop and rejects its invalid leaf", () => {
  const c = compile(
    { $id: uri, $dynamicAnchor: "n", type: "object", properties: { x: { $ref: S } } },
    [{ $id: S, $defs: { n: { $dynamicAnchor: "n" } }, $dynamicRef: "#n" }],
  );
  if (c.kind !== "compiled") throw new Error(c.reason);
  expect(c.evaluateUtf8(bytes({ x: {} }))).toMatchObject({ kind: "evaluated", valid: true });
  expect(c.evaluateUtf8(bytes({ x: 1 }))).toMatchObject({ kind: "evaluated", valid: false });
});
it("retains propertyNames in the conservative proof", () => {
  expect(compile({ $dynamicAnchor: "n", propertyNames: { $dynamicRef: "#n" } })).toMatchObject({
    kind: "refused",
    reason: "nonqualified-cycle",
  });
});
it("does not activate for a reserved dynamic reference and preserves static counters", () => {
  expect(evaluate({ $defs: { unused: { $dynamicAnchor: "n", $dynamicRef: "#n" } } }, 1)).toEqual(
    evaluate({ $defs: { unused: true } }, 1),
  );
});
it("converges equivalent contexts reached in opposite resource order", () => {
  const f: Fixture = {
    nodes: [
      node(0, 0, { allOf: [] }),
      node(1, 1, { $ref: "x" }),
      node(2, 2, { $ref: "x" }),
      node(3, 2, { $ref: "x" }),
      node(4, 1, { $ref: "x" }),
      node(5, 3, { $dynamicRef: "#n" }),
      node(6, 1, { $dynamicAnchor: "n" }),
      node(7, 2, { $dynamicAnchor: "u" }),
    ],
    resources: [
      resource(0, 0, {}),
      resource(1, 1, { n: 6 }),
      resource(2, 2, { u: 7 }),
      resource(3, 5, {}),
    ],
    children: new Map(),
    refs: new Map(),
  };
  child(f, 0, 1, "allOf");
  child(f, 0, 2, "allOf");
  reference(f, 1, 3);
  reference(f, 2, 4);
  reference(f, 3, 5);
  reference(f, 4, 5);
  reference(f, 5, 6, true);
  const no = () => undefined,
    b = new EvaluationBudget(EVALUATOR_CEILINGS);
  const r = qualifyDynamicRecursion(f.nodes, f.resources, 0, f.children, f.refs, b, no, no);
  expect(r.states.filter((s) => s.node === 5)).toHaveLength(1);
  const targets = r.states
    .filter((s) => s.node === 3 || s.node === 4)
    .flatMap((s) => [...s.refs.values()]);
  expect(targets).toHaveLength(2);
  expect(targets[0]).toBe(targets[1]);
});
it("enters the actual resource for a nonzero original entry", () => {
  const f = fixture(1);
  f.nodes[0] = node(0, 0, {});
  f.nodes[1] = node(1, 0, { $dynamicRef: "#n" });
  f.nodes.push(node(2, 0, { $dynamicAnchor: "n" }));
  f.resources = [resource(0, 0, { n: 2 })];
  f.refs.clear();
  f.children.clear();
  reference(f, 1, 2, true);
  const no = () => undefined,
    b = new EvaluationBudget(EVALUATOR_CEILINGS);
  const r = qualifyDynamicRecursion(f.nodes, f.resources, 1, f.children, f.refs, b, no, no);
  expect(r.entry).toBe(0);
  expect(r.states[0]?.node).toBe(1);
  expect(r.states[1]?.node).toBe(2);
});

const rootControls = [
  {
    name: "branch-context-ab-int",
    documents: [
      {
        $id: "https://dynamic.test/root",
        anyOf: [
          {
            $ref: "https://dynamic.test/a",
          },
          {
            $ref: "https://dynamic.test/b",
          },
        ],
      },
      {
        $id: "https://dynamic.test/a",
        $defs: {
          override: {
            $dynamicAnchor: "n",
            type: "number",
            title: "number branch",
          },
        },
        $ref: "https://dynamic.test/shared",
      },
      {
        $id: "https://dynamic.test/b",
        $defs: {
          override: {
            $dynamicAnchor: "n",
            type: "string",
            title: "string branch",
          },
        },
        $ref: "https://dynamic.test/shared",
      },
      {
        $id: "https://dynamic.test/shared",
        $defs: {
          fallback: {
            $dynamicAnchor: "n",
            type: "null",
          },
        },
        $dynamicRef: "#n",
      },
    ],
    instance: 1,
    valid: true,
    annotations: [
      {
        keyword: "title",
        value: "number branch",
        schemaLocation: "https://dynamic.test/a#/%24defs/override/title",
        instanceLocation: "",
        validationPath: "/anyOf/0/$ref/$ref/$dynamicRef/title",
      },
    ],
  },
  {
    name: "branch-context-ab-str",
    documents: [
      {
        $id: "https://dynamic.test/root",
        anyOf: [
          {
            $ref: "https://dynamic.test/a",
          },
          {
            $ref: "https://dynamic.test/b",
          },
        ],
      },
      {
        $id: "https://dynamic.test/a",
        $defs: {
          override: {
            $dynamicAnchor: "n",
            type: "number",
            title: "number branch",
          },
        },
        $ref: "https://dynamic.test/shared",
      },
      {
        $id: "https://dynamic.test/b",
        $defs: {
          override: {
            $dynamicAnchor: "n",
            type: "string",
            title: "string branch",
          },
        },
        $ref: "https://dynamic.test/shared",
      },
      {
        $id: "https://dynamic.test/shared",
        $defs: {
          fallback: {
            $dynamicAnchor: "n",
            type: "null",
          },
        },
        $dynamicRef: "#n",
      },
    ],
    instance: "x",
    valid: true,
    annotations: [
      {
        keyword: "title",
        value: "string branch",
        schemaLocation: "https://dynamic.test/b#/%24defs/override/title",
        instanceLocation: "",
        validationPath: "/anyOf/1/$ref/$ref/$dynamicRef/title",
      },
    ],
  },
  {
    name: "branch-context-ab-NoneType",
    documents: [
      {
        $id: "https://dynamic.test/root",
        anyOf: [
          {
            $ref: "https://dynamic.test/a",
          },
          {
            $ref: "https://dynamic.test/b",
          },
        ],
      },
      {
        $id: "https://dynamic.test/a",
        $defs: {
          override: {
            $dynamicAnchor: "n",
            type: "number",
            title: "number branch",
          },
        },
        $ref: "https://dynamic.test/shared",
      },
      {
        $id: "https://dynamic.test/b",
        $defs: {
          override: {
            $dynamicAnchor: "n",
            type: "string",
            title: "string branch",
          },
        },
        $ref: "https://dynamic.test/shared",
      },
      {
        $id: "https://dynamic.test/shared",
        $defs: {
          fallback: {
            $dynamicAnchor: "n",
            type: "null",
          },
        },
        $dynamicRef: "#n",
      },
    ],
    instance: null,
    valid: false,
    annotations: [],
  },
  {
    name: "branch-context-ba-int",
    documents: [
      {
        $id: "https://dynamic.test/root",
        anyOf: [
          {
            $ref: "https://dynamic.test/b",
          },
          {
            $ref: "https://dynamic.test/a",
          },
        ],
      },
      {
        $id: "https://dynamic.test/a",
        $defs: {
          override: {
            $dynamicAnchor: "n",
            type: "number",
            title: "number branch",
          },
        },
        $ref: "https://dynamic.test/shared",
      },
      {
        $id: "https://dynamic.test/b",
        $defs: {
          override: {
            $dynamicAnchor: "n",
            type: "string",
            title: "string branch",
          },
        },
        $ref: "https://dynamic.test/shared",
      },
      {
        $id: "https://dynamic.test/shared",
        $defs: {
          fallback: {
            $dynamicAnchor: "n",
            type: "null",
          },
        },
        $dynamicRef: "#n",
      },
    ],
    instance: 1,
    valid: true,
    annotations: [
      {
        keyword: "title",
        value: "number branch",
        schemaLocation: "https://dynamic.test/a#/%24defs/override/title",
        instanceLocation: "",
        validationPath: "/anyOf/1/$ref/$ref/$dynamicRef/title",
      },
    ],
  },
  {
    name: "branch-context-ba-str",
    documents: [
      {
        $id: "https://dynamic.test/root",
        anyOf: [
          {
            $ref: "https://dynamic.test/b",
          },
          {
            $ref: "https://dynamic.test/a",
          },
        ],
      },
      {
        $id: "https://dynamic.test/a",
        $defs: {
          override: {
            $dynamicAnchor: "n",
            type: "number",
            title: "number branch",
          },
        },
        $ref: "https://dynamic.test/shared",
      },
      {
        $id: "https://dynamic.test/b",
        $defs: {
          override: {
            $dynamicAnchor: "n",
            type: "string",
            title: "string branch",
          },
        },
        $ref: "https://dynamic.test/shared",
      },
      {
        $id: "https://dynamic.test/shared",
        $defs: {
          fallback: {
            $dynamicAnchor: "n",
            type: "null",
          },
        },
        $dynamicRef: "#n",
      },
    ],
    instance: "x",
    valid: true,
    annotations: [
      {
        keyword: "title",
        value: "string branch",
        schemaLocation: "https://dynamic.test/b#/%24defs/override/title",
        instanceLocation: "",
        validationPath: "/anyOf/0/$ref/$ref/$dynamicRef/title",
      },
    ],
  },
  {
    name: "branch-context-ba-NoneType",
    documents: [
      {
        $id: "https://dynamic.test/root",
        anyOf: [
          {
            $ref: "https://dynamic.test/b",
          },
          {
            $ref: "https://dynamic.test/a",
          },
        ],
      },
      {
        $id: "https://dynamic.test/a",
        $defs: {
          override: {
            $dynamicAnchor: "n",
            type: "number",
            title: "number branch",
          },
        },
        $ref: "https://dynamic.test/shared",
      },
      {
        $id: "https://dynamic.test/b",
        $defs: {
          override: {
            $dynamicAnchor: "n",
            type: "string",
            title: "string branch",
          },
        },
        $ref: "https://dynamic.test/shared",
      },
      {
        $id: "https://dynamic.test/shared",
        $defs: {
          fallback: {
            $dynamicAnchor: "n",
            type: "null",
          },
        },
        $dynamicRef: "#n",
      },
    ],
    instance: null,
    valid: false,
    annotations: [],
  },
];
for (const row of rootControls)
  it(`root memo discriminator ${row.name}`, () => {
    const c = compile(row.documents[0], row.documents.slice(1));
    if (c.kind !== "compiled") throw new Error(c.reason);
    const first = c.evaluateUtf8(bytes(row.instance));
    expect(first).toMatchObject({
      kind: "evaluated",
      valid: row.valid,
      annotations: row.annotations,
    });
    for (const value of [null, "x", 1]) c.evaluateUtf8(bytes(value));
    expect(c.evaluateUtf8(bytes(row.instance))).toEqual(first);
  });

it("memo reuse retains separate occurrences and bounded complete output", () => {
  const schema = {
    $id: uri,
    $defs: { n: { $dynamicAnchor: "n", title: "again" } },
    allOf: [{ $ref: S }, { $ref: S }],
  };
  const documents = [{ $id: S, $dynamicRef: `${uri}#n` }];
  const c = compile(schema, documents);
  if (c.kind !== "compiled") throw new Error(c.reason);
  const r = c.evaluateUtf8(bytes(null));
  if (r.kind !== "evaluated") throw new Error(r.reason);
  // Source-derived call graph: root + two wrappers + one shared + one leaf;
  // projection duplicates the shared/leaf path: 1 + 2*(wrapper+shared+leaf).
  expect(r.counters).toMatchObject({ states: 5, occurrences: 7 });
  expect(r.annotations.map((a) => a.validationPath)).toEqual([
    "/allOf/1/$ref/$dynamicRef/title",
    "/allOf/0/$ref/$dynamicRef/title",
  ]);
  expect(c.evaluateUtf8(bytes(null))).toEqual(r);
  for (const [key, limit] of [
    ["occurrences", 6],
    ["annotations", 1],
  ] as const) {
    const bounded = compile(schema, documents, { ...EVALUATOR_CEILINGS, [key]: limit });
    if (bounded.kind !== "compiled") throw new Error(bounded.reason);
    expect(bounded.evaluateUtf8(bytes(null))).toMatchObject({
      kind: "refused",
      phase: "instance",
      reason: `limit-${key}`,
    });
  }
});
for (const reverse of [false, true])
  for (const array of [false, true])
    it(`context-specific coverage array=${array} reverse=${reverse}`, () => {
      const B = "https://dynamic.test/b";
      const branches = [{ $ref: A }, { $ref: B }];
      if (reverse) branches.reverse();
      const selected = (good: boolean) =>
        array
          ? { prefixItems: [good], title: good ? "good" : "bad" }
          : { properties: { x: good }, title: good ? "good" : "bad" };
      const schema = {
        anyOf: branches,
        ...(array ? { unevaluatedItems: false } : { unevaluatedProperties: false }),
      };
      const docs = [
        { $id: A, $defs: { n: { $dynamicAnchor: "n", ...selected(true) } }, $ref: S },
        { $id: B, $defs: { n: { $dynamicAnchor: "n", ...selected(false) } }, $ref: S },
        { $id: S, $defs: { n: { $dynamicAnchor: "n", const: null } }, $dynamicRef: "#n" },
      ];
      const c = compile(schema, docs);
      if (c.kind !== "compiled") throw new Error(c.reason);
      const good = c.evaluateUtf8(bytes(array ? [1] : { x: 1 }));
      if (good.kind !== "evaluated") throw new Error(good.reason);
      expect(good.valid).toBe(true);
      expect(good.annotations.filter((a) => a.keyword === "title").map((a) => a.value)).toEqual([
        "good",
      ]);
      expect(c.evaluateUtf8(bytes(array ? [1, 2] : { x: 1, y: 2 }))).toMatchObject({
        kind: "evaluated",
        valid: false,
        annotations: [],
      });
    });
it("does not import a second binding from a bypassed initial resource", () => {
  const B = "https://dynamic.test/bypassed",
    C = "https://dynamic.test/correct";
  const c = compile(
    { $id: uri, $defs: { n: { $dynamicAnchor: "n", $dynamicRef: `${C}#m` } }, $ref: S },
    [
      { $id: S, $dynamicRef: `${B}#n` },
      { $id: B, $dynamicAnchor: "n", $defs: { m: { $dynamicAnchor: "m", const: 0 } } },
      { $id: C, $dynamicAnchor: "m", const: 1 },
    ],
  );
  if (c.kind !== "compiled") throw new Error(c.reason);
  expect(c.evaluateUtf8(bytes(1))).toMatchObject({ kind: "evaluated", valid: true });
  expect(c.evaluateUtf8(bytes(0))).toMatchObject({ kind: "evaluated", valid: false });
});
it("refuses zero work before any unbudgeted dynamic path", () => {
  expect(
    compile({ $dynamicAnchor: "n", $dynamicRef: "#n" }, [], { ...EVALUATOR_CEILINGS, work: 0 }),
  ).toMatchObject({ kind: "refused", phase: "compile", reason: "limit-work" });
});
it("fresh expanded-state ceiling distinguishes13 specialized states from12 original nodes", () => {
  const f = fixture(6),
    no = () => undefined;
  const invoke = (states: number) =>
    qualifyDynamicRecursion(
      f.nodes,
      f.resources,
      0,
      f.children,
      f.refs,
      new EvaluationBudget({ ...EVALUATOR_CEILINGS, states }),
      no,
      no,
    );
  expect(invoke(13).states).toHaveLength(13);
  expect(() => invoke(12)).toThrow("limit-states");
});

it("decorative names preserve public validity while intentionally splitting contexts", () => {
  const B = "https://dynamic.test/b";
  const c = compile(
    {
      $id: uri,
      $defs: { n: { $dynamicAnchor: "n", type: "string" } },
      allOf: [{ $ref: A }, { $ref: B }],
    },
    [
      { $id: A, $defs: { u: { $dynamicAnchor: "u" } }, $ref: S },
      { $id: B, $defs: { u: { $dynamicAnchor: "u" } }, $ref: S },
      { $id: S, $dynamicRef: `${uri}#n` },
    ],
  );
  if (c.kind !== "compiled") throw new Error(c.reason);
  expect(c.evaluateUtf8(bytes("ok"))).toMatchObject({ kind: "evaluated", valid: true });
  expect(c.evaluateUtf8(bytes(1))).toMatchObject({ kind: "evaluated", valid: false });
});
