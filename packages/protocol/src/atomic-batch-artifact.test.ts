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
            : value.resources
              ? "atomicBatchResult"
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
      { results: { operationIndex: number; operation: string; id: string }[] },
    ][]) {
      const request = cases.resultRequests[name];
      expect(valid("batchRequest", request), name).toBe(true);
      expect(result.results).toHaveLength(request.operations.length);
      for (const [index, entry] of result.results.entries()) {
        const member = request.operations[index];
        expect(entry.operationIndex).toBe(index);
        expect(entry.operation).toBe(member.operation);
        if (member.operation === "updateBead")
          expect(entry.id).toBe(new URL(member.bead, cases.scope).href);
      }
    }
    // This checks paper correspondence, not applied mutations or a renderer/compiler.
  });

  it("separates identity mappings from final outcomes and refuses wrong result kinds", () => {
    const entry = cases.results.twoCreates.results[0];
    expect(valid("atomicBatchResultEntry", entry)).toBe(true);
    for (const change of [
      { outcome: "updated" },
      { operation: "futureOperation" },
      { changed: false },
      { operationIndex: -1 },
      { operationName: "bad name" },
    ])
      expect(valid("atomicBatchResultEntry", { ...entry, ...change }), JSON.stringify(change)).toBe(
        false,
      );
    const row = cases.results.twoCreates.resources.find(
      (x: { resourceKind: string }) => x.resourceKind === "bead",
    );
    for (const change of [
      { resourceKind: "link" },
      { changed: false },
      { resource: { ...row.resource, links: { items: [], next: null } } },
    ])
      expect(valid("atomicBatchResourceResult", { ...row, ...change })).toBe(false);
    const update = cases.results.allNoOp.results[0];
    expect(valid("atomicBatchResultEntry", { ...update, operationName: "onlyCreates" })).toBe(
      false,
    );
  });

  it("requires authoritative changed flags on Resource CRUD while leaving aliases distinct", () => {
    const base = cases.results.allNoOp.resources[0];
    const native = { outcome: "updated", resource: base.resource, changed: false };
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

  it("maps every command to one unique final outcome with canonical ordering and kind", () => {
    for (const result of Object.values(cases.results) as {
      results: { operation: string; id: string }[];
      resources: { id: string; resourceKind: string }[];
    }[]) {
      const ids = result.resources.map((r) => r.id);
      expect(ids).toEqual([...new Set(ids)].sort());
      for (const entry of result.results) {
        const row = result.resources.find((r) => r.id === entry.id);
        expect(row).toBeDefined();
        expect(row?.resourceKind).toBe(entry.operation.endsWith("Bead") ? "bead" : "link");
      }
    }
    // Cross-row equality/order is semantic source, not a JSON-Schema guarantee.
  });

  it("publishes no intermediate revision or Event for a net-zero reversal", () => {
    const result = cases.results.reversal;
    expect(result.results).toHaveLength(2);
    expect(result.resources).toHaveLength(1);
    expect(result.changed).toBe(false);
    expect(result.resources[0].outcome).toBe("unchanged");
    expect(result.resources[0].resource).toEqual(
      cases.publicationBefore.reversal[result.resources[0].id],
    );
    expect(result).not.toHaveProperty("transaction");
    expect(cases.publishedEvents.reversal).toEqual([]);
    expect(
      cases.semanticCases.find((c: { id: string }) => c.id === "no-op-durable").expected,
    ).toContain("successful key outcome");
  });

  it("uses one final postimage and initial guard baseline for two staged updates", () => {
    const result = cases.results.twoUpdates;
    const request = cases.resultRequests.twoUpdates;
    const before = cases.publicationBefore.twoUpdates[result.resources[0].id];
    expect(request.operations.map((m: { expectedRevision: string }) => m.expectedRevision)).toEqual(
      [before.revision, before.revision],
    );
    expect(result.results).toHaveLength(2);
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0].resource.properties.title).toBe("C");
    expect(cases.publishedEvents.twoUpdates).toHaveLength(1);
    expect(cases.publishedEvents.twoUpdates[0].previousRevision).toBe(before.revision);
    expect(cases.publishedEvents.twoUpdates[0].effect.resource).toEqual(
      result.resources[0].resource,
    );
  });

  it("reports committed create-delete allocation without a fictional Resource version", () => {
    const result = cases.results.createDelete;
    expect(result.changed).toBe(true);
    expect(result.transaction).toBeTruthy();
    expect(result.results[0].id).toBe(result.results[1].id);
    expect(result.resources).toEqual([
      {
        id: result.results[0].id,
        resourceKind: "bead",
        outcome: "allocated",
        changed: true,
      },
    ]);
    expect(cases.publishedEvents.createDelete).toEqual([]);
    expect(
      valid("atomicBatchResourceResult", { ...result.resources[0], revision: "invented" }),
    ).toBe(false);
    expect(valid("atomicBatchResult", { ...result, changed: false })).toBe(false);
  });

  it("deletes the actual final-live published version without leaking a staged retype", () => {
    const result = cases.results.updateDelete;
    const row = result.resources[0];
    const before = cases.publicationBefore.updateDelete[row.id];
    expect(row.deleted.resource.type).toEqual(before.type);
    expect(row.deleted.resource.revision).toBe(before.revision);
    expect(row.deleted.resource.type).not.toEqual(
      cases.resultRequests.updateDelete.operations[0].type,
    );
    expect(cases.publishedEvents.updateDelete).toHaveLength(1);
    expect(cases.publishedEvents.updateDelete[0].effect.operation).toBe("deleteBead");
    expect(cases.publishedEvents.updateDelete[0].revision).toBe(before.revision);
  });

  it("captures two final Link records in one owner revision without repinning endpoints", () => {
    const result = cases.results.twoOwnedLinks;
    const owner = result.resources.find((r: { resourceKind: string }) => r.resourceKind === "bead");
    expect(
      result.resources.filter((r: { resourceKind: string }) => r.resourceKind === "bead"),
    ).toHaveLength(1);
    const captured = Object.values(owner.resource.ownedLinks).flat();
    for (const row of result.resources.filter(
      (r: { resourceKind: string }) => r.resourceKind === "link",
    )) {
      expect(row.source).toBe(owner.id);
      expect(row.sourceRevision).toBe(owner.resource.revision);
      expect(captured).toContainEqual(row.resource);
      expect(row.resource.source.revision).toBe(
        cases.publicationBefore.twoOwnedLinks[owner.id].revision,
      );
      expect(row.resource.source.revision).not.toBe(owner.resource.revision);
    }
    expect(
      cases.publishedEvents.twoOwnedLinks.filter(
        (e: { effect: { operation: string } }) => e.effect.operation === "updateBead",
      ),
    ).toHaveLength(1);
  });

  it("retains owner and Link envelopes when the final owned state is unchanged", () => {
    const result = cases.results.netOwnerNoOp;
    expect(result.changed).toBe(false);
    for (const row of result.resources) {
      expect(row.outcome).toBe("unchanged");
      expect(row.resource).toEqual(cases.publicationBefore.netOwnerNoOp[row.id]);
    }
    expect(cases.publishedEvents.netOwnerNoOp).toEqual([]);
    const owner = result.resources.find((r: { resourceKind: string }) => r.resourceKind === "bead");
    expect(owner.resource.ownedLinks[`${cases.scope}HistoricalEmpty`]).toEqual([]);
  });

  it("returns a deleted owner's actual final-live context without an intermediate owner version", () => {
    const result = cases.results.deleteOwner;
    const owner = result.resources.find((r: { resourceKind: string }) => r.resourceKind === "bead");
    const before = cases.publicationBefore.deleteOwner[owner.id];
    expect(owner.outcome).toBe("deleted");
    expect(owner.deleted.resource.revision).toBe(before.revision);
    for (const row of result.resources) {
      expect(row).not.toHaveProperty("resource");
      if (row.resourceKind === "link") {
        expect(row.source).toBe(owner.id);
        expect(row.sourceRevision).toBe(before.revision);
      }
    }
    expect(cases.publishedEvents.deleteOwner).toHaveLength(3);
  });

  it("has one explicit final attribution and valid provenance/guard refusal controls", () => {
    const result = cases.results.sameProvenance;
    const inputs = cases.resultRequests.sameProvenance.operations.map(
      (m: { revisionProvenance: unknown }) => m.revisionProvenance,
    );
    expect(inputs[0]).toEqual(inputs[1]);
    expect(result.resources[0].resource.revisionProvenance).toEqual(inputs[0]);
    for (const sample of cases.admissionCases) {
      expect(valid("batchRequest", sample.request), sample.id).toBe(true);
      expect(valid("atomicBatchProblem", sample.expectedProblem), sample.id).toBe(true);
    }
    const conflict = cases.admissionCases.find(
      (x: { id: string }) => x.id === "conflicting-provenance",
    );
    expect(conflict.request.operations[0].revisionProvenance).not.toEqual(
      conflict.request.operations[1].revisionProvenance,
    );
    expect(conflict.expectedProblem.code).toBe("validation-failed");
  });

  it("allows Resource-qualified equal revision strings without requiring global equality", () => {
    const result = structuredClone(cases.results.twoOwnedLinks);
    for (const row of result.resources) {
      row.resource.revision = "same-token";
      if (row.sourceRevision) row.sourceRevision = "same-token";
      for (const records of Object.values(row.resource.ownedLinks ?? {}) as {
        revision: string;
      }[][])
        for (const record of records) record.revision = "same-token";
    }
    expect(valid("atomicBatchResult", result)).toBe(true);
    expect(valid("atomicBatchResult", cases.results.twoOwnedLinks)).toBe(true);
  });

  it("pairs one final Event per changed published Resource in canonical order", () => {
    for (const [name, result] of Object.entries(cases.results) as [
      string,
      { resources: { id: string; changed: boolean; outcome: string }[] },
    ][]) {
      const published = result.resources.filter((r) => r.changed && r.outcome !== "allocated");
      const events = cases.publishedEvents[name];
      expect(events).toHaveLength(published.length);
      for (const [i, event] of events.entries()) {
        expect(valid("retainedPostimageEvent", event), name).toBe(true);
        expect(event.effect.id ?? event.effect.bead ?? event.effect.link).toBe(published[i]?.id);
      }
    }
  });
});
