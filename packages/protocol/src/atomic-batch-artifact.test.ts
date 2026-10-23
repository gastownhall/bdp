import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const schema = JSON.parse(read("specs/profiles/core/bdp-v0.1.schema.json"));
const legacy = JSON.parse(read("specs/profiles/core/bdp-v0.schema.json"));
const cases = JSON.parse(read("fixtures/atomic-batch/candidate.json"));
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv, { mode: "full" });
ajv.addSchema(schema);
ajv.addSchema(legacy);
function valid(name: string, value: unknown, bundle = schema): boolean {
  const validate = ajv.getSchema(`${bundle.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`missing definition ${name}`);
  return Boolean(validate(value));
}

describe("optional atomic batch artifacts; no compiler/provider execution", () => {
  it("binds a known exact feature version while allowing unknown versions for base use", () => {
    expect(valid("capabilityAdvertisements", cases.advertisement)).toBe(true);
    const mixed = structuredClone(cases.advertisement);
    mixed[cases.capability]["2"] = { futureLanguage: {} };
    expect(valid("capabilityAdvertisements", mixed)).toBe(true);
    expect(
      valid("atomicBatchCapabilityV1", {
        operation: `${cases.scope}commands/atomic`,
        operations: ["updateBead"],
      }),
    ).toBe(true);
    for (const fields of [
      { operations: [] },
      { operations: ["updateBead", "updateBead"] },
      { operations: ["deleteWhere"] },
      { maximumOperations: 0 },
      { unexpected: true },
    ]) {
      const detail = { ...cases.advertisement[cases.capability]["1"], ...fields };
      expect(valid("atomicBatchCapabilityV1", detail), JSON.stringify(fields)).toBe(false);
    }
  });

  it("separates selector syntax from unsupported-version body interpretation", () => {
    const unknown = { capabilityVersion: "2", futureBody: { unrecognized: true } };
    expect(valid("atomicBatchSelection", unknown)).toBe(true);
    expect(valid("batchRequest", unknown)).toBe(false);
    for (const value of [{}, { capabilityVersion: "" }, { capabilityVersion: 1 }, []])
      expect(valid("atomicBatchSelection", value), JSON.stringify(value)).toBe(false);
    expect(valid("atomicBatchCapabilityProblem", cases.problems.capability)).toBe(true);
    // Prefix acceptance is not a complete request/admission or an executed refusal.
  });

  it("requires the rejectable selector and closes the selected request", () => {
    const request = cases.pairs[0].request;
    expect(valid("batchRequest", request)).toBe(true);
    const { capabilityVersion: _version, ...missing } = request;
    expect(valid("batchRequest", missing)).toBe(false);
    for (const extra of [{ atomic: false }, { idempotencyKey: "per-body-key" }, { parameters: {} }])
      expect(valid("batchRequest", { ...request, ...extra })).toBe(false);
    expect(valid("batchRequest", { ...request, operations: [] })).toBe(false);
    expect(valid("batchRequest", request, legacy)).toBe(false);
  });

  it("retains all six records and excludes old set/alias/read vocabulary", () => {
    const bodies = {
      createBead: { type: `${cases.scope}Task` },
      updateBead: { bead: "task-17", properties: {} },
      deleteBead: { bead: "task-17" },
      createLink: { type: `${cases.scope}Relates`, source: "task-17", target: "task-18" },
      updateLink: { link: "relation-old", metadata: {} },
      deleteLink: { link: "relation-old" },
    };
    for (const [operation, fields] of Object.entries(bodies))
      expect(
        valid("batchRequest", { capabilityVersion: "1", operations: [{ operation, ...fields }] }),
        operation,
      ).toBe(true);
    const oldSet = { operation: "deleteWhere", collection: "beads", selector: "$" };
    expect(valid("batchRequest", { operations: [oldSet] }, legacy)).toBe(true);
    for (const member of [
      oldSet,
      { operation: "putAlias", alias: "current", target: "task-17" },
      { operation: "show", bead: "task-17" },
    ])
      expect(valid("batchRequest", { capabilityVersion: "1", operations: [member] })).toBe(false);
  });

  it("checks render/compile paper pairs in their actual shared grammar", () => {
    for (const pair of cases.pairs) expect(valid("batchRequest", pair.request), pair.id).toBe(true);
    for (const path of [
      "docs/cli-design/atomic-batch.md",
      "specs/profiles/write/atomic-batch.md",
    ]) {
      for (const match of read(path).matchAll(/```json\n([\s\S]*?)\n```/g)) {
        const value = JSON.parse(match[1] ?? "null");
        const definition = value.capabilities
          ? "capabilityAdvertisements"
          : value.code
            ? "atomicBatchProblem"
            : "batchRequest";
        expect(valid(definition, value.capabilities ?? value), path).toBe(true);
      }
    }
    // No tokenizer/compiler or semantic round-trip has run.
  });

  it("does not confuse structural reference strings with resolved handle correctness", () => {
    const contextual = {
      capabilityVersion: "1",
      operations: [{ operation: "updateBead", bead: "@not-created", propertiesChange: [] }],
    };
    expect(valid("batchRequest", contextual)).toBe(true);
    // Contextual admission must refuse; schema shape is not name/kind resolution.
  });

  it("carries complete results with operation/kind/outcome and effect correlation", () => {
    for (const [name, result] of Object.entries(cases.results))
      expect(valid("atomicBatchResult", result), name).toBe(true);
    const base = cases.results.twoCreates;
    const { transaction: _transaction, ...missing } = base;
    expect(valid("atomicBatchResult", missing)).toBe(false);
    expect(valid("atomicBatchResult", { ...base, changed: false })).toBe(false);
    expect(valid("atomicBatchResult", { ...cases.results.allNoOp, transaction: "invented" })).toBe(
      false,
    );
    expect(valid("atomicBatchResult", { ...base, results: [] })).toBe(false);
    expect(valid("atomicBatchResult", { ...base, next: "public-receipt-page" })).toBe(false);
  });

  it("keeps native paper results aligned with their authored request slots and targets", () => {
    for (const [name, result] of Object.entries(cases.results) as [
      string,
      { results: { operationIndex: number; operation: string; resource?: { id: string } }[] },
    ][]) {
      const request = cases.resultRequests[name];
      expect(valid("batchRequest", request), name).toBe(true);
      expect(result.results).toHaveLength(request.operations.length);
      for (const [index, entry] of result.results.entries()) {
        const member = request.operations[index];
        expect(entry.operationIndex).toBe(index);
        expect(entry.operation).toBe(member.operation);
        if (member.operation === "updateBead")
          expect(entry.resource?.id).toBe(new URL(member.bead, cases.scope).href);
      }
    }
    // This checks paper correspondence, not applied mutations or a renderer/compiler.
  });

  it("refuses mismatched member outcomes, kinds, names and false create flags", () => {
    const entry = cases.results.twoCreates.results[0];
    expect(valid("atomicBatchResultEntry", entry)).toBe(true);
    for (const change of [
      { outcome: "updated" },
      { operation: "createLink" },
      { changed: false },
      { operationIndex: -1 },
      { operationName: "bad name" },
    ])
      expect(valid("atomicBatchResultEntry", { ...entry, ...change }), JSON.stringify(change)).toBe(
        false,
      );
    expect(
      valid("atomicBatchResultEntry", {
        ...entry,
        resource: { ...entry.resource, links: { items: [], next: null } },
      }),
    ).toBe(false);
    const update = cases.results.allNoOp.results[0];
    expect(valid("atomicBatchResultEntry", { ...update, operationName: "onlyCreates" })).toBe(
      false,
    );
  });

  it("requires authoritative changed flags on Resource CRUD while leaving aliases distinct", () => {
    const base = cases.results.allNoOp.results[0];
    const native = { outcome: base.outcome, resource: base.resource, changed: false };
    expect(valid("mutationResult", native)).toBe(true);
    const { changed: _changed, ...missing } = native;
    expect(valid("mutationResult", missing)).toBe(false);
    expect(
      valid("aliasResult", {
        outcome: "created",
        alias: `${cases.scope}current`,
        target: base.resource.id,
      }),
    ).toBe(true);
  });

  it("validates deterministic refusal samples without claiming preflight execution", () => {
    for (const sample of cases.supportCases) {
      expect(valid("batchRequest", sample.request), sample.id).toBe(true);
      expect(valid("atomicBatchProblem", sample.expectedProblem), sample.id).toBe(true);
    }
    const problem = cases.problems.operation;
    for (const change of [
      { status: 400 },
      { retry: "never" },
      { pointer: "/operations/01/operation" },
      { operation: "deleteWhere" },
    ])
      expect(valid("atomicBatchProblem", { ...problem, ...change }), JSON.stringify(change)).toBe(
        false,
      );
    expect(valid("atomicBatchProblem", cases.problems.capability)).toBe(true);
  });
});
