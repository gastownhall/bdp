import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const schema = read("specs/profiles/core/bdp-v0.1.schema.json");
const paper = read("fixtures/resource-projection/candidate.json");
const ajv = new Ajv2020({ strict: true, allErrors: true });
formatsPlugin.default(ajv, { mode: "full" });
ajv.addSchema(schema);
function valid(name: string, value: unknown): boolean {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`missing artifact definition ${name}`);
  return Boolean(validate(value));
}
const clone = <T>(value: T): T => structuredClone(value);

// Static source obligations and paper/schema correspondence only. No projection
// evaluator, provider, CLI, HTTP request, permission check or concurrency runs.
describe("Resource projection artifacts without provider execution", () => {
  it("strictly compiles the complete selected candidate offline", () => {
    for (const name of Object.keys(schema.$defs))
      expect(ajv.getSchema(`${schema.$id}#/$defs/${name}`), name).toBeDefined();
    // Existing contract-binding tests own mirror equality and held-v0 hashes.
  });

  it("binds version-one capability flags with at least one supported surface", () => {
    expect(valid("capabilityAdvertisements", paper.advertisement)).toBe(true);
    for (const detail of [
      { current: true, exact: false, list: false },
      { current: false, exact: true, list: false },
      { current: false, exact: false, list: true },
    ])
      expect(valid("resourceProjectionCapabilityV1", detail)).toBe(true);
    for (const detail of [
      {},
      { current: true },
      { current: false, exact: false, list: false },
      { current: true, exact: true, list: "true" },
      { current: true, exact: true, list: true, implicit: true },
    ]) {
      expect(valid("resourceProjectionCapabilityV1", detail)).toBe(false);
      expect(valid("capabilityAdvertisements", { [paper.capability]: { "1": detail } })).toBe(
        false,
      );
    }
    expect(valid("capabilityAdvertisements", { [paper.capability]: { "2": {} } })).toBe(true);
  });

  it("pairs current point and ordinary inventory content for every authored mask", () => {
    for (const p of paper.pairs) {
      expect(valid("resourceProjectionPointQueryV1", p.pointQuery), p.id).toBe(true);
      expect(valid("resourceProjectionInventoryQueryV1", p.inventoryQuery), p.id).toBe(true);
      expect(p.pointQuery).toEqual(p.inventoryQuery);
      expect(valid("projectedBeadRecord", p.pointResource), p.id).toBe(true);
      expect(valid("projectedBeadCollection", p.inventoryPage), p.id).toBe(true);
      expect(p.inventoryPage.items).toEqual([p.pointResource]);
      for (const field of ["id", "type", "revision"])
        expect(p.pointResource[field]).toEqual(paper.current[field]);
      expect(p.pointResource).not.toHaveProperty("projection");
      expect(p.pointResource).not.toHaveProperty("projectionVersion");
    }
    const full = paper.pairs.find((p: { id: string }) => p.id === "full-without-fields");
    expect(full.pointQuery).not.toHaveProperty("fields");
    expect(full.pointResource).toEqual(paper.current);
    const nested = paper.pairs.find((p: { id: string }) => p.id === "nested-includes-and-omit");
    expect(nested.pointResource.properties.details).toEqual({ status: "open" });
    expect(nested.pointResource.metadata).toEqual({ nested: { visible: true } });
    const whole = paper.pairs.find(
      (p: { id: string }) => p.id === "whole-provenance-and-owned-state",
    );
    expect(whole.pointResource.revisionProvenance).toEqual(paper.current.revisionProvenance);
    expect(whole.pointResource.ownedLinks).toEqual(paper.current.ownedLinks);
  });

  it("distinguishes absent optional paths, present null and a context-only projection", () => {
    const absent = paper.pairs.find((p: { id: string }) => p.id === "all-includes-absent");
    expect(Object.keys(absent.pointResource).sort()).toEqual(["id", "revision", "type"]);
    expect(absent.pointResource).not.toHaveProperty("properties");
    expect(absent.pointResource).not.toEqual(paper.current);
    const nullable = paper.pairs.find((p: { id: string }) => p.id === "present-null-and-absent");
    expect(nullable.pointResource.properties).toEqual({ nullable: null });
    expect(nullable.pointResource.properties).not.toHaveProperty("missing");
    const omit = paper.pairs.find((p: { id: string }) => p.id === "absent-omission");
    expect(omit.pointResource).toEqual(paper.current);
    expect(paper.beadAbsentSource.projected).toEqual(paper.current);
    expect(valid("resourceProjectionPointQueryV1", paper.beadAbsentSource.query)).toBe(true);
    // Absent Bead source differs from a protected whole Link Reference.
  });

  it("projects the exact historical edition while current content differs", () => {
    const p = paper.exact;
    expect(valid("resourceProjectionPointQueryV1", p.query)).toBe(true);
    expect(valid("projectedBeadRecord", p.projected)).toBe(true);
    expect(p.query.revision).toBe(p.selected.revision);
    expect(p.projected.revision).toBe(p.selected.revision);
    expect(p.projected.properties.title).toBe(p.selected.properties.title);
    expect(p.projected.properties.title).not.toBe(p.current.properties.title);
    expect(p.projected.revision).not.toBe(p.current.revision);
    expect(paper.historyDenied.query).toEqual(p.query);
    expect(paper.historyDenied.expected).toEqual({
      outcome: "refused",
      reason: "resource-not-found",
      status: 404,
      fullFallback: false,
      substituteCurrent: false,
    });
    // This records the permission obligation, not a successful permission check.
  });

  it("keeps pinned Link References whole and closes projected record shapes", () => {
    const p = paper.linkPair;
    expect(valid("projectedLinkRecord", p.pointResource)).toBe(true);
    expect(valid("projectedLinkCollection", p.inventoryPage)).toBe(true);
    expect(p.inventoryPage.items).toEqual([p.pointResource]);
    for (const field of ["source", "target"])
      expect(p.pointResource[field]).toEqual(paper.link[field]);
    for (const field of ["id", "type", "revision", "source", "target"]) {
      const missing = clone(p.pointResource);
      delete missing[field];
      expect(valid("projectedLinkRecord", missing)).toBe(false);
    }
    for (const endpoint of [{ uri: paper.link.source.uri }, { revision: "task-r1" }, null])
      expect(valid("projectedLinkRecord", { ...p.pointResource, source: endpoint })).toBe(false);
    for (const extra of [
      { projection: {} },
      { projectionVersion: "1" },
      { links: { items: [], next: null } },
    ]) {
      expect(valid("projectedLinkRecord", { ...p.pointResource, ...extra })).toBe(false);
      expect(valid("projectedBeadRecord", { ...paper.pairs[4].pointResource, ...extra })).toBe(
        false,
      );
    }
    for (const name of ["projectedBeadCollection", "projectedLinkCollection"])
      expect(valid(name, { items: [] })).toBe(false);
  });

  it("preserves properties on full records and metadata on current full records", () => {
    for (const [kind, record] of [
      ["Bead", paper.current],
      ["Link", paper.link],
    ] as const) {
      expect(valid(`${kind.toLowerCase()}Record`, record)).toBe(true);
      expect(valid(`current${kind}Record`, record)).toBe(true);
      const withoutProperties = clone(record);
      delete withoutProperties.properties;
      expect(valid(`${kind.toLowerCase()}Record`, withoutProperties)).toBe(false);
      expect(valid(`current${kind}Record`, withoutProperties)).toBe(false);
      const withoutMetadata = clone(record);
      delete withoutMetadata.metadata;
      expect(valid(`${kind.toLowerCase()}Record`, withoutMetadata)).toBe(true);
      expect(valid(`current${kind}Record`, withoutMetadata)).toBe(false);
      expect(valid(`projected${kind}Record`, withoutProperties)).toBe(true);
      expect(valid(`projected${kind}Record`, withoutMetadata)).toBe(true);
    }
  });

  it("admits inventory selectors but does not add historical List population", () => {
    const selectors = {
      type: `${paper.current.type.uri}`,
      conformsTo: `${paper.current.type.uri}`,
      source: paper.current.id,
      target: paper.current.id,
      endpoint: paper.current.id,
      selector: "$.status",
      cursor: "opaque-cursor",
      limit: 2,
    };
    expect(
      valid("resourceProjectionInventoryQueryV1", { projectionVersion: "1", ...selectors }),
    ).toBe(true);
    for (const extra of [{ revision: "task-r1" }, { limit: 0 }, { source: "" }, { cursor: "" }])
      expect(
        valid("resourceProjectionInventoryQueryV1", { projectionVersion: "1", ...extra }),
      ).toBe(false);
    expect(
      valid("resourceProjectionPointQueryV1", { projectionVersion: "1", cursor: "opaque" }),
    ).toBe(false);
  });

  it("preserves non-HTTP Reference URI filters when projection is selected", () => {
    for (const field of ["source", "target", "endpoint"])
      for (const operand of ["urn:example:external", "task-1", "team/task-1"])
        expect(
          valid("resourceProjectionInventoryQueryV1", {
            projectionVersion: "1",
            [field]: operand,
          }),
        ).toBe(true);
    for (const field of ["type", "conformsTo"])
      expect(
        valid("resourceProjectionInventoryQueryV1", {
          projectionVersion: "1",
          [field]: "urn:example:external",
        }),
      ).toBe(false);
  });

  it("separates unknown version selection from complete supported query admission", () => {
    const p = paper.unsupportedVersion;
    expect(valid("resourceProjectionSelection", p.query)).toBe(true);
    expect(valid("resourceProjectionSelection", { projectionVersion: "2", fields: null })).toBe(
      true,
    );
    for (const name of ["resourceProjectionPointQueryV1", "resourceProjectionInventoryQueryV1"])
      expect(valid(name, p.query)).toBe(false);
    for (const p of [paper.unsupportedVersion, paper.unsupportedExact]) {
      expect(valid("resourceProjectionCapabilityProblem", p.problem)).toBe(true);
      expect(valid("resourceProjectionProblem", p.problem)).toBe(true);
      expect(p.fullFallback).toBe(false);
    }
    expect(valid("resourceProjectionCapabilityV1", paper.unsupportedExact.capability)).toBe(true);
    expect(paper.unsupportedExact.capability.exact).toBe(false);
    expect(paper.unsupportedExact.problem.capabilityVersion).toBe("1");
    expect(
      valid("resourceProjectionProblem", {
        type: "https://github.com/gastownhall/bdp/problems/request",
        code: "invalid-parameter",
        status: 400,
        retry: "never",
      }),
    ).toBe(true);
    expect(valid("resourceProjectionCapabilityProblem", { ...p.problem, retry: "never" })).toBe(
      false,
    );
  });

  it("rejects malformed pointers, null or empty mask containers and native view queries", () => {
    for (const fields of [
      null,
      {},
      [],
      { include: [] },
      { omit: [] },
      { include: null },
      { include: ["properties/title"] },
      { include: ["/properties/~2"] },
      { omit: ["#/properties/title"] },
      { include: [7] },
      { include: [""], extra: true },
    ]) {
      expect(valid("resourceProjectionMask", fields)).toBe(false);
      expect(valid("resourceProjectionPointQueryV1", { projectionVersion: "1", fields })).toBe(
        false,
      );
    }
    for (const pointer of ["", "/properties/a~1b", "/metadata/~0key"])
      expect(valid("resourceProjectionMask", { include: [pointer] })).toBe(true);
    for (const name of ["resourceProjectionPointQueryV1", "resourceProjectionInventoryQueryV1"])
      for (const extra of [
        { view: "properties" },
        { view: "links" },
        { view: "versions" },
        { unknown: true },
      ])
        expect(valid(name, { projectionVersion: "1", ...extra })).toBe(false);
    expect(valid("historyVersionRow", paper.versionsRow)).toBe(true);
    expect(
      valid("historyVersionRow", { ...paper.versionsRow, fields: { include: ["/revision"] } }),
    ).toBe(false);
    // This adds no Versions query grammar or masked summary representation.
  });

  it("records explicit semantic refusal controls beyond JSON Schema path syntax", () => {
    expect(paper.semanticRefusals.map((p: { id: string }) => p.id)).toEqual([
      "omit-root",
      "omit-id",
      "omit-type",
      "omit-revision",
      "slice-type",
      "omit-link-source",
      "omit-link-target-pin",
      "slice-link-source",
      "slice-provenance",
      "slice-owned-plane",
    ]);
    for (const p of paper.semanticRefusals) {
      expect(valid("resourceProjectionPointQueryV1", p.query), p.id).toBe(true);
      expect(p.expected).toEqual({
        outcome: "refused",
        reason: "invalid-parameter",
        fullFallback: false,
      });
      expect(p).not.toHaveProperty("projected");
    }
    // These authored refusals are obligations; Ajv does not enforce kind-aware
    // protection, whole-plane traversal, history permission or response content.
  });

  it("records array masks against original indices and compacts retained items once", () => {
    expect(
      paper.arrays.map((p: { selectedOriginalIndices: number[] }) => p.selectedOriginalIndices),
    ).toEqual([[1], [0, 2], [2]]);
    expect(
      paper.arrays.map(
        (p: { projected: { properties: { items: string[] } } }) => p.projected.properties.items,
      ),
    ).toEqual([["blue"], ["red", "green"], ["green"]]);
    for (const p of paper.arrays) {
      expect(p.original.properties.items).toEqual(["red", "blue", "green"]);
      expect(valid("resourceProjectionPointQueryV1", p.query), p.id).toBe(true);
      expect(valid("projectedBeadRecord", p.projected), p.id).toBe(true);
    }
    expect(paper.arrays[2].query.fields).toEqual({
      include: ["/properties/items/1", "/properties/items/2"],
      omit: ["/properties/items/1"],
    });
    // No projection implementation is introduced by these authored expected values.
  });

  it("pairs applied-mask headers for projected point and inventory GET, HEAD and 304", () => {
    expect(paper.framing).toHaveLength(8);
    for (const p of paper.framing) {
      expect(JSON.parse(p.headers["BDP-Projection"])).toEqual(p.appliedMask);
      expect(p.appliedMask).toEqual(paper.pairs[1].pointQuery.fields);
      expect(p.bodyPresent).toBe(p.method === "GET" && p.status === 200);
    }
    expect(new Set(paper.framing.map((p: { operation: string }) => p.operation))).toEqual(
      new Set(["point", "inventory"]),
    );
    // Header obligations are paper correspondence, not HTTP/validator execution.
  });
});
