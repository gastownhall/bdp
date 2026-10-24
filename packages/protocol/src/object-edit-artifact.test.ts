import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { describe, expect, it } from "vitest";

const addFormats = formatsPlugin.default;

const root = new URL("../../../", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root), "utf8");
const schema = JSON.parse(read("specs/profiles/core/bdp-v0.1.schema.json"));
const legacy = JSON.parse(read("specs/profiles/core/bdp-v0.schema.json"));
const cases = JSON.parse(read("fixtures/object-edits/candidate.json"));
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv, { mode: "full" });
ajv.addSchema(schema);
ajv.addSchema(legacy);
function valid(name: string, value: unknown, bundle = schema): boolean {
  const validator = ajv.getSchema(`${bundle.$id}#/$defs/${name}`);
  if (!validator) throw new Error(`missing definition ${name}`);
  return Boolean(validator(value));
}

describe("ordinary object-edit input artifact, without provider or CLI execution", () => {
  it.each(["Bead", "Link"])(
    "applies the same %s replacement/patch grammar in shared positions",
    (kind) => {
      const field = kind.toLowerCase();
      const operation = `update${kind}`;
      for (const sample of cases.updateCases) {
        const body = { [field]: "item", ...sample.fields };
        expect(valid(`${operation}Request`, body), `${sample.id}/singleton`).toBe(sample.valid);
        expect(
          valid("batchRequest", { capabilityVersion: "1", operations: [{ operation, ...body }] }),
          `${sample.id}/batch`,
        ).toBe(sample.valid);
        expect(
          valid("sequenceRequest", {
            operations: [{ operation, ...body, idempotencyKey: "object-edit-case-key" }],
          }),
          `${sample.id}/inherited-sequence-shape`,
        ).toBe(sample.valid);
      }
      // The sequence position is accounting for inherited grammar, not a retained CLI command.
    },
  );

  it.each(["Bead", "Link"])(
    "isolates new %s replacement fields from the held v0 schema",
    (kind) => {
      const body = { [kind.toLowerCase()]: "item" };
      for (const replacement of [{ properties: {} }, { metadata: {} }]) {
        expect(valid(`update${kind}Request`, { ...body, ...replacement })).toBe(true);
        expect(valid(`update${kind}Request`, { ...body, ...replacement }, legacy)).toBe(false);
      }
      expect(valid(`update${kind}Request`, { ...body, propertiesChange: [] }, legacy)).toBe(true);
    },
  );

  it("does not infer effects from empty input or treat guard/provenance as mutation input", () => {
    expect(valid("updateBeadRequest", { bead: "item", properties: {} })).toBe(true);
    expect(valid("updateBeadRequest", { bead: "item", propertiesChange: [] })).toBe(true);
    for (const fields of [{}, { expectedRevision: "r1" }, { revisionProvenance: {} }])
      expect(valid("updateBeadRequest", { bead: "item", ...fields })).toBe(false);
    // Actual resulting-state equality, admission and guards are separate semantic checks.
  });

  it("preserves independent modes, exact Type input and generic property data", () => {
    const body = {
      bead: "item",
      type: { uri: "https://types.example/Task", revision: "definition-r2" },
      properties: { type: "ordinary authored data" },
      metadataChange: [],
      expectedRevision: "resource-r7",
    };
    expect(valid("updateBeadRequest", body)).toBe(true);
    expect(body.properties.type).toBe("ordinary authored data");
    expect(valid("updateBeadRequest", { ...body, propertiesChange: [] })).toBe(false);
  });

  it("keeps creation, strict patch and deferred set-write domains unchanged", () => {
    expect(valid("createBeadRequest", { type: "https://types.example/Task", properties: {} })).toBe(
      true,
    );
    expect(
      valid("updateBeadRequest", {
        bead: "item",
        propertiesChange: [{ op: "remove", path: "/a" }],
      }),
    ).toBe(true);
    expect(
      valid("updateBeadRequest", {
        bead: "item",
        propertiesChange: [{ op: "test", path: "/a", value: 1 }],
      }),
    ).toBe(false);
    const setWrite = {
      collection: "beads",
      selector: "$",
      change: [{ op: "add", path: "/a", value: 1 }],
    };
    expect(valid("updateWhereRequest", setWrite)).toBe(true);
    expect(valid("updateWhereRequest", { ...setWrite, properties: {} })).toBe(false);
  });

  it("validates paired operation samples without claiming a compiler ran", () => {
    for (const sample of cases.cliPairs) {
      const { operation, ...body } = sample.operation;
      expect(valid(`${operation}Request`, body), sample.id).toBe(true);
      expect(
        valid("batchRequest", { capabilityVersion: "1", operations: [sample.operation] }),
        sample.id,
      ).toBe(true);
    }
    const replacement = cases.cliPairs.find(
      (sample: { id: string }) => sample.id === "replacement",
    );
    expect(replacement.operation).toHaveProperty("properties", {});
    expect(replacement.operation).not.toHaveProperty("propertiesChange");
  });

  it("keeps the illustrative common grammar aligned with replacements and conflicts", () => {
    const block = [...read("specs/profiles/write/write.md").matchAll(/```json\n([\s\S]*?)\n```/g)]
      .map((match) => JSON.parse(match[1] ?? "null"))
      .find((value) => value.title === "BDP batch operation");
    const sketch = new Ajv2020({ strict: true, allErrors: true });
    addFormats(sketch, { mode: "full" });
    const validate = sketch.compile(block);
    for (const sample of cases.cliPairs) expect(validate(sample.operation), sample.id).toBe(true);
    expect(
      validate({ operation: "updateBead", bead: "item", properties: {}, propertiesChange: [] }),
    ).toBe(false);
  });
});
