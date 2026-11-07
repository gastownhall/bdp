import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { describe, expect, it } from "vitest";
import { withBdpSourceAnnotations } from "./schema-source-annotations.js";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const common = read("specs/profiles/core/bdp-v0.1.schema.json");
const feature = read("specs/profiles/write/delete-modes-v1.schema.json");
const paper = read("fixtures/delete-modes/candidate.json");
const ajv = withBdpSourceAnnotations(new Ajv2020({ strict: true, allErrors: true }));
formatsPlugin.default(ajv, { mode: "full" });
ajv.addSchema(common);
ajv.addSchema(feature);
const valid = (name: string, value: unknown, schema = feature): boolean => {
  const check = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  if (!check) throw new Error(`missing definition ${name}`);
  return Boolean(check(value));
};
// Schema and authored correspondence only. No walk, provider, Types engine, HTTP,
// CLI, transaction/concurrency executor or recovery implementation runs.
describe("fixed delete-modes1 separate Write artifact", () => {
  it("compiles every feature definition strictly with full formats", () => {
    for (const name of Object.keys(feature.$defs))
      expect(ajv.getSchema(`${feature.$id}#/$defs/${name}`), name).toBeDefined();
  });

  it("requires exact version1 advertisement with closed detail", () => {
    expect(valid("deleteModesCapabilityAdvertisement", paper.advertisement)).toBe(true);
    // The capability's detail is all optional: except is offered, not required, and nothing
    // about atomic batches is advertised here.
    for (const detail of [{}, { except: false }, { except: true }])
      expect(valid("deleteModesCapabilityV1", detail), JSON.stringify(detail)).toBe(true);
    for (const detail of [
      { atomicBatch: true },
      { atomicBatch: false, except: false },
      { except: true, maximumClosure: 0 },
      { except: true, through: [] },
      { except: true, typeEffects: ["not-absolute"] },
      { except: true, typeEffects: ["https://types.invalid/a", "https://types.invalid/a"] },
    ])
      expect(valid("deleteModesCapabilityV1", detail), JSON.stringify(detail)).toBe(false);
    const unknown = { [paper.capability]: { "2": {} } };
    expect(valid("capabilityAdvertisements", unknown, common)).toBe(true);
    expect(valid("deleteModesCapabilityAdvertisement", unknown)).toBe(false);
  });

  it("leaves the common bundle closed: base grammar rejects every selector", () => {
    for (const { request } of [...paper.modes, ...paper.nativeSingleton]) {
      expect(valid("deleteModesRequest", request), JSON.stringify(request)).toBe(true);
      expect(valid("deleteBeadRequest", request, common), JSON.stringify(request)).toBe(false);
    }
    for (const definition of ["deleteBeadRequest", "deleteBeadOperation"])
      expect(common.$defs[definition].unevaluatedProperties).toBe(false);
    expect(common.$defs.batchRequest.additionalProperties).toBe(false);
    expect(Object.keys(common.$defs.deleteBeadMembers.properties).sort()).toEqual([
      "bead",
      "expectedRevision",
      "revisionProvenance",
    ]);
  });

  it("selects by presence: a request with no selector is only the base arm", () => {
    for (const request of [
      { bead: "a" },
      { bead: "a", expectedRevision: "r7" },
      { bead: "a", revisionProvenance: {} },
    ]) {
      expect(valid("deleteBeadRequest", request, common), JSON.stringify(request)).toBe(true);
      expect(valid("deleteModesRequest", request), JSON.stringify(request)).toBe(false);
    }
  });

  it("takes exactly one of bead and beads, and refuses a guard beside beads", () => {
    for (const request of paper.refusedRequests)
      expect(valid("deleteModesRequest", request), JSON.stringify(request)).toBe(false);
    expect(valid("deleteModesRequest", { beads: ["a"] })).toBe(true);
    expect(valid("deleteModesRequest", { bead: "a", expectedRevision: "r7", dryRun: true })).toBe(
      true,
    );
    expect(valid("deleteBeadRequest", { beads: ["a"] }, common)).toBe(false);
  });

  it("closes the request members and their nested carriers", () => {
    const test = { type: "https://types.invalid/parent-child", match: "exact" };
    const through = [test];
    for (const request of [
      { bead: "a", cascade: { through } },
      { bead: "a", cascade: { through: [{ ...test, match: "family" }] } },
      { bead: "a", cascade: { through: [test, { ...test, type: "https://types.invalid/other" }] } },
      { bead: "a", cascade: { through, except: { bind: "b", predicate: true } } },
      { bead: "a", revisionProvenance: {}, blockedBy: "any" },
    ])
      expect(valid("deleteModesRequest", request), JSON.stringify(request)).toBe(true);
    for (const request of [
      { bead: "a", blockedBy: "outbound" },
      { bead: "a", blockedBy: "none", force: true },
      { bead: "a", cascade: {} },
      { bead: "a", cascade: true },
      { bead: "a", cascade: { through: test } },
      { bead: "a", cascade: { through: [] } },
      { bead: "a", cascade: { through: [test, test] } },
      { bead: "a", cascade: { through: [{ type: test.type }] } },
      { bead: "a", cascade: { through: [{ ...test, match: "subtype" }] } },
      { bead: "a", cascade: { through: [{ ...test, revision: "r1" }] } },
      { bead: "a", cascade: { through: [{ type: "not-absolute", match: "exact" }] } },
      { bead: "a", cascade: { through, depth: 2 } },
      { bead: "a", cascade: { through, except: { predicate: true } } },
      { bead: "a", cascade: { through, except: { bind: "1b", predicate: true } } },
      { bead: "a", cascade: { through, except: { bind: "b", predicate: "x" } } },
      { bead: "@name", blockedBy: "any" },
      { bead: "a", dryRun: "yes" },
    ])
      expect(valid("deleteModesRequest", request), JSON.stringify(request)).toBe(false);
  });

  it("represents every native single and multi-ID request with no batch capability", () => {
    for (const { native, request } of [...paper.nativeSingleton, ...paper.nativeMulti]) {
      expect(valid("deleteModesRequest", request), JSON.stringify(native)).toBe(true);
      expect(request.dryRun === true).toBe(native.dry_run === true);
      expect(request.blockedBy).toBe(native.cascade || native.force ? "none" : "inbound");
      expect(request.cascade !== undefined).toBe(native.cascade === true);
      expect(request.beads ?? [request.bead]).toEqual(native.ids);
      expect(request.expectedRevision !== undefined).toBe(native.expected_version !== undefined);
    }
    expect(paper.nativeMulti.length).toBeGreaterThan(0);
  });

  it("adds nothing to atomic batches: every selector stays outside the closed batch grammar", () => {
    const batch = (member: object) => ({
      capabilityVersion: "1",
      operations: [{ operation: "deleteBead", bead: "a", ...member }],
    });
    expect(valid("batchRequest", batch({}), common)).toBe(true);
    for (const member of [
      { blockedBy: "none" },
      { cascade: { through: [{ type: "https://types.invalid/parent-child", match: "exact" }] } },
      { dryRun: true },
      { beads: ["b"] },
    ])
      expect(valid("batchRequest", batch(member), common), JSON.stringify(member)).toBe(false);
    for (const name of ["deleteModesBatchRequest", "deleteModesBatchProblem"])
      expect(feature.$defs[name], name).toBeUndefined();
  });

  it("reuses the common rows in a committed result and adds removed Link endpoints", () => {
    expect(valid("deleteModesResult", paper.result)).toBe(true);
    const items = feature.$defs.deleteModesResult.properties;
    expect(items.resources.items.$ref).toBe(`${common.$id}#/$defs/atomicBatchResourceResult`);
    expect(items.results.items.$ref).toBe(`${common.$id}#/$defs/atomicBatchResultEntry`);
    const { removedLinks: _removed, ...plain } = paper.result;
    expect(valid("atomicBatchResult", plain, common)).toBe(true);
    expect(valid("deleteModesResult", plain)).toBe(false);
    expect(valid("mutationResult", paper.result, common)).toBe(false);
    const { transaction: _transaction, ...untransacted } = paper.result;
    expect(valid("deleteModesResult", untransacted)).toBe(false);
    expect(valid("deleteModesResult", { ...paper.result, changed: false })).toBe(false);
  });

  it("keeps a preview distinct from every committed result", () => {
    expect(valid("deleteModesPreview", paper.preview)).toBe(true);
    expect(valid("deleteModesResult", paper.preview)).toBe(false);
    expect(valid("deleteModesPreview", paper.result)).toBe(false);
    for (const changed of [
      { ...paper.preview, transaction: "t1" },
      { ...paper.preview, changed: true },
      { ...paper.preview, dryRun: false },
    ])
      expect(valid("deleteModesPreview", changed)).toBe(false);
    const updated = paper.preview.resources[1];
    expect(valid("deleteModesPreviewRow", updated)).toBe(true);
    expect(valid("deleteModesPreviewRow", { ...updated, revision: undefined })).toBe(false);
    expect(valid("deleteModesPreviewRow", { ...updated, resource: {} })).toBe(false);
    expect(valid("deleteModesPreviewRow", { ...updated, outcome: "created" })).toBe(false);
    expect(updated.proposed).toBeDefined();
    expect(valid("deleteModesPreviewRow", { ...updated, proposed: {} })).toBe(false);
    expect(valid("deleteModesPreviewRow", { ...updated, proposed: { type: "x" } })).toBe(false);
    const { proposed: _proposed, ...ownerOnly } = updated;
    expect(valid("deleteModesPreviewRow", ownerOnly)).toBe(true);
    expect(
      valid("deleteModesPreviewRow", { ...paper.preview.resources[0], proposed: { metadata: {} } }),
    ).toBe(false);
  });

  it("states semantic outcomes only in existing Problem codes or the feature's own", () => {
    const codes = new Set([
      ...common.$defs.readUpdateProblemCode.enum,
      feature.$defs.deleteModesCapabilityProblem.properties.code.const,
    ]);
    const stated = paper.semanticCases.flatMap((entry: { code?: string }) =>
      entry.code === undefined ? [] : [entry.code],
    );
    expect(stated.length).toBeGreaterThan(0);
    for (const code of stated) expect(codes.has(code), code).toBe(true);
  });

  it("names the selecting member in its feature Problem", () => {
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/request",
      status: 422,
      code: "capability-not-supported",
      retry: "after-state-change",
      capability: paper.capability,
      capabilityVersion: "1",
    };
    for (const pointer of paper.capabilityProblems) {
      expect(valid("deleteModesCapabilityProblem", { ...problem, pointer }), pointer).toBe(true);
      expect(valid("deleteModesProblem", { ...problem, pointer }), pointer).toBe(true);
    }
    for (const pointer of paper.refusedPointers)
      expect(valid("deleteModesCapabilityProblem", { ...problem, pointer }), pointer).toBe(false);
    const ordinary = {
      type: "https://github.com/gastownhall/bdp/problems/conflict",
      status: 409,
      code: "incident-links-exist",
      retry: "after-state-change",
    };
    expect(valid("deleteModesProblem", ordinary)).toBe(true);
    expect(valid("readUpdateProblem", ordinary, common)).toBe(true);
  });
});
