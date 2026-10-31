import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const bytes = (path: string) => readFileSync(new URL(path, root));
const read = (path: string) => JSON.parse(bytes(path).toString("utf8"));
const common = read("specs/profiles/core/bdp-v0.1.schema.json");
const feature = read("specs/profiles/write/id-root-v1.schema.json");
const paper = read("fixtures/id-root/candidate.json");
const ajv = new Ajv2020({ strict: true, allErrors: true });
formatsPlugin.default(ajv, { mode: "full" });
ajv.addSchema(common);
ajv.addSchema(feature);
const valid = (name: string, value: unknown, schema = feature): boolean => {
  const check = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  if (!check) throw new Error(`missing definition ${name}`);
  return Boolean(check(value));
};
const clone = <T>(value: T): T => structuredClone(value);

// Schema and authored correspondence only. No allocator, provider, Type engine,
// HTTP/CLI, transaction/concurrency executor or recovery implementation runs.
describe("fixed id-root1 separate Write artifact", () => {
  it("compiles every feature definition strictly with full formats", () => {
    for (const name of Object.keys(feature.$defs))
      expect(ajv.getSchema(`${feature.$id}#/$defs/${name}`), name).toBeDefined();
  });

  it("preserves both common schema generations and distribution mirrors byte-for-byte", () => {
    for (const [version, hash] of [
      ["v0", "15104f001d41290c130b22999ceafe3bb9e83e8aa36db3f7aee2de06c268a327"],
      ["v0.1", "e0de70f5d1da926bedb4fac0343e0f561e91136511c4949cffd56ba5b6c60b8f"],
    ]) {
      const canonical = bytes(`specs/profiles/core/bdp-${version}.schema.json`);
      expect(createHash("sha256").update(canonical).digest("hex")).toBe(hash);
      expect(bytes(`packages/protocol/schemas/bdp-${version}.schema.json`)).toEqual(canonical);
    }
  });

  it("requires exact version1 advertisement with closed empty detail", () => {
    expect(valid("idRootCapabilityAdvertisement", paper.advertisement)).toBe(true);
    expect(valid("idRootCapabilityV1", {})).toBe(true);
    expect(valid("idRootCapabilityV1", { operation: "https://work.invalid/new-url" })).toBe(false);
    const unknown = { [paper.capability]: { "2": {} } };
    expect(valid("capabilityAdvertisements", unknown, common)).toBe(true);
    expect(valid("idRootCapabilityAdvertisement", unknown)).toBe(false);
  });

  it("closes feature requests after open member composition and leaves base closed", () => {
    for (const kind of ["Bead", "Link"]) {
      const members = feature.$defs[`idRootCreate${kind}Members`];
      expect(members.allOf).toEqual([{ $ref: `${common.$id}#/$defs/create${kind}Members` }]);
      expect(members).not.toHaveProperty("unevaluatedProperties");
      for (const suffix of ["Request", "Operation"])
        expect(feature.$defs[`idRootCreate${kind}${suffix}`].unevaluatedProperties).toBe(false);
      expect(common.$defs[`create${kind}Request`].unevaluatedProperties).toBe(false);
    }
    expect(feature.$defs.idRootBatchRequest.additionalProperties).toBe(false);
    expect(common.$defs.batchRequest.additionalProperties).toBe(false);
    expect(
      feature.$defs.idRootBatchOperation.oneOf
        .filter((x: { $ref: string }) => x.$ref.startsWith(common.$id))
        .map((x: { $ref: string }) => x.$ref.split("/").at(-1)),
    ).toEqual([
      "updateBeadOperation",
      "deleteBeadOperation",
      "updateLinkOperation",
      "deleteLinkOperation",
    ]);
  });

  it.each(["Bead", "Link"])(
    "selects rooted %s creation while ordinary input remains base grammar",
    (kind) => {
      const request = kind === "Bead" ? paper.beadRequest : paper.linkRequest;
      const selected = `idRootCreate${kind}Request`;
      expect(valid(selected, request)).toBe(true);
      expect(valid(`create${kind}Request`, request, common)).toBe(false);
      expect(valid(selected, { ...request, id: "explicit" })).toBe(false);
      expect(valid(selected, { ...request, idRootVersion: "1" })).toBe(false);
      expect(valid(selected, { ...request, extra: true })).toBe(false);
      const ordinary = clone(request);
      delete ordinary.idRoot;
      expect(valid(selected, ordinary)).toBe(false);
      expect(valid(`create${kind}Request`, ordinary, common)).toBe(true);
      expect(valid(`create${kind}Request`, { ...ordinary, id: "explicit" }, common)).toBe(true);
    },
  );

  it("checks canonical prefix spelling without pretending to validate UTF-8 or namespace authority", () => {
    for (const value of paper.lexicalRoots) expect(valid("idRoot", value), value).toBe(true);
    for (const value of [...paper.invalidRoots, null, 7, {}, []])
      expect(valid("idRoot", value), JSON.stringify(value)).toBe(false);
    for (const refusal of paper.semanticRefusals) {
      expect(valid("idRoot", refusal.root)).toBe(refusal.lexicalAdmission);
      expect(refusal.serviceRefusal.length).toBeGreaterThan(0);
    }
  });

  it("retains whole References and string-only revision tokens; URI@2 is literal", () => {
    expect(
      valid("idRootCreateBeadRequest", {
        ...paper.beadRequest,
        type: "https://types.invalid/note@2",
      }),
    ).toBe(true);
    for (const type of [
      { uri: "https://types.invalid/note", revision: 2 },
      { id: "https://types.invalid/note", revision: "2" },
      { uri: "https://types.invalid/note" },
      { uri: "https://types.invalid/note", revision: "2", extra: true },
    ])
      expect(valid("idRootCreateBeadRequest", { ...paper.beadRequest, type })).toBe(false);
    expect(
      valid("idRootCreateBeadRequest", {
        ...paper.beadRequest,
        type: { uri: "https://types.invalid/note@2", revision: "2" },
      }),
    ).toBe(true);
    expect(
      valid("idRootCreateLinkRequest", {
        ...paper.linkRequest,
        source: { uri: "source", revision: 2 },
      }),
    ).toBe(false);
    expect(valid("idRootCreateLinkRequest", { ...paper.linkRequest, source: "@newNote" })).toBe(
      false,
    );
    expect(valid("idRootCreateLinkRequest", { ...paper.linkRequest, source: "source" })).toBe(true);
  });

  it("composes fixed root allocation with six-CRUD atomic-batch1 and prior identity bindings", () => {
    expect(valid("idRootBatchRequest", paper.batchRequest)).toBe(true);
    expect(valid("batchRequest", paper.batchRequest, common)).toBe(false);
    expect(paper.batchRequest.capabilityVersion).toBe("1");
    expect(
      new Set(paper.batchRequest.operations.map((op: { operation: string }) => op.operation)).size,
    ).toBe(6);
    expect(paper.batchRequest.operations[1].source).toBe("@newNote");
    const ordinary = clone(paper.batchRequest);
    for (const op of ordinary.operations) delete op.idRoot;
    expect(valid("batchRequest", ordinary, common)).toBe(true);
    expect(valid("idRootBatchRequest", ordinary)).toBe(false);
    expect(valid("idRootBatchRequest", { ...paper.batchRequest, idRoot: "wrong-wrapper" })).toBe(
      false,
    );
    expect(valid("idRootBatchRequest", { ...paper.batchRequest, idRootVersion: "1" })).toBe(false);
    for (const field of ["id", "idRootVersion"]) {
      const bad = clone(paper.batchRequest);
      bad.operations[0][field] = "forbidden";
      expect(valid("idRootBatchRequest", bad)).toBe(false);
    }
    for (const operation of paper.batchRequest.operations.filter(
      (op: { operation: string }) => !op.operation.startsWith("create"),
    )) {
      const bad = clone(paper.batchRequest);
      bad.operations.push({ ...operation, idRoot: "misplaced" });
      expect(valid("idRootBatchRequest", bad)).toBe(false);
    }
  });

  it("detects presence only at declared create positions, never in nested data or unknown operations", () => {
    expect(valid("idRootCreateSelection", { idRoot: null })).toBe(true);
    expect(valid("idRootCreateBeadRequest", { ...paper.beadRequest, idRoot: null })).toBe(false);
    const nested = {
      type: "https://types.invalid/note",
      properties: { idRoot: "ordinary data", nested: { idRoot: "literal" } },
      metadata: { idRoot: "literal" },
    };
    expect(valid("createBeadRequest", nested, common)).toBe(true);
    expect(valid("idRootCreateSelection", nested)).toBe(false);
    expect(
      valid("idRootBatchSelection", {
        capabilityVersion: "1",
        operations: [{ operation: "createBead", ...nested }],
      }),
    ).toBe(false);
    for (const operation of ["select", "updateBead", "deleteLink"]) {
      const misplaced = {
        capabilityVersion: "1",
        operations: [{ operation, idRoot: "wrong-position" }],
      };
      expect(valid("idRootBatchSelection", misplaced)).toBe(false);
      expect(valid("idRootBatchRequest", misplaced)).toBe(false);
    }
    expect(valid("idRootBatchSelection", paper.batchRequest)).toBe(true);
  });

  it("keeps unsupported feature refusal local and pointer-specific", () => {
    expect(valid("idRootCapabilityProblem", paper.unsupported)).toBe(true);
    expect(
      valid("idRootCapabilityProblem", { ...paper.unsupported, pointer: "/operations/1/idRoot" }),
    ).toBe(true);
    for (const change of [
      { pointer: "/id" },
      { pointer: "/operations/01/idRoot" },
      { capabilityVersion: "2" },
      { status: 400 },
      { extra: true },
    ])
      expect(valid("idRootCapabilityProblem", { ...paper.unsupported, ...change })).toBe(false);
  });

  it("records original allocated identity/accepted Type/postimage across written replay scenarios", () => {
    const p = paper.typeAndReplay;
    expect(valid("idRootCreateBeadRequest", p.request)).toBe(true);
    expect(valid("mutationResult", p.originalResult, common)).toBe(true);
    expect(valid("idRootCreateResult", p.sameKeyRetainedResult)).toBe(true);
    expect(p.originalResult.resource.id).toBe(
      `${paper.scope}${p.request.idRoot}/${p.opaqueSuffix}`,
    );
    expect(p.opaqueSuffix.split("/")).toHaveLength(1);
    expect(p.originalResult.resource.type).toEqual(p.atAdmission.acceptedType);
    expect(p.atAdmission.clientPrefetch).toBe(false);
    expect(p.laterDefault).not.toEqual(p.atAdmission.acceptedType);
    expect(p.sameKeyRetainedResult).toEqual(p.originalResult);
    expect(p.sameKeyAfterCapabilityWithdrawal).toEqual(p.originalResult);
    expect(p.expiredSuccessfulSameMeaning).toBe("idempotency-expired");
    expect(p.differentMeaningSameKey).toBe("idempotency-conflict");
    expect(p.rootResourceCreated).toBe(false);
    expect(p.afterDeletion).toBe("allocated identity remains unavailable for unrelated reuse");
    // These are authored service obligations, not execution of those scenarios.
  });
});
