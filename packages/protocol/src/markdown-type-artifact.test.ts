// Authored Type examples and delegated schema projection, not a Type-DSL parser/provider.
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { describe, expect, it } from "vitest";
import { parseSchema } from "../../../scripts/markdown-schema.mjs";
import { withBdpSourceAnnotations } from "./schema-source-annotations.js";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const fixture = (name: string) => read(`fixtures/markdown-types/${name}`);
const common = read("specs/profiles/core/bdp-v0.1.schema.json");
const types = read("specs/profiles/types/types-v1.schema.json");
const intrinsic = "specs/profiles/types/intrinsic-2/";
const descriptor = read(`${intrinsic}type-definition.properties.schema.json`);
const bead = read(`${intrinsic}bead-type-definition.properties.schema.json`);
const link = read(`${intrinsic}link-type-definition.properties.schema.json`);
const ajv = withBdpSourceAnnotations(
  new Ajv2020({ strict: true, allErrors: true, useDefaults: false }),
);
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
    const offline = withBdpSourceAnnotations(new Ajv2020({ strict: true }));
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

// Fixed canonical-document custody checks, not a general Type-format parser.
const publication = read("specs/profiles/types/intrinsic-2.json");
const descriptorDocs = "specs/profiles/types/descriptors/";
const compact = (value: unknown) => JSON.stringify(value);
function document(name: string) {
  return readFileSync(new URL(`${descriptorDocs}${name}.md`, root), "utf8");
}
function documentedSection(text: string, heading: string) {
  const headings = [...text.matchAll(/^## ([^\n]+)$/gm)];
  const matches = headings.filter((match) => match[1] === heading);
  if (matches.length !== 1)
    throw new Error(`Missing or duplicate fixed document section ${heading}`);
  const selected = matches[0]!;
  const next = headings.find((match) => match.index! > selected.index!);
  return text.slice(selected.index! + selected[0].length, next?.index).trim();
}
const schemaNames: Record<string, string> = {
  type: "type-definition.properties.schema.json",
  "bead-type": "bead-type-definition.properties.schema.json",
  "link-type": "link-type-definition.properties.schema.json",
  refines: "refines.properties.schema.json",
};
const namespace = "https://github.com/gastownhall/bdp/types/type-system/";

describe("adopted intrinsic descriptor documents against unchanged publication2", () => {
  it("records exact definition identity, category and metatype without manufacturing metadata", () => {
    for (const record of publication.definitions) {
      const name = record.id.slice(namespace.length);
      const text = document(name);
      const label = {
        type: "Type",
        "bead-type": "BeadType",
        "link-type": "LinkType",
        refines: "Refines",
      }[name as keyof typeof schemaNames];
      expect(text.split("\n")[0]).toBe(
        `# ${name === "refines" ? "Link" : "Bead"} type: ${label} (publication2 source record)`,
      );
      expect(text).toContain("```text\nFormat: bdp-type-markdown-0.1\nMode: recorded\n```");
      const definition = documentedSection(text, "Definition");
      expect(definition.split("\n")).toEqual([
        "| Field | Value (JSON) |",
        "| --- | --- |",
        ...["id", "revision", "type"].map((field) => `| ${field} | ${compact(record[field])} |`),
      ]);
      expect([...text.matchAll(/^## (.+)$/gm)].map((match) => match[1])).toEqual([
        "Definition",
        ...(name === "type" ? ["Descriptor"] : []),
        "Properties schema",
        "Schema resources",
        ...(name === "type"
          ? ["Selectors", "Owns outgoing"]
          : name === "refines"
            ? ["Selectors", "Endpoint pairs"]
            : []),
        "Refines",
      ]);
      expect(Object.hasOwn(record, "metadata")).toBe(false);
      expect(text).not.toMatch(/^#{2,4} (?:Metadata|Revision provenance)$/m);
      const validate = name === "refines" ? linkShape : beadShape;
      const original = structuredClone(record.properties);
      expect(validate(record.properties), JSON.stringify(validate.errors)).toBe(true);
      expect(record.properties).toEqual(original);
    }
  });

  it("binds complete property schemas and every retained resource without new schema identities", () => {
    for (const record of publication.definitions) {
      const name = record.id.slice(namespace.length);
      const text = document(name);
      expect(documentedSection(text, "Properties schema")).toBe(
        `Source: JSON: ../intrinsic-2/${schemaNames[name]}`,
      );
      expect(read(`${intrinsic}${schemaNames[name]}`)).toEqual(record.properties.propertiesSchema);
      const expectedRows = Object.entries(record.properties.schemaResources).map(([uri, value]) => {
        const local =
          uri === descriptor.$id
            ? "../intrinsic-2/type-definition.properties.schema.json"
            : `schema-resources/${uri.endsWith("/schema") ? "schema" : uri.slice(uri.lastIndexOf("/") + 1)}.schema.json`;
        const bound = JSON.parse(readFileSync(new URL(`${descriptorDocs}${local}`, root), "utf8"));
        expect(bound).toEqual(value);
        return `| ${uri} | JSON: ${local} |`;
      });
      expect(documentedSection(text, "Schema resources").split("\n").slice(2)).toEqual(
        expectedRows,
      );
    }
  });

  it("keeps recorded owned Refines identity, literal source, exact target and absence", () => {
    for (const record of publication.definitions) {
      const text = document(record.id.slice(namespace.length));
      const refines = documentedSection(text, "Refines");
      const declarations = Object.values(record.ownedLinks).flat() as Record<string, unknown>[];
      const blocks = [...refines.matchAll(/^### Declaration: [A-Za-z][A-Za-z0-9_-]*$/gm)];
      expect(blocks).toHaveLength(declarations.length);
      for (const [index, declaration] of declarations.entries()) {
        expect(publication.declarations).toContainEqual(declaration);
        const block = blocks[index]!;
        const text = refines.slice(block.index, blocks[index + 1]?.index).trim();
        expect(text.split("\n")).toEqual([
          block[0],
          "",
          "| Field | Value (JSON) |",
          "| --- | --- |",
          ...["id", "revision", "type", "source", "target"].map(
            (field) => `| ${field} | ${compact(declaration[field])} |`,
          ),
          "",
          "#### Properties",
          "",
          "```json",
          JSON.stringify(declaration.properties, null, 2),
          "```",
        ]);
        expect(declaration.source).toBe(record.id);
        expect(Object.hasOwn(declaration, "metadata")).toBe(false);
      }
      if (!declarations.length) expect(refines).toBe("");
    }
  });

  it("preserves explicit Type ownership, omissions and the two correlated Refines pairs", () => {
    const type = document("type");
    expect(documentedSection(type, "Descriptor")).toBe(
      "| Field | Value (JSON) |\n| --- | --- |\n| abstract | true |",
    );
    expect(documentedSection(type, "Selectors").split("\n")).toEqual([
      "| Name | Match | Type URI | Revision (JSON) |",
      "| --- | --- | --- | --- |",
      `| refines | family | ${namespace}refines | "refines-2" |`,
    ]);
    expect(documentedSection(type, "Owns outgoing")).toBe("| Selector |\n| --- |\n| refines |");
    for (const name of ["bead-type", "link-type", "refines"]) {
      const text = document(name);
      expect([...text.matchAll(/^## Descriptor$/gm)]).toHaveLength(0);
      expect(text).not.toContain("## Owns outgoing");
    }
    const refines = document("refines");
    expect(documentedSection(refines, "Endpoint pairs").split("\n").slice(2)).toEqual([
      "| bead | either | bead-type | bead | either | bead-type |",
      "| bead | either | link-type | bead | either | link-type |",
    ]);
    expect(documentedSection(refines, "Selectors").split("\n")).toEqual([
      "| Name | Match | Type URI | Revision (JSON) |",
      "| --- | --- | --- | --- |",
      ...["bead-type", "link-type"].map(
        (name) => `| ${name} | family | ${namespace}${name} | "${name}-2" |`,
      ),
    ]);
    expect(refines).not.toContain("## Link constraints");
    const selected = publication.definitions.find(
      (record: { id: string }) => record.id === `${namespace}refines`,
    );
    expect(Object.keys(selected.properties.linkConstraints)).toEqual(["typeConstraints"]);
    expect(selected.properties.linkConstraints.typeConstraints).toHaveLength(2);
    for (const pair of selected.properties.linkConstraints.typeConstraints)
      expect(pair.source.types).toEqual(pair.target.types);
  });
});

describe("recorded publication source boundary", () => {
  it("keeps pre-metadata source records invalid as current complete reads on metadata alone", () => {
    const validate = validator(`${types.$id}#/$defs/beadRecord`);
    for (const record of publication.definitions) {
      expect(validate(record)).toBe(false);
      expect(validate.errors?.length).toBeGreaterThan(0);
      for (const error of validate.errors ?? []) {
        expect(error.keyword).toBe("required");
        expect(error.params).toEqual({ missingProperty: "metadata" });
      }
      const served = structuredClone(record);
      served.metadata = {};
      for (const links of Object.values(served.ownedLinks) as Record<string, unknown>[][])
        for (const link of links) link.metadata = {};
      expect(validate(served), JSON.stringify(validate.errors)).toBe(true);
      expect(Object.hasOwn(record, "metadata")).toBe(false);
    }
  });
  it("binds only anchored top-level sections, never deeper headings", () => {
    expect(
      documentedSection(
        "# Document\n### Refines\nnot the section\n## Refines\nselected\n## Next\nother",
        "Refines",
      ),
    ).toBe("selected");
    expect(() => documentedSection("### Refines\nwrong", "Refines")).toThrow(
      "Missing or duplicate",
    );
    expect(() => documentedSection("## Refines\none\n## Refines\ntwo", "Refines")).toThrow(
      "Missing or duplicate",
    );
  });
});
