// Authored Type examples and delegated schema projection, not a Type-DSL parser/provider.
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { describe, expect, it } from "vitest";
import { parseSchema } from "../../../scripts/markdown-schema.mjs";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const fixture = (name: string) => read(`fixtures/markdown-types/${name}`);
const common = read("specs/profiles/core/bdp-v0.1.schema.json");
const types = read("specs/profiles/types/types-v1.schema.json");
const intrinsic = "specs/profiles/types/intrinsic-2/";
const descriptor = read(`${intrinsic}type-definition.properties.schema.json`);
const bead = read(`${intrinsic}bead-type-definition.properties.schema.json`);
const link = read(`${intrinsic}link-type-definition.properties.schema.json`);
const ajv = new Ajv2020({ strict: true, allErrors: true, useDefaults: false });
formatsPlugin.default(ajv, { mode: "full" });
for (const schema of [common, types, descriptor, bead, link]) ajv.addSchema(schema);
function validator(id: string) {
  const result = ajv.getSchema(id);
  if (!result) throw new Error(`Missing artifact schema ${id}`);
  return result;
}
const beadShape = validator(bead.$id);
const linkShape = validator(link.$id);

describe("Type authoring examples against current descriptor artifacts; no Type-format execution", () => {
  it("retains valid local Bead and Link descriptors without materializing defaults", () => {
    for (const [name, validate] of [
      ["work-item.authoring.expected.json", beadShape],
      ["reviewed-reference.authoring.expected.json", linkShape],
    ] as const) {
      const value = fixture(name).definition.properties;
      const before = structuredClone(value);
      expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
      expect(value).toEqual(before);
    }
  });

  it("actually parses the delegated v0.6 property schema to its expected exact value", () => {
    const text = readFileSync(
      new URL("fixtures/markdown-types/work-item-properties.md", root),
      "utf8",
    );
    expect(parseSchema(text)).toEqual(
      fixture("work-item.authoring.expected.json").definition.properties.propertiesSchema,
    );
  });

  it("preserves omitted, true, false and empty schemas while refusing explicit null", () => {
    for (const value of [
      {},
      { propertiesSchema: true },
      { propertiesSchema: false },
      { propertiesSchema: {} },
    ])
      expect(beadShape(value), JSON.stringify(beadShape.errors)).toBe(true);
    expect(beadShape({ propertiesSchema: null })).toBe(false);
    const recorded = fixture("work-item.recorded.expected.json").record;
    expect(Object.hasOwn(recorded.properties, "propertiesSchema")).toBe(false);
    expect(validator(`${types.$id}#/$defs/beadRecord`)(recorded)).toBe(true);
  });

  it("does not widen category restrictions or confuse Link maxima with Bead participation", () => {
    const base = fixture("reviewed-reference.authoring.expected.json").definition.properties;
    for (const field of ["ownsOutgoing", "incoming", "outgoing"])
      expect(linkShape({ ...base, [field]: [] })).toBe(false);
    expect(beadShape({ linkConstraints: base.linkConstraints })).toBe(false);
    expect(
      linkShape({ ...base, linkConstraints: { ...base.linkConstraints, pairUnique: true } }),
    ).toBe(false);
  });

  it("preserves the exact local schema-resource closure without rebasing or network acquisition", () => {
    const value = fixture("reviewed-reference.authoring.expected.json").definition.properties;
    const schema = read("fixtures/markdown-types/reviewed-reference-properties.schema.json");
    const resource = read("fixtures/markdown-types/shared-fields.schema.json");
    expect(value.propertiesSchema).toEqual(schema);
    expect(value.schemaResources).toEqual({
      "https://schemas.example/shared-fields.json": resource,
    });
    const offline = new Ajv2020({ strict: true });
    offline.addSchema(resource);
    const validate = offline.compile(schema);
    expect(validate({ annotation: "reviewed" })).toBe(true);
    expect(validate({ annotation: "" })).toBe(false);
    expect(validate({ annotation: "reviewed", extra: true })).toBe(false);
    expect(schema.properties.annotation.$ref).toBe("shared-fields.json#/$defs/annotation");
  });

  it("keeps wire revision tokens string-only and preserves numeric-looking exact tokens", () => {
    const validate = validator(`${common.$id}#/$defs/pinnedTypeReference`);
    const uri = "https://types.example/reference";
    expect(validate({ uri, revision: "2" })).toBe(true);
    expect(validate({ uri, revision: 2 })).toBe(false);
    expect(validate({ id: uri, revision: "2" })).toBe(false);
    expect(validate({ uri, revision: "" })).toBe(false);
  });
});
