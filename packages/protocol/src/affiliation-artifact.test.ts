import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const candidate = JSON.parse(read("specs/profiles/core/bdp-v0.1.schema.json"));
const legacy = JSON.parse(read("specs/profiles/core/bdp-v0.schema.json"));
const cases = JSON.parse(read("fixtures/affiliations/candidate.json"));
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv, { mode: "full" });
ajv.addSchema(candidate);
ajv.addSchema(legacy);
function valid(name: string, value: unknown, bundle = candidate): boolean {
  const validator = ajv.getSchema(`${bundle.$id}#/$defs/${name}`);
  if (!validator) throw new Error(`missing artifact definition ${name}`);
  return Boolean(validator(value));
}
const uri = "https://work.example/acme/Task";
const exact = { uri, revision: "definition-r2" };

describe("v0.1 affiliation artifact, without claiming stateful or CLI execution", () => {
  it("admits unpinned and exact HTTP(S) Type carriers but not local/batch identities", () => {
    for (const value of [uri, exact, "http://types.example/T"])
      expect(valid("typeReference", value), JSON.stringify(value)).toBe(true);
    for (const value of ["Task", "@new", "urn:types:T", "ftp://types.example/T", null])
      expect(valid("typeReference", value), JSON.stringify(value)).toBe(false);
  });

  it("requires a closed exact carrier with an opaque nonempty string pin", () => {
    expect(valid("pinnedTypeReference", exact)).toBe(true);
    for (const value of [
      uri,
      { uri },
      { uri, revision: "" },
      { uri, revision: 2 },
      { uri, revision: "r2", extra: true },
      { uri, typeRevision: "r2" },
      { uri: "Task", revision: "r2" },
    ])
      expect(valid("pinnedTypeReference", value), JSON.stringify(value)).toBe(false);
  });

  it.each(["Bead", "Link"])(
    "allows a %s Type-only update with an optional ordinary guard",
    (kind) => {
      const field = kind.toLowerCase();
      const body = { [field]: "item", type: exact };
      expect(valid(`update${kind}Request`, body)).toBe(true);
      expect(valid(`update${kind}Request`, { ...body, expectedRevision: "resource-r1" })).toBe(
        true,
      );
      expect(valid(`update${kind}Request`, body, legacy)).toBe(false);
      expect(valid(`update${kind}Request`, { ...body, source: "new-source" })).toBe(false);
    },
  );

  it.each(["Bead", "Link"])(
    "preserves %s omission/empty-patch admission without empty mutation",
    (kind) => {
      const body = { [kind.toLowerCase()]: "item" };
      for (const edit of [{ propertiesChange: [] }, { metadataChange: [] }, { type: exact }])
        expect(valid(`update${kind}Request`, { ...body, ...edit })).toBe(true);
      for (const edit of [{}, { expectedRevision: "r1" }, { revisionProvenance: {} }])
        expect(valid(`update${kind}Request`, { ...body, ...edit })).toBe(false);
    },
  );

  it("checks documented operation shapes in singleton and atomic batch positions", () => {
    for (const sample of cases.cliOperations) {
      const { operation, ...body } = sample.operation;
      expect(valid(`${operation}Request`, body), sample.id).toBe(true);
      expect(valid("batchRequest", { operations: [sample.operation] }), sample.id).toBe(true);
    }
    // These are paired paper inputs; no parser, compiler or default resolution ran.
    expect(cases.cliOperations[0].operation).not.toHaveProperty("type");
  });

  it("carries full exact affiliations in mixed-pin nominal buckets and empty new captures", () => {
    for (const record of Object.values(cases.records))
      expect(valid("beadRecord", record)).toBe(true);
    const records =
      cases.records.mixedPinsAndRefinement.ownedLinks[`${cases.commandScope}Association`];
    expect(records).toHaveLength(2);
    expect(records[0].type.uri).toBe(records[1].type.uri);
    expect(records[0].type.revision).not.toBe(records[1].type.revision);
    expect(cases.records.emptyNewCapture.ownedLinks).toEqual({});
  });

  it("does not confuse structural acceptance of retained state with new-capture semantics", () => {
    expect(valid("beadRecord", cases.records.historicalEmptyBucket)).toBe(true);
    const semanticallyWrongBucket = structuredClone(cases.records.mixedPinsAndRefinement);
    semanticallyWrongBucket.ownedLinks[`${cases.commandScope}Association`][0].type.uri =
      `${cases.commandScope}OtherType`;
    // Key/record equality and contextual capture rules are not expressible here.
    expect(valid("beadRecord", semanticallyWrongBucket)).toBe(true);
  });

  it("carries ownership-exit source metadata without tying it to the postimage Type", () => {
    const results = cases.nativeLinkResults;
    for (const value of Object.values(results)) {
      expect(valid("mutationResult", value)).toBe(true);
      expect(valid("receiptResult", { operationIndex: 0, ...(value as object) })).toBe(true);
    }
    expect(results.leavingOwnership.resource.type.uri).toBe(`${cases.commandScope}UnownedRelation`);
    expect(results.leavingOwnership.sourceRevision).toBe("owner-r10");
    expect(results.unrelatedUnowned).not.toHaveProperty("source");
    expect(results.unrelatedUnowned).not.toHaveProperty("sourceRevision");
    expect(results.ownedNoOp.sourceRevision).toBe("owner-r9");
    for (const missing of ["source", "sourceRevision"]) {
      const incomplete = { ...results.leavingOwnership };
      delete incomplete[missing];
      expect(valid("mutationResult", incomplete)).toBe(false);
      expect(valid("receiptResult", { operationIndex: 0, ...incomplete })).toBe(false);
    }
    // Grammar carries a truthful pair; actual pre/post membership remains a semantic case.
  });

  it("preserves nominal identity and endpoint domains independently of Type carriers", () => {
    expect(valid("typeIdArray", [uri])).toBe(true);
    expect(valid("typeIdArray", [exact])).toBe(false);
    expect(valid("reference", { uri: "urn:example:outside", revision: "old" })).toBe(true);
    expect(valid("resourceReference", "@created")).toBe(true);
    const setWrite = {
      collection: "beads",
      selector: "$",
      change: [{ op: "add", path: "/title", value: "new" }],
    };
    expect(valid("updateWhereRequest", setWrite)).toBe(true);
    expect(valid("updateWhereRequest", { ...setWrite, type: exact })).toBe(false);
  });

  it("widens recorded identity/fact affiliation without confusing Event type or closing Type-only encoding", () => {
    const record = cases.records.mixedPinsAndRefinement;
    expect(
      valid("resourceIdentity", { id: record.id, type: record.type, revision: record.revision }),
    ).toBe(true);
    const event = {
      id: "event-1",
      ordinal: 0,
      type: "updated",
      source: `${cases.commandScope}events`,
      subject: record.id,
      subjectType: record.type,
      transaction: "tx-1",
      time: "2026-10-22T07:00:00Z",
      data: {
        previousRevision: "r1",
        revision: "r2",
        change: [{ op: "add", path: "/title", value: "new" }],
      },
    };
    expect(valid("event", event)).toBe(true);
    expect(valid("event", { ...event, type: record.type })).toBe(false);
    expect(valid("event", { ...event, data: { previousRevision: "r1", revision: "r2" } })).toBe(
      false,
    );
    // Passing refusal records the pending Event gap, not an accepted omission.
  });

  it("retargets the illustrative common operation fields while preserving its staging boundary", () => {
    const text = read("specs/profiles/write/write.md");
    const block = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)]
      .map((match) => JSON.parse(match[1] ?? "null"))
      .find((value) => value.title === "BDP batch operation");
    expect(block).toBeDefined();
    const sketch = new Ajv2020({ strict: true, allErrors: true });
    addFormats(sketch, { mode: "full" });
    const validate = sketch.compile(block);
    for (const sample of cases.cliOperations)
      expect(validate(sample.operation), sample.id).toBe(true);
    expect(text).toContain("not a retained-surface decision");
  });
});
