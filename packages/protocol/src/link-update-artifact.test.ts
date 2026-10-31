import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const schema = read("specs/profiles/core/bdp-v0.1.schema.json");
const paper = read("fixtures/link-updates/candidate.json");
const ajv = new Ajv2020({ strict: true, allErrors: true });
formatsPlugin.default(ajv, { mode: "full" });
ajv.addSchema(schema);
function valid(name: string, value: unknown): boolean {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`missing artifact definition ${name}`);
  return Boolean(validate(value));
}
const clone = <T>(value: T): T => structuredClone(value);
const transfer = paper.transfer;

// Paper/schema/state correspondence only: no provider, CLI, Type evaluator or
// transaction executor runs. Schema admission does not prove reference resolution.
describe("Link endpoint artifact admission and paper state correspondence", () => {
  it("strictly compiles the complete candidate offline", () => {
    for (const name of Object.keys(schema.$defs))
      expect(ajv.getSchema(`${schema.$id}#/$defs/${name}`), name).toBeDefined();
    // Existing contract-binding tests own mirror equality and held-v0 hash checks.
  });

  it.each(["source", "target"])("admits a %s-only floating or pinned correction", (field) => {
    for (const endpoint of [
      "correct-bead",
      `${paper.scope}correct-bead`,
      "urn:example:external",
      { uri: "correct-bead", revision: "literal-old-pin" },
      { uri: `${paper.scope}correct-bead`, revision: "literal-old-pin" },
    ]) {
      const body = { link: "relation", [field]: endpoint };
      expect(valid("updateLinkRequest", body), JSON.stringify(endpoint)).toBe(true);
      expect(valid("updateLinkRequest", { ...body, expectedRevision: "link-r1" })).toBe(true);
      expect(
        valid("batchRequest", {
          capabilityVersion: "1",
          operations: [{ operation: "updateLink", ...body }],
        }),
      ).toBe(true);
    }
  });

  it.each(["source", "target"])("rejects malformed or partial %s replacements", (field) => {
    for (const endpoint of [
      null,
      {},
      { uri: "correct-bead" },
      { revision: "r1" },
      { uri: "correct-bead", revision: "" },
      { uri: "correct-bead", revision: "r1", extra: true },
      "@new-owner",
      { uri: "@new-owner", revision: "r1" },
    ])
      expect(valid("updateLinkRequest", { link: "relation", [field]: endpoint })).toBe(false);
    expect(valid("updateBeadRequest", { bead: "owner-a", [field]: "owner-b" })).toBe(false);
    expect(valid("updateLinkRequest", { link: "relation" })).toBe(false);
  });

  it("admits both endpoint replacements and the paper prior-binding batch shape", () => {
    expect(
      valid("updateLinkRequest", {
        link: "relation",
        source: "owner-b",
        target: { uri: "target-c", revision: "c-r1" },
      }),
    ).toBe(true);
    expect(valid("batchRequest", paper.priorBinding)).toBe(true);
    expect(paper.priorBinding.operations[0].name).toBe("new-owner");
    expect(paper.priorBinding.operations[1].source).toBe("@new-owner");
  });

  it("admits zero, one or two closed owner revision entries without inline owner records", () => {
    const base = clone(transfer.result);
    delete base.ownerRevisions;
    expect(valid("mutationResult", base)).toBe(true);
    for (const ownerRevisions of [
      transfer.result.ownerRevisions.slice(0, 1),
      transfer.result.ownerRevisions,
    ]) {
      expect(valid("mutationResult", { ...base, ownerRevisions })).toBe(true);
      expect(
        valid("atomicBatchResourceResult", {
          ...base,
          id: base.resource.id,
          resourceKind: "link",
          ownerRevisions,
        }),
      ).toBe(true);
    }
    for (const ownerRevisions of [
      [],
      [{ id: transfer.fullA.id }],
      [{ revision: "a-r2" }],
      [{ id: transfer.fullA.id, revision: "" }],
      [{ id: "relative-owner", revision: "r1" }],
      [{ ...transfer.result.ownerRevisions[0], resource: transfer.fullA }],
      [...transfer.result.ownerRevisions, { id: `${paper.scope}owner-c`, revision: "c-r1" }],
      [transfer.result.ownerRevisions[0], transfer.result.ownerRevisions[0]],
    ])
      expect(valid("mutationResult", { ...base, ownerRevisions })).toBe(false);
    for (const legacy of [
      { source: transfer.fullA.id },
      { sourceRevision: "a-r2" },
      { source: transfer.fullA.id, sourceRevision: "a-r2" },
    ]) {
      expect(valid("mutationResult", { ...base, ...legacy })).toBe(false);
      expect(
        valid("atomicBatchResourceResult", {
          ...base,
          id: base.resource.id,
          resourceKind: "link",
          ...legacy,
        }),
      ).toBe(false);
    }
  });

  it("rejects owner context on Bead or allocated results", () => {
    const ownerRevisions = transfer.result.ownerRevisions;
    expect(
      valid("mutationResult", {
        outcome: "updated",
        changed: true,
        resource: transfer.fullA,
        ownerRevisions,
      }),
    ).toBe(false);
    for (const row of [
      {
        id: transfer.fullA.id,
        resourceKind: "bead",
        outcome: "updated",
        changed: true,
        resource: transfer.fullA,
      },
      {
        id: transfer.finalLink.id,
        resourceKind: "link",
        outcome: "allocated",
        changed: true,
      },
    ]) {
      expect(valid("atomicBatchResourceResult", row)).toBe(true);
      expect(valid("atomicBatchResourceResult", { ...row, ownerRevisions })).toBe(false);
    }
  });

  it("records the same Link identity, complete final owner states and literal historical captures", () => {
    const p = transfer;
    expect(
      valid("batchRequest", {
        capabilityVersion: "1",
        operations: [p.authored],
      }),
    ).toBe(true);
    expect(valid("mutationResult", p.result)).toBe(true);
    expect(valid("atomicBatchResult", p.batchResult)).toBe(true);
    for (const record of [p.beforeLink, p.finalLink, paper.historical.link])
      expect(valid("linkRecord", record)).toBe(true);
    for (const record of [
      p.beforeA,
      p.beforeB,
      p.fullA,
      p.fullB,
      paper.historical.ownerA,
      paper.historical.ownerB,
    ])
      expect(valid("beadRecord", record)).toBe(true);
    expect(p.finalLink.id).toBe(p.beforeLink.id);
    for (const field of ["type", "target", "properties", "metadata"])
      expect(p.finalLink[field]).toEqual(p.beforeLink[field]);
    expect(p.fullA.ownedLinks).toEqual({});
    expect(p.fullB.ownedLinks[p.finalLink.type.uri]).toEqual([p.finalLink]);
    expect(p.result.ownerRevisions).toEqual([
      { id: p.fullA.id, revision: p.fullA.revision },
      { id: p.fullB.id, revision: p.fullB.revision },
    ]);
    expect(p.finalLink.source.revision).toBe(p.beforeB.revision);
    expect(p.finalLink.source.revision).not.toBe(p.fullB.revision);
    expect(paper.historical.link).toEqual(p.beforeLink);
    expect(paper.historical.ownerA).toEqual(p.beforeA);
    expect(paper.historical.ownerB).toEqual(p.beforeB);
    expect(paper.historical.ownerA.ownedLinks[p.beforeLink.type.uri]).toEqual([p.beforeLink]);
  });

  it("pairs source moves with zero or one owner, target correction and same-source pin correction", () => {
    for (const p of paper.variants) {
      const { operation, ...body } = p.authored;
      expect(operation).toBe("updateLink");
      expect(valid("updateLinkRequest", body), p.id).toBe(true);
      expect(valid("linkRecord", p.finalLink), p.id).toBe(true);
      expect(valid("mutationResult", p.result), p.id).toBe(true);
      expect(p.finalLink.id).toBe(p.beforeLink.id);
      const contexts = p.result.ownerRevisions ?? [];
      const ids = contexts.map((x: { id: string }) => x.id);
      expect(ids).toEqual(p.expectedOwnerIds);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(
        [...new Set([...p.boundaryOwnerIds.initial, ...p.boundaryOwnerIds.final])].sort(),
      );
    }
    const target = paper.variants.find(
      (p: { id: string }) => p.id === "target-correction-keeps-one-owner",
    );
    expect(target.finalLink.source).toEqual(target.beforeLink.source);
    expect(target.finalLink.target).not.toEqual(target.beforeLink.target);
    const pin = paper.variants.find((p: { id: string }) => p.id === "same-source-pin-correction");
    expect(pin.finalLink.source.uri).toBe(pin.beforeLink.source.uri);
    expect(pin.finalLink.source.revision).not.toBe(pin.beforeLink.source.revision);
    expect(pin.result.ownerRevisions).toHaveLength(1);
  });

  it("pairs endpoint-only delta and postimage facts with each affected owner's actual revision", () => {
    expect(transfer.postimages).toHaveLength(3);
    expect(transfer.deltas).toHaveLength(3);
    const expected = [transfer.fullA, transfer.fullB, transfer.finalLink];
    for (const [i, record] of expected.entries()) {
      const post = transfer.postimages[i];
      const delta = transfer.deltas[i];
      expect(valid("retainedPostimageEvent", post)).toBe(true);
      expect(valid("retainedDeltaEvent", delta)).toBe(true);
      expect(post.effect.resource).toEqual(record);
      for (const field of ["id", "transaction", "revision", "previousRevision"])
        expect(delta[field]).toEqual(post[field]);
      expect(delta.revision).toBe(record.revision);
      expect(delta.transaction).toBe(transfer.batchResult.transaction);
      if (i < 2) expect(delta.derived.ownedLinks).toEqual(record.ownedLinks);
    }
    const linkDelta = transfer.deltas[2];
    expect(linkDelta.effect).toEqual({
      operation: "updateLink",
      link: transfer.finalLink.id,
      source: transfer.finalLink.source,
    });
    expect(linkDelta).not.toHaveProperty("derived");
    const ids = transfer.postimages.map(
      (p: { effect: { resource: { id: string } } }) => p.effect.resource.id,
    );
    expect(new Set(ids).size).toBe(3);
    const targetDelta = clone(linkDelta);
    delete targetDelta.effect.source;
    targetDelta.effect.target = "urn:example:correct-target";
    expect(valid("retainedDeltaEvent", targetDelta)).toBe(true);
    targetDelta.effect.target = { uri: "urn:example:correct-target" };
    expect(valid("retainedDeltaEvent", targetDelta)).toBe(false);
  });

  it("preserves original envelopes and emits no facts for the authored A to B to A batch", () => {
    const p = paper.reversal;
    expect(valid("batchRequest", p.authored)).toBe(true);
    expect(valid("atomicBatchResult", p.result)).toBe(true);
    expect(p.authored.operations.map((x: { operation: string }) => x.operation)).toEqual([
      "updateLink",
      "updateLink",
    ]);
    expect(p.authored.operations[0].source).toBe(transfer.beforeB.id);
    expect(p.authored.operations[1].source).toEqual(transfer.beforeLink.source);
    expect(p.result.changed).toBe(false);
    expect(p.result).not.toHaveProperty("transaction");
    expect(p.facts).toEqual([]);
    expect(p.result.resources.map((x: { resource: unknown }) => x.resource)).toEqual(p.before);
    for (const row of p.result.resources) {
      expect(row.outcome).toBe("unchanged");
      expect(row.changed).toBe(false);
    }
    expect(p.result.resources[1].ownerRevisions).toEqual([
      { id: transfer.beforeA.id, revision: transfer.beforeA.revision },
    ]);
    // Boundary membership does not invent a final row/version for intermediate B.
    expect(p.result.resources.map((x: { id: string }) => x.id)).not.toContain(transfer.beforeB.id);
  });
});
