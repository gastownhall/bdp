import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { describe, expect, it } from "vitest";

const addFormats = formatsPlugin.default;

const root = new URL("../../../", import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const schema = read("specs/profiles/core/bdp-v0.1.schema.json");
const old = read("specs/profiles/core/bdp-v0.schema.json");
const paper = read("fixtures/type-definition-read/candidate.json");
const discovery = read("fixtures/read-delivery/candidate.json").finite.find(
  (x: { id: string }) => x.id === "scope-descriptor",
).value.data;
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv, { mode: "full" });
ajv.addSchema(schema);
ajv.addSchema(old);
function valid(name: string, value: unknown, bundle = schema): boolean {
  const validate = ajv.getSchema(`${bundle.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`missing definition ${name}`);
  return Boolean(validate(value));
}

describe("shared exact-definition read artifact, without lookup/CLI execution", () => {
  it("strictly compiles the seven ported helpers and all candidate definitions offline", () => {
    for (const name of Object.keys(schema.$defs))
      expect(ajv.getSchema(`${schema.$id}#/$defs/${name}`)).toBeDefined();
    expect(Object.keys(paper.typesSource.port)).toHaveLength(7);
    // Source-check receipts bind the full delta, not a permanent bundle-size invariant.
  });

  it("validates the known detail while retaining unknown capability versions", () => {
    const capabilities = {
      [paper.capability]: { "1": paper.advertisementDetail, "2": { futureGrammar: true } },
    };
    expect(valid("readDiscovery", { ...discovery, capabilities })).toBe(true);
    expect(valid("readDiscovery", { ...discovery, capabilities }, old)).toBe(false);
    for (const detail of [
      {},
      { operation: "relative" },
      { ...paper.advertisementDetail, extra: 1 },
    ])
      expect(valid("capabilityAdvertisements", { [paper.capability]: { "1": detail } })).toBe(
        false,
      );
    expect(valid("capabilityAdvertisements", { [paper.capability]: { "2": {} } })).toBe(true);
  });

  it("distinguishes version dispatch from complete closed query admission", () => {
    const future = { capabilityVersion: "2", future: { syntax: true } };
    expect(valid("typeDefinitionReadSelection", future)).toBe(true);
    expect(valid("typeDefinitionReadQueryV1", future)).toBe(false);
    for (const selector of [{}, { capabilityVersion: "" }, { capabilityVersion: 1 }])
      expect(valid("typeDefinitionReadSelection", selector)).toBe(false);
    for (const entry of paper.queryCases)
      expect(valid("typeDefinitionReadQueryV1", entry.query), entry.id).toBe(entry.valid);
  });

  it("round-trips form-query tokens once without treating reserved literal tokens as instructions", () => {
    for (const entry of paper.queryEncodingCases) {
      expect(valid("typeDefinitionReadQueryV1", entry.query)).toBe(true);
      const encoded = new URLSearchParams(entry.query).toString();
      expect(Object.fromEntries(new URLSearchParams(encoded))).toEqual(entry.query);
    }
    const encoded = new URLSearchParams({ revision: "r+1" }).toString();
    expect(encoded).toBe("revision=r%2B1");
    expect(new URLSearchParams("revision=r+1").get("revision")).toBe("r 1");
    const repeated = new URLSearchParams("capabilityVersion=1&capabilityVersion=1");
    expect(repeated.getAll("capabilityVersion")).toHaveLength(2);
    // Scalar JSON grammar cannot enforce once-only HTTP members; dispatch must reject them.
  });

  it("preserves the complete literal definition and original Refines endpoint spelling", () => {
    expect(valid("typeDefinitionReadResult", paper.response)).toBe(true);
    expect(paper.response.definition.id).toBe(paper.queryCases[0].query.uri);
    expect(paper.response.definition.revision).toBe(paper.queryCases[0].query.revision);
    const declarations = Object.values(paper.response.definition.ownedLinks).flat();
    const declaration = declarations[0];
    if (typeof declaration !== "object" || declaration === null || !("source" in declaration))
      throw new Error("fixture requires a Refines declaration with a source");
    expect(declaration.source).toBe(paper.response.definition.id);
    expect(paper.response.definition).not.toHaveProperty("metadata");
    expect(paper.response.definition).not.toHaveProperty("revisionProvenance");
  });

  it("requires exact definition and captured Link affiliations and an explicit owned plane", () => {
    let value = structuredClone(paper.response);
    value.definition.type = value.definition.type.uri;
    expect(valid("typeDefinitionReadResult", value)).toBe(false);
    value = structuredClone(paper.response);
    delete value.definition.ownedLinks;
    expect(valid("typeDefinitionReadResult", value)).toBe(false);
    value = structuredClone(paper.response);
    const entry = Object.values(value.definition.ownedLinks).flat()[0] as {
      type: { uri: string } | string;
    };
    if (typeof entry.type !== "object") throw new Error("expected pinned fixture");
    entry.type = entry.type.uri;
    expect(valid("typeDefinitionReadResult", value)).toBe(false);
  });

  it("keeps wrapper/origin context distinct from a Resource or paginated aggregate", () => {
    const value = structuredClone(paper.response);
    expect(valid("beadRecord", value)).toBe(false);
    expect(valid("typeDefinitionReadResult", value.definition)).toBe(false);
    expect(valid("typeDefinitionReadResult", { definition: value.definition })).toBe(true);
    expect(valid("typeDefinitionReadResult", { ...value, originScope: "relative" })).toBe(false);
    expect(valid("typeDefinitionReadResult", { ...value, next: null })).toBe(false);
    value.definition.links = { items: [], next: null };
    expect(valid("typeDefinitionReadResult", value)).toBe(false);
    // Shape cannot establish actual original authority or complete Type-category semantics.
  });

  it("uses a feature-specific query refusal rather than an atomic body pointer", () => {
    const problem = paper.unknownVersionProblem;
    expect(valid("typeDefinitionReadCapabilityProblem", problem)).toBe(true);
    expect(valid("typeDefinitionReadProblem", problem)).toBe(true);
    expect(valid("atomicBatchCapabilityProblem", problem)).toBe(false);
    expect(valid("readProblem", problem)).toBe(false);
    expect(
      valid("typeDefinitionReadCapabilityProblem", {
        ...problem,
        capability: "https://github.com/gastownhall/bdp/capabilities/atomic-batch",
      }),
    ).toBe(false);
    const body = { ...problem, pointer: "/capabilityVersion" };
    delete body.parameter;
    expect(valid("typeDefinitionReadCapabilityProblem", body)).toBe(false);
  });

  it("reuses only the bounded Unretained shape from the History diagnosis vocabulary", () => {
    expect(valid("typeDefinitionReadProblem", paper.unretainedProblem)).toBe(true);
    const missing = structuredClone(paper.unretainedProblem);
    delete missing.missing;
    expect(valid("typeDefinitionReadProblem", missing)).toBe(false);
    for (const [code, family, status] of [
      ["revision-unknown", "not-found", 404],
      ["revision-reorganized", "gone", 410],
      ["revision-not-tracked", "conflict", 409],
      ["revision-unrepresentable", "conflict", 409],
    ] as const) {
      const value = {
        type: `https://github.com/gastownhall/bdp/problems/${family}`,
        code,
        status,
        retry: "after-state-change",
      };
      expect(valid("readProblem", value), code).toBe(true);
      expect(valid("typeDefinitionReadProblem", value), code).toBe(false);
    }
  });

  it("retains missing-state diagnostic bounds without making them a Type family maximum", () => {
    const missing = { ...paper.unretainedProblem.missing, items: [], complete: false };
    expect(valid("typeDefinitionReadProblem", { ...paper.unretainedProblem, missing })).toBe(true);
    missing.complete = true;
    expect(valid("typeDefinitionReadProblem", { ...paper.unretainedProblem, missing })).toBe(false);
    const items = Array.from({ length: 65 }, (_, i) => ({
      kind: "property",
      pointer: `/properties/p${i}`,
    }));
    expect(
      valid("typeDefinitionReadProblem", {
        ...paper.unretainedProblem,
        missing: { items, complete: false },
      }),
    ).toBe(false);
  });

  it("retains exact original source pins and records unexecuted service expectations", () => {
    expect(paper.typesSource.commit).toBe("8fc7ce901f747587d352091d7110050059d3dc49");
    expect(paper.commonSource.commit).toBe("ad6ddd45f4fb35742fbc60be84b0eb6f3b0fd9c1");
    expect(paper.commonSource.sha256).toBe(
      "d9c9822c8abdaae907a966ef076f945043116adb52b94c9c1c71dbaa8c8adf09",
    );
    expect(paper.semanticCases).toHaveLength(6);
    // No service, authentication, bounds, retention or closure-traversal execution is asserted.
  });
});
