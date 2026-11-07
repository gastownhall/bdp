import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { describe, expect, it } from "vitest";
import { withBdpSourceAnnotations } from "./schema-source-annotations.js";

const root = new URL("../../../", import.meta.url);
const common = JSON.parse(
  readFileSync(new URL("specs/profiles/core/bdp-v0.1.schema.json", root), "utf8"),
);
const ajv = withBdpSourceAnnotations(new Ajv2020({ strict: true, allErrors: true }));
formatsPlugin.default(ajv, { mode: "full" });
ajv.addSchema(common);
const valid = (name: string, value: unknown): boolean => {
  const check = ajv.getSchema(`${common.$id}#/$defs/${name}`);
  if (!check) throw new Error(`missing definition ${name}`);
  return Boolean(check(value));
};
const capability = "https://github.com/gastownhall/bdp/capabilities/write-exceptions";
const refusal = {
  type: "https://github.com/gastownhall/bdp/problems/request",
  code: "operation-not-supported",
  status: 422,
  retry: "after-state-change",
  operation: "deleteLink",
};
const discovery = (detail: unknown) => ({
  bdpVersion: "0.1",
  profile: "write",
  scope: "https://beads.example/acme/",
  specRevision: "0".repeat(40),
  operations: "https://beads.example/acme/bdp/operations",
  capabilities: { [capability]: { "1": detail } },
});

// Schema shapes only. The reference serves all six and advertises no exception.
describe("write-exceptions1 and the ordinary operation-not-supported Problem", () => {
  it("admits the code in the Write Problem table", () => {
    expect(common.$defs.readUpdateProblemCode.enum).toContain("operation-not-supported");
    expect(valid("readUpdateProblem", refusal)).toBe(true);
    expect(valid("readUpdateProblem", { ...refusal, detail: "not served here" })).toBe(true);
  });

  it.each([
    ["no operation", { ...refusal, operation: undefined }],
    ["an alias operation", { ...refusal, operation: "putAlias" }],
    ["an unknown operation", { ...refusal, operation: "archiveBead" }],
    [
      "another family",
      { ...refusal, type: "https://github.com/gastownhall/bdp/problems/conflict" },
    ],
    ["another status", { ...refusal, status: 400 }],
    ["another retry", { ...refusal, retry: "never" }],
    ["a batch pointer", { ...refusal, pointer: "/operations/0/operation" }],
  ])("refuses a Problem with %s", (_name, problem) => {
    expect(valid("readUpdateProblem", JSON.parse(JSON.stringify(problem)))).toBe(false);
  });

  it("keeps the batch member refusal its own form, matching exactly one arm", () => {
    const member = { ...refusal, pointer: "/operations/2/operation" };
    expect(valid("atomicBatchOperationProblem", member)).toBe(true);
    expect(valid("atomicBatchProblem", member)).toBe(true);
    expect(valid("atomicBatchOperationProblem", refusal)).toBe(false);
    expect(valid("atomicBatchProblem", refusal)).toBe(true);
  });

  it.each([
    [["deleteBead"]],
    [["createBead", "updateBead", "deleteBead", "createLink", "updateLink", "deleteLink"]],
  ])("admits the detail %j", (operationsNotSupported) => {
    expect(valid("writeExceptionsCapabilityV1", { operationsNotSupported })).toBe(true);
    expect(valid("writeDiscovery", discovery({ operationsNotSupported }))).toBe(true);
  });

  it.each([
    ["no list", {}],
    ["an empty list", { operationsNotSupported: [] }],
    ["a repeated name", { operationsNotSupported: ["deleteBead", "deleteBead"] }],
    ["an alias operation", { operationsNotSupported: ["deleteAlias"] }],
    ["an unknown name", { operationsNotSupported: ["archiveBead"] }],
    ["another member", { operationsNotSupported: ["deleteBead"], reason: "policy" }],
  ])("refuses a detail with %s, directly and in discovery", (_name, detail) => {
    expect(valid("writeExceptionsCapabilityV1", detail)).toBe(false);
    expect(valid("writeDiscovery", discovery(detail))).toBe(false);
  });

  it("keeps the directory's six members required for a Scope with exceptions", () => {
    const check = common.$defs.writeOperationDirectory.required;
    expect(check).toEqual([
      "createBead",
      "updateBead",
      "deleteBead",
      "createLink",
      "updateLink",
      "deleteLink",
    ]);
  });
});
