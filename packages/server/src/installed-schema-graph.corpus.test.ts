import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { decodeJsonDocument, type LosslessJsonValue } from "@bdp/protocol";
import { describe, expect, it } from "vitest";
import { schemaSpans } from "../test-support/schema-graph-spans.js";
import {
  CONTRACT_ARTIFACT_CEILINGS,
  type ContractArtifactInput,
} from "./installed-contract-artifact.js";
import { schemaGraphStructure } from "../test-support/schema-graph-structure.js";
import {
  buildInstalledSchemaGraph,
  formatSchemaPointer,
  SCHEMA_GRAPH_POLICY,
} from "./installed-schema-graph.js";
import {
  GraphBudget,
  isSchemaObject,
  SCHEMA_GRAPH_CEILINGS,
  SchemaGraphError,
  visitSchemaChildren,
} from "./installed-schema-shape.js";
import { resolveSchemaUri } from "./installed-schema-uri.js";

const root = new URL("../test-support/schema-graph-corpus/", import.meta.url);
interface Manifest {
  files: { path: string; sha256: string }[];
  groups: {
    file: string;
    group: number;
    schemaPointer: string;
    caseCount: number;
    graphDisposition: string;
    reason: string;
  }[];
  cases: {
    file: string;
    group: number;
    case: number;
    officialValid: boolean;
    validationDisposition: string;
  }[];
}
const manifest: Manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
const spanPins: {
  spans: {
    file: string;
    group: number;
    schemaPointer: string;
    byteStart: number;
    byteEnd: number;
    sha256: string;
  }[];
} = JSON.parse(readFileSync(new URL("schema-spans.json", root), "utf8"));
const structurePins: {
  groups: ({ file: string; group: number } & ReturnType<typeof schemaGraphStructure>)[];
} = JSON.parse(
  readFileSync(new URL("../test-support/schema-graph-structures.json", import.meta.url), "utf8"),
);
const refusalPins: {
  groups: {
    file: string;
    group: number;
    code: string;
    privateBasis: string;
    schemaValidity: string;
    instanceEvaluation: string;
  }[];
} = JSON.parse(
  readFileSync(new URL("../test-support/schema-graph-refusal-basis.json", import.meta.url), "utf8"),
);
const refusals = new Map(refusalPins.groups.map((g) => [`${g.file}:${g.group}`, g]));
const structures = new Map(structurePins.groups.map((g) => [`${g.file}:${g.group}`, g]));
const fileText = new Map<string, string>();
for (const file of manifest.files) {
  const bytes = readFileSync(new URL(file.path, root));
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
    throw new Error(`changed corpus file ${file.path}`);
  fileText.set(file.path, bytes.toString("utf8"));
}
const spans = new Map(
  [...fileText]
    .filter(([name]) => name.startsWith("tests/"))
    .map(([name, text]) => [name, schemaSpans(text)]),
);
const remote = new Map(
  [...fileText]
    .filter(([name]) => name.startsWith("remotes/"))
    .map(([name, text]) => [`http://localhost:1234/${name.slice(8)}`, text]),
);
/** Test-only explicit closure assembly; no loader exists in the production builder. */
function bundle(text: string): ContractArtifactInput[] {
  const uri = "https://corpus.test/root";
  const rows = new Map([[uri, text]]);
  const queue = [{ uri, text }];
  const known = new Set<string>();
  const refs: string[] = [];
  for (let next = 0; next < queue.length; next++) {
    const doc = queue[next];
    if (!doc) throw new Error("corpus queue");
    known.add(doc.uri);
    const budget = new GraphBudget(SCHEMA_GRAPH_CEILINGS);
    const pending = [{ value: decodeJsonDocument(doc.text), base: doc.uri }];
    while (pending.length) {
      const current = pending.pop();
      if (!current) throw new Error("corpus frame");
      if (!isSchemaObject(current.value)) continue;
      let base = current.base;
      if (typeof current.value.$id === "string")
        base = resolveSchemaUri(base, current.value.$id, budget).resource;
      known.add(base);
      for (const k of ["$ref", "$dynamicRef"] as const)
        if (typeof current.value[k] === "string")
          refs.push(resolveSchemaUri(base, current.value[k], budget).resource);
      // Unsupported schema positions still need their original planned refusal,
      // not an attempted execution or custom dialect substitution.
      try {
        visitSchemaChildren(current.value, budget, (c) =>
          pending.push({ value: c.value as LosslessJsonValue, base }),
        );
      } catch (e) {
        if (!(e instanceof SchemaGraphError) || !e.code.startsWith("unsupported-")) throw e;
      }
    }
    for (const ref of refs)
      if (!known.has(ref) && !rows.has(ref)) {
        const body = remote.get(ref);
        if (body !== undefined) {
          rows.set(ref, body);
          queue.push({ uri: ref, text: body });
        }
      }
  }
  return [...rows].map(([retrievalUri, text]) => ({ retrievalUri, utf8Bytes: Buffer.from(text) }));
}
describe("pinned official graph inputs (instance outcomes remain deferred)", () => {
  it("accounts every original group/case and extracts exact byte spans", () => {
    expect(spanPins.spans).toHaveLength(462);
    expect(new Set(spanPins.spans.map((s) => `${s.file}:${s.group}`)).size).toBe(462);
    expect(manifest.groups).toHaveLength(462);
    expect(structures.size).toBe(444);
    expect(structurePins.groups).toHaveLength(444);
    expect(new Set(structures.keys())).toEqual(
      new Set(
        manifest.groups
          .filter((g) => g.graphDisposition === "planned-index-support")
          .map((g) => `${g.file}:${g.group}`),
      ),
    );
    expect(refusalPins.groups).toHaveLength(18);
    expect(refusals.size).toBe(18);
    expect(new Set(refusals.keys())).toEqual(
      new Set(
        manifest.groups
          .filter((g) => g.graphDisposition !== "planned-index-support")
          .map((g) => `${g.file}:${g.group}`),
      ),
    );
    for (const refusal of refusalPins.groups) {
      expect(refusal.privateBasis.length).toBeGreaterThan(0);
      expect(refusal.schemaValidity).toBe("not-determined");
      expect(refusal.instanceEvaluation).toBe("not-executed");
    }
    expect(manifest.cases).toHaveLength(2322);
    expect(new Set(manifest.groups.map((g) => `${g.file}:${g.group}`)).size).toBe(462);
    expect(new Set(manifest.cases.map((g) => `${g.file}:${g.group}:${g.case}`)).size).toBe(2322);
    for (const [name, text] of fileText)
      if (name.startsWith("tests/")) {
        const lossless = decodeJsonDocument(text) as readonly {
          schema: LosslessJsonValue;
          tests: readonly { valid: boolean }[];
        }[];
        const extracted = spans.get(name);
        expect(extracted).toHaveLength(lossless.length);
        for (let i = 0; i < lossless.length; i++) {
          const span = extracted?.[i];
          if (!span) throw new Error("missing span");
          const pin = spanPins.spans.find((p) => p.file === name && p.group === i);
          if (!pin) throw new Error("missing span pin");
          expect(pin.schemaPointer).toBe(`/${i}/schema`);
          expect(Buffer.byteLength(text.slice(0, span.start))).toBe(pin.byteStart);
          expect(Buffer.byteLength(text.slice(0, span.end))).toBe(pin.byteEnd);
          const original = readFileSync(new URL(name, root)).subarray(pin.byteStart, pin.byteEnd);
          expect(Buffer.from(span.text)).toEqual(original);
          expect(createHash("sha256").update(original).digest("hex")).toBe(pin.sha256);
          expect(span.text).toBe(text.slice(span.start, span.end));
          expect(decodeJsonDocument(span.text)).toEqual(lossless[i]?.schema);
          const cases = manifest.cases.filter((c) => c.file === name && c.group === i);
          expect(cases).toHaveLength(lossless[i]?.tests.length ?? -1);
          for (const c of cases) {
            expect(c.officialValid).toBe(lossless[i]?.tests[c.case]?.valid);
            expect(c.validationDisposition).toBe("deferred-no-execution");
          }
        }
      }
    const sample = '[{"schema":{"const":9007199254740993,"x":"}\\"[","n":1e999999}}]';
    expect(schemaSpans(sample)[0]?.text).toBe(
      '{"const":9007199254740993,"x":"}\\"[","n":1e999999}',
    );
  });
  // Hand-read initial targets from all 21 main dynamicRef schema groups and
  // their three remote documents. Outer runtime target selection stays deferred.
  it.each([
    [0, "/$defs/foo", "dynamic-anchor", "items"],
    [1, "/$defs/foo", "static", ""],
    [2, "/$defs/foo", "static", ""],
    [3, "/$defs/list/$defs/items", "dynamic-anchor", "items"],
    [4, "/$defs/list/$defs/items", "static", ""],
    [5, "/$defs/list/$defs/items", "dynamic-anchor", "items"],
    [6, "/$defs/list/$defs/items", "dynamic-anchor", "items"],
    [7, "/$defs/list/$defs/items", "static", ""],
    [8, "/$defs/list/$defs/items", "static", ""],
    [9, "/$defs/extended", "dynamic-anchor", "meta"],
    [10, "/$defs/extended", "static", ""],
    [11, "/$defs/genericList/$defs/defaultItemType", "dynamic-anchor", "itemType"],
    [12, "/$defs/thingy", "dynamic-anchor", "thingy"],
    [13, "", "dynamic-anchor", "node"],
    [14, "/$defs/elements", "dynamic-anchor", "elements"],
    [15, "/$defs/elements", "dynamic-anchor", "elements"],
    [16, "/$defs/elements", "dynamic-anchor", "elements"],
    [17, "/$defs/detached", "dynamic-anchor", "detached"],
    [18, "/$defs/false|/$defs/true", "static", ""],
    [19, "/$defs/bar/$defs/item/$defs/defaultContent", "dynamic-anchor", "content"],
    [20, "/$defs/third/$defs/length", "dynamic-anchor", "length"],
  ] as const)("pins main dynamicRef group %i initial target", (group, targetPath, kind, anchor) => {
    const span = spans.get("tests/draft2020-12/dynamicRef.json")?.[group];
    if (!span) throw new Error("missing dynamic span");
    const g = buildInstalledSchemaGraph(
      { descriptors: [], schemas: bundle(span.text), limits: CONTRACT_ARTIFACT_CEILINGS },
      SCHEMA_GRAPH_CEILINGS,
    );
    const edges = g.references.filter(
      (r) =>
        !g.resources[g.nodes[r.node]?.resource ?? -1]?.artifact.startsWith(
          "https://json-schema.org/",
        ) && r.keyword === (group === 2 ? "$ref" : "$dynamicRef"),
    );
    const paths = edges.map((edge) => {
      const target = g.nodes[edge.target];
      if (!target) throw new Error("missing target");
      let root = target.documentPointer;
      let steps = 0;
      while (true) {
        const parent = g.pointers[root]?.parent;
        if (parent === undefined || ++steps > g.pointers.length)
          throw new Error("broken pointer chain");
        if (parent === null) break;
        root = parent;
      }
      expect(edge.kind).toBe(kind);
      expect(edge.anchor ?? "").toBe(anchor);
      expect(edge.fragmentKind).toBe(group === 4 || group === 18 ? "pointer" : "plain-name");
      if (kind === "dynamic-anchor") {
        const resource = g.resources[target.resource];
        expect(resource?.dynamicAnchors[anchor]).toBe(target.id);
        expect(edge.resolvedUri).toBe(`${resource?.canonicalUri}#${anchor}`);
      }
      return formatSchemaPointer(g.pointers, target.documentPointer, root, 2048);
    });
    expect(paths.sort().join("|")).toBe(targetPath);
    expect(g.receipt.deferred).toContain("dynamic-execution");
  });
  for (const group of manifest.groups) {
    it(`${group.file} group ${group.group}: ${group.graphDisposition}`, () => {
      const span = spans.get(group.file)?.[group.group];
      if (!span) throw new Error("missing schema bytes");
      const input = {
        descriptors: [],
        schemas: bundle(span.text),
        limits: CONTRACT_ARTIFACT_CEILINGS,
      };
      if (group.graphDisposition === "planned-index-support") {
        const graph = buildInstalledSchemaGraph(input, SCHEMA_GRAPH_CEILINGS);
        expect(graph.stage).toBe(SCHEMA_GRAPH_POLICY);
        // Implementation-derived structural regression, not independent validity.
        const expected = structures.get(`${group.file}:${group.group}`);
        if (!expected) throw new Error("missing structural regression lock");
        const { file: _file, group: _group, ...shape } = expected;
        expect(schemaGraphStructure(graph)).toEqual(shape);
        expect(graph.receipt.deferred).toContain("instance-evaluation");
      } else {
        const refusal = refusals.get(`${group.file}:${group.group}`);
        if (!refusal) throw new Error("missing private refusal basis");
        const code = refusal.code;
        // Both records describe private refusals, not upstream schema validity.
        const originalCode = group.reason.split(":", 1)[0];
        expect(code).toBe(
          originalCode === "unsupported-custom-dialect" ? "unsupported-dialect" : originalCode,
        );
        expect(() => buildInstalledSchemaGraph(input, SCHEMA_GRAPH_CEILINGS)).toThrow(
          `schema resource index refused: ${code}`,
        );
      }
    });
  }
});
